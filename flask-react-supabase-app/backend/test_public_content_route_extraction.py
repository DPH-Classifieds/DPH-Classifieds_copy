import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "public_content.py"


def test_public_content_module_uses_runtime_backend_only():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_public_content_routes_are_registered_once_with_legacy_exports():
    from routes import public_content

    manifest = build_route_manifest(backend.app)
    privacy = [c for c in manifest if c.rule == "/api/privacy-policy"]
    ads = [c for c in manifest if c.rule == "/api/advertisements"]

    assert len(privacy) == 1
    assert privacy[0].endpoint == "get_privacy_policy"
    assert privacy[0].methods == ("GET", "HEAD", "OPTIONS")
    assert len(ads) == 1
    assert ads[0].endpoint == "get_advertisements"
    assert ads[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_privacy_policy is public_content.get_privacy_policy
    assert backend.get_advertisements is public_content.get_advertisements


def test_privacy_policy_preserves_latest_row_and_missing_response():
    with patch.object(
        backend,
        "supabase_request",
        return_value=([{"id": "policy-1", "body": "latest"}], 200),
    ) as request:
        response = backend.app.test_client().get("/api/privacy-policy")

    assert response.status_code == 200
    assert response.get_json() == {"id": "policy-1", "body": "latest"}
    request.assert_called_once_with(
        "get", "/rest/v1/privacy_policies?select=*&order=created_at.desc&limit=1"
    )

    with patch.object(backend, "supabase_request", return_value=([], 200)):
        missing = backend.app.test_client().get("/api/privacy-policy")
    assert missing.status_code == 404
    assert missing.get_json() == {"privacy_policy": "Privacy policy not found"}


def test_advertisements_use_service_role_and_preserve_missing_response():
    with patch.object(
        backend,
        "supabase_request",
        return_value=([{"id": "ad-1", "title": "Sale"}], 200),
    ) as request:
        response = backend.app.test_client().get("/api/advertisements")

    assert response.status_code == 200
    assert response.get_json() == {"id": "ad-1", "title": "Sale"}
    request.assert_called_once_with(
        "get",
        "/rest/v1/advertisements?select=*&order=created_at.desc&limit=1",
        use_service_role=True,
    )

    with patch.object(backend, "supabase_request", return_value=([], 200)):
        missing = backend.app.test_client().get("/api/advertisements")
    assert missing.status_code == 404
    assert missing.get_json() == {"error": "Advertisements not found"}
