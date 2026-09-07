from unittest.mock import patch

import app as backend


def _call_bike_update(payload, *, user_id="user-123"):
    with backend.app.test_request_context(
        "/api/bikes/bike-1", method="PATCH", json=payload
    ):
        return backend.update_bike.__wrapped__(user_id, "bike-1")


def test_bike_update_preserves_aliases_and_rejects_client_lifecycle_fields():
    captured = {}

    def fake_supabase_request(method, path, params=None, data=None, user_id=None, **kwargs):
        if method == "get" and path == "/rest/v1/bikes" and params.get("select") == "user_id":
            return ([{"user_id": "user-123"}], 200)
        if method == "patch":
            captured["data"] = data
            return ([{"id": "bike-1"}], 200)
        if method == "get" and path == "/rest/v1/bikes":
            return ([{"id": "bike-1", "price": 12000}], 200)
        if method == "get" and path == "/rest/v1/bike_images":
            return ([], 200)
        return ([], 200)

    with patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
        patch.object(backend, "_send_listing_status_email", return_value=("ok", None)), \
        patch.object(backend, "_maybe_record_price_drop"), \
        patch.object(backend, "_record_price_point"), \
        patch.object(backend, "_invalidate_public_inventory_cache"), \
        patch.object(backend, "_invalidate_api_cache_prefixes"):
        response, status = _call_bike_update(
            {
                "make": "Honda",
                "model": "CBR",
                "contact_phone": "+971500000000",
                "location": "Dubai",
                "price": "12000",
                "status": "approved",
                "user_id": "attacker-id",
                "id": "other-id",
            }
        )

    assert status == 200
    assert captured["data"]["bike_brand"] == "Honda"
    assert captured["data"]["bike_model"] == "CBR"
    assert captured["data"]["contact_number"] == "+971500000000"
    assert captured["data"]["price"] == 12000
    assert "status" not in captured["data"]
    assert "user_id" not in captured["data"]
    assert "id" not in captured["data"]
    assert response.get_json()["id"] == "bike-1"


def test_bike_update_rejects_non_owner_before_mutation():
    with patch.object(
        backend,
        "supabase_request",
        return_value=([{"user_id": "owner-456"}], 200),
    ) as mock_request:
        response, status = _call_bike_update({"price": 100}, user_id="user-123")

    assert status == 403
    assert "permission" in response.get_json()["error"]
    assert mock_request.call_count == 1


def test_bike_update_rejects_invalid_numeric_input():
    with patch.object(
        backend,
        "supabase_request",
        return_value=([{"user_id": "user-123"}], 200),
    ) as mock_request:
        response, status = _call_bike_update(
            {"price": "not-a-number", "contact_phone": "+971500000000"}
        )

    assert status == 400
    assert "price" in response.get_json()["error"]
    assert mock_request.call_count == 1
