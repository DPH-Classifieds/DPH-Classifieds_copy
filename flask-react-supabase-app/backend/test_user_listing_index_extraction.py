import ast
from pathlib import Path

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "user_listing_index.py"
ROUTES = {
    "/api/user/cars": "get_user_cars",
    "/api/user/bikes": "get_user_bikes",
    "/api/user/plates": "get_user_plates",
    "/api/user/parts": "get_user_parts",
    "/api/user/listings": "get_all_user_listings",
}


def test_user_listing_index_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_user_listing_index_keeps_single_get_routes_and_legacy_exports():
    from routes import user_listing_index

    contracts = build_route_manifest(backend.app)
    for rule, endpoint in ROUTES.items():
        matches = [contract for contract in contracts if contract.rule == rule]
        assert len(matches) == 1
        assert matches[0].endpoint == endpoint
        assert matches[0].methods == ("GET", "HEAD", "OPTIONS")
        assert getattr(backend, endpoint) is getattr(user_listing_index, endpoint)


def test_user_listing_index_requires_authentication():
    for rule in ROUTES:
        response = backend.app.test_client().get(rule)
        assert response.status_code == 401, (rule, response.get_data(as_text=True))
