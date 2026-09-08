import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "car_update.py"


def test_car_delete_is_owned_by_the_car_update_module():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()

    from routes import car_update

    contracts = [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == "/api/cars/<string:car_id>"
        and contract.endpoint == "car_update.delete_car"
    ]
    assert len(contracts) == 1
    assert contracts[0].methods == ("DELETE", "OPTIONS")
    assert backend.delete_car is car_update.delete_car


def test_car_delete_preserves_owner_delete_and_cache_invalidation_contract():
    with patch.object(
        backend, "token_required", side_effect=lambda fn: lambda *a, **kw: fn("u1", *a, **kw)
    ), patch.object(
        backend, "_delete_user_owned_listing", return_value=({"ok": True}, 200)
    ) as delete_listing, patch.object(
        backend, "_invalidate_public_inventory_cache"
    ) as invalidate_inventory, patch.object(
        backend, "_invalidate_api_cache_prefixes"
    ) as invalidate_api:
        response = backend.app.test_client().delete("/api/cars/car-1")

    assert response.status_code == 200
    assert response.get_json() == {"message": "Car deleted successfully"}
    delete_listing.assert_called_once_with("u1", "car", "car-1")
    invalidate_inventory.assert_called_once_with("cars")
    invalidate_api.assert_called_once_with(["/api/cars/car-1"])
