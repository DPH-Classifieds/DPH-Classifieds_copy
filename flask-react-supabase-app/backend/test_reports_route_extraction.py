import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "reports.py"


def test_reports_module_uses_runtime_boundary_without_app_import():
    source = MODULE_PATH.read_text()
    tree = ast.parse(source)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source


def test_reports_keep_the_intentional_get_post_path_collision():
    from routes import reports

    contracts = [
        contract for contract in build_route_manifest(backend.app) if contract.rule == "/api/reports"
    ]
    assert {(contract.endpoint, contract.methods) for contract in contracts} == {
        ("create_report", ("OPTIONS", "POST")),
        ("get_reports", ("GET", "HEAD", "OPTIONS")),
    }
    assert backend.create_report is reports.create_report
    assert backend.get_reports is reports.get_reports


def test_report_routes_require_authentication():
    client = backend.app.test_client()
    assert client.post("/api/reports", json={}).status_code == 401
    assert client.get("/api/reports").status_code == 401


def test_create_report_preserves_validation_and_notification_flow():
    with backend.app.test_request_context("/api/reports", method="POST", json={}):
        response = backend.create_report.__wrapped__("user-1")
    assert response[1] == 400
    assert response[0].get_json() == {"error": "No data provided"}

    report = {"id": "report-1", "listing_id": "car-1", "listing_type": "car"}
    with backend.app.test_request_context(
        "/api/reports", method="POST", json={
            "listing_id": "car-1",
            "listing_type": "car",
            "reason": "fraud",
            "details": "Suspicious listing",
        }
    ), patch.object(backend, "supabase_request", return_value=([report], 201)) as supabase, patch.object(
        backend, "_get_user_email_by_id", return_value={"email": "user@example.com"}
    ), patch.object(backend, "_send_report_admin_notification") as notify:
        response = backend.create_report.__wrapped__("user-1")

    assert response[1] == 201
    assert response[0].get_json() == {
        "message": "Report submitted successfully",
        "report": [report],
    }
    assert supabase.call_args.kwargs["data"] == {
        "listing_id": "car-1",
        "listing_type": "car",
        "reporter_id": "user-1",
        "reason": "fraud",
        "details": "Suspicious listing",
        "status": "pending",
    }
    notify.assert_called_once_with(report, reporter_email="user@example.com")


def test_get_reports_scopes_regular_users_and_allows_admins_all_rows():
    with backend.app.test_request_context("/api/reports"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": False}
    ), patch.object(backend, "supabase_request", return_value=([{"id": "mine"}], 200)) as supabase:
        response = backend.get_reports.__wrapped__("user-1")
    assert response[1] == 200
    assert response[0].get_json() == [{"id": "mine"}]
    assert supabase.call_args.args[1] == "/rest/v1/reports?reporter_id=eq.user-1&order=created_at.desc"

    with backend.app.test_request_context("/api/reports"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(backend, "supabase_request", return_value=([{"id": "all"}], 200)) as supabase:
        response = backend.get_reports.__wrapped__("admin-1")
    assert response[1] == 200
    assert supabase.call_args.args[1] == "/rest/v1/reports?order=created_at.desc"


def test_get_reports_preserves_upstream_error_status():
    with backend.app.test_request_context("/api/reports"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": False}
    ), patch.object(backend, "supabase_request", return_value=({"error": "down"}, 503)):
        response = backend.get_reports.__wrapped__("user-1")
    assert response[1] == 503
    assert response[0].get_json() == {"error": "Failed to fetch reports"}
