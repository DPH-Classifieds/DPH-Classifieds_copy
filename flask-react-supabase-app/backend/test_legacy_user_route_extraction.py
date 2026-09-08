import ast
from pathlib import Path
from unittest.mock import MagicMock, patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "users_legacy.py"
ROUTE = "/api/users"


def test_legacy_user_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_legacy_user_route_keeps_single_authenticated_get_contract_and_export():
    from routes import users_legacy

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_users"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_users is users_legacy.get_users


def test_legacy_user_route_requires_admin_before_fetching_all_users():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "supabase_request", return_value=([{"id": "u1", "is_admin": False}], 200)
    ), patch.object(backend, "_is_super_admin_record", return_value=False), patch.object(
        backend.requests, "get"
    ) as get_request:
        response, status = backend.get_users.__wrapped__("u1")
    assert status == 403
    assert response.get_json() == {"error": "Unauthorized. Only admins can view users."}
    get_request.assert_not_called()


def test_legacy_user_route_preserves_partial_content_envelope():
    response = MagicMock(status_code=206, text="", json=lambda: [{"id": "u1"}])
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "supabase_request", return_value=([{"id": "admin", "is_admin": True}], 200)
    ), patch.object(backend.requests, "get", return_value=response):
        result, status = backend.get_users.__wrapped__("admin")
    assert status == 200
    assert result.get_json() == {"users": [{"id": "u1"}], "partial_content": True}
