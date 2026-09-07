from unittest.mock import patch

import app as backend


def test_part_update_checks_ownership_before_mutation():
    with backend.app.test_request_context(
        "/api/parts/part-1", method="PATCH", json={"price": 100}
    ), patch.object(
        backend,
        "supabase_request",
        return_value=([{"user_id": "owner-456"}], 200),
    ) as mock_request:
        response, status = backend.update_part("user-123", "part-1")

    assert status == 403
    assert "permission" in response.get_json()["error"]
    assert mock_request.call_count == 1


def test_part_update_filters_identity_fields_and_persists_allowed_payload():
    captured = {}

    def fake_supabase_request(method, path, params=None, data=None, user_id=None, **kwargs):
        if method == "get" and params.get("select") == "user_id":
            return ([{"user_id": "user-123"}], 200)
        if method == "patch":
            captured["data"] = data
            return ([{"id": "part-1"}], 200)
        if method == "get" and path == "/rest/v1/car_parts":
            return ([{"id": "part-1", "name": "Brake pad"}], 200)
        return ([], 200)

    with backend.app.test_request_context(
        "/api/parts/part-1", method="PATCH", json={
                "name": "Brake pad",
                "price": 100,
                "contact_number": "+971500000000",
                "id": "other",
            "user_id": "attacker",
        }
    ), patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
        patch.object(backend, "_send_listing_status_email", return_value=("ok", None)), \
        patch.object(backend, "_maybe_record_price_drop"), \
        patch.object(backend, "_record_price_point"), \
        patch.object(backend, "_invalidate_public_inventory_cache"), \
        patch.object(backend, "_invalidate_api_cache_prefixes"):
        response, status = backend.update_part("user-123", "part-1")

    assert status == 200
    assert captured["data"] == {
        "name": "Brake pad",
        "price": 100,
        "contact_number": "+971500000000",
        "contact_phone": "+971500000000",
        "whatsapp_prefill_text": (
            "Hi, I saw your listing on DPHClassifieds and I am interested. "
            "Listing: {{LISTING_URL}}"
        ),
    }
    assert response.get_json()["message"] == "Part updated successfully"
