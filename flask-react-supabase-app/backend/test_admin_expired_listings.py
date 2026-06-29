"""Tests for GET /api/admin/expired-listings endpoint."""
import pytest
from unittest.mock import patch, MagicMock

import app as _app_module
import routes.admin as _admin_routes


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


@pytest.fixture(autouse=True)
def clear_admin_cache():
    """Clear the in-process admin cache before each test to prevent cross-test contamination."""
    _admin_routes._ADMIN_CACHE.clear()
    yield
    _admin_routes._ADMIN_CACHE.clear()


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


CAR_ROW = {
    "id": "car-1", "car_manufacturer": "BMW", "car_model": "320i",
    "expected_selling_price": 95000, "status": "deleted",
    "sold_status": None, "sold_status_set_at": None,
    "deleted_at": "2026-06-25T10:00:00Z",
    "expired_at": "2026-06-20T00:00:00Z",
    "retention_expires_at": "2026-07-20T00:00:00Z",
    "is_archived": False, "renewal_nudge_count": 2,
    "renewal_nudge_sent_at": "2026-06-18T00:00:00Z",
    "user_id": "u1", "listing_state": "deleted",
    "bike_brand": None, "bike_model": None, "part_type": None, "part_name": None,
    "city": None, "code": None, "digits": None, "number": None, "price": None,
    "sold_response_deadline": None,
}

DELETION_EVENT = {
    "listing_id": "car-1", "listing_type": "car",
    "deleted_by_role": "admin", "reason": "Spam listing",
    "created_at": "2026-06-25T10:00:00Z",
}

EMAIL_ROW = {
    "user_id": "u1", "email_type": "renewal_nudge",
    "opened_at": "2026-06-18T05:00:00Z", "clicked_at": None,
}


def _build_fake_get(cars=None, deletion_events=None, email_rows=None, images=None):
    cars = cars or []
    deletion_events = deletion_events or []
    email_rows = email_rows or []
    images = images or []

    def data_handler(url, **kwargs):
        if "/cars" in url and "status" in (kwargs.get("params") or {}):
            return _make_response(cars)
        if "/bikes" in url or "/car_parts" in url or "/license_plates" in url:
            return _make_response([])
        if "listing_deletion_events" in url:
            return _make_response(deletion_events)
        if "outbound_emails" in url:
            return _make_response(email_rows)
        if any(t in url for t in ("car_images", "bike_images", "part_images", "plate_images")):
            return _make_response(images)
        return _make_response([])

    return _auth_aware_fake(data_handler)


def test_expired_listings_returns_listings(client):
    with patch("routes.admin.requests.get", side_effect=_build_fake_get(cars=[CAR_ROW])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30",
            headers={"Authorization": "Bearer fake-token"},
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert "listings" in data
    assert len(data["listings"]) == 1
    item = data["listings"][0]
    assert item["id"] == "car-1"
    assert item["listing_type"] == "cars"


def test_expiry_reason_admin_deleted(client):
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(cars=[CAR_ROW], deletion_events=[DELETION_EVENT])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30",
            headers={"Authorization": "Bearer fake-token"},
        )
    item = resp.get_json()["listings"][0]
    assert item["expiry_reason"] == "Admin deleted"
    assert item["reason_detail"] == "Spam listing"


def test_expiry_reason_no_response(client):
    car = {**CAR_ROW, "status": "expired", "deleted_at": None, "sold_status": None}
    with patch("routes.admin.requests.get", side_effect=_build_fake_get(cars=[car])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30",
            headers={"Authorization": "Bearer fake-token"},
        )
    item = resp.get_json()["listings"][0]
    assert item["expiry_reason"] == "Expired — no response"


def test_expiry_reason_sold_on_dph(client):
    car = {**CAR_ROW, "status": "expired", "deleted_at": None, "sold_status": "sold_on_dph"}
    with patch("routes.admin.requests.get", side_effect=_build_fake_get(cars=[car])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30",
            headers={"Authorization": "Bearer fake-token"},
        )
    item = resp.get_json()["listings"][0]
    assert item["expiry_reason"] == "Sold on DPH"


def test_email_interacted_flag(client):
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(cars=[CAR_ROW], email_rows=[EMAIL_ROW])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30",
            headers={"Authorization": "Bearer fake-token"},
        )
    item = resp.get_json()["listings"][0]
    assert item["email_interacted"] is True


def test_email_not_interacted_when_no_open(client):
    email = {**EMAIL_ROW, "opened_at": None, "clicked_at": None}
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(cars=[CAR_ROW], email_rows=[email])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30",
            headers={"Authorization": "Bearer fake-token"},
        )
    item = resp.get_json()["listings"][0]
    assert item["email_interacted"] is False


def test_reason_filter_admin_deleted(client):
    """reason=admin_deleted should only return admin-deleted rows."""
    car_no_event = {**CAR_ROW, "id": "car-2", "status": "expired",
                    "deleted_at": None, "sold_status": None}
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(
                   cars=[CAR_ROW, car_no_event],
                   deletion_events=[DELETION_EVENT])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30&reason=admin_deleted",
            headers={"Authorization": "Bearer fake-token"},
        )
    data = resp.get_json()
    assert len(data["listings"]) == 1
    assert data["listings"][0]["id"] == "car-1"


def test_invalid_type_returns_400(client):
    """An unrecognised type param should return 400."""
    with patch("routes.admin.requests.get", side_effect=_build_fake_get()):
        resp = client.get(
            "/api/admin/expired-listings?type=invalid",
            headers={"Authorization": "Bearer fake-token"},
        )
    assert resp.status_code == 400


def test_invalid_reason_returns_400(client):
    """An unrecognised reason param should return 400."""
    with patch("routes.admin.requests.get", side_effect=_build_fake_get()):
        resp = client.get(
            "/api/admin/expired-listings?reason=foobar",
            headers={"Authorization": "Bearer fake-token"},
        )
    assert resp.status_code == 400


def test_invalid_days_returns_400(client):
    """A non-integer days param should return 400."""
    with patch("routes.admin.requests.get", side_effect=_build_fake_get()):
        resp = client.get(
            "/api/admin/expired-listings?days=notanumber",
            headers={"Authorization": "Bearer fake-token"},
        )
    assert resp.status_code == 400


def test_expired_listing_included_not_deleted(client):
    """A listing with status=expired and deleted_at=None but expired_at set should appear."""
    expired_car = {
        **CAR_ROW,
        "id": "car-exp-1",
        "status": "expired",
        "deleted_at": None,
        "expired_at": "2026-06-25T10:00:00Z",
        "sold_status": None,
    }
    with patch("routes.admin.requests.get", side_effect=_build_fake_get(cars=[expired_car])):
        resp = client.get(
            "/api/admin/expired-listings?type=cars&days=30",
            headers={"Authorization": "Bearer fake-token"},
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["listings"]) == 1
    item = data["listings"][0]
    assert item["id"] == "car-exp-1"
    assert item["expiry_reason"] == "Expired — no response"
