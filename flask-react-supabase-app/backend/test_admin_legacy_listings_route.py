from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import app as backend
import routes.admin as admin_routes


def _view_response(result):
    if isinstance(result, tuple):
        response, status = result
        return response, status
    return result, result.status_code


def _upstream_response(payload, status_code=200, headers=None):
    response = Mock()
    response.status_code = status_code
    response.headers = headers or {}
    response.json.return_value = payload
    return response


def test_admin_listings_requires_token():
    response = backend.app.test_client().get("/api/admin/listings")

    assert response.status_code == 401
    assert response.get_json() == {"error": "Authentication required"}


def test_admin_listings_applies_filters_pagination_and_count_headers():
    rows = [
        {
            "id": "car-1",
            "created_at": "2026-09-05T12:00:00Z",
            "make_year": 2024,
            "car_manufacturer": "Toyota",
            "car_model": "Land Cruiser",
            "status": "pending",
            "users": {
                "email": "ada@example.com",
                "first_name": "Ada",
                "last_name": "Lovelace",
                "username": "ada",
            },
        },
        {
            "id": "car-2",
            "created_at": "2026-09-04T12:00:00Z",
            "make_year": 2023,
            "car_manufacturer": "Honda",
            "car_model": "Civic",
            "status": "pending",
            "users": {},
        },
    ]
    upstream = _upstream_response(
        rows,
        status_code=206,
        headers={"Content-Range": "2-3/7"},
    )

    with backend.app.test_request_context(
        "/api/admin/listings?type=cars&status=pending&limit=2&offset=2"
    ):
        with patch.object(admin_routes.requests, "get", return_value=upstream) as fetch:
            result = admin_routes.get_all_listings.__wrapped__()

    response, status = _view_response(result)
    assert status == 200
    assert response.get_json() == [
        {
            "id": "car-1",
            "created_at": "2026-09-05T12:00:00Z",
            "make_year": 2024,
            "car_manufacturer": "Toyota",
            "car_model": "Land Cruiser",
            "status": "pending",
            "user_email": "ada@example.com",
            "user_name": "Ada Lovelace",
            "display_title": "2024 Toyota Land Cruiser — posted by Ada Lovelace",
        },
        {
            "id": "car-2",
            "created_at": "2026-09-04T12:00:00Z",
            "make_year": 2023,
            "car_manufacturer": "Honda",
            "car_model": "Civic",
            "status": "pending",
            "user_email": "Unknown",
            "user_name": "Unknown",
            "display_title": "2023 Honda Civic — posted by Unknown",
        },
    ]
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "2026-09-04T12:00:00Z"
    assert response.headers["X-Total-Count"] == "7"

    fetch.assert_called_once()
    url = fetch.call_args.args[0]
    query = parse_qs(urlsplit(url).query)
    assert urlsplit(url).path.endswith("/rest/v1/cars")
    assert query == {
        "select": ["*,users(email,first_name,last_name,username)"],
        "order": ["created_at.desc"],
        "status": ["eq.pending"],
        "limit": ["2"],
        "offset": ["2"],
    }
    assert fetch.call_args.kwargs["headers"]["Prefer"] == "count=exact"


def test_admin_listings_clamps_limit_and_offset():
    upstream = _upstream_response([], headers={"Content-Range": "*/0"})

    with backend.app.test_request_context(
        "/api/admin/listings?limit=99999&offset=-12"
    ):
        with patch.object(admin_routes.requests, "get", return_value=upstream) as fetch:
            result = admin_routes.get_all_listings.__wrapped__()

    response, status = _view_response(result)
    assert status == 200
    assert response.get_json() == []
    url = fetch.call_args.args[0]
    query = parse_qs(urlsplit(url).query)
    assert query["limit"] == ["200"]
    assert query["offset"] == ["0"]
    assert response.headers["X-Has-More"] == "false"
    assert response.headers["X-Total-Count"] == "0"


def test_admin_listings_invalid_pagination_uses_safe_defaults():
    upstream = _upstream_response([])

    with backend.app.test_request_context(
        "/api/admin/listings?limit=not-an-integer&offset=also-invalid"
    ):
        with patch.object(admin_routes.requests, "get", return_value=upstream) as fetch:
            result = admin_routes.get_all_listings.__wrapped__()

    response, status = _view_response(result)
    assert status == 200
    assert response.get_json() == []
    query = parse_qs(urlsplit(fetch.call_args.args[0]).query)
    assert query["limit"] == ["50"]
    assert query["offset"] == ["0"]
    assert response.headers["X-Has-More"] == "false"


def test_admin_listings_returns_empty_list_for_malformed_upstream_json():
    upstream = _upstream_response({"error": "unexpected object"})

    with backend.app.test_request_context("/api/admin/listings?limit=2"):
        with patch.object(admin_routes.requests, "get", return_value=upstream):
            result = admin_routes.get_all_listings.__wrapped__()

    response, status = _view_response(result)
    assert status == 200
    assert response.get_json() == []
    assert response.headers["X-Has-More"] == "false"


def test_admin_listings_preserves_upstream_error_status():
    upstream = _upstream_response({"error": "database unavailable"}, status_code=503)

    with backend.app.test_request_context("/api/admin/listings"):
        with patch.object(admin_routes.requests, "get", return_value=upstream):
            result = admin_routes.get_all_listings.__wrapped__()

    response, status = _view_response(result)
    assert status == 503
    assert response.get_json() == {"error": "Failed to fetch listings"}
