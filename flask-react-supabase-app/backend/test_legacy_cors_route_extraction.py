import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "legacy_cors.py"


def test_legacy_cors_module_uses_runtime_backend_only():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_legacy_cors_routes_keep_preflight_contract_and_exports():
    from routes import legacy_cors

    manifest = build_route_manifest(backend.app)
    expected = {
        "/api/cars": "cars_options",
        "/api/cars/<string:car_id>/update": "update_car_options",
        "/api/cars/<string:car_id>": "update_car_options",
    }
    for rule, endpoint in expected.items():
        contracts = [
            c for c in manifest if c.rule == rule and c.endpoint == endpoint
        ]
        assert len(contracts) == 1
        assert contracts[0].endpoint == endpoint
    assert backend.cars_options is legacy_cors.cars_options
    assert backend.update_car_options is legacy_cors.update_car_options


def test_legacy_cors_routes_allow_configured_origin_and_expected_headers():
    with patch.object(backend, "_get_cors_origins", return_value={"https://example.test"}):
        response = backend.app.test_client().options(
            "/api/cars", headers={"Origin": "https://example.test"}
        )
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "https://example.test"
    assert response.headers["Access-Control-Allow-Credentials"] == "true"
    assert "Authorization" in response.headers["Access-Control-Allow-Headers"]
    assert "DELETE" in response.headers["Access-Control-Allow-Methods"]
