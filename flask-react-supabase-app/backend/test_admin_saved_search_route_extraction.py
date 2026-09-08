import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "admin_saved_searches.py"
ROUTE = "/api/admin/saved-searches"


def test_admin_saved_search_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_admin_saved_search_route_keeps_single_get_contract_and_export():
    from routes import admin_saved_searches

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_admin_saved_searches"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_admin_saved_searches is admin_saved_searches.get_admin_saved_searches


def test_admin_saved_search_route_keeps_admin_gate_before_database():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "_require_admin_api_user", return_value=False
    ), patch.object(backend, "supabase_request") as supabase_request:
        response, status = backend.get_admin_saved_searches.__wrapped__("user-1")
    assert status == 403
    assert response.get_json() == {"error": "Unauthorized - Admin access required"}
    supabase_request.assert_not_called()
