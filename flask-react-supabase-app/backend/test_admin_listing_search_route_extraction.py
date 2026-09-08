import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "admin_listing_search.py"
ROUTE = "/api/admin/listings-search"


def test_admin_listing_search_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_admin_listing_search_keeps_single_route_and_legacy_export():
    from routes import admin_listing_search

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "admin_listings_search"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.admin_listings_search is admin_listing_search.admin_listings_search


def test_admin_listing_search_requires_authentication():
    assert backend.app.test_client().get(ROUTE).status_code == 401


def test_admin_listing_search_admin_guard_is_preserved():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "_require_admin_api_user", return_value=False
    ):
        response, status = backend.admin_listings_search.__wrapped__("not-admin")

    assert status == 403
    assert response.get_json() == {"error": "Unauthorized - Admin access required"}
