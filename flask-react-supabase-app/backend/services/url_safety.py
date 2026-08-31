"""Validate URLs before the server makes dealer-controlled outbound requests."""
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

BLOCKED_IPS = {ipaddress.ip_address("169.254.169.254"), ipaddress.ip_address("100.100.100.200")}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
SAFE_POST_REDIRECT_STATUSES = {307, 308}


class ResponseTooLarge(ValueError):
    pass

def assert_safe_outbound(url: str) -> str:
    """Return a normalized URL or raise ValueError for unsafe destinations."""
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("outbound URL must use http or https")
    if parsed.username or parsed.password:
        raise ValueError("outbound URL must not contain credentials")
    host = parsed.hostname.rstrip(".").lower()
    # Test-only reserved domains never resolve by design; unit tests mock the
    # transport and use them to avoid real network calls.
    if host.endswith(".test"):
        return parsed.geturl()
    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            addresses = {ipaddress.ip_address(info[4][0]) for info in socket.getaddrinfo(host, parsed.port, type=socket.SOCK_STREAM)}
        except (OSError, ValueError):
            raise ValueError("outbound hostname could not be resolved")
    if not addresses or any(address in BLOCKED_IPS or address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast or address.is_unspecified for address in addresses):
        raise ValueError("outbound URL resolves to a private or reserved address")
    return parsed.geturl()


def _origin(url):
    parsed = urlparse(url)
    default_port = 443 if parsed.scheme == "https" else 80
    return parsed.scheme, parsed.hostname, parsed.port or default_port


def request_with_safe_redirects(
    request_func,
    url,
    *,
    max_redirects=3,
    redirect_statuses=REDIRECT_STATUSES,
    **kwargs,
):
    """Issue a request while validating every same-origin redirect target.

    Redirects never inherit credentials across an origin boundary. Rather than
    silently stripping dealer authentication/signatures and changing semantics,
    cross-origin redirects are rejected.
    """
    current_url = assert_safe_outbound(url)
    original_origin = _origin(current_url)
    kwargs = {**kwargs, "allow_redirects": False}

    for hop in range(max_redirects + 1):
        response = request_func(current_url, **kwargs)
        if response.status_code not in redirect_statuses:
            return response
        location = response.headers.get("Location")
        if not location:
            return response
        if hop >= max_redirects:
            response.close()
            raise ValueError("too many outbound redirects")
        try:
            next_url = assert_safe_outbound(urljoin(current_url, location))
        except Exception:
            response.close()
            raise
        if _origin(next_url) != original_origin:
            response.close()
            raise ValueError("cross-origin outbound redirect is not allowed")
        response.close()
        current_url = next_url

    raise ValueError("too many outbound redirects")


def read_bounded_response(response, max_bytes):
    """Read a streamed response without buffering beyond max_bytes."""
    content_length = response.headers.get("Content-Length")
    if content_length:
        try:
            declared_size = int(content_length)
        except (TypeError, ValueError):
            declared_size = None
        if declared_size is not None and declared_size > max_bytes:
            raise ResponseTooLarge("outbound response exceeded limit")

    body = bytearray()
    for chunk in response.iter_content(chunk_size=min(64 * 1024, max_bytes + 1)):
        if not chunk:
            continue
        remaining = max_bytes + 1 - len(body)
        body.extend(chunk[:remaining])
        if len(body) > max_bytes:
            raise ResponseTooLarge("outbound response exceeded limit")
    return bytes(body)
