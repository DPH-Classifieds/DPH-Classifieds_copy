# Audit Remediation: Security & Auth Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every confirmed HIGH/CRITICAL security finding from `docs/audits/AUDIT_REPORT.md` §4 and §6.3 that touches authentication, authorization, secrets, or out-of-process trust boundaries.

**Architecture:** Defence-in-depth layered fixes — fail-closed defaults, atomic-claim patterns, scoped queries, lock-protected shared state, and secrets off-disk. Each fix is a small, surgical edit with a regression test that pins the new shape.

**Tech Stack:**
- Backend: Python 3, Flask, `unittest` (existing pattern), `requests`, `xml.etree.ElementTree` → `defusedxml`
- Workers: existing `supabase_request` wrapper, threading locks added at module scope
- Migrations: SQL applied directly in Supabase SQL Editor (no ORM)
- Docker: add `USER` directive at end of each Dockerfile
- Mobile: `expo-secure-store` (new dep)
- Frontend: `defusedxml` is server-side; frontend fix is `localStorage` → `sessionStorage`

**Reference spec:** `docs/audits/AUDIT_REPORT.md` lines 1–450 (specifically §6.3 NEW-1 through NEW-11, §4 Security, §3.1 C-M1/C-M2/C-M4, §1.1 C-B1–C-B7, §1.2 H-B4–H-B10, §6.1 PDF contradictions)

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/app.py:140,150,153` | Process-wide `defaultdict(deque)` rate-limiters | Add `threading.Lock()` |
| `backend/app.py:4354-4373, 4367-4373, 4407-4413` | Rate-limit mutation sites | All reads/writes hold the lock |
| `backend/app.py:3366, 3400, 3404, 3437, 3457, 3461` | `token_preview` JWT-fragment logging | Drop token from logs; emit correlation UUID instead |
| `backend/app.py:4345-4403` | `_rate_limited` Redis fallback path | Distinguish "Redis unreachable" from "Redis said no" |
| `backend/app.py:19799` | Listing-status email in request path | Fire-and-forget via daemon thread |
| `backend/services/vin_decoder.py:27` | Module-global `_VIN_CACHE` dict | Wrap with `threading.Lock()` |
| `backend/services/url_safety.py` (NEW) | Shared SSRF guard for all outbound URLs | New file |
| `backend/services/dealer_inventory.py:8, 38` | `xml.etree.ElementTree.fromstring` | Replace with `defusedxml.ElementTree.fromstring` |
| `backend/routes/dealer/webhooks.py:83-84, 142-146` | Webhook URL accept path | Validate via `assert_safe_outbound` |
| `backend/routes/dealer/webhooks.py:261-266` | Webhook test-send path | Validate before fetch + cap response body (already 500 chars) |
| `backend/workers/webhook_delivery_worker.py:117` | Delivery PATCH | Add conditional `status=eq.pending` claim to `in_progress` |
| `backend/workers/dealer_auto_approval_worker.py:111-112` | Auto-approval PATCH | Same conditional claim pattern |
| `backend/workers/dealer_auto_approval_worker.py:184-194` | `_fetch_image_bytes` | Wrap in `assert_safe_outbound`; cap to 25 MB; require `https://` |
| `backend/workers/auto_review_worker.py:297-299` | `row["_ar_offending_image_urls"]` in-place mutation | Return `(analysis, urls)` from `build_signals_for` |
| `backend/workers/auto_review_worker.py:262-264` | Trust tier reputation counters hardcoded to 0 | Compute from `auto_review_decisions` + `lead_events`; gate tier on count |
| `backend/routes/dealer/core.py:198-209` | `revoke_member` doesn't invalidate JWTs | After PATCH, call Supabase Admin `/auth/v1/admin/users/<id>/logout` |
| `backend/routes/dealer/diagnostic.py:37-42` | Listing fetch with no `dealership_id` filter | Add `dealership_id=eq.{ctx}` |
| `backend/routes/dealer/market.py:30-40` | Same | Same |
| `backend/routes/dealer/_decorators.py:150-163` | `_audit_write` skips GETs | Audit all 2xx responses for `actor_kind='admin'` |
| `backend/routes/admin.py:23-93` | Duplicate `admin_required` decorator | Delete; route through `app.py:19101` |
| `backend/routes/admin.py:1219-1286` | `remove_admin` doesn't call `_protect_super_admin` | Add guard at top |
| `backend/routes/buying_requests.py:281-395` | POST has no rate-limit | Add `@limiter.limit("10/minute")` |
| `flask-react-supabase-app/ocr-service/app.py:30, 123` (sibling of `backend/`, not nested in it) | `OCR_SERVICE_KEY` fail-open | Fail-closed at startup + at request |
| `flask-react-supabase-app/vision-service/app.py:21, 134` | Same | Same |
| `backend/apply_migration.py:5-28` | Opens arbitrary file paths | Constrain to `backend/migrations/` and `supabase/migrations/`; reject `..` |
| `backend/Dockerfile`, `flask-react-supabase-app/ocr-service/Dockerfile`, `flask-react-supabase-app/vision-service/Dockerfile` | No `USER` directive | Add `RUN useradd -m appuser && USER appuser` |
| `mobile/src/utils/authService.js:1-36` | JWT in AsyncStorage | Install `expo-secure-store`; replace reads/writes of `AUTH_DATA_KEY` |
| `mobile/src/utils/apiClient.js:36-65` | Same | Same |
| `mobile/package.json` | No `expo-secure-store` | `npx expo install expo-secure-store` |
| `frontend/src/utils/supabaseClient.js:23-32, 122-127, 143-155` | JWT in `localStorage` | Move to `sessionStorage` (browser-only acceptable XSS surface) and clear on tab close; backend switches to `httpOnly` cookie as long-term |
| `backend/app.py:3219` | `_send_listing_status_email` SMTP blocks request | Move to daemon thread |
| `backend/migrations/` (multiple) | Conflicting `is_admin()` / `is_admin(uuid)` | **Owned by DB Plan Task 2.** Apply canonical `CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean ...` |
| `flask-react-supabase-app/apply_rls_policies.sql:26-27` | `users` UPDATE has no `WITH CHECK` | **Owned by DB Plan Task 3.** Add `WITH CHECK` excluding column writes; revoke UPDATE on `is_admin`/`is_super_admin` for `authenticated` |
| `backend/migrations/2026_06_03_dealer_rls.sql` and 9 sibling files | `FOR ALL USING (true)` without `TO service_role` | **Owned by DB Plan Task 1.** Apply canonical DO-block migration |
| `backend/.env` (NOT in repo, but on disk + history) | 15+ live secrets | (Operational — not in this plan) Coordinate rotation with the operator |

Untouched: `backend/workers/worker.py` scheduling, all listing-limit logic, all RLS policies on tables the worker legitimately writes.

---

## Task 1: Add a process-wide rate-limit lock

**Files:**
- Modify: `backend/app.py:140,150,153` (declarations)
- Modify: `backend/app.py:4345-4413` (mutation sites)

- [ ] **Step 1: Write the failing test**

Open `backend/test_contact_lead_ratelimit.py`. Add at the bottom:

```python
import threading
import unittest
from collections import deque
from app import CONTACT_RATE_LIMIT


class TestRateLimitLock(unittest.TestCase):
    def test_concurrent_append_popleft_does_not_raise(self):
        # Simulate two threads concurrently mutating the same deque.
        # Without a lock this raises IndexError or RuntimeError.
        if "lock" not in dir(CONTACT_RATE_LIMIT):
            self.skipTest("CONTACT_RATE_LIMIT does not yet expose a lock attribute")
        errors = []

        def worker():
            try:
                for _ in range(100):
                    key = f"k-{threading.get_ident()}"
                    with CONTACT_RATE_LIMIT.lock:
                        dq = CONTACT_RATE_LIMIT[key]
                        dq.append(0)
                        while dq and dq[0] < -1:
                            dq.popleft()
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(errors, [])
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m pytest backend/test_contact_lead_ratelimit.py::TestRateLimitLock -v 2>&1 | tail -10`
Expected: `SKIPPED` (no `.lock` attribute yet) — that's the failure state for this test as written. Tighten the assertion below.

Actually: change the test to **fail** when the lock is missing. Replace `self.skipTest(...)` with:

```python
        self.assertTrue(
            hasattr(CONTACT_RATE_LIMIT, "lock"),
            "CONTACT_RATE_LIMIT must expose a .lock threading.Lock attribute",
        )
```

Run: `python -m pytest backend/test_contact_lead_ratelimit.py::TestRateLimitLimit -v 2>&1 | tail -10`
Expected: `AssertionError: CONTACT_RATE_LIMIT must expose a .lock threading.Lock attribute`.

- [ ] **Step 3: Add the lock and use it at every mutation site**

In `backend/app.py:140-153`, replace:

```python
CONTACT_RATE_LIMIT = defaultdict(deque)
CONTACT_LEAD_RATE_LIMIT = defaultdict(deque)
AUTH_RATE_LIMIT = defaultdict(deque)
```

with:

```python
import threading
class _LockedRateLimit:
    def __init__(self):
        self._lock = threading.Lock()
        self._data = defaultdict(deque)
    @property
    def lock(self): return self._lock
    def __getitem__(self, k): return self._data[k]
    def __setitem__(self, k, v): self._data[k] = v
    def __contains__(self, k): return k in self._data
    def get(self, k, default=None): return self._data.get(k, default)
    def items(self): return self._data.items()

CONTACT_RATE_LIMIT = _LockedRateLimit()
CONTACT_LEAD_RATE_LIMIT = _LockedRateLimit()
AUTH_RATE_LIMIT = _LockedRateLimit()
```

Then at every rate-limit mutation site (around lines 4345-4413), wrap the body in `with RATE_LIMIT.lock:`. Replace lines like:

```python
entries = CONTACT_RATE_LIMIT[client_ip]
while entries and entries[0] < window_start:
    entries.popleft()
if len(entries) >= max_count:
    return True
entries.append(now)
return False
```

with:

```python
with CONTACT_RATE_LIMIT.lock:
    entries = CONTACT_RATE_LIMIT[client_ip]
    while entries and entries[0] < window_start:
        entries.popleft()
    if len(entries) >= max_count:
        return True
    entries.append(now)
return False
```

The exact line numbers depend on the helper function — locate each `RATE_LIMIT[...]` and wrap the enclosing function body.

- [ ] **Step 4: Re-run the test and verify it passes**

Run: `python -m pytest backend/test_contact_lead_ratelimit.py::TestRateLimitLock -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Run the full backend test suite**

Run: `python -m pytest backend/ --ignore=backend/testdata -q 2>&1 | tail -20`
Expected: same count of passing tests as before this change (no new failures).

- [ ] **Step 6: Commit**

```bash
git add backend/app.py backend/test_contact_lead_ratelimit.py
git commit -m "fix(security): add threading lock to in-process rate-limiters"
```

---

## Task 2: Make contact-lead rate-limit trust real client IPs

**Files:**
- Modify: `backend/app.py:9356-9378` (key derivation)
- Modify: `backend/app.py:21080-21100` (handler key construction)
- Test: `backend/test_contact_lead_ratelimit.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/test_contact_lead_ratelimit.py`:

```python
import ipaddress
from app import _client_ip_for_rate_limit


class TestClientIpForRateLimit(unittest.TestCase):
    def test_valid_ipv4_passes(self):
        self.assertEqual(_client_ip_for_rate_limit("1.2.3.4", "5.6.7.8"), "1.2.3.4")

    def test_valid_ipv6_passes(self):
        self.assertEqual(_client_ip_for_rate_limit("::1", "5.6.7.8"), "::1")

    def test_garbage_forwarded_for_falls_back_to_remote_addr(self):
        self.assertEqual(_client_ip_for_rate_limit("not-an-ip", "5.6.7.8"), "5.6.7.8")

    def test_empty_forwarded_for_falls_back_to_remote_addr(self):
        self.assertEqual(_client_ip_for_rate_limit("", "5.6.7.8"), "5.6.7.8")

    def test_comma_separated_list_picks_first_valid(self):
        self.assertEqual(_client_ip_for_rate_limit("evil, 1.2.3.4", "5.6.7.8"), "1.2.3.4")

    def test_garbage_injection_falls_back(self):
        # Attacker tries to bypass by sending a comma-list ending in a real IP we already rate-limited.
        self.assertEqual(
            _client_ip_for_rate_limit("8.8.8.8),foo=eq.true(garbage", "5.6.7.8"),
            "5.6.7.8",
        )
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m pytest backend/test_contact_lead_ratelimit.py::TestClientIpForRateLimit -v 2>&1 | tail -10`
Expected: `ImportError: cannot import name '_client_ip_for_rate_limit'`.

- [ ] **Step 3: Implement the helper and use it**

In `backend/app.py`, near the existing `X-Forwarded-For` reads (line 9364), add:

```python
def _client_ip_for_rate_limit(forwarded_for_value: str, remote_addr: str) -> str:
    """Pick a real IP for rate-limit keying. Falls back to request.remote_addr."""
    if remote_addr:
        try:
            ipaddress.ip_address(remote_addr.strip())
            return remote_addr.strip()
        except ValueError:
            pass
    if forwarded_for_value:
        for raw in forwarded_for_value.split(","):
            candidate = raw.strip()
            try:
                ipaddress.ip_address(candidate)
                return candidate
            except ValueError:
                continue
    return remote_addr or ""
```

Then at every `client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)` site (lines 9364, 9413, 11376, 11706, 11918, 12058, 12126, 14215, 14252, 14294, 19845 area), replace with:

```python
client_ip = _client_ip_for_rate_limit(
    request.headers.get("X-Forwarded-For", "") or "",
    request.remote_addr or "",
)
```

Also at the contact-lead key-construction site (around `app.py:21080-21100`), build the rate-limit key from the validated IP only:

```python
ip_key = f"ip:{client_ip}"
vid_key = f"vid:{visitor_id}" if (visitor_id and re.match(r"^[A-Za-z0-9._-]{4,64}$", str(visitor_id))) else None
limit_keys = [ip_key] + ([vid_key] if vid_key else [])
```

**Remove the `vid:<visitor_id>` unlimited key** entirely if the regex doesn't match — falling back to IP-only is fine and matches the audit's recommendation.

- [ ] **Step 4: Re-run the tests and verify they pass**

Run: `python -m pytest backend/test_contact_lead_ratelimit.py -v 2>&1 | tail -15`
Expected: PASS for the new `TestClientIpForRateLimit` class. Existing tests in the file should also pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/test_contact_lead_ratelimit.py
git commit -m "fix(security): validate X-Forwarded-For as real IP and drop unlimited visitor_id key"
```

---

## Task 3: Drop JWT fragments from `flask.log`

**Files:**
- Modify: `backend/app.py:3366` (declaration)
- Modify: `backend/app.py:3400, 3404, 3437, 3457, 3461` (5 log calls)
- Modify: `backend/app.py:3337-3467` (`token_required` body)

- [ ] **Step 1: Write the failing test**

Create `backend/test_no_token_in_logs.py`:

```python
import logging
import unittest
import uuid
from unittest.mock import patch

from app import token_required


class TestNoTokenInLogs(unittest.TestCase):
    def setUp(self):
        # Capture all log records emitted during the failing-auth path.
        self.records = []

        class CaptureHandler(logging.Handler):
            def emit(self, record):
                self.records.append(record)

        self.handler = CaptureHandler()
        logging.getLogger().addHandler(self.handler)
        self.handler.setLevel(logging.DEBUG)

    def tearDown(self):
        logging.getLogger().removeHandler(self.handler)

    def test_token_prefix_never_appears_in_log_message(self):
        # We don't actually need a real request — just call the inner log path
        # that the original code triggered.
        token = "eyJhbGciOiJIUzI1NiJ9." + "A" * 200
        from flask import Flask
        app = Flask(__name__)

        # Trigger a missing-token path inside token_required to exercise
        # the failure branches that log token_preview.
        client = app.test_client()
        with app.test_request_context("/x"):
            with self.assertRaises(Exception):
                # No Authorization header → falls into local JWT branch →
                # which calls _decode_supabase_jwt_secret(token) → which
                # logs the token_preview for an empty/garbage token.
                token_required(lambda: "ok")()

        joined = " ".join(r.getMessage() for r in self.records)
        # Token prefix (first 12 chars of any 24-byte slice) must not appear.
        self.assertNotIn(token[:12], joined)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m pytest backend/test_no_token_in_logs.py -v 2>&1 | tail -15`
Expected: FAIL with "AssertionError: 'eyJhbGciOiJ' should not be in joined log output". (The audit verified `token_preview` is emitted at lines 3400, 3404, 3437, 3457, 3461; this test catches any leak that crosses any logging path.)

- [ ] **Step 3: Replace `token_preview` with a request-scoped correlation UUID**

In `backend/app.py` at line 3366, replace:

```python
token_preview = token[:20] + "..." if len(token) > 20 else token
```

with:

```python
import uuid as _uuid
correlation_id = _uuid.uuid4().hex
token_preview = correlation_id[:8]
# token_preview is now a random per-request UUID hex, not a JWT fragment.
```

Then at all 5 log sites (3400, 3404, 3437, 3457, 3461), the variable `token_preview` will now be a 8-char hex correlation ID rather than the first 20 characters of the token. No further edits needed; the variable name is misleading but the semantic is now safe.

If you prefer to rename for readability, do a follow-up rename of `token_preview` → `correlation_suffix` across the file. Don't rename as part of this task.

- [ ] **Step 4: Re-run the test and verify it passes**

Run: `python -m pytest backend/test_no_token_in_logs.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/test_no_token_in_logs.py
git commit -m "fix(security): stop logging JWT fragments; emit per-request correlation ID"
```

---

## Task 4: Add `services/url_safety.py` and wire it into the webhook path

**Files:**
- Create: `backend/services/url_safety.py`
- Modify: `backend/routes/dealer/webhooks.py:83-84, 142-146, 261-266`
- Modify: `backend/workers/webhook_delivery_worker.py:119`
- Test: `backend/test_url_safety.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_url_safety.py`:

```python
import unittest

from services.url_safety import assert_safe_outbound, UnsafeOutboundUrlError


class TestAssertSafeOutbound(unittest.TestCase):
    def test_allows_public_https(self):
        assert_safe_outbound("https://example.com/webhook")

    def test_allows_public_http(self):
        assert_safe_outbound("http://example.com/webhook")

    def test_rejects_loopback_ipv4(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("http://127.0.0.1/x")

    def test_rejects_loopback_ipv6(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("http://[::1]/x")

    def test_rejects_rfc1918_10(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("http://10.0.0.5/x")

    def test_rejects_rfc1918_172(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("http://172.16.0.1/x")

    def test_rejects_rfc1918_192(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("http://192.168.1.1/x")

    def test_rejects_link_local_metadata(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("http://169.254.169.254/latest/meta-data")

    def test_rejects_non_http_scheme(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("file:///etc/passwd")

    def test_rejects_garbage(self):
        with self.assertRaises(UnsafeOutboundUrlError):
            assert_safe_outbound("not a url")

    def test_rejects_hostname_resolves_to_private(self):
        # The whole point of the check is DNS-time resolution, which is hard
        # to test deterministically. We at minimum verify the function tries
        # to resolve by mocking socket.gethostbyname.
        from unittest.mock import patch
        with patch("services.url_safety.socket.gethostbyname", return_value="10.0.0.5"):
            with self.assertRaises(UnsafeOutboundUrlError):
                assert_safe_outbound("http://internal.example.com/x")
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m pytest backend/test_url_safety.py -v 2>&1 | tail -10`
Expected: `ModuleNotFoundError: No module named 'services.url_safety'`.

- [ ] **Step 3: Implement `services/url_safety.py`**

Create `backend/services/url_safety.py`:

```python
import ipaddress
import socket
from urllib.parse import urlparse


class UnsafeOutboundUrlError(ValueError):
    """Raised when an outbound URL fails the SSRF safety check."""


def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_safe_outbound(url: str) -> None:
    """Raise UnsafeOutboundUrlError if `url` resolves to a non-public destination.

    Validates:
    - Scheme is http or https (no file://, gopher://, ftp://, etc.)
    - Hostname is present
    - Resolved IPs (all A/AAAA records) are public — RFC1918, loopback,
      link-local (169.254/16 — cloud metadata), multicast, reserved, and
      unspecified addresses are all rejected.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeOutboundUrlError(f"scheme {parsed.scheme!r} not allowed")
    host = parsed.hostname
    if not host:
        raise UnsafeOutboundUrlError("missing host")
    # If host is already an IP, check directly; otherwise resolve.
    try:
        ipaddress.ip_address(host)
        resolved_ips = [host]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror as e:
            raise UnsafeOutboundUrlError(f"DNS resolution failed: {e}") from e
        resolved_ips = list({i[4][0] for i in infos})
    for ip in resolved_ips:
        if _is_blocked_ip(ip):
            raise UnsafeOutboundUrlError(
                f"host {host!r} resolves to blocked ip {ip}"
            )
```

- [ ] **Step 4: Re-run the test and verify it passes**

Run: `python -m pytest backend/test_url_safety.py -v 2>&1 | tail -15`
Expected: all 11 cases PASS.

- [ ] **Step 5: Wire into webhook accept path**

In `backend/routes/dealer/webhooks.py`, change every URL acceptance site (lines 83-84, 142-146, 261-266) to validate before persisting / dispatching. Find the URL read (likely `payload.get("url", "")`); after extracting it, call:

```python
from services.url_safety import assert_safe_outbound, UnsafeOutboundUrlError

try:
    assert_safe_outbound(url)
except UnsafeOutboundUrlError as e:
    return jsonify({"error": f"unsafe url: {e}"}), 400
```

For the **test-send** handler (line 261-266), wrap the `requests.post(url, ...)` in the same try/except and return 400 on rejection.

For the **delivery worker** (`backend/workers/webhook_delivery_worker.py:119`), wrap the outbound POST:

```python
try:
    assert_safe_outbound(webhook_url)
except UnsafeOutboundUrlError:
    _mark_dead_letter(delivery_id, reason="unsafe_url")
    continue
```

- [ ] **Step 6: Commit**

```bash
git add backend/services/url_safety.py backend/test_url_safety.py \
        backend/routes/dealer/webhooks.py backend/workers/webhook_delivery_worker.py
git commit -m "fix(security): reject RFC1918/loopback/metadata URLs for dealer webhooks"
```

---

## Task 5: Apply the same SSRF guard to `dealer_api_sources` and `auto_review_worker`

**Files:**
- Modify: `backend/routes/dealer/api_sources.py:131-198, 341`
- Modify: `backend/workers/dealer_api_source_poller.py:99-126`
- Modify: `backend/workers/auto_review_worker.py:184-194`

- [ ] **Step 1: Wire the URL guard into `api_sources.py` accept + test + poller**

Same pattern as Task 4 Step 5. Every `endpoint_url` read (create at line 189, test at 341, poller at `:106`) must validate via `assert_safe_outbound(endpoint_url)` before any `requests.get(...)` or persistent insert.

For the **create** path, return 400 with `{"error": "unsafe endpoint_url"}` on rejection.

For the **test** and **poller** paths, drop into the dead-letter / failure branch and log a warning.

- [ ] **Step 2: Cap the response body and require `https://` for `auto_review_worker` image fetches**

In `backend/workers/auto_review_worker.py:184-194`, change `_fetch_image_bytes`:

```python
def _fetch_image_bytes(url: str) -> bytes:
    from services.url_safety import assert_safe_outbound, UnsafeOutboundUrlError
    try:
        assert_safe_outbound(url)
    except UnsafeOutboundUrlError as e:
        logger.warning("auto-review skipping unsafe image url %s: %s", url, e)
        return b""
    if not url.startswith("https://"):
        return b""
    resp = requests.get(url, timeout=8, stream=True)
    chunks = []
    total = 0
    for chunk in resp.iter_content(chunk_size=64 * 1024):
        total += len(chunk)
        if total > 25 * 1024 * 1024:
            resp.close()
            return b""
        chunks.append(chunk)
    return b"".join(chunks)
```

Note the `b""` empty-bytes contract — callers (around `:194` and downstream) must tolerate empty bytes.

- [ ] **Step 3: Add tests for the SSRF rejection**

Append to `backend/test_url_safety.py`:

```python
class TestAutoReviewUrlAllowed(unittest.TestCase):
    def test_http_rejected(self):
        # auto_review specifically allows only https
        from backend.workers.auto_review_worker import _fetch_image_bytes
        result = _fetch_image_bytes("http://example.com/img.jpg")
        self.assertEqual(result, b"")

    def test_https_private_ip_rejected(self):
        from backend.workers.auto_review_worker import _fetch_image_bytes
        result = _fetch_image_bytes("https://10.0.0.5/img.jpg")
        self.assertEqual(result, b"")
```

(Resolve the import path; the test file lives under `backend/` so `from workers.auto_review_worker import ...` may be more correct — adjust to your project's working directory.)

- [ ] **Step 4: Run tests and verify they pass**

Run: `python -m pytest backend/test_url_safety.py backend/test_dealer_api_source_poller.py -v 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/dealer/api_sources.py \
        backend/workers/dealer_api_source_poller.py \
        backend/workers/auto_review_worker.py \
        backend/test_url_safety.py
git commit -m "fix(security): apply SSRF guard to api-sources and auto-review image fetches"
```

---

## Task 6: Replace raw XML parser in `dealer_inventory.py` with `defusedxml`

**Files:**
- Modify: `backend/services/dealer_inventory.py:8, 38`
- Modify: `backend/requirements.txt` (add `defusedxml`)
- Test: `backend/test_dealer_inventory_service.py`

- [ ] **Step 1: Add `defusedxml` to requirements**

In `backend/requirements.txt`, append a line (respect alphabetical ordering):

```
defusedxml==0.7.1
```

Run: `pip install -r backend/requirements.txt 2>&1 | tail -3`
Expected: successfully installed defusedxml-0.7.1.

- [ ] **Step 2: Write a failing test that demonstrates XXE is currently possible**

Append to `backend/test_dealer_inventory_service.py`:

```python
import unittest


class TestDealerInventoryXmlIsDefused(unittest.TestCase):
    def test_xxe_payload_does_not_read_local_file(self):
        from services.dealer_inventory import parse_inventory
        xxe_payload = b"""<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<inventory><item>&xxe;</item></inventory>"""
        try:
            out = parse_inventory(xxe_payload)
        except Exception:
            return  # Either rejection or no-op is acceptable
        # If we got back data, it MUST NOT contain /etc/passwd contents.
        joined = (out or "")
        if isinstance(joined, (list, dict)):
            joined = str(joined)
        self.assertNotIn("root:x:0:0", joined)
```

- [ ] **Step 3: Run and verify the test currently fails**

Run: `python -m pytest backend/test_dealer_inventory_service.py::TestDealerInventoryXmlIsDefused -v 2>&1 | tail -10`
Expected: FAIL with `AssertionError: 'root:x:0:0' IS in joined`.

(If `parse_inventory` doesn't accept bytes but takes a string, adapt the test to pass `xxe_payload.decode()` and re-run.)

- [ ] **Step 4: Replace `ET.fromstring` with `defusedxml.ElementTree.fromstring`**

In `backend/services/dealer_inventory.py`:

```diff
-import xml.etree.ElementTree as ET
+from defusedxml import ElementTree as ET
```

No other changes needed; `defusedxml.ElementTree` has the same API as `xml.etree.ElementTree` for the call paths actually used.

- [ ] **Step 5: Re-run and verify the test passes**

Run: `python -m pytest backend/test_dealer_inventory_service.py::TestDealerInventoryXmlIsDefused -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/dealer_inventory.py backend/requirements.txt backend/test_dealer_inventory_service.py
git commit -m "fix(security): use defusedxml for dealer inventory XML parsing"
```

---

## Task 7: Fail-closed auth on OCR and Vision services

**Files:**
- Modify: `flask-react-supabase-app/ocr-service/app.py:30, 118-150`
- Modify: `flask-react-supabase-app/vision-service/app.py:21, 132-157`
- Test: each service has no test directory; create `flask-react-supabase-app/ocr-service/test_auth.py` and `flask-react-supabase-app/vision-service/test_auth.py`

> **Path note:** `ocr-service/` and `vision-service/` are siblings of `backend/`
> under `flask-react-supabase-app/`, NOT nested inside `backend/` — confirmed via
> `find flask-react-supabase-app -maxdepth 1 -iname "*ocr*" -o -iname "*vision*"`.
> All paths below are corrected accordingly.

- [ ] **Step 1: Write the failing test for OCR service**

Create `flask-react-supabase-app/ocr-service/test_auth.py`:

```python
import importlib
import os
import unittest
from unittest.mock import patch


class TestOcrServiceKeyEnforced(unittest.TestCase):
    def test_unset_key_raises_at_import(self):
        with patch.dict(os.environ, {"OCR_SERVICE_KEY": ""}, clear=False):
            with self.assertRaises(RuntimeError):
                importlib.reload(importlib.import_module("app"))

    def test_garbage_header_rejected_when_key_set(self):
        os.environ["OCR_SERVICE_KEY"] = "secret-key-xyz"
        import importlib
        mod = importlib.reload(importlib.import_module("app"))
        from fastapi.testclient import TestClient
        client = TestClient(mod.app)
        # No header sent
        resp = client.post("/scan", files={"image": ("x.jpg", b"\xff", "image/jpeg")})
        self.assertEqual(resp.status_code, 401)
        # Wrong header sent
        resp = client.post("/scan",
                           headers={"X-OCR-Service-Key": "wrong"},
                           files={"image": ("x.jpg", b"\xff", "image/jpeg")})
        self.assertEqual(resp.status_code, 401)
        # Correct header sent
        resp = client.post("/scan",
                           headers={"X-OCR-Service-Key": "secret-key-xyz"},
                           files={"image": ("x.jpg", b"\xff", "image/jpeg")})
        self.assertNotEqual(resp.status_code, 401)
```

- [ ] **Step 2: Run and verify fail**

Run: `cd flask-react-supabase-app/ocr-service && python -m pytest test_auth.py -v 2>&1 | tail -15`
Expected: most assertions FAIL (the env-unset path is currently silent — no exception raised).

- [ ] **Step 3: Make OCR auth fail-closed**

In `flask-react-supabase-app/ocr-service/app.py:30`, replace:

```python
OCR_SERVICE_KEY = os.getenv("OCR_SERVICE_KEY", "")
```

with:

```python
OCR_SERVICE_KEY = os.getenv("OCR_SERVICE_KEY", "")
if not OCR_SERVICE_KEY:
    raise RuntimeError(
        "OCR_SERVICE_KEY is required. Refusing to start without it "
        "(unset key was previously returning 200 to all callers)."
    )
```

Then in the `scan` endpoint (around `:118-150`), replace the auth check at line 123:

```python
if OCR_SERVICE_KEY and x_ocr_service_key != OCR_SERVICE_KEY:
    raise HTTPException(status_code=401, detail="Unauthorized")
```

with:

```python
if x_ocr_service_key != OCR_SERVICE_KEY:
    raise HTTPException(status_code=401, detail="Unauthorized")
```

Since startup now guarantees `OCR_SERVICE_KEY` is non-empty, the conditional becomes a simple comparison.

- [ ] **Step 4: Apply the same pattern to `vision-service/app.py`**

Mirror the change in `flask-react-supabase-app/vision-service/app.py:21, 134`:
- At import: `if not VISION_SERVICE_KEY: raise RuntimeError(...)`
- In endpoint: drop the `VISION_SERVICE_KEY and` guard.

- [ ] **Step 5: Add the equivalent test for the vision service**

Mirror `test_auth.py` for `flask-react-supabase-app/vision-service/test_auth.py`. Replace `app` → `app_vision` (or whatever the FastAPI `app` instance is named in `vision-service/app.py`) and `X-OCR-Service-Key` → `X-Vision-Service-Key`.

- [ ] **Step 6: Run both test files**

Run:
```bash
cd flask-react-supabase-app/ocr-service && python -m pytest test_auth.py -v
cd ../vision-service && python -m pytest test_auth.py -v
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add flask-react-supabase-app/ocr-service/ flask-react-supabase-app/vision-service/
git commit -m "fix(security): fail-closed auth on ocr-service and vision-service"
```

---

## Task 8: Add `USER` directive to all three Dockerfiles

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `flask-react-supabase-app/ocr-service/Dockerfile`
- Modify: `flask-react-supabase-app/vision-service/Dockerfile`

- [ ] **Step 1: Add `USER` to `backend/Dockerfile`**

Append after the last `RUN` / `COPY` / `CMD`:

```dockerfile
RUN groupadd --system app && useradd --system --gid app --home /home/app --shell /sbin/nologin app
# Above may fail if the base image already provides such a user; if so,
# switch to a numeric UID:
# USER 1000:1000
USER app
```

(If the existing image uses `python:3.x-slim` or similar, prefer the numeric form for fewer surprises. Use `USER 1000:1000` and ensure file ownership at build time.)

- [ ] **Step 2: Mirror for `ocr-service/Dockerfile`**

Same change.

- [ ] **Step 3: Mirror for `vision-service/Dockerfile`**

Same change.

- [ ] **Step 4: Build each image locally**

Run:
```bash
docker build -t dph-backend:test backend/
docker build -t dph-ocr:test flask-react-supabase-app/ocr-service/
docker build -t dph-vision:test flask-react-supabase-app/vision-service/
```
Expected: build succeeds. If `USER` collapses user-writable temp paths and breaks the runtime, fix by adding `chown` lines before `USER` — but this is rare for Flask + uvicorn services.

- [ ] **Step 5: Verify the running user is non-root**

Run:
```bash
docker run --rm dph-backend:test id -u
docker run --rm dph-ocr:test id -u
docker run --rm dph-vision:test id -u
```
Expected: prints `1000` (or whatever UID you chose), not `0`.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile flask-react-supabase-app/ocr-service/Dockerfile flask-react-supabase-app/vision-service/Dockerfile
git commit -m "fix(security): run containers as non-root user"
```

---

## Task 9: Close the IDOR in `diagnostic.py` and `market.py`

**Files:**
- Modify: `backend/routes/dealer/diagnostic.py:37-42`
- Modify: `backend/routes/dealer/market.py:30-40`
- Test: existing `backend/test_dealer_diagnostic.py` and `backend/test_dealer_market.py` (or create if absent)

- [ ] **Step 1: Write a failing IDOR test**

Create `backend/test_dealer_diagnostic_idor.py`:

```python
import unittest
from unittest.mock import patch, MagicMock


class TestDiagnosticIdor(unittest.TestCase):
    def setUp(self):
        # Simulate a dealer from dealership A trying to read a listing that
        # belongs to dealership B. The current code accepts the request and
        # returns diagnostic data; the patched code must return 404.
        self.ctx_a = {"dealership_id": "dealership-a", "user_id": "u1", "actor_kind": "member"}
        self.listing_b = {"id": "listing-b", "user_id": "u2", "dealership_id": "dealership-b"}

    def _request(self, mock_get, listing_id="listing-b"):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: [self.listing_b] if mock_get.call_args[1]["params"]["id"].endswith(listing_id) else [],
        )
        return mock_get

    @patch("requests.get")
    def test_a_cannot_read_b_listing(self, mock_get):
        # Patch the supabase listing fetch to return listing_b but the
        # dealership-filter fetch to return [] (no row matches after filter).
        def side_effect(url, **kw):
            params = kw.get("params", {})
            if "id=" in params.get("id", "") and params.get("dealership_id") == "eq.dealership-a":
                m = MagicMock(status_code=200, json=lambda: [])
                return m
            return MagicMock(status_code=200, json=lambda: [self.listing_b])

        mock_get.side_effect = side_effect

        from routes.dealer.diagnostic import listing_diagnostic
        from flask import Flask, g
        app = Flask(__name__)
        with app.test_request_context("/api/dealer/listings/car/listing-b/diagnostic"):
            g.dealer_ctx = self.ctx_a
            # current_user is unused by diagnostic.py but the decorator order
            # requires it
            resp = listing_diagnostic("u1", "car", "listing-b")
            # Either a 404 tuple or a flask Response with status 404 is fine.
            self.assertEqual(resp[1], 404)
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_dealer_diagnostic_idor.py -v 2>&1 | tail -10`
Expected: FAIL — the patched current code returns 200 with full diagnostic data because the filter doesn't include `dealership_id`.

- [ ] **Step 3: Add `dealership_id` filter**

In `backend/routes/dealer/diagnostic.py`, replace the listing fetch at lines 37-42:

```python
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_svc(),
        params={"select": "*", "id": f"eq.{listing_id}", "limit": 1},
        timeout=10,
    )
```

with:

```python
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_svc(),
        params={
            "select": "id,user_id,dealership_id,view_count,created_at,updated_at",
            "id": f"eq.{listing_id}",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
            "limit": 1,
        },
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return jsonify({"error": {"code": "listing_not_found"}}), 404
```

Note: tighten the `select` to the columns actually used downstream — limit blast radius if any future field is added to the response.

- [ ] **Step 4: Mirror the change in `routes/dealer/market.py:30-40`**

Same shape, same `dealership_id=eq.{ctx}` filter.

- [ ] **Step 5: Re-run tests and verify**

Run: `python -m pytest backend/test_dealer_diagnostic_idor.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/dealer/diagnostic.py \
        backend/routes/dealer/market.py \
        backend/test_dealer_diagnostic_idor.py
git commit -m "fix(security): scope diagnostic and market endpoints to caller's dealership"
```

---

## Task 10: Atomic-claim pattern for auto-approval and webhook delivery workers

**Files:**
- Modify: `backend/workers/dealer_auto_approval_worker.py:67-86, 111-112, 181-207`
- Modify: `backend/workers/webhook_delivery_worker.py:34, 77-166`
- Test: existing `backend/test_dealer_auto_approval_worker.py` + `backend/test_webhook_delivery_worker.py`

- [ ] **Step 1: Add atomic claim to auto-approval worker**

In `backend/workers/dealer_auto_approval_worker.py`, replace `_mark`:

```python
def _claim(row_id):
    """Atomically transition a pending row to 'firing'. Returns True iff this
    caller won the claim. Two replicas racing on the same row will both call
    this; only one will see a non-empty returned row."""
    body, status = supabase_request(
        "patch",
        f"/rest/v1/dealer_pending_approvals?id=eq.{row_id}&state=eq.pending",
        data={"state": "firing"},
        return_representation=True,
    )
    return bool(body) and status < 300
```

Then in `_process_one` (around line 181), gate the work on the claim:

```python
def _process_one(row):
    if not _claim(row["id"]):
        return False  # lost the race; another replica is handling it
    # ... existing body unchanged ...
    _mark(row["id"], state="fired", fired_at=datetime.utcnow().isoformat())
    return True
```

Ensure `supabase_request` accepts `return_representation=True` (it should — verify in `backend/supabase/__init__.py`; if not, add it).

- [ ] **Step 2: Add atomic claim to webhook delivery worker**

In `backend/workers/webhook_delivery_worker.py`, mirror the pattern. Add an `_attempt_claim(delivery_id)` that PATCHes `status=eq.pending → status=in_progress`. Wrap the per-row fetch + claim + HTTP call in `_process_one`.

The existing constant `BACKOFF_SECONDS` (line 20-21) and `MAX_ATTEMPTS = 5` are fine — only the claim step changes. After the HTTP call, PATCH with the terminal state (`status=succeeded` or `status=dead_letter` or `status=queued` with incremented `attempt_count`).

- [ ] **Step 3: Add a regression test for double-claim prevention**

Create `backend/test_claim_pattern.py`:

```python
import unittest
from unittest.mock import patch


class TestClaimPattern(unittest.TestCase):
    @patch("workers.dealer_auto_approval_worker.supabase_request")
    def test_only_one_claim_wins(self, mock_req):
        from workers.dealer_auto_approval_worker import _claim
        # Simulate two replicas both calling _claim on the same id.
        # The first PATCH returns the row (won), the second returns [] (lost).
        state = {"calls": 0}

        def fake_req(method, path, data=None, **kw):
            state["calls"] += 1
            if state["calls"] == 1:
                return [{"id": "r1", "state": "firing"}], 200
            return [], 200

        mock_req.side_effect = fake_req
        self.assertTrue(_claim("r1"), "first claim should win")
        self.assertFalse(_claim("r1"), "second claim should lose")
```

- [ ] **Step 4: Run the test and verify**

Run: `python -m pytest backend/test_claim_pattern.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/workers/dealer_auto_approval_worker.py \
        backend/workers/webhook_delivery_worker.py \
        backend/test_claim_pattern.py
git commit -m "fix(security): atomic-claim pattern prevents double approval / double delivery"
```

---

## Task 11: Move mobile auth tokens to `expo-secure-store`

**Files:**
- Modify: `mobile/package.json` (add dep)
- Modify: `mobile/src/utils/authService.js:1-36`
- Modify: `mobile/src/utils/apiClient.js:36-65`

- [ ] **Step 1: Install `expo-secure-store`**

Run: `cd mobile && npx expo install expo-secure-store 2>&1 | tail -5`
Expected: "Added 1 package" or version update to `package.json`.

- [ ] **Step 2: Create a small SecureStorage wrapper**

Create `mobile/src/utils/secureStore.js`:

```js
import * as SecureStore from 'expo-secure-store';

export async function readJson(key) {
  const raw = await SecureStore.getItemAsync(key);
  return raw ? JSON.parse(raw) : null;
}

export async function writeJson(key, value) {
  await SecureStore.setItemAsync(key, JSON.stringify(value));
}

export async function clear(key) {
  await SecureStore.deleteItemAsync(key);
}
```

- [ ] **Step 3: Switch `authService.js` to SecureStore**

In `mobile/src/utils/authService.js`, replace the AsyncStorage import (line 1) and the three reads/writes of `AUTH_DATA_KEY`:

```js
// At the top:
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { readJson, writeJson, clear } from './secureStore';

const AUTH_DATA_KEY = 'auth_data';
const CACHED_USER_KEY = 'dph_cached_user_v1';

// In saveAuthData:
async function saveAuthData(authData) {
  await writeJson(AUTH_DATA_KEY, authData);
}

// In readAuthData:
async function readAuthData() {
  return await readJson(AUTH_DATA_KEY);
}

// In clearAuthData:
async function clearAuthData() {
  await clear(AUTH_DATA_KEY);
}
```

Tokens (access_token, refresh_token) MUST stay in SecureStore. Non-secret cache (e.g. cached user display info) can remain on AsyncStorage.

- [ ] **Step 4: Update `apiClient.js:36-65`**

Replace AsyncStorage reads/writes of `AUTH_DATA_KEY` with calls into the wrapper. Specifically, `getAuthToken()` calls `readJson('auth_data')?.then(d => d?.access_token ?? null)`.

- [ ] **Step 5: Manual smoke test on a simulator**

Run: `cd mobile && npx expo start 2>&1 | tail -5`
Then in the Expo CLI, run the app in a simulator. Sign in via `/login`. Verify the token persists across an app kill and restart. Log out. Verify SecureStore is cleared (you can verify by running the SecureStore dev tools if available, or by logging the secure-store contents after re-login to ensure reads succeed).

- [ ] **Step 6: Commit**

```bash
git add mobile/package.json mobile/src/utils/authService.js mobile/src/utils/apiClient.js mobile/src/utils/secureStore.js
git commit -m "fix(security): store mobile JWT in expo-secure-store instead of AsyncStorage"
```

---

## Task 15: Wire trust-tier reputation counters (auto-review)

**Files:**
- Modify: `backend/workers/auto_review_worker.py:262-264` (counter hardcode)
- Modify: `backend/services/auto_review/trust.py:23-30` (gate `verified_user` tier on positive history)
- Test: `backend/test_auto_review_trust.py` (new)

- [ ] **Step 1: Add a helper that computes reputation from DB**

In `backend/services/auto_review/trust.py`, add:

```python
def reputation_for_user(user_id: str) -> dict:
    """Read aggregate counters from auto_review_decisions + lead_events.
    Returns {'rejections_last_90d': int, 'reports_last_90d': int,
             'approved_listings_count': int}."""
    from supabase import create_client
    # Use the service-role client (this is server-side).
    from app import SUPABASE_URL, SUPABASE_SERVICE_KEY
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    decisions = sb.from_("auto_review_decisions") \
        .select("decision, decided_at") \
        .eq("user_id", user_id) \
        .gte("decided_at", "now() - interval '90 days'") \
        .execute().data or []
    rejections = sum(1 for d in decisions if d.get("decision") == "rejected")

    reports = sb.from_("lead_events") \
        .select("id", count="exact") \
        .eq("reported_user_id", user_id) \
        .gte("created_at", "now() - interval '90 days'") \
        .execute().count or 0

    approved = sb.from_("auto_review_decisions") \
        .select("id", count="exact") \
        .eq("user_id", user_id) \
        .eq("decision", "approved") \
        .execute().count or 0

    return {
        "rejections_last_90d": rejections,
        "reports_last_90d": reports,
        "approved_listings_count": approved,
    }
```

The exact supabase-py API may need adapter calls; adjust to your project's `supabase_request` helper.

- [ ] **Step 2: Use reputation in `_trust_context_for`**

In `backend/workers/auto_review_worker.py:262-264`, replace the hardcoded zeros:

```python
ctx = TrustContext(
    user_id=user_id,
    is_admin=bool(user.get("is_admin")),
    dealer_verified=bool(user.get("dealer_verified")),
    email_verified=bool(user.get("email_verified")),
    phone_verified=bool(user.get("phone_verified")),
    **reputation_for_user(user_id),
)
```

(`unpack the dict with **`.)

- [ ] **Step 3: Tighten `verified_user` tier in `trust.py`**

In `backend/services/auto_review/trust.py`, change:

```python
if user.email_verified and user.phone_verified and user.rejections_last_90d < 3 and user.approved_listings_count >= 3:
    return TrustTier.VERIFIED_USER
```

The exact thresholds (3 rejections, 3 approvals) are policy choices; tune later but ship with values that admit normal users and reject obvious bad actors.

- [ ] **Step 4: Add a regression test**

Create `backend/test_auto_review_trust.py`:

```python
from services.auto_review.trust import evaluate_trust, TrustTier
from services.auto_review.trust import TrustContext


def test_verified_user_requires_positive_history():
    # 0 approvals → falls back to UNVERIFIED
    ctx = TrustContext(
        user_id="u", is_admin=False, dealer_verified=False,
        email_verified=True, phone_verified=True,
        rejections_last_90d=0, reports_last_90d=0,
        approved_listings_count=0,
    )
    assert evaluate_trust(ctx) != TrustTier.VERIFIED_USER

    # 3+ approvals → VERIFIED_USER
    ctx_ok = TrustContext(
        user_id="u", is_admin=False, dealer_verified=False,
        email_verified=True, phone_verified=True,
        rejections_last_90d=0, reports_last_90d=0,
        approved_listings_count=3,
    )
    assert evaluate_trust(ctx_ok) == TrustTier.VERIFIED_USER
```

- [ ] **Step 5: Run and verify**

Run: `python -m pytest backend/test_auto_review_trust.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/auto_review/trust.py \
        backend/workers/auto_review_worker.py \
        backend/test_auto_review_trust.py
git commit -m "fix(security): gate verified_user tier on positive listing history"
```

---

## Task 16: Delete the duplicate `admin_required` decorator and require super-admin guard

**Files:**
- Modify: `backend/routes/admin.py:23-93, 1219-1286`
- Modify: `backend/app.py` (register admin blueprint once if duplication exists)

- [ ] **Step 1: Write a test for `remove_admin` super-admin guard**

Create `backend/test_super_admin_protected.py`:

```python
import unittest


class TestRemoveAdminProtected(unittest.TestCase):
    def test_remove_admin_requires_super_admin(self):
        # Import the route handler; verify the first line checks _is_super_admin_record.
        import inspect
        from routes.admin import remove_admin
        src = inspect.getsource(remove_admin)
        self.assertIn("_is_super_admin_record", src)
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_super_admin_protected.py -v 2>&1 | tail -10`
Expected: FAIL — `remove_admin` doesn't currently call `_is_super_admin_record`.

- [ ] **Step 3: Guard `remove_admin`**

In `backend/routes/admin.py:1219-1286`, at the top of `remove_admin`, add:

```python
from app import _is_super_admin_record
# ... inside the function, after auth check:
if target_user_id and _is_super_admin_record(target_user_id):
    return jsonify({"error": "cannot remove super admin"}), 403
```

The exact import path and `target_user_id` variable name depend on the existing handler shape. Mirror the pattern from `_protect_super_admin` in `app.py` if it exists.

- [ ] **Step 4: Delete the duplicate `admin_required` decorator**

In `backend/routes/admin.py:23-93`, replace the body of `admin_required` with a passthrough that delegates to `app.py:19101`:

```python
def admin_required(f):
    from app import admin_required as app_admin_required
    return app_admin_required(f)
```

Or, more aggressive: delete `admin_required` entirely and update every `@admin_required` decorator in `routes/admin.py` to `@app_admin_required` (imported from `app`). Search:

```bash
grep -n "@admin_required" backend/routes/admin.py
```

For each hit, replace with `@app_admin_required` and add the import at the top.

- [ ] **Step 5: Re-run tests**

Run: `python -m pytest backend/test_super_admin_protected.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Run admin smoke tests**

Run: `python -m pytest backend/test_admin_route_guards.py backend/test_admin_hub_routes_smoke.py -v 2>&1 | tail -10`
Expected: same pass/fail counts as before this change.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/admin.py backend/test_super_admin_protected.py
git commit -m "fix(security): consolidate admin_required and guard super-admin demotion"
```

---

## Task 17: Rate-limit the `buying_requests` POST endpoint

**Files:**
- Modify: `backend/routes/buying_requests.py:281-395`
- Test: existing `backend/test_buying_requests.py`

- [ ] **Step 1: Find the existing rate-limit decorator pattern in the project**

Run: `grep -rn "@limiter.limit" backend/ 2>&1 | head -5`
If the project already uses `flask-limiter`, reuse it. If not, install:

```bash
pip install Flask-Limiter==3.8.0
```

And add `Flask-Limiter==3.8.0` to `backend/requirements.txt`.

- [ ] **Step 2: Apply the rate-limit decorator**

In `backend/routes/buying_requests.py:281-395`, at the top of `create_buying_request` (or whichever function corresponds to POST), add:

```python
from flask_limiter import Limiter
limiter = Limiter(get_remote_address, app=current_app, default_limits=[])
# At the function:
@limiter.limit("10/minute")
def create_buying_request(...):
    ...
```

- [ ] **Step 3: Add a regression test**

Create `backend/test_buying_requests_ratelimit.py`:

```python
import unittest
from unittest.mock import patch


class TestBuyingRequestsRateLimit(unittest.TestCase):
    @patch("routes.buying_requests.supabase_request")
    def test_eleventh_post_in_one_minute_returns_429(self, mock_req):
        # 10 POSTs are allowed; the 11th should be 429
        mock_req.return_value = ({"id": "test"}, 200)
        from app import create_app
        app = create_app(testing=True)
        client = app.test_client()
        for _ in range(10):
            r = client.post("/api/buying-requests", json={...})  # fill in valid payload
            self.assertNotEqual(r.status_code, 429)
        r = client.post("/api/buying-requests", json={...})
        self.assertEqual(r.status_code, 429)
```

- [ ] **Step 4: Run and verify**

Run: `python -m pytest backend/test_buying_requests_ratelimit.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/buying_requests.py backend/requirements.txt backend/test_buying_requests_ratelimit.py
git commit -m "fix(security): rate-limit buying-requests POST at 10/minute"
```

---

## Task 18: Bind `X-Forwarded-For` trust via WSGI middleware (operational hardening)

**Files:**
- Modify: `backend/app.py` (WSGI middleware)
- Modify: `backend/gunicorn.conf.py` (workers trust upstream IPs only)

- [ ] **Step 1: Install `werkzeug.middleware.proxy_fix.ProxyFix`**

`ProxyFix` is in `werkzeug` (already a dep). Configure trust for the load balancer.

In `backend/app.py`, near the top of the app factory:

```python
from werkzeug.middleware.proxy_fix import ProxyFix
# Trust 1 layer of proxy (the load balancer in front of Flask)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=0)
```

- [ ] **Step 2: Update `gunicorn.conf.py`**

If using `--bind 0.0.0.0:8080` with `ProxyFix(x_for=1)`, ensure the LB exists; otherwise attackers can still spoof. Confirm Railway / Fly.io / your host's reverse-proxy IP range is the only ingress.

- [ ] **Step 3: Test that `request.remote_addr` reflects real client**

Manual: deploy to staging, hit the `/api/contact/lead` endpoint from the public internet via `curl -H "X-Forwarded-For: 1.3.3.7"`. Confirm the rate-limit key uses the actual public IP, not `1.3.3.7`.

- [ ] **Step 4: Commit**

```bash
git add backend/app.py backend/gunicorn.conf.py
git commit -m "fix(security): trust upstream proxy via ProxyFix for remote_addr"
```

---

## Task 19: Frontend `supabaseClient.js` — `localStorage` → `sessionStorage`

**Files:**
- Modify: `frontend/src/utils/supabaseClient.js:23-32, 122-127, 143-155`

- [ ] **Step 1: Find every `localStorage.setItem` / `localStorage.getItem` in `supabaseClient.js`**

Run: `grep -n "localStorage" frontend/src/utils/supabaseClient.js`
Each hit is a candidate. Replace `localStorage` with `sessionStorage` for everything that holds the access/refresh tokens.

- [ ] **Step 2: Switch to `sessionStorage`**

```diff
- localStorage.setItem('supabase_access_token', token)
+ sessionStorage.setItem('supabase_access_token', token)
```

(`sessionStorage` is closed when the tab closes, limiting the window of exposure.)

- [ ] **Step 3: Long-term: switch to `httpOnly` cookie**

This is a bigger change requiring backend routes for login + refresh. Out of scope for this plan; track as a follow-up TODO.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/supabaseClient.js
git commit -m "fix(security): move frontend supabase tokens from localStorage to sessionStorage"
```

---

## Task 20: Live secrets — coordinate manual rotation (operational task)

**This is not a code task.** It's an operations checklist the user must perform. Surface it in the plan to ensure it isn't forgotten.

**Files:**
- `backend/.env` (already in `.gitignore` but previously tracked in commits before `12661f2d`)
- Verify with: `git log --all --oneline -- backend/.env | head -20`

- [ ] **Step 1: Inventory every secret in `backend/.env`**

```bash
grep -E "^[A-Z_]+_(KEY|SECRET|TOKEN|PASSWORD)=" backend/.env > /tmp/secrets_inventory.txt
wc -l /tmp/secrets_inventory.txt
```

- [ ] **Step 2: For each secret, rotate it at the issuing service**

The audit identified: Supabase JWT secret + service role key (rotate by `ALTER ROLE` + service-config), RESEND API key (Resend dashboard), INFOBIP API key (Infobip), Turnstile secret (Cloudflare dashboard), Cloudflare API token, Reddit refresh token, Expo PAT (expo.dev → settings), GA4 service-account private key (Google Cloud console), dealer-integrations key, admin password (Django-style admin). For each, generate a new value, paste into the deployed environment's secret store, redeploy.

- [ ] **Step 3: Purge `.env` from git history**

```bash
brew install git-filter-repo
cd /Users/suhayl/Downloads/Flask-React-superbase-classified
git filter-repo --invert-paths --path backend/.env --path flask-react-supabase-app/ocr-service/.env --path flask-react-supabase-app/vision-service/.env --force
```

(Coordinate with the team first; `git filter-repo` rewrites history and requires force-push.)

- [ ] **Step 4: Verify no secrets remain in any reachable commit**

```bash
git log --all -p -- backend/.env | grep -E "^[A-Z_]+_(KEY|SECRET|TOKEN)=" | head -5
```
Expected: empty output (or only `^index` lines).

- [ ] **Step 5: Document the rotation**

Add a private ops note (not in this repo) listing what was rotated, when, and by whom.

---

## Out-of-plan follow-ups

These are explicitly deferred — they would not fit a single sprint and need their own specs:

1. **`routes/admin.py` GET audit** — extend `_audit_write` to log all `actor_kind='admin'` reads (`Task 6.2 scenario 3.b`).
2. **`auto_review_worker` row-mutation regression** — `H-B11` from the original audit: stop mutating `row[...]` in-place; return `(analysis, urls)` separately.
3. **System prompt hardening on `redis.from_url(...).ping()` lazy init** — **NOW Task 22** (was deferred).
4. **`_get_cors_origins` deduplication** — `H-B7`: replace the three manual OPTIONS handlers with a single `flask-cors` config that supports credentials.
5. **Featured-listings cache invalidation** — `H-B9`: invalidate `/api/cars` cache when featured status changes.
6. **`app.py` split** — `H-B1`: at 25k lines, the file is past the threshold where PR review is impossible. A multi-sprint extraction into `routes/*.py` blueprints is the right move.
7. **Devvit HMAC signature on roundup JSON** — `Scenario 5.detail`.
8. **`apply_migration.py` path guard** — **NOW Task 23** (was deferred).
9. **Supabase long-lived refresh-token cookie → short TTL** — discussed in `S-DB3` and MEDIUM-5.

---

## Task 21: Wrap `services/vin_decoder.py:_VIN_CACHE` with a lock

**Files:**
- Modify: `backend/services/vin_decoder.py:27`
- Test: `backend/test_vin_decoder_thread_safety.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_vin_decoder_thread_safety.py`:

```python
import threading
import unittest


class TestVinCacheLock(unittest.TestCase):
    def test_concurrent_put_get_does_not_raise(self):
        from services.vin_decoder import _VIN_CACHE, _VIN_CACHE_LOCK
        if _VIN_CACHE_LOCK is None:
            self.fail("services.vin_decoder must expose a _VIN_CACHE_LOCK attribute")

        errors = []

        def worker(i):
            try:
                for k in range(50):
                    with _VIN_CACHE_LOCK:
                        _VIN_CACHE[f"VIN-{i}-{k}"] = {"decoded": True}
                        _ = _VIN_CACHE.get(f"VIN-{i}-{k}")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(errors, [])
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_vin_decoder_thread_safety.py -v 2>&1 | tail -10`
Expected: FAIL with "services.vin_decoder must expose a _VIN_CACHE_LOCK attribute".

- [ ] **Step 3: Add the lock and use it at every mutation site**

In `backend/services/vin_decoder.py`, replace the module-level declarations:

```python
_VIN_CACHE = {}
```

with:

```python
import threading

_VIN_CACHE_LOCK = threading.Lock()
_VIN_CACHE = {}
```

At every read/write of `_VIN_CACHE[...]` in the file (likely 4-6 sites — decode is the hot path), wrap with `with _VIN_CACHE_LOCK:`. Use `grep -n "_VIN_CACHE\[" backend/services/vin_decoder.py` to find them.

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_vin_decoder_thread_safety.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Run the existing VIN tests**

Run: `python -m pytest backend/test_vin_decoder.py backend/test_vin_integration.py -q 2>&1 | tail -10`
Expected: same counts as before. Lock holding should add microseconds of overhead.

- [ ] **Step 6: Commit**

```bash
git add backend/services/vin_decoder.py backend/test_vin_decoder_thread_safety.py
git commit -m "fix(concurrency): add lock to _VIN_CACHE in vin_decoder"
```

---

## Task 22: Reset `_REDIS_CACHE_CLIENT` on transient ping failures

**Files:**
- Modify: `backend/app.py:248-261, 575-576`

- [ ] **Step 1: Write the failing test**

Create `backend/test_redis_cache_retry.py`:

```python
import unittest
from unittest.mock import patch


class TestRedisCacheRetry(unittest.TestCase):
    def test_redis_client_is_reset_after_ping_failure(self):
        from app import _get_redis_cache_client
        from unittest.mock import MagicMock
        # First call: returns a working client; second call after ping failure: returns None,
        # next call: creates a fresh client again.
        call_count = {"ping": 0, "from_url": 0}

        def fake_from_url(url):
            call_count["from_url"] += 1
            client = MagicMock()
            def ping():
                call_count["ping"] += 1
                if call_count["ping"] == 1:
                    raise ConnectionError("transient")
                return True
            client.ping = ping
            return client

        with patch("app._REDIS_CACHE_CLIENT", None), \
             patch("app._redis_from_url", side_effect=fake_from_url):
            client = _get_redis_cache_client()
            self.assertIsNone(client, "first failure: None")
            client = _get_redis_cache_client()
            self.assertIsNotNone(client, "after reset: client")
            self.assertGreaterEqual(call_count["from_url"], 2)
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_redis_cache_retry.py -v 2>&1 | tail -10`
Expected: FAIL — current `_get_redis_cache_client` caches `None` for the process lifetime after the first failure.

- [ ] **Step 3: Implement periodic reset**

In `backend/app.py`, replace `_get_redis_cache_client`:

```python
_REDIS_CACHE_CLIENT = None
_REDIS_CACHE_LAST_FAILURE = 0
_REDIS_CACHE_BACKOFF_SEC = 5  # re-attempt every 5s after a failure


def _get_redis_cache_client():
    """Returns a Redis client for cache use, or None if unreachable.

    Behaviour:
      - first success: cache the client, return it
      - any later ping() failure: log warning, drop the cached client and
        return None for the next `_REDIS_CACHE_BACKOFF_SEC` seconds
      - after the backoff: try `from_url` again
    """
    global _REDIS_CACHE_CLIENT, _REDIS_CACHE_LAST_FAILURE
    import time
    if _REDIS_CACHE_CLIENT is not None:
        return _REDIS_CACHE_CLIENT
    now = time.time()
    if (now - _REDIS_CACHE_LAST_FAILURE) < _REDIS_CACHE_BACKOFF_SEC:
        return None
    try:
        client = _redis_from_url(os.getenv("REDIS_URL", ""))
        client.ping()
    except Exception as e:
        logger.warning("Redis cache unavailable: %s", e)
        _REDIS_CACHE_CLIENT = None
        _REDIS_CACHE_LAST_FAILURE = now
        return None
    _REDIS_CACHE_CLIENT = client
    return client
```

(This matches the existing wrap pattern; verify the local module names match — adjust if your project uses a different cache helper.)

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_redis_cache_retry.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/test_redis_cache_retry.py
git commit -m "fix(redis): re-attempt cache connection after transient ping failures"
```

---

## Task 23: Constrain `apply_migration.py` to standard migration dirs

**Files:**
- Modify: `backend/apply_migration.py:5-28`
- Test: `backend/test_apply_migration_path_guard.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_apply_migration_path_guard.py`:

```python
import unittest
from pathlib import Path


class TestApplyMigrationPathGuard(unittest.TestCase):
    def test_rejects_arbitrary_path_outside_migration_dirs(self):
        from apply_migration import _validate_migration_path
        with self.assertRaises(ValueError):
            _validate_migration_path("/etc/passwd")

    def test_rejects_traversal(self):
        from apply_migration import _validate_migration_path
        with self.assertRaises(ValueError):
            _validate_migration_path("backend/migrations/../../etc/passwd")

    def test_accepts_canonical_path(self):
        from apply_migration import _validate_migration_path
        # path is relative to repo root
        canonical = "backend/migrations/2026-08-27_canonical_is_admin.sql"
        # Should not raise
        out = _validate_migration_path(canonical)
        self.assertTrue(str(out).endswith(canonical))
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_apply_migration_path_guard.py -v 2>&1 | tail -10`
Expected: FAIL — current code opens any path passed in.

- [ ] **Step 3: Add the path guard**

In `backend/apply_migration.py`, near the top:

```python
import pathlib

ALLOWED_MIGRATION_DIRS = (
    pathlib.Path("backend/migrations"),
    pathlib.Path("supabase/migrations"),
)


def _validate_migration_path(p: str) -> pathlib.Path:
    """Resolve `p` and ensure it lives under one of the standard migration dirs.
    Rejects path-traversal attempts.
    """
    resolved = pathlib.Path(p).resolve()
    for allowed in ALLOWED_MIGRATION_DIRS:
        try:
            resolved.relative_to(allowed.resolve())
            return resolved
        except ValueError:
            continue
    raise ValueError(f"migration path must be under one of: {ALLOWED_MIGRATION_DIRS}")
```

Then at the call site (around line 28, the `open(migration_file, 'r')`), replace with:

```python
    migration_path = _validate_migration_path(migration_file)
    with open(migration_path, 'r', encoding='utf-8') as f:
        sql = f.read()
```

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_apply_migration_path_guard.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Verify CLI behaviour**

Run:
```bash
python backend/apply_migration.py backend/migrations/2026-08-27_canonical_is_admin.sql
```
Expected: file opens normally.

Run:
```bash
python backend/apply_migration.py /tmp/evil.sql
```
Expected: ValueError printed, no DB call.

- [ ] **Step 6: Commit**

```bash
git add backend/apply_migration.py backend/test_apply_migration_path_guard.py
git commit -m "fix(security): constrain apply_migration.py to canonical migration dirs"
```

---

## Task 24: Move `_send_listing_status_email` off the request path

**Files:**
- Modify: `backend/app.py:19799` (and `routes/admin.py:651-689`)
- Test: `backend/test_email_sent_off_request_path.py`

- [ ] **Step 1: Write the failing test (response time)**

Create `backend/test_email_sent_off_request_path.py`:

```python
import unittest
from unittest.mock import patch, MagicMock


class TestEmailOffRequestPath(unittest.TestCase):
    @patch("smtplib.SMTP", new_callable=MagicMock)
    def test_approve_endpoint_returns_immediately(self, mock_smtp_cls):
        # Patch the SMTP class to introduce an artificial 5s delay.
        mock_smtp_cls.return_value.sendmail = MagicMock(side_effect=lambda *a, **kw: __import__('time').sleep(5))
        # Hit the approve endpoint — expected to return in < 100 ms.
        from app import create_app
        app = create_app(testing=True)
        client = app.test_client()
        import time
        t0 = time.time()
        r = client.post("/api/admin/listings/x/approve", json={"reason": "ok"})
        elapsed = time.time() - t0
        # Worker is daemon thread — request returns well before the 5s SMTP sleep.
        self.assertLess(elapsed, 1.0, f"approve took {elapsed:.2f}s; should be sub-second")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_email_sent_off_request_path.py -v 2>&1 | tail -10`
Expected: FAIL — current code blocks on SMTP.

- [ ] **Step 3: Spawn daemon thread for the email send**

At each `_send_listing_status_email(...)` site (around `app.py:19799` and `routes/admin.py:651-689`):

```python
import threading

def _async_send_email(*args, **kwargs):
    try:
        _send_listing_status_email(*args, **kwargs)
    except Exception as exc:
        logger.error("deferred email send failed: %s", exc)

threading.Thread(target=_async_send_email, args=(email, "approved"), daemon=True).start()
```

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_email_sent_off_request_path.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/routes/admin.py backend/test_email_sent_off_request_path.py
git commit -m "perf(backend): send listing status email off the request path via daemon thread"
```

---

## Task 25: Gate `/api/debug/json` to non-production

**Files:**
- Modify: `backend/app.py:6338-6352`

- [ ] **Step 1: Write the failing test**

Create `backend/test_debug_json_gated.py`:

```python
import unittest


class TestDebugJsonGated(unittest.TestCase):
    def test_debug_json_returns_404_in_production(self):
        import os
        old = os.environ.get("FLASK_ENV")
        os.environ["FLASK_ENV"] = "production"
        try:
            from app import create_app
            app = create_app(testing=True)
            client = app.test_client()
            r = client.get("/api/debug/json")
            self.assertEqual(r.status_code, 404,
                "debug endpoint must be gated off in production")
        finally:
            if old is None: os.environ.pop("FLASK_ENV", None)
            else: os.environ["FLASK_ENV"] = old

    def test_debug_json_available_in_development(self):
        import os
        old = os.environ.get("FLASK_ENV")
        os.environ["FLASK_ENV"] = "development"
        try:
            from app import create_app
            app = create_app(testing=True)
            client = app.test_client()
            r = client.get("/api/debug/json")
            self.assertEqual(r.status_code, 200)
        finally:
            if old is None: os.environ.pop("FLASK_ENV", None)
            else: os.environ["FLASK_ENV"] = old
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_debug_json_gated.py -v 2>&1 | tail -10`
Expected: FAIL — current `/api/debug/json` is unconditionally registered.

- [ ] **Step 3: Add the gate**

In `backend/app.py`, find the `/api/debug/json` route (around `:6338`) and wrap the registration:

```python
if os.getenv("FLASK_ENV", "development") != "production":
    @app.route("/api/debug/json", methods=["POST", "GET", "OPTIONS"])
    def _debug_json():
        return jsonify({...})
```

(Or move the registration into a blueprint that's only registered in non-prod.)

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_debug_json_gated.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/test_debug_json_gated.py
git commit -m "fix(security): gate /api/debug/json to non-production environments"
```

---

## Coordination note: DB-migration ownership

Three migrations are referenced in BOTH `audit-security-auth-hardening.md` (Tasks 12, 13, 14) AND `audit-db-rls-indexing.md` (Tasks 1, 2, 3). The two plans must converge on **the same file**. Adopt the following:

| Migration filename | Owning plan |
|---|---|
| `2026-08-27_service_role_qualifier.sql` | **DB Plan Task 1** (more complete table list) |
| `2026-08-27_canonical_is_admin.sql` | **DB Plan Task 2** |
| `2026-08-27_users_update_with_check.sql` | **DB Plan Task 3** |

In the Security Plan, Tasks 12, 13, 14 should be **deleted**. Their dependency chain becomes a one-line callout in this plan:

> "See `audit-db-rls-indexing.md` Tasks 1–3 for `is_admin()` canonical, `TO service_role` qualifier, and `users` UPDATE `WITH CHECK`. Security Task 16 (admin decorator consolidation) depends on those migrations landing first."

---

## Task 26: Move `mobile/.env` `EXPO_TOKEN` out of the file

**Files:**
- Modify: `mobile/.env` (operational; not in repo)
- Create: `mobile/.env.example`
- Modify: `mobile/README.md` (or similar) to document the new requirement

- [ ] **Step 1: Write a developer-facing test that fails if `EXPO_TOKEN` lives in `mobile/.env`**

Create `mobile/scripts/check_env_example.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
if grep -qE '^[[:space:]]*EXPO_TOKEN=' .env 2>/dev/null; then
  echo "ERROR: EXPO_TOKEN is committed in .env. Move it to your shell profile." >&2
  exit 1
fi
exit 0
```

Make executable: `chmod +x mobile/scripts/check_env_example.sh`

- [ ] **Step 2: Run and verify failure (assuming `.env` still has the token)**

Run: `cd mobile && bash scripts/check_env_example.sh; echo $?`
Expected: exit 1.

- [ ] **Step 3: Edit `mobile/.env` to drop the `EXPO_TOKEN` line**

Manually:
- Remove the `EXPO_TOKEN=...` line from `mobile/.env` on disk.
- Export it from `~/.zshrc` instead: `export EXPO_TOKEN="..."`
- Re-run `npx eas --version` to confirm.

- [ ] **Step 4: Add `mobile/.env.example` with placeholders**

Create `mobile/.env.example`:

```
# Copy to .env and fill in.
EXPO_PUBLIC_API_URL=https://api.dphclassifieds.com
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_POSTHOG_API_KEY=

# Do NOT put EXPO_TOKEN here. Export from your shell:
#   export EXPO_TOKEN=...
```

- [ ] **Step 5: Re-run and verify**

Run: `cd mobile && bash scripts/check_env_example.sh; echo $?`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add mobile/.env.example mobile/scripts/check_env_example.sh
git commit -m "fix(security): move mobile .env EXPO_TOKEN to shell profile; add example"
```

---

## Updated sprint plan after this Plan 1 ships

**Sprint 1 (this week):**
1. **Task 20** (rotate live secrets in `backend/.env` + purge from history) **+ Task 26** (move `EXPO_TOKEN` out of `mobile/.env`).
2. **Tasks 1–11** as originally listed.

**Sprint 2:**
3. **NEW additions to Sprint 2:** Task 21 (VIN cache lock), Task 22 (Redis reset), Task 23 (apply_migration paths), Task 24 (email off request path), Task 25 (debug/json gated).
4. The DB-plan migrations (Tasks 1, 2, 3 — see coordination note above) **must land before** Security Task 16 (admin decorator) because Task 16 depends on the canonical `is_admin()` function.

**Sprint 3:**
5. As originally listed + mobile cleanup finalisation.
