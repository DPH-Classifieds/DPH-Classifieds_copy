import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "license_plates_legacy.py"
ROUTE = "/api/license-plates"


def test_legacy_license_plate_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_legacy_license_plate_route_keeps_single_public_get_contract_and_export():
    from routes import license_plates_legacy

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_license_plates"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_license_plates is license_plates_legacy.get_license_plates


def test_legacy_license_plate_route_builds_approved_filter_query_and_enriches():
    calls = []

    def fake_supabase(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return ([{"id": "p1", "user_id": "u1"}], 200)

    with backend.app.test_request_context(
        "/api/license-plates?city=Dubai&code=A&digits=2"
    ), patch.object(backend, "_build_api_cache_key", return_value="key"), patch.object(
        backend, "_api_cache_get", return_value=None
    ), patch.object(backend, "supabase_request", side_effect=fake_supabase), patch.object(
        backend, "_batch_fetch_seller_map", return_value={"u1": {"display_name": "Seller"}}
    ), patch.object(backend, "_apply_seller_to_listing") as enrich, patch.object(
        backend, "_api_cache_set"
    ), patch.object(backend, "_cached_json_response", side_effect=lambda payload: backend.jsonify(payload)):
        response = backend.get_license_plates()

    assert response.get_json() == [{"id": "p1", "user_id": "u1"}]
    assert "status=eq.approved&is_approved=eq.true" in calls[0][1]
    assert "city=eq.Dubai" in calls[0][1]
    enrich.assert_called_once()
