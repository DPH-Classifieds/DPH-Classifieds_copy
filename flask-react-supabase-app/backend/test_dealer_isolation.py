"""
Cross-Dealership Isolation Contract Tests
==========================================

These tests verify that dealer A cannot read or mutate dealer B's data
through any API endpoint exposed by the backend.

Automated (pytest)
------------------
Requires TEST_SUPABASE_URL (and optionally TEST_SUPABASE_ANON_KEY) to be set.
When the env-var is absent the entire module is skipped — safe to run in CI
without a live Supabase project.

Manual E2E Runbook
------------------
The runbook below describes the full isolation verification procedure that
should be executed against a staging or production-mirror environment before
any release that touches dealer data paths.

=== MANUAL E2E RUNBOOK ===

Prerequisites
~~~~~~~~~~~~~
1. Two dealer accounts provisioned in the target Supabase project:
     - DEALER_A_EMAIL / DEALER_A_PASSWORD
     - DEALER_B_EMAIL / DEALER_B_PASSWORD
2. Both accounts must have is_dealer=true and dealer_verified=true in the
   users table (or equivalent profile table).
3. At least one listing owned by Dealer A (LISTING_A_ID) and one owned by
   Dealer B (LISTING_B_ID).
4. The Flask backend running and reachable at BASE_URL (e.g. http://localhost:5000).
5. A REST client (curl, httpie, Postman, or the test helpers below).

Step 1 — Authenticate both dealers
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
POST {BASE_URL}/auth/login  body: {email: DEALER_A_EMAIL, password: ...}
  → capture TOKEN_A (JWT / session cookie)

POST {BASE_URL}/auth/login  body: {email: DEALER_B_EMAIL, password: ...}
  → capture TOKEN_B

Step 2 — Dealer A cannot read Dealer B's private dashboard data
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
GET {BASE_URL}/dealer/dashboard
  Authorization: Bearer TOKEN_A
  Expected: 200, body contains only listings/KPIs owned by Dealer A.
            LISTING_B_ID must NOT appear anywhere in the response.

Step 3 — Dealer A cannot read Dealer B's KPI metrics
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
GET {BASE_URL}/dealer/kpi
  Authorization: Bearer TOKEN_A
  Expected: 200, metrics scoped to Dealer A's listings only.

GET {BASE_URL}/dealer/kpi
  Authorization: Bearer TOKEN_B
  Expected: 200, metrics scoped to Dealer B's listings only.

  Assertion: the two responses must not share listing_ids.

Step 4 — Dealer A cannot edit Dealer B's listing
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
PATCH {BASE_URL}/listings/{LISTING_B_ID}
  Authorization: Bearer TOKEN_A
  body: {price: 1}
  Expected: 403 or 404 (must NOT be 200).

Step 5 — Dealer A cannot delete Dealer B's listing
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
DELETE {BASE_URL}/listings/{LISTING_B_ID}
  Authorization: Bearer TOKEN_A
  Expected: 403 or 404 (must NOT be 200).

Step 6 — Dealer A cannot approve/reject Dealer B's buying requests
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
GET {BASE_URL}/dealer/buying-requests
  Authorization: Bearer TOKEN_A
  Expected: 200, list contains only buying requests addressed to Dealer A's
            listings. No requests for LISTING_B_ID should appear.

Step 7 — Dealer A cannot view Dealer B's market intelligence scoped data
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
GET {BASE_URL}/dealer/market
  Authorization: Bearer TOKEN_A
  Expected: 200, market data returned is aggregate/public — it must NOT
            include Dealer B's private fields (e.g. internal cost, margin).

Step 8 — Unauthenticated requests are rejected on all dealer routes
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
GET {BASE_URL}/dealer/dashboard   (no Authorization header)
  Expected: 401

GET {BASE_URL}/dealer/kpi         (no Authorization header)
  Expected: 401

Step 9 — IDOR via listing ID enumeration
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
For id in range(LISTING_B_ID - 5, LISTING_B_ID + 5):
  GET {BASE_URL}/dealer/listing/{id}/analytics
    Authorization: Bearer TOKEN_A
    Expected: for IDs owned by Dealer B → 403 or 404.
              for IDs owned by Dealer A → 200.

Step 10 — Redis cache does not leak cross-dealer data
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
a) As Dealer B, fetch GET {BASE_URL}/dealer/dashboard  → warms cache.
b) As Dealer A, fetch GET {BASE_URL}/dealer/dashboard
   Expected: Dealer A receives their own data, not Dealer B's cached payload.
   Verify by confirming LISTING_B_ID is absent from Dealer A's response.

Pass criteria: ALL steps produce the expected HTTP status codes and the
               cross-dealer listing/data assertions hold.

=== END RUNBOOK ===
"""

import os
import pytest

# ---------------------------------------------------------------------------
# Module-level skip when no live Supabase project is configured
# ---------------------------------------------------------------------------

TEST_SUPABASE_URL = os.environ.get("TEST_SUPABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not TEST_SUPABASE_URL,
    reason="TEST_SUPABASE_URL is not set — skipping live isolation tests",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def supabase_client():
    """Return an authenticated Supabase client for the test project."""
    supabase_key = os.environ.get("TEST_SUPABASE_ANON_KEY", "")
    if not supabase_key:
        pytest.skip("TEST_SUPABASE_ANON_KEY is not set")
    try:
        from supabase import create_client  # type: ignore
    except ImportError:
        pytest.skip("supabase-py not installed in this environment")
    return create_client(TEST_SUPABASE_URL, supabase_key)


@pytest.fixture(scope="module")
def dealer_a_token(supabase_client):
    """Sign in as Dealer A and return the access token."""
    email = os.environ.get("TEST_DEALER_A_EMAIL", "")
    password = os.environ.get("TEST_DEALER_A_PASSWORD", "")
    if not email or not password:
        pytest.skip("TEST_DEALER_A_EMAIL / TEST_DEALER_A_PASSWORD not set")
    res = supabase_client.auth.sign_in_with_password({"email": email, "password": password})
    return res.session.access_token


@pytest.fixture(scope="module")
def dealer_b_token(supabase_client):
    """Sign in as Dealer B and return the access token."""
    email = os.environ.get("TEST_DEALER_B_EMAIL", "")
    password = os.environ.get("TEST_DEALER_B_PASSWORD", "")
    if not email or not password:
        pytest.skip("TEST_DEALER_B_EMAIL / TEST_DEALER_B_PASSWORD not set")
    res = supabase_client.auth.sign_in_with_password({"email": email, "password": password})
    return res.session.access_token


@pytest.fixture(scope="module")
def base_url():
    return os.environ.get("TEST_BASE_URL", "http://localhost:5000")


# ---------------------------------------------------------------------------
# Isolation contract tests
# ---------------------------------------------------------------------------


def test_dealer_a_dashboard_excludes_dealer_b_listings(dealer_a_token, dealer_b_token, base_url):
    """
    Dealer A's dashboard response must not contain any listing IDs that
    belong to Dealer B.
    """
    import requests  # type: ignore

    listing_b_id = os.environ.get("TEST_LISTING_B_ID", "")
    if not listing_b_id:
        pytest.skip("TEST_LISTING_B_ID not set")

    headers_a = {"Authorization": f"Bearer {dealer_a_token}"}
    resp = requests.get(f"{base_url}/dealer/dashboard", headers=headers_a, timeout=10)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    body = resp.text
    assert listing_b_id not in body, (
        f"Dealer A's dashboard response contains Dealer B's listing ID {listing_b_id}"
    )


def test_dealer_a_cannot_edit_dealer_b_listing(dealer_a_token, base_url):
    """
    A PATCH request from Dealer A against Dealer B's listing must be rejected
    with 403 or 404.
    """
    import requests  # type: ignore

    listing_b_id = os.environ.get("TEST_LISTING_B_ID", "")
    if not listing_b_id:
        pytest.skip("TEST_LISTING_B_ID not set")

    headers_a = {"Authorization": f"Bearer {dealer_a_token}", "Content-Type": "application/json"}
    resp = requests.patch(
        f"{base_url}/listings/{listing_b_id}",
        json={"price": 1},
        headers=headers_a,
        timeout=10,
    )
    assert resp.status_code in (403, 404), (
        f"Expected 403 or 404 when Dealer A edits Dealer B's listing, got {resp.status_code}"
    )


def test_dealer_a_cannot_delete_dealer_b_listing(dealer_a_token, base_url):
    """
    A DELETE request from Dealer A against Dealer B's listing must be rejected
    with 403 or 404.
    """
    import requests  # type: ignore

    listing_b_id = os.environ.get("TEST_LISTING_B_ID", "")
    if not listing_b_id:
        pytest.skip("TEST_LISTING_B_ID not set")

    headers_a = {"Authorization": f"Bearer {dealer_a_token}"}
    resp = requests.delete(
        f"{base_url}/listings/{listing_b_id}",
        headers=headers_a,
        timeout=10,
    )
    assert resp.status_code in (403, 404), (
        f"Expected 403 or 404 when Dealer A deletes Dealer B's listing, got {resp.status_code}"
    )


def test_unauthenticated_dealer_dashboard_returns_401(base_url):
    """Unauthenticated requests to /dealer/dashboard must return 401."""
    import requests  # type: ignore

    resp = requests.get(f"{base_url}/dealer/dashboard", timeout=10)
    assert resp.status_code == 401, (
        f"Expected 401 for unauthenticated /dealer/dashboard, got {resp.status_code}"
    )


def test_unauthenticated_dealer_kpi_returns_401(base_url):
    """Unauthenticated requests to /dealer/kpi must return 401."""
    import requests  # type: ignore

    resp = requests.get(f"{base_url}/dealer/kpi", timeout=10)
    assert resp.status_code == 401, (
        f"Expected 401 for unauthenticated /dealer/kpi, got {resp.status_code}"
    )


def test_dealer_kpi_responses_do_not_share_listing_ids(dealer_a_token, dealer_b_token, base_url):
    """
    Dealer A's KPI response and Dealer B's KPI response must not expose the
    same listing IDs — each dealer sees only their own data.
    """
    import requests  # type: ignore

    headers_a = {"Authorization": f"Bearer {dealer_a_token}"}
    headers_b = {"Authorization": f"Bearer {dealer_b_token}"}

    resp_a = requests.get(f"{base_url}/dealer/kpi", headers=headers_a, timeout=10)
    resp_b = requests.get(f"{base_url}/dealer/kpi", headers=headers_b, timeout=10)

    assert resp_a.status_code == 200, f"Dealer A KPI returned {resp_a.status_code}"
    assert resp_b.status_code == 200, f"Dealer B KPI returned {resp_b.status_code}"

    data_a = resp_a.json()
    data_b = resp_b.json()

    ids_a = set(data_a.get("listing_ids", []))
    ids_b = set(data_b.get("listing_ids", []))

    overlap = ids_a & ids_b
    assert not overlap, (
        f"Dealer A and Dealer B KPI responses share listing IDs: {overlap}"
    )


def test_buying_requests_scoped_to_dealer_a(dealer_a_token, base_url):
    """
    Dealer A's buying-requests list must not include requests for listings
    owned by Dealer B.
    """
    import requests  # type: ignore

    listing_b_id = os.environ.get("TEST_LISTING_B_ID", "")
    if not listing_b_id:
        pytest.skip("TEST_LISTING_B_ID not set")

    headers_a = {"Authorization": f"Bearer {dealer_a_token}"}
    resp = requests.get(f"{base_url}/dealer/buying-requests", headers=headers_a, timeout=10)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    body = resp.text
    assert listing_b_id not in body, (
        f"Dealer A's buying-requests contains Dealer B's listing ID {listing_b_id}"
    )
