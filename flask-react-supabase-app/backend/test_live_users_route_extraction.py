import ast
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "live_users.py"
ROUTES = {
    "/api/admin/live-users": "get_admin_live_users",
    "/api/admin/live-users/history": "get_admin_live_users_history",
}


def test_live_user_module_uses_runtime_boundary_without_app_import():
    source = MODULE_PATH.read_text()
    tree = ast.parse(source)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")

    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source


def test_live_user_routes_keep_single_legacy_contracts_and_exports():
    from routes import live_users

    manifest = build_route_manifest(backend.app)
    for path, endpoint in ROUTES.items():
        contracts = [contract for contract in manifest if contract.rule == path]
        assert len(contracts) == 1
        assert contracts[0].endpoint == endpoint
        assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
        assert getattr(backend, endpoint) is getattr(live_users, endpoint)


def test_live_user_routes_require_an_authenticated_request():
    client = backend.app.test_client()
    for path in ROUTES:
        assert client.get(path).status_code == 401


def test_live_users_preserves_window_clamp_distinct_visitors_and_cache():
    now = datetime(2026, 9, 8, 8, 0, tzinfo=timezone.utc)
    events = [
        {"visitor_id": "visitor-a", "created_at": "2026-09-08T07:59:00+00:00"},
        {"visitor_id": "visitor-a", "created_at": "2026-09-08T07:58:00+00:00"},
        {"visitor_id": "visitor-b", "created_at": "2026-09-08T07:57:00+00:00"},
        {"visitor_id": "", "created_at": "2026-09-08T07:56:00+00:00"},
    ]
    with backend.app.test_request_context("/api/admin/live-users?window_seconds=9999"), patch.object(
        backend, "_require_admin_api_user", return_value=True
    ), patch.object(backend, "_api_cache_get", return_value=None), patch.object(
        backend, "_utc_now", return_value=now
    ), patch.object(backend, "supabase_request", return_value=(events, 200)) as supabase, patch.object(
        backend, "_api_cache_set"
    ) as cache_set:
        response = backend.get_admin_live_users.__wrapped__("admin-1")

    assert response[1] == 200
    assert response[0].get_json() == {
        "window_seconds": 1800,
        "live_visitors": 2,
        "timestamp": "2026-09-08T08:00:00+00:00",
    }
    assert supabase.call_args.kwargs["params"]["created_at"] == "gte.2026-09-08T07:30:00+00:00"
    cache_set.assert_called_once_with(
        "api-cache:admin-live-users:window=1800",
        response[0].get_json(),
        ttl_seconds=15,
    )


def test_live_users_preserves_upstream_error_envelope():
    with backend.app.test_request_context("/api/admin/live-users"), patch.object(
        backend, "_require_admin_api_user", return_value=True
    ), patch.object(backend, "_api_cache_get", return_value=None), patch.object(
        backend,
        "supabase_request",
        return_value=({"message": "unavailable"}, 503),
    ):
        response = backend.get_admin_live_users.__wrapped__("admin-1")

    assert response[1] == 503
    assert response[0].get_json() == {"error": "Failed to fetch live visitors"}


def test_live_user_history_preserves_clamps_buckets_and_distinct_counts():
    now = datetime(2026, 9, 8, 8, 0, 30, tzinfo=timezone.utc)
    events = [
        {"visitor_id": "visitor-a", "created_at": "2026-09-08T07:59:45+00:00"},
        {"visitor_id": "visitor-a", "created_at": "2026-09-08T07:59:40+00:00"},
        {"visitor_id": "visitor-b", "created_at": "2026-09-08T07:59:50+00:00"},
        {"visitor_id": "visitor-c", "created_at": "2026-09-08T07:54:00+00:00"},
    ]
    with backend.app.test_request_context(
        "/api/admin/live-users/history?window_seconds=1&bucket_seconds=1"
    ), patch.object(backend, "_require_admin_api_user", return_value=True), patch.object(
        backend, "_api_cache_get", return_value=None
    ), patch.object(backend, "_utc_now", return_value=now), patch.object(
        backend, "supabase_request", return_value=(events, 200)
    ) as supabase, patch.object(backend, "_api_cache_set") as cache_set:
        response = backend.get_admin_live_users_history.__wrapped__("admin-1")

    assert response[1] == 200
    payload = response[0].get_json()
    assert payload["window_seconds"] == 300
    assert payload["bucket_seconds"] == 30
    assert len(payload["points"]) == 10
    assert max(point["value"] for point in payload["points"]) == 2
    assert sum(point["value"] for point in payload["points"]) == 2
    assert supabase.call_args.kwargs["params"]["created_at"] == "gte.2026-09-08T07:55:30+00:00"
    cache_set.assert_called_once()
    assert cache_set.call_args.args[0] == "api-cache:admin-live-users-history:w=300:b=30"
    assert cache_set.call_args.kwargs["ttl_seconds"] == 30


def test_live_user_history_preserves_upstream_error_envelope():
    with backend.app.test_request_context("/api/admin/live-users/history"), patch.object(
        backend, "_require_admin_api_user", return_value=True
    ), patch.object(backend, "_api_cache_get", return_value=None), patch.object(
        backend,
        "supabase_request",
        return_value=({"message": "unavailable"}, 503),
    ):
        response = backend.get_admin_live_users_history.__wrapped__("admin-1")

    assert response[1] == 503
    assert response[0].get_json() == {
        "error": "Failed to fetch live visitor history"
    }
