import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "user_listing_actions.py"
ROUTE = "/api/user/listings/<item_type>/<item_id>/dismiss"


def test_user_listing_actions_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_user_listing_actions_keeps_single_authenticated_route_and_export():
    from routes import user_listing_actions

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "dismiss_user_listing"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.dismiss_user_listing is user_listing_actions.dismiss_user_listing


def test_dismiss_requires_terminal_owned_listing_and_is_idempotent():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", {}
    ):
        response, status = backend.dismiss_user_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 400
    assert response.get_json() == {"error": "Invalid listing type"}

    config = {"car": {"table": "cars"}}
    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", config
    ), patch.object(
        backend,
        "supabase_request",
        return_value=([{"id": "car-1", "user_id": "other", "status": "deleted"}], 200),
    ):
        response, status = backend.dismiss_user_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 403

    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", config
    ), patch.object(
        backend,
        "supabase_request",
        return_value=([{"id": "car-1", "user_id": "user-1", "status": "approved"}], 200),
    ):
        response, status = backend.dismiss_user_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 400

    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", config
    ), patch.object(
        backend,
        "supabase_request",
        return_value=([{"id": "car-1", "user_id": "user-1", "status": "deleted", "user_dismissed_at": "now"}], 200),
    ):
        response, status = backend.dismiss_user_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 200
    assert response.get_json() == {"message": "Listing already removed from your list"}


def test_dismiss_patches_only_owned_terminal_listing():
    config = {"car": {"table": "cars"}}
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if method == "get":
            return ([{"id": "car-1", "user_id": "user-1", "status": "sold"}], 200)
        return ([{"id": "car-1"}], 200)

    with backend.app.test_request_context(ROUTE), patch.object(
        backend, "LISTING_TABLE_CONFIG", config
    ), patch.object(backend, "supabase_request", side_effect=fake_request), patch.object(
        backend, "_utc_now", return_value=backend.datetime.datetime(2026, 1, 1)
    ), patch.object(backend, "_isoformat_utc", return_value="2026-01-01T00:00:00Z"):
        response, status = backend.dismiss_user_listing.__wrapped__("user-1", "car", "car-1")

    assert status == 200
    assert response.get_json() == {"message": "Listing removed from your list"}
    assert calls[1] == (
        "patch",
        "/rest/v1/cars",
        {
            "params": {"id": "eq.car-1", "user_id": "eq.user-1"},
            "data": {"user_dismissed_at": "2026-01-01T00:00:00Z"},
            "use_service_role": True,
        },
    )
