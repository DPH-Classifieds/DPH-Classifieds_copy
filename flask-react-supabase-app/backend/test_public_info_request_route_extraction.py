import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "public_info_request.py"


def test_public_info_request_module_uses_runtime_boundary_without_app_import():
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


def test_public_lookup_keeps_single_unauthenticated_route_contract():
    from routes import public_info_request

    contracts = [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == "/api/info-requests/<token>"
    ]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_public_info_request"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_public_info_request is public_info_request.get_public_info_request


def test_public_lookup_rejects_short_tokens_without_database_access():
    with patch.object(backend, "supabase_request") as supabase:
        response = backend.app.test_client().get("/api/info-requests/short")
    assert response.status_code == 404
    assert response.get_json() == {"error": "Invalid token"}
    supabase.assert_not_called()


def test_public_lookup_preserves_redaction_expiry_and_dealer_name_shape():
    token = "token-1234567890123456"
    request_row = {
        "id": "request-1",
        "requested_documents": ["Trade License"],
        "message": "Upload a clearer copy",
        "status": "pending",
        "expires_at": "2026-09-07T00:00:00+00:00",
        "submitted_at": None,
        "created_at": "2026-09-01T00:00:00+00:00",
        "dealer_user_id": "dealer-1",
        "dealer_info_request_uploads": [
            {"id": "upload-1", "document_label": "Trade License", "file_type": "image/jpeg"}
        ],
    }
    responses = [
        ([request_row], 200),
        ([], 204),
        ([{"company_name": "Carology", "first_name": "Dealer"}], 200),
    ]

    with patch.object(backend, "supabase_request", side_effect=responses) as supabase:
        response = backend.app.test_client().get(f"/api/info-requests/{token}")

    assert response.status_code == 200
    assert response.get_json() == {
        "id": "request-1",
        "documents": ["Trade License"],
        "message": "Upload a clearer copy",
        "status": "expired",
        "expires_at": "2026-09-07T00:00:00+00:00",
        "submitted_at": None,
        "dealer_name": "Carology",
        "uploads": [
            {"id": "upload-1", "document_label": "Trade License", "file_type": "image/jpeg"}
        ],
    }
    assert supabase.call_args_list[1].kwargs["data"] == {"status": "expired"}
    assert "email" not in supabase.call_args_list[2].kwargs["params"]["select"]


def test_public_lookup_preserves_not_found_and_safe_failure_envelopes():
    token = "token-1234567890123456"
    with patch.object(backend, "supabase_request", return_value=([], 200)):
        response = backend.app.test_client().get(f"/api/info-requests/{token}")
    assert response.status_code == 404
    assert response.get_json() == {"error": "Not found"}

    with patch.object(backend, "supabase_request", side_effect=RuntimeError("secret")):
        response = backend.app.test_client().get(f"/api/info-requests/{token}")
    assert response.status_code == 500
    assert response.get_json() == {"error": "Failed to load request"}
