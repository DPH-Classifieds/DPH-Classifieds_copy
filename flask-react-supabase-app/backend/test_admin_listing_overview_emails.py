"""Test that listing overview returns renewal_emails field."""
import pytest
from unittest.mock import patch, MagicMock

import app as _app_module


def _make_response(data, status=200):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = data
    m.headers = {}
    return m


@pytest.fixture(scope="module")
def client():
    _app_module.app.config["TESTING"] = True
    yield _app_module.app.test_client()


def _auth_aware_fake(data_handler):
    """Wrap a data_handler so auth/admin-check calls succeed automatically."""
    def fake_get(url, **kwargs):
        # admin_required step 1: validate token with Supabase Auth
        if "/auth/v1/user" in url and "admin/users" not in url:
            return _make_response({"id": "admin-user", "role": "authenticated"})
        # admin_required step 2: check is_admin in users table
        if "select=is_admin" in url or (
            "users" in url and kwargs.get("params", {}).get("select") == "is_admin"
        ):
            return _make_response([{"is_admin": True}])
        return data_handler(url, **kwargs)
    return fake_get


def test_overview_includes_renewal_emails_field(client):
    """GET /api/admin/listings/cars/123/overview returns renewal_emails key."""
    listing_row = {
        "id": "123", "user_id": "u1", "status": "expired",
        "sold_status": None, "expired_at": "2026-06-20T00:00:00Z",
        "renewal_nudge_count": 1, "renewal_nudge_sent_at": "2026-06-19T00:00:00Z",
    }
    email_rows = [
        {"id": "e1", "email_type": "renewal_nudge", "sent_at": "2026-06-19T00:00:00Z",
         "opened_at": "2026-06-19T05:00:00Z", "clicked_at": None, "open_count": 1,
         "click_count": 0, "subject": "Renew your listing", "delivered_at": None,
         "error_message": None}
    ]

    def data_handler(url, **kwargs):
        if "outbound_emails" in url:
            return _make_response(email_rows)
        if "listing_deletion_events" in url:
            return _make_response([])
        if "lead_events" in url:
            return _make_response([])
        if "reports" in url:
            return _make_response([])
        if "/cars" in url:
            params = kwargs.get("params", {})
            if params.get("id") == "eq.123":
                return _make_response([listing_row])
        # user fetch for owner, image fetch, auth admin users lookup — all safe as []
        return _make_response([])

    with patch("routes.admin.requests.get", side_effect=_auth_aware_fake(data_handler)):
        resp = client.get(
            "/api/admin/listings/cars/123/overview",
            headers={"Authorization": "Bearer fake-token"},
        )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.get_json()}"
    data = resp.get_json()
    assert "renewal_emails" in data, "renewal_emails key must be present"
    assert len(data["renewal_emails"]) == 1
    assert data["renewal_emails"][0]["email_type"] == "renewal_nudge"
    assert data["renewal_emails"][0]["opened_at"] == "2026-06-19T05:00:00Z"


def test_overview_renewal_emails_empty_when_no_user_id(client):
    """If listing has no user_id, renewal_emails must be []."""
    listing_row = {
        "id": "999", "user_id": None, "status": "deleted",
        "renewal_nudge_count": 0,
    }

    def data_handler(url, **kwargs):
        if "/cars" in url:
            params = kwargs.get("params", {})
            if params.get("id") == "eq.999":
                return _make_response([listing_row])
        return _make_response([])

    with patch("routes.admin.requests.get", side_effect=_auth_aware_fake(data_handler)):
        resp = client.get(
            "/api/admin/listings/cars/999/overview",
            headers={"Authorization": "Bearer fake-token"},
        )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.get_json()}"
    data = resp.get_json()
    assert data.get("renewal_emails") == []


def test_overview_renewal_emails_empty_on_exception(client):
    """If outbound_emails fetch raises, overview still returns 200 with renewal_emails=[]."""
    listing_row = {
        "id": "777", "user_id": "u2", "status": "expired",
        "renewal_nudge_count": 1,
    }

    def data_handler(url, **kwargs):
        if "outbound_emails" in url:
            raise ConnectionError("Supabase unreachable")
        if "/cars" in url:
            return _make_response([listing_row])
        return _make_response([])

    with patch("routes.admin.requests.get", side_effect=_auth_aware_fake(data_handler)):
        resp = client.get(
            "/api/admin/listings/cars/777/overview",
            headers={"Authorization": "Bearer fake-token"},
        )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("renewal_emails") == []
