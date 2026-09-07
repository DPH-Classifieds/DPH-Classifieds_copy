import ast
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


BACKEND_DIR = Path(__file__).parent
MODULE_PATH = BACKEND_DIR / "routes" / "admin_metrics.py"
ROUTES = {
    "/api/admin/metrics/email": "get_email_metrics",
    "/api/admin/metrics/errors": "get_error_metrics",
}


def test_admin_metrics_module_uses_runtime_boundary_without_app_import():
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


def test_admin_metrics_routes_keep_single_legacy_contracts_and_exports():
    from routes import admin_metrics

    manifest = build_route_manifest(backend.app)
    for path, endpoint in ROUTES.items():
        contracts = [contract for contract in manifest if contract.rule == path]
        assert len(contracts) == 1
        assert contracts[0].endpoint == endpoint
        assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
        assert getattr(backend, endpoint) is getattr(admin_metrics, endpoint)


def test_admin_metrics_routes_require_an_authenticated_admin():
    client = backend.app.test_client()
    for path in ROUTES:
        response = client.get(path)
        assert response.status_code == 401


def test_email_metrics_preserves_aggregation_cache_and_days_clamp():
    rows = [
        {
            "email_type": "dealer_verification",
            "sent_at": "2026-09-07T08:00:00+00:00",
            "delivered_at": "2026-09-07T08:01:00+00:00",
            "opened_at": "2026-09-07T08:02:00+00:00",
            "clicked_at": None,
            "bounced_at": None,
            "unsubscribed_at": None,
            "error_message": None,
        },
        {
            "email_type": "dealer_verification",
            "sent_at": "2026-09-06T08:00:00+00:00",
            "delivered_at": None,
            "opened_at": None,
            "clicked_at": None,
            "bounced_at": "2026-09-06T08:01:00+00:00",
            "unsubscribed_at": None,
            "error_message": "bounce",
        },
    ]
    now = datetime(2026, 9, 8, 8, 0, tzinfo=timezone.utc)
    with backend.app.test_request_context("/api/admin/metrics/email?days=999"), patch.object(
        backend,
        "_get_user_details_with_admin_status",
        return_value={"is_admin": True},
    ), patch.object(backend, "_utc_now", return_value=now), patch.object(
        backend, "_api_cache_get", return_value=None
    ), patch.object(backend, "_cache_lock_acquire", return_value=True), patch.object(
        backend, "supabase_request", return_value=(rows, 200)
    ) as supabase, patch.object(backend, "_api_cache_set") as cache_set:
        response = backend.get_email_metrics.__wrapped__("admin-1")

    assert response[1] == 200
    payload = response[0].get_json()
    assert payload["summary"] == {
        "total_sent": 2,
        "delivered": 1,
        "opened": 1,
        "clicked": 0,
        "bounced": 1,
        "unsubscribed": 0,
        "errored": 1,
        "open_rate": 50.0,
        "click_rate": 0.0,
        "bounce_rate": 50.0,
    }
    assert payload["by_type"][0]["type"] == "dealer_verification"
    assert payload["daily"] == [
        {"date": "2026-09-06", "count": 1},
        {"date": "2026-09-07", "count": 1},
    ]
    assert "gte.2025-09-08T08:00:00+00:00" == supabase.call_args.kwargs["params"]["sent_at"]
    cache_set.assert_called_once()
    assert cache_set.call_args.args[0] == "api-cache:/api/admin/metrics/email?days=365"


def test_email_metrics_preserves_missing_table_envelope():
    with backend.app.test_request_context("/api/admin/metrics/email"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(
        backend,
        "_api_cache_get",
        return_value=None,
    ), patch.object(backend, "_cache_lock_acquire", return_value=True), patch.object(
        backend,
        "supabase_request",
        return_value=({"message": "relation outbound_emails does not exist"}, 404),
    ), patch.object(backend, "_looks_like_missing_table", return_value=True):
        response = backend.get_email_metrics.__wrapped__("admin-1")

    assert response[1] == 200
    assert response[0].get_json() == {
        "error": "outbound_emails table not migrated yet",
        "summary": {},
        "by_type": [],
        "daily": [],
    }


def test_error_metrics_preserves_context_summary_and_recent_limit():
    rows = [
        {"context": "listing", "source": "frontend", "message": "a"},
        {"context": "listing", "source": "backend", "message": "b"},
        {"context": None, "source": "worker", "message": "c"},
    ]
    with backend.app.test_request_context("/api/admin/metrics/errors?days=0"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(backend, "_utc_now", return_value=datetime(2026, 9, 8, tzinfo=timezone.utc)), patch.object(
        backend,
        "supabase_request",
        return_value=(rows, 200),
    ) as supabase:
        response = backend.get_error_metrics.__wrapped__("admin-1")

    assert response[1] == 200
    payload = response[0].get_json()
    assert payload["summary"] == {"total": 3, "frontend": 1, "backend": 2}
    assert payload["by_context"] == [
        {"context": "listing", "count": 2},
        {"context": "unknown", "count": 1},
    ]
    assert payload["recent"] == rows
    assert supabase.call_args.kwargs["params"]["created_at"] == "gte.2026-09-07T00:00:00+00:00"


def test_error_metrics_preserves_missing_table_envelope():
    with backend.app.test_request_context("/api/admin/metrics/errors"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(
        backend,
        "supabase_request",
        return_value=({"message": "relation app_errors does not exist"}, 404),
    ), patch.object(backend, "_looks_like_missing_table", return_value=True):
        response = backend.get_error_metrics.__wrapped__("admin-1")

    assert response[1] == 200
    assert response[0].get_json() == {
        "error": "app_errors table not migrated yet",
        "summary": {},
        "by_context": [],
        "recent": [],
    }
