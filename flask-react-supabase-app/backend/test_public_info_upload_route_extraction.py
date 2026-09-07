import ast
import io
from pathlib import Path
from unittest.mock import Mock, patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "public_info_upload.py"
TOKEN = "token-1234567890123456"


def test_upload_module_uses_runtime_boundary_without_app_import():
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


def test_upload_keeps_single_post_route_contract():
    from routes import public_info_upload

    contracts = [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == "/api/info-requests/<token>/upload"
    ]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "upload_public_info_request"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.upload_public_info_request is public_info_upload.upload_public_info_request


def test_upload_rejects_short_token_without_database_access():
    with patch.object(backend, "supabase_request") as supabase:
        response = backend.app.test_client().post("/api/info-requests/short/upload")
    assert response.status_code == 404
    assert response.get_json() == {"error": "Invalid token"}
    supabase.assert_not_called()


def test_upload_preserves_not_found_expired_and_state_errors():
    client = backend.app.test_client()
    with patch.object(backend, "supabase_request", return_value=([], 200)) as supabase:
        response = client.post(f"/api/info-requests/{TOKEN}/upload")
    assert response.status_code == 404
    assert response.get_json() == {"error": "Not found"}
    supabase.assert_called_once()

    expired = {
        "id": "request-1",
        "dealer_user_id": "dealer-1",
        "requested_documents": ["Trade License"],
        "status": "pending",
        "expires_at": "2020-01-01T00:00:00+00:00",
    }
    with patch.object(backend, "supabase_request", side_effect=[([expired], 200), ([], 204)]) as supabase:
        response = client.post(f"/api/info-requests/{TOKEN}/upload")
    assert response.status_code == 410
    assert response.get_json() == {"error": "This request has expired"}
    assert supabase.call_args_list[1].kwargs["data"] == {"status": "expired"}

    closed = {**expired, "status": "cancelled", "expires_at": "2099-01-01T00:00:00+00:00"}
    with patch.object(backend, "supabase_request", return_value=([closed], 200)):
        response = client.post(f"/api/info-requests/{TOKEN}/upload")
    assert response.status_code == 409
    assert response.get_json() == {"error": "Request is cancelled"}


def test_upload_validates_label_file_trade_license_and_storage_before_mutation():
    request_row = {
        "id": "request-1",
        "dealer_user_id": "dealer-1",
        "requested_documents": ["Trade License"],
        "status": "pending",
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    client = backend.app.test_client()
    with patch.object(backend, "supabase_request", return_value=([request_row], 200)):
        response = client.post(
            f"/api/info-requests/{TOKEN}/upload",
            data={"document_label": "Wrong label"},
        )
    assert response.status_code == 400
    assert response.get_json() == {"error": "document_label is not part of this request"}

    with patch.object(backend, "supabase_request", return_value=([request_row], 200)):
        response = client.post(
            f"/api/info-requests/{TOKEN}/upload",
            data={"document_label": "Trade License"},
        )
    assert response.status_code == 400
    assert response.get_json() == {"error": "No file provided"}

    with patch.object(backend, "supabase_request", return_value=([request_row], 200)), patch.object(
        backend, "_validate_info_request_document", side_effect=ValueError("bad signature")
    ):
        response = client.post(
            f"/api/info-requests/{TOKEN}/upload",
            data={
                "document_label": "Trade License",
                "expires_at": "2099-01-01",
                "file": (io.BytesIO(b"bad"), "license.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )
    assert response.status_code == 400
    assert response.get_json() == {"error": "bad signature"}

    with patch.object(backend, "supabase_request", side_effect=[([request_row], 200), ([], 200)]), patch.object(
        backend, "_validate_info_request_document", return_value=b"%PDF-valid"
    ), patch.object(backend, "_dealer_document_type_from_label", return_value="trade_license"), patch.object(
        backend, "ensure_storage_bucket", return_value=False
    ):
        response = client.post(
            f"/api/info-requests/{TOKEN}/upload",
            data={
                "document_label": "Trade License",
                "expires_at": "2099-01-01",
                "file": (io.BytesIO(b"%PDF-valid"), "license.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )
    assert response.status_code == 500
    assert response.get_json() == {"error": "Storage bucket not available"}


def test_upload_writes_private_storage_canonical_document_and_submits_request():
    request_row = {
        "id": "request-1",
        "dealer_user_id": "dealer/1",
        "requested_documents": ["Trade License"],
        "status": "pending",
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    calls = []

    def supabase(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if method == "get" and path.endswith("dealer_info_requests"):
            return [request_row], 200
        if method == "get" and path.endswith("dealer_info_request_uploads"):
            if kwargs["params"]["select"] == "id,storage_path":
                return [], 200
            return [{"document_label": "Trade License"}], 200
        if method == "post" and path.endswith("dealer_documents"):
            return [{"id": "document-1"}], 201
        return [], 204

    upload_response = Mock(status_code=201, text="")
    with patch.object(backend, "supabase_request", side_effect=supabase), patch.object(
        backend, "_validate_info_request_document", return_value=b"%PDF-valid"
    ), patch.object(backend, "_dealer_document_type_from_label", return_value="trade_license"), patch.object(
        backend, "ensure_storage_bucket", return_value=True
    ), patch.object(backend.requests, "post", return_value=upload_response) as storage_post:
        response = backend.app.test_client().post(
            f"/api/info-requests/{TOKEN}/upload",
            data={
                "document_label": "Trade License",
                "expires_at": "2099-01-01",
                "file": (io.BytesIO(b"%PDF-valid"), "license.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )

    assert response.status_code == 201
    assert response.get_json() == {"success": True, "url": None, "filename": "license.pdf"}
    storage_post.assert_called_once()
    storage_url = storage_post.call_args.args[0]
    assert "/storage/v1/object/dealer-documents/dealer_1/info-requests/request-1/" in storage_url
    assert storage_post.call_args.kwargs["data"] == b"%PDF-valid"

    document_calls = [call for call in calls if call[1].endswith("dealer_documents")]
    assert document_calls[0][0] == "patch"
    canonical = document_calls[1][2]["data"]
    assert canonical["storage_path"].startswith("dealer_1/info-requests/request-1/")
    assert canonical["url"] == canonical["storage_path"]
    assert canonical["status"] == "pending"
    upload_record = [call for call in calls if call[1].endswith("dealer_info_request_uploads") and call[0] == "post"][0]
    assert upload_record[2]["data"]["url"] == upload_record[2]["data"]["storage_path"]
    assert any(call[0] == "patch" and "/rest/v1/users" in call[1] for call in calls)


def test_upload_fails_closed_when_quota_lookup_is_unavailable():
    request_row = {
        "id": "request-1",
        "dealer_user_id": "dealer-1",
        "requested_documents": ["Company registration certificate"],
        "status": "pending",
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    with patch.object(
        backend,
        "supabase_request",
        side_effect=[([request_row], 200), ({"error": "upstream"}, 503)],
    ), patch.object(backend, "_validate_info_request_document", return_value=b"%PDF-valid"), patch.object(
        backend.requests, "post"
    ) as storage_post:
        response = backend.app.test_client().post(
            f"/api/info-requests/{TOKEN}/upload",
            data={
                "document_label": "Company registration certificate",
                "file": (io.BytesIO(b"%PDF-valid"), "registration.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )
    assert response.status_code == 503
    assert response.get_json() == {"error": "Unable to verify upload quota"}
    storage_post.assert_not_called()


def test_upload_does_not_report_success_when_submission_state_write_fails():
    request_row = {
        "id": "request-1",
        "dealer_user_id": "dealer-1",
        "requested_documents": ["Company registration certificate"],
        "status": "pending",
        "expires_at": "2099-01-01T00:00:00+00:00",
    }

    def supabase(method, path, **kwargs):
        if method == "get" and path.endswith("dealer_info_requests"):
            return [request_row], 200
        if method == "get" and path.endswith("dealer_info_request_uploads"):
            if kwargs["params"]["select"] == "id,storage_path":
                return [], 200
            return [{"document_label": "Company registration certificate"}], 200
        if method == "post" and path.endswith("dealer_info_request_uploads"):
            return [], 201
        if method == "patch" and path.endswith("dealer_info_requests"):
            return {"error": "write failed"}, 503
        return [], 204

    with patch.object(backend, "supabase_request", side_effect=supabase), patch.object(
        backend, "_validate_info_request_document", return_value=b"%PDF-valid"
    ), patch.object(backend, "_dealer_document_type_from_label", return_value=None), patch.object(
        backend, "ensure_storage_bucket", return_value=True
    ), patch.object(backend.requests, "post", return_value=Mock(status_code=201, text="")):
        response = backend.app.test_client().post(
            f"/api/info-requests/{TOKEN}/upload",
            data={
                "document_label": "Company registration certificate",
                "file": (io.BytesIO(b"%PDF-valid"), "registration.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )
    assert response.status_code == 503
    assert response.get_json() == {"error": "Upload saved but submission could not be finalized"}


def test_upload_returns_safe_failure_when_storage_or_recording_fails():
    request_row = {
        "id": "request-1",
        "dealer_user_id": "dealer-1",
        "requested_documents": ["Company registration certificate"],
        "status": "pending",
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    client = backend.app.test_client()
    with patch.object(backend, "supabase_request", side_effect=[([request_row], 200), ([], 200)]), patch.object(
        backend, "_validate_info_request_document", return_value=b"%PDF-valid"
    ), patch.object(backend, "_dealer_document_type_from_label", return_value=None), patch.object(
        backend, "ensure_storage_bucket", return_value=True
    ), patch.object(backend.requests, "post", return_value=Mock(status_code=500, text="secret")):
        response = client.post(
            f"/api/info-requests/{TOKEN}/upload",
            data={
                "document_label": "Company registration certificate",
                "file": (io.BytesIO(b"%PDF-valid"), "registration.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )
    assert response.status_code == 500
    assert response.get_json() == {"error": "Failed to upload file"}
