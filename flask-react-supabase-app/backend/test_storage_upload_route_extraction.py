import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "storage_upload.py"
ROUTE = "/api/storage/signed-upload-url"


def test_storage_upload_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_storage_upload_keeps_single_authenticated_post_contract_and_export():
    from routes import storage_upload

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "create_storage_signed_upload_url"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.create_storage_signed_upload_url is storage_upload.create_storage_signed_upload_url


def test_storage_upload_validates_before_bucket_or_signing_calls():
    payload = {
        "bucket_name": "listing-images",
        "object_path": "user-123/photo.jpg",
        "content_type": "image/jpeg",
        "file_size": 1024,
        "upsert": True,
    }
    with backend.app.test_request_context(ROUTE, method="POST", json=payload), patch.object(
        backend, "_safe_generated_object_path", return_value=True
    ), patch.object(backend, "ensure_storage_bucket", return_value=True) as ensure_bucket, patch.object(
        backend, "_create_signed_upload_url", return_value=({"url": "signed"}, None)
    ) as create_signed:
        response, status = backend.create_storage_signed_upload_url.__wrapped__("user-123")
    assert status == 200
    assert response.get_json() == {"url": "signed"}
    ensure_bucket.assert_called_once_with("listing-images")
    create_signed.assert_called_once_with(
        bucket_name="listing-images", object_path="user-123/photo.jpg", upsert=True
    )

    bad_payload = {**payload, "object_path": "user-123/../photo.jpg"}
    with backend.app.test_request_context(ROUTE, method="POST", json=bad_payload), patch.object(
        backend, "_safe_generated_object_path", return_value=False
    ), patch.object(backend, "ensure_storage_bucket") as ensure_bucket:
        response, status = backend.create_storage_signed_upload_url.__wrapped__("user-123")
    assert status == 400
    assert "safe generated path" in response.get_json()["error"]
    ensure_bucket.assert_not_called()
