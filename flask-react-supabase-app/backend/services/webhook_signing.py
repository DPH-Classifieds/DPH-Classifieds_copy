"""
HMAC-SHA256 signing helper for outbound webhook deliveries.

Stdlib only — no third-party dependencies.
"""
import hashlib
import hmac


def sign(secret: str, body: bytes) -> str:
    """Returns 'sha256=' + HMAC-SHA256(secret, body) as hex."""
    digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"
