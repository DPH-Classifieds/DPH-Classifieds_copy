import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "admin_stats.py"
ROUTE = "/api/admin/stats"


def test_admin_stats_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_admin_stats_keeps_single_route_and_legacy_export():
    from routes import admin_stats

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_admin_stats"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_admin_stats is admin_stats.get_admin_stats


def test_admin_stats_requires_authentication():
    assert backend.app.test_client().get(ROUTE).status_code == 401


def test_admin_stats_admin_guard_is_preserved():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "_require_admin_api_user", return_value=False
    ):
        response, status = backend.get_admin_stats.__wrapped__("not-admin")

    assert status == 403
    assert response.get_json() == {"error": "Unauthorized - Admin access required"}
