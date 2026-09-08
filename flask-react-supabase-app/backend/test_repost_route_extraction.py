import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "repost.py"
ROUTE = "/api/user/listings/<item_type>/<item_id>/repost"


def test_repost_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_repost_keeps_single_authenticated_route_and_legacy_export():
    from routes import repost

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "repost_user_listing"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.repost_user_listing is repost.repost_user_listing


def test_repost_rejects_unknown_type_and_non_owned_listing():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", {}
    ):
        response, status = backend.repost_user_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 400
    assert response.get_json() == {"error": "Invalid listing type"}

    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", {"car": {"table": "cars"}}
    ), patch.object(
        backend, "supabase_request", return_value=([{"id": "car-1", "user_id": "other"}], 200)
    ):
        response, status = backend.repost_user_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 403
    assert response.get_json() == {"error": "You do not have permission to repost this listing"}


def test_repost_requires_deleted_or_rejected_state():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", {"car": {"table": "cars"}}
    ), patch.object(
        backend, "supabase_request", return_value=([{"id": "car-1", "user_id": "user-1", "status": "approved"}], 200)
    ):
        response, status = backend.repost_user_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 400
    assert response.get_json() == {"error": "Only deleted listings can be reposted"}
