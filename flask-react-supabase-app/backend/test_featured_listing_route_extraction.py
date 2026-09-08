import ast
from pathlib import Path

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "featured_listings.py"
EXPECTED = {
    ("/api/admin/featured-listings", "admin_list_featured_listings"): ("GET", "HEAD", "OPTIONS"),
    ("/api/admin/featured-listings", "admin_create_featured_listing"): ("OPTIONS", "POST"),
    ("/api/admin/featured-listings/<row_id>", "admin_delete_featured_listing"): ("DELETE", "OPTIONS"),
    ("/api/admin/featured-listings/<row_id>", "admin_update_featured_listing"): ("OPTIONS", "PATCH"),
    ("/api/featured-listings", "public_list_featured_listings"): ("GET", "HEAD", "OPTIONS"),
    ("/api/admin/featured-placement/settings", "admin_featured_placement_settings"): ("GET", "HEAD", "OPTIONS", "PATCH"),
    ("/api/featured-placement/pattern", "public_featured_placement_pattern"): ("GET", "HEAD", "OPTIONS"),
}


def test_featured_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_featured_routes_are_registered_once_with_legacy_exports():
    from routes import featured_listings

    contracts = build_route_manifest(backend.app)
    for (rule, endpoint), methods in EXPECTED.items():
        matches = [contract for contract in contracts if contract.rule == rule and contract.endpoint == endpoint]
        assert len(matches) == 1
        assert matches[0].methods == methods
        assert getattr(backend, endpoint) is getattr(featured_listings, endpoint)


def test_featured_public_route_rejects_unknown_type_without_provider_access():
    with backend.app.test_request_context("/api/featured-listings?type=unknown"):
        response, status = backend.public_list_featured_listings()
    assert status == 400
    assert "type must be one of" in response.get_json()["error"]
