from unittest.mock import Mock, patch

import app as backend
import routes.admin as admin_routes


def _response(payload, status_code=200):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload
    return response


def test_live_listing_history_is_auth_gated():
    response = backend.app.test_client().get("/api/admin/listing-history")

    assert response.status_code == 401


def test_live_listing_history_is_bounded_and_uses_sentinel_headers():
    rows = [
        {"id": "event-1", "listing_id": "car-1"},
        {"id": "event-2", "listing_id": "car-2"},
        {"id": "event-3", "listing_id": "car-3"},
    ]
    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=[
            _response({"id": "admin-1", "role": "authenticated"}),
            _response([{"is_admin": True}]),
            _response(rows, 206),
        ],
    ) as fetch:
        response = backend.app.test_client().get(
            "/api/admin/listing-history?limit=2&offset=4",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 200
    assert [row["id"] for row in response.get_json()] == ["event-1", "event-2"]
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "6"
    params = fetch.call_args_list[2].kwargs["params"]
    assert params["limit"] == "3"
    assert params["offset"] == "4"


def test_live_listing_history_handles_malformed_final_payload():
    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=[
            _response({"id": "admin-1", "role": "authenticated"}),
            _response([{"is_admin": True}]),
            _response({"error": "bad"}),
        ],
    ):
        response = backend.app.test_client().get(
            "/api/admin/listing-history",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 502
