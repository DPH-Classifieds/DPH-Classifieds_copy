import ast
from pathlib import Path

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "admin_reddit_analytics.py"
ROUTE = "/api/admin/reddit-import-analytics"


def test_admin_reddit_analytics_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_admin_reddit_analytics_keeps_single_route_and_legacy_export():
    from routes import admin_reddit_analytics

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_admin_reddit_import_analytics"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_admin_reddit_import_analytics is admin_reddit_analytics.get_admin_reddit_import_analytics


def test_admin_reddit_analytics_requires_authentication():
    assert backend.app.test_client().get(ROUTE).status_code == 401
