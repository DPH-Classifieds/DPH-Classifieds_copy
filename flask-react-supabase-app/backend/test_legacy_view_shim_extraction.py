import ast
from pathlib import Path

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "legacy_view_shims.py"


def test_legacy_view_shim_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_legacy_view_shims_keep_single_post_routes_and_compatibility_exports():
    from routes import legacy_view_shims

    manifest = build_route_manifest(backend.app)
    expected = {
        "/api/cars/<string:car_id>/view": "track_car_view",
        "/api/bikes/<string:bike_id>/view": "track_bike_view",
        "/api/plates/<string:plate_id>/view": "track_plate_view",
        "/api/parts/<string:part_id>/view": "track_part_view",
    }
    for rule, endpoint in expected.items():
        contracts = [c for c in manifest if c.rule == rule]
        assert len(contracts) == 1
        assert contracts[0].endpoint == endpoint
        assert contracts[0].methods == ("OPTIONS", "POST")
        assert getattr(backend, endpoint) is getattr(legacy_view_shims, endpoint)


def test_legacy_view_shims_return_accepted_canonical_tracking_message():
    cases = [
        (backend.track_car_view, "car", "car-1"),
        (backend.track_bike_view, "bike", "bike-1"),
        (backend.track_plate_view, "plate", "plate-1"),
        (backend.track_part_view, "part", "part-1"),
    ]
    for handler, listing_type, listing_id in cases:
        with backend.app.test_request_context(
            f"/api/{listing_type}s/{listing_id}/view", method="POST"
        ):
            response, status = handler(listing_id)
        assert status == 202
        assert response.get_json() == {
            "message": "Listing views are tracked by canonical analytics events"
        }
