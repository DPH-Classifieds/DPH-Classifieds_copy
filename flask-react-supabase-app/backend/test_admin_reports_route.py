from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import app as backend
import routes.admin as admin_routes


def _response(payload, status_code=200):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload
    return response


def _auth_and(*responses):
    return [
        _response({"id": "admin-1", "role": "authenticated"}),
        _response([{"is_admin": True}]),
        *responses,
    ]


def test_admin_reports_requires_authentication():
    response = backend.app.test_client().get("/api/admin/reports")

    assert response.status_code == 401
    assert response.get_json() == {"error": "Authentication required"}


def test_live_admin_reports_bounds_filters_and_batches_reporters():
    reports = [
        {"id": "report-1", "status": "pending", "reporter_id": "user-1"},
        {"id": "report-2", "status": "pending", "reporter_id": "user-2"},
        {"id": "report-3", "status": "pending", "reporter_id": "user-3"},
    ]
    users = [
        {"id": "user-1", "email": "one@example.com", "username": "one"},
        {"id": "user-2", "email": "two@example.com", "username": "two"},
    ]

    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=_auth_and(_response(reports, 206), _response(users, 206)),
    ) as fetch:
        response = backend.app.test_client().get(
            "/api/admin/reports?status=pending&limit=2&offset=4",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 200
    assert [row["id"] for row in response.get_json()] == ["report-1", "report-2"]
    assert response.get_json()[0]["reporter_email"] == "one@example.com"
    assert response.get_json()[1]["reporter_username"] == "two"
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "6"

    reports_call = fetch.call_args_list[2]
    query = parse_qs(urlsplit(reports_call.args[0]).query)
    assert query["status"] == ["eq.pending"]
    assert query["limit"] == ["3"]
    assert query["offset"] == ["4"]
    users_call = fetch.call_args_list[3]
    assert users_call.kwargs["params"]["id"] == "in.(user-1,user-2)"


def test_live_admin_reports_rejects_unsupported_status_and_malformed_payloads():
    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=_auth_and(),
    ):
        invalid = backend.app.test_client().get(
            "/api/admin/reports?status=archived",
            headers={"Authorization": "Bearer test-admin-token"},
        )
    assert invalid.status_code == 400

    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=_auth_and(_response({"error": "bad"}, 200)),
    ):
        malformed = backend.app.test_client().get(
            "/api/admin/reports",
            headers={"Authorization": "Bearer test-admin-token"},
        )
    assert malformed.status_code == 502


def test_live_admin_reports_filters_malformed_rows_and_accepts_final_page():
    reports = [
        {"id": "report-1", "reporter_id": "user-1"},
        "not-a-report",
        {},
    ]
    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=_auth_and(_response(reports, 206), _response([], 206)),
    ):
        response = backend.app.test_client().get(
            "/api/admin/reports?limit=2&offset=-5",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 200
    assert response.get_json() == [{"id": "report-1", "reporter_id": "user-1"}]
    assert response.headers["X-Has-More"] == "false"
    assert "X-Next-Cursor" not in response.headers
