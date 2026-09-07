import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "dealer_info_requests.py"


def test_dealer_info_request_module_uses_runtime_boundary_without_app_import():
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


def test_admin_info_request_routes_preserve_legacy_owners_and_collision():
    from routes import dealer_info_requests

    manifest = build_route_manifest(backend.app)
    admin_path = "/api/admin/dealers/<dealer_id>/info-requests"
    contracts = [contract for contract in manifest if contract.rule == admin_path]
    assert {(contract.endpoint, contract.methods) for contract in contracts} == {
        ("create_dealer_info_request", ("OPTIONS", "POST")),
        ("list_dealer_info_requests", ("GET", "HEAD", "OPTIONS")),
    }
    cancel = [
        contract
        for contract in manifest
        if contract.rule == "/api/admin/info-requests/<request_id>/cancel"
    ]
    assert len(cancel) == 1
    assert cancel[0].endpoint == "cancel_dealer_info_request"
    assert cancel[0].methods == ("OPTIONS", "POST")
    assert backend.create_dealer_info_request is dealer_info_requests.create_dealer_info_request
    assert backend.list_dealer_info_requests is dealer_info_requests.list_dealer_info_requests
    assert backend.cancel_dealer_info_request is dealer_info_requests.cancel_dealer_info_request


def test_admin_info_request_routes_require_authentication():
    client = backend.app.test_client()
    assert client.post("/api/admin/dealers/dealer-1/info-requests", json={}).status_code == 401
    assert client.get("/api/admin/dealers/dealer-1/info-requests").status_code == 401
    assert client.post("/api/admin/info-requests/request-1/cancel").status_code == 401


def test_create_info_request_preserves_document_validation_and_write_flow():
    responses = [
        ([{"email": "dealer@example.com", "first_name": "A", "last_name": "Dealer", "company_name": None}], 200),
        ([], 204),
        ([{"id": "request-1", "expires_at": "2026-09-22T00:00:00+00:00", "status": "pending", "created_at": "2026-09-08T00:00:00+00:00"}], 201),
        ([], 204),
    ]

    def supabase(*args, **kwargs):
        return responses.pop(0)

    with backend.app.test_request_context(
        "/api/admin/dealers/dealer-1/info-requests",
        method="POST",
        json={
            "documents": ["Trade License", "Trade License", "Tax Registration"],
            "message": "Please upload clearer copies.",
        },
        headers={"Origin": "https://dphclassifieds.com"},
    ), patch.object(backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}), patch.object(
        backend, "supabase_request", side_effect=supabase
    ) as request_mock, patch.object(backend.secrets, "token_urlsafe", return_value="token-1234567890123456"), patch.object(
        backend, "_send_info_request_email", return_value=(None, None)
    ), patch.object(backend, "_get_safe_frontend_origin", return_value="https://dphclassifieds.com"):
        response = backend.create_dealer_info_request.__wrapped__("admin-1", "dealer-1")

    assert response[1] == 201
    payload = response[0].get_json()
    assert payload["documents"] == ["Trade License", "Tax Registration"]
    assert payload["email_sent"] is True
    assert payload["email_error"] is None
    assert payload["link_url"].endswith("/dealer-info-request/token-1234567890123456")
    assert request_mock.call_count == 4


def test_list_info_requests_preserves_private_attachment_signing():
    rows = [
        {
            "id": "request-1",
            "dealer_info_request_uploads": [{"id": "upload-1", "storage_path": "private/key"}],
        }
    ]
    with backend.app.test_request_context("/api/admin/dealers/dealer-1/info-requests"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(backend, "supabase_request", return_value=(rows, 200)), patch.object(
        backend,
        "_with_private_dealer_attachment_url",
        side_effect=lambda upload: {**upload, "signed_url": "https://signed"},
    ) as signer:
        response = backend.list_dealer_info_requests.__wrapped__("admin-1", "dealer-1")

    assert response[1] == 200
    assert response[0].get_json()["requests"][0]["dealer_info_request_uploads"] == [
        {"id": "upload-1", "storage_path": "private/key", "signed_url": "https://signed"}
    ]
    signer.assert_called_once_with(rows[0]["dealer_info_request_uploads"][0])


def test_cancel_info_request_preserves_pending_filter_and_success_envelope():
    with backend.app.test_request_context("/api/admin/info-requests/request-1/cancel", method="POST"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(backend, "supabase_request", return_value=([], 204)) as request_mock:
        response = backend.cancel_dealer_info_request.__wrapped__("admin-1", "request-1")

    assert response[1] == 200
    assert response[0].get_json() == {"success": True}
    assert request_mock.call_args.kwargs["params"] == {
        "id": "eq.request-1",
        "status": "eq.pending",
    }
