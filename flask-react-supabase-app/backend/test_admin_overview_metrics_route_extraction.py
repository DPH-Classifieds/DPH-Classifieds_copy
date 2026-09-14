import ast
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


BACKEND_DIR = Path(__file__).parent
MODULE_PATH = BACKEND_DIR / "routes" / "admin_overview_metrics.py"
ROUTE = "/api/admin/metrics/overview"


def test_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")

    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_route_keeps_single_legacy_contract_and_compatibility_export():
    from routes import admin_overview_metrics

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_admin_metrics_overview"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_admin_metrics_overview is admin_overview_metrics.get_admin_metrics_overview


def test_route_requires_authentication():
    assert backend.app.test_client().get(ROUTE).status_code == 401


def test_overview_aggregates_all_listing_tables_and_uses_platform_events_fallback():
    now = datetime(2026, 9, 8, 8, 0, tzinfo=timezone.utc)
    event = {"visitor_id": "visitor-1", "created_at": now.isoformat()}
    rows_by_path = {
        "/rest/v1/platform_events": ([event], 200),
        "/rest/v1/cars": ([{"id": "car-1"}], 200),
        "/rest/v1/license_plates": ([{"id": "plate-1"}], 200),
        "/rest/v1/bikes": ([{"id": "bike-1"}], 200),
        "/rest/v1/car_parts": ([{"id": "part-1"}], 200),
        "/rest/v1/users": ([{"id": "user-1"}], 200),
    }

    def fetch_all_rows(path, params):
        return rows_by_path[path]

    with backend.app.test_request_context(f"{ROUTE}?days=999"), patch.object(
        backend,
        "_get_user_details_with_admin_status",
        return_value={"is_admin": True},
    ), patch.object(backend, "_utc_now", return_value=now), patch.object(
        backend, "_api_cache_get", return_value=None
    ), patch.object(backend, "_cache_lock_acquire", return_value=True), patch.object(
        backend, "_fetch_all_rows", side_effect=fetch_all_rows
    ) as fetch, patch.object(
        backend,
        "build_platform_metrics",
        return_value={"user_metrics": {"unique_visitors": 1}, "daily_trends": []},
    ) as build, patch(
        "services.cloudflare_analytics.is_enabled", return_value=False
    ), patch.object(backend, "_api_cache_set") as cache_set:
        response, status = backend.get_admin_metrics_overview.__wrapped__("admin-1")

    assert status == 200
    payload = response.get_json()
    assert payload["live_users"] == 1
    assert payload["user_metrics"]["live_users"] == 1
    assert payload["user_metrics"]["data_source"] == "platform_events"
    assert build.call_args.kwargs["days"] == 365
    assert fetch.call_count == 6
    assert cache_set.call_args.args[0] == "api-cache:/api/admin/metrics/overview?days=365"


def test_overview_cache_hit_skips_analytics_reads():
    cached = {"user_metrics": {"data_source": "platform_events"}, "live_users": 4}
    with backend.app.test_request_context(ROUTE), patch.object(
        backend,
        "_get_user_details_with_admin_status",
        return_value={"is_admin": True},
    ), patch.object(backend, "_api_cache_get", return_value=cached), patch.object(
        backend, "_fetch_all_rows"
    ) as fetch:
        response, status = backend.get_admin_metrics_overview.__wrapped__("admin-1")

    assert status == 200
    assert response.get_json() == cached
    fetch.assert_not_called()


def test_overview_marks_failed_listing_source_as_incomplete():
    rows_by_path = {
        "/rest/v1/platform_events": ([], 200),
        "/rest/v1/cars": ({"error": "cars unavailable"}, 503),
        "/rest/v1/license_plates": ([], 200),
        "/rest/v1/bikes": ([], 200),
        "/rest/v1/car_parts": ([], 200),
        "/rest/v1/users": ([], 200),
    }

    with backend.app.test_request_context(ROUTE), patch.object(
        backend,
        "_get_user_details_with_admin_status",
        return_value={"is_admin": True},
    ), patch.object(backend, "_utc_now", return_value=datetime(2026, 9, 8, tzinfo=timezone.utc)), patch.object(
        backend, "_api_cache_get", return_value=None
    ), patch.object(backend, "_cache_lock_acquire", return_value=True), patch.object(
        backend, "_fetch_all_rows", side_effect=lambda path, params: rows_by_path[path]
    ), patch.object(
        backend,
        "build_platform_metrics",
        return_value={"user_metrics": {}, "financial_metrics": {}},
    ), patch("services.cloudflare_analytics.is_enabled", return_value=False), patch.object(
        backend, "_api_cache_set"
    ):
        response, status = backend.get_admin_metrics_overview.__wrapped__("admin-1")

    assert status == 200
    assert response.get_json()["data_health"]["sources"]["cars"] == "unavailable"
    assert response.get_json()["data_health"]["incomplete"] is True


def test_overview_returns_exact_market_tracker_for_requested_cohort():
    now = datetime(2026, 9, 8, tzinfo=timezone.utc)
    rows_by_path = {
        "/rest/v1/platform_events": ([], 200),
        "/rest/v1/cars": ([
            {"car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2019,
             "expected_selling_price": 100000, "status": "approved", "is_approved": True},
            {"car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2019,
             "expected_selling_price": 120000, "status": "approved", "is_approved": True},
            {"car_manufacturer": "Toyota", "car_model": "Corolla", "make_year": 2019,
             "expected_selling_price": 50000, "status": "approved", "is_approved": True},
        ], 200),
        "/rest/v1/license_plates": ([], 200),
        "/rest/v1/bikes": ([], 200),
        "/rest/v1/car_parts": ([], 200),
        "/rest/v1/users": ([], 200),
        "/rest/v1/market_price_snapshots": ([
            {"snapshot_date": "2026-09-08", "listing_count": 2, "average_price": 105000,
             "median_price": 105000, "source": "platform_cars"},
        ], 200),
    }

    with backend.app.test_request_context(
        f"{ROUTE}?days=30&market_make=Toyota&market_model=Camry&market_year=2019"
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(backend, "_utc_now", return_value=now), patch.object(
        backend, "_api_cache_get", return_value=None
    ), patch.object(backend, "_cache_lock_acquire", return_value=True), patch.object(
        backend, "_fetch_all_rows", side_effect=lambda path, params: rows_by_path[path]
    ), patch.object(backend, "_api_cache_set"), patch(
        "services.cloudflare_analytics.is_enabled", return_value=False
    ):
        response, status = backend.get_admin_metrics_overview.__wrapped__("admin-1")

    assert status == 200
    market = response.get_json()["market_tracker"]
    assert market["cohort"]["key"] == "toyota|camry|2019"
    assert market["average_price"] == 110000
    assert market["listing_count"] == 2
    assert market["history"][0]["snapshot_date"] == "2026-09-08"


def test_overview_cloudflare_metrics_override_is_truthful():
    now = datetime(2026, 9, 8, 8, 0, tzinfo=timezone.utc)
    cloudflare = {
        "unique_visitors": 99,
        "page_views": 100,
        "requests": 101,
        "threats": 2,
        "cached_requests": 80,
        "bytes": 1234,
        "peak_daily_uniques": 20,
        "daily_trends": [{"date": "2026-09-08", "unique_visitors": 99}],
        "unique_visitors_source": "edge",
    }

    def fetch_all_rows(path, params):
        if path == "/rest/v1/platform_events":
            return ([{"visitor_id": "platform", "created_at": now.isoformat()}], 200)
        return ([], 200)

    with backend.app.test_request_context(ROUTE), patch.object(
        backend,
        "_get_user_details_with_admin_status",
        return_value={"is_admin": True},
    ), patch.object(backend, "_utc_now", return_value=now), patch.object(
        backend, "_api_cache_get", return_value=None
    ), patch.object(backend, "_cache_lock_acquire", return_value=True), patch.object(
        backend, "_fetch_all_rows", side_effect=fetch_all_rows
    ), patch.object(
        backend,
        "build_platform_metrics",
        return_value={
            "user_metrics": {
                "unique_visitors": 1,
                "daily_trends": [{"date": "platform"}],
            }
        },
    ), patch(
        "services.cloudflare_analytics.is_enabled", return_value=True
    ), patch(
        "services.cloudflare_analytics.fetch_zone_metrics", return_value=cloudflare
    ), patch.object(backend, "_api_cache_set"):
        response, status = backend.get_admin_metrics_overview.__wrapped__("admin-1")

    assert status == 200
    user_metrics = response.get_json()["user_metrics"]
    assert user_metrics["data_source"] == "cloudflare"
    assert user_metrics["unique_visitors"] == 99
    assert user_metrics["daily_trends"] == cloudflare["daily_trends"]
    assert user_metrics["daily_trends_platform"] == [{"date": "platform"}]


def test_overview_returns_upstream_status_when_events_query_fails():
    with backend.app.test_request_context(ROUTE), patch.object(
        backend,
        "_get_user_details_with_admin_status",
        return_value={"is_admin": True},
    ), patch.object(backend, "_api_cache_get", return_value=None), patch.object(
        backend, "_cache_lock_acquire", return_value=True
    ), patch.object(backend, "_fetch_all_rows", return_value=([], 503)):
        response, status = backend.get_admin_metrics_overview.__wrapped__("admin-1")

    assert status == 503
    assert response.get_json() == {"error": "Failed to fetch analytics events"}
