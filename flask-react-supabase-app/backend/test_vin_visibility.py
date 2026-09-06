"""Contract tests for the car-detail VIN privacy boundary."""

from unittest.mock import Mock, patch

import app as backend


CAR_ID = "car-1"
VIN = "1HGBH41JXMN109186"


def _provider_side_effect(*, phone_verified=None):
    car = {
        "id": CAR_ID,
        "user_id": "owner-1",
        "listing_title": "Test car",
        "vin_number": VIN,
        "status": "approved",
        "is_approved": True,
    }

    def provider(method, path, **_kwargs):
        if method != "get":
            return ([], 200)
        if path.startswith("/rest/v1/cars?"):
            return ([dict(car)], 200)
        if path.startswith("/rest/v1/car_images?"):
            return ([], 200)
        if path.startswith("/rest/v1/users?"):
            if "profile_photo_url" in path:
                return ([{"profile_photo_url": None}], 200)
            return ([{"phone_verified": bool(phone_verified), "is_admin": False}], 200)
        raise AssertionError(f"Unexpected provider call: {method} {path}")

    return provider


def _get_car(*, requester, phone_verified=None, owner=False, admin=False):
    view_response = Mock(status_code=200)
    view_response.json.return_value = [{"view_count": 3}]
    provider = _provider_side_effect(phone_verified=phone_verified)
    if owner:
        requester = "owner-1"

    def visible(_car, _requester):
        return True, True

    def provider_with_admin(method, path, **kwargs):
        response = provider(method, path, **kwargs)
        if path.startswith("/rest/v1/users?") and "profile_photo_url" not in path:
            response = ([{"phone_verified": bool(phone_verified), "is_admin": admin}], 200)
        return response

    with (
        patch.object(backend, "_resolve_car_listing_id", return_value=CAR_ID),
        patch.object(backend, "_optional_user_id", return_value=requester),
        patch.object(backend, "_api_cache_get", return_value=None),
        patch.object(backend, "_api_cache_set"),
        patch.object(backend, "_listing_visible_to_requester", side_effect=visible),
        patch.object(backend, "_sync_listing_lifecycle", side_effect=lambda _table, row, **_kwargs: row),
        patch.object(backend, "supabase_request", side_effect=provider_with_admin),
        patch.object(backend.requests, "get", return_value=view_response),
        patch.object(backend.requests, "patch", return_value=view_response),
    ):
        response = backend.app.test_client().get(f"/api/cars/{CAR_ID}")
    return response


def test_anonymous_car_detail_strips_vin():
    response = _get_car(requester=None)

    assert response.status_code == 200
    assert "vin_number" not in response.get_json()


def test_unverified_viewer_car_detail_strips_vin():
    response = _get_car(requester="viewer-1", phone_verified=False)

    assert response.status_code == 200
    assert "vin_number" not in response.get_json()


def test_phone_verified_viewer_receives_vin():
    response = _get_car(requester="viewer-1", phone_verified=True)

    assert response.status_code == 200
    assert response.get_json()["vin_number"] == VIN


def test_owner_receives_vin_without_phone_lookup():
    response = _get_car(requester="owner-1", owner=True)

    assert response.status_code == 200
    assert response.get_json()["vin_number"] == VIN


def test_admin_viewer_receives_vin():
    response = _get_car(requester="admin-1", phone_verified=False, admin=True)

    assert response.status_code == 200
    assert response.get_json()["vin_number"] == VIN
