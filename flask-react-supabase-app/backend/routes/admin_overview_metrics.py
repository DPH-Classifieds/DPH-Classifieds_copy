"""Admin platform-metrics overview route.

The handler is intentionally separate from the broader admin-stats and
Cloudflare-diagnostics routes. Shared auth, cache, time, Supabase pagination,
analytics aggregation, and logging helpers resolve through the runtime
backend boundary so legacy direct callers and monkeypatches continue to work.
"""

import time
from functools import wraps

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _token_required(function):
    """Apply the compatibility root's auth decorator at request time."""

    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def get_admin_metrics_overview(current_user):
    """Return user, car, bike, part, and plate analytics for admins."""

    backend = _backend()
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        days = max(min(int(request.args.get("days", 30)), 365), 1)
        cutoff = (backend._utc_now() - backend.datetime.timedelta(days=days)).isoformat()

        overview_metrics_ttl = 60
        overview_cache_key = f"api-cache:/api/admin/metrics/overview?days={days}"
        overview_cached = backend._api_cache_get(overview_cache_key)
        if overview_cached is not None:
            return jsonify(overview_cached), 200
        if not backend._cache_lock_acquire(overview_cache_key):
            time.sleep(0.15)
            overview_cached = backend._api_cache_get(overview_cache_key)
            if overview_cached is not None:
                return jsonify(overview_cached), 200

        events_resp, events_status = backend._fetch_all_rows(
            "/rest/v1/platform_events",
            {
                "select": "*",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
            },
        )
        if events_status >= 400:
            return jsonify({"error": "Failed to fetch analytics events"}), events_status

        # Page through full tables because PostgREST commonly caps one request
        # at 1,000 rows, which otherwise under-counts dashboard totals.
        car_rows_resp, car_status = backend._fetch_all_rows(
            "/rest/v1/cars",
            {
                "select": "id,car_manufacturer,car_model,make_year,body_type,vehicle_type,expected_selling_price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if car_status >= 400:
            car_rows_resp = []

        plate_rows_resp, plate_status = backend._fetch_all_rows(
            "/rest/v1/license_plates",
            {
                "select": "id,city,code,number,digits,price,plate_format,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if plate_status >= 400:
            plate_rows_resp = []

        bike_rows_resp, bike_status = backend._fetch_all_rows(
            "/rest/v1/bikes",
            {
                "select": "id,make,model,make_year,body_type,vehicle_type,price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if bike_status >= 400:
            bike_rows_resp = []

        part_rows_resp, part_status = backend._fetch_all_rows(
            "/rest/v1/car_parts",
            {
                "select": "id,title,name,price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if part_status >= 400:
            part_rows_resp = []

        user_rows_resp, user_status = backend._fetch_all_rows(
            "/rest/v1/users",
            {
                "select": "id,username,display_name,first_name,last_name,email,created_at,is_dealer,account_status,phone_verified,email_verified",
                "order": "created_at.desc",
            },
        )
        if user_status >= 400:
            user_rows_resp = []

        metrics = backend.build_platform_metrics(
            events_resp or [],
            car_rows=car_rows_resp or [],
            plate_rows=plate_rows_resp or [],
            user_rows=user_rows_resp or [],
            bike_rows=bike_rows_resp or [],
            part_rows=part_rows_resp or [],
            days=days,
        )

        live_cutoff = backend._utc_now() - backend.datetime.timedelta(minutes=5)
        live_visitor_ids = set()
        for event in events_resp or []:
            try:
                event_time = backend._parse_datetime(event.get("created_at"))
                if not event_time or event_time < live_cutoff:
                    continue
                live_visitor_ids.add(
                    str(
                        event.get("visitor_id")
                        or event.get("user_id")
                        or event.get("session_id")
                        or "anonymous"
                    )
                )
            except Exception:
                continue

        metrics["live_users"] = len(live_visitor_ids)
        metrics.setdefault("user_metrics", {})["live_users"] = len(live_visitor_ids)

        # Cloudflare may replace headline traffic metrics, while listing-level
        # engagement stays sourced from platform_events.
        try:
            from services.cloudflare_analytics import (
                fetch_zone_metrics as cloudflare_fetch,
                is_enabled as cloudflare_enabled,
            )

            user_metrics = metrics.setdefault("user_metrics", {})
            if cloudflare_enabled():
                cloudflare_metrics = cloudflare_fetch(days)
                if cloudflare_metrics:
                    user_metrics["unique_visitors"] = cloudflare_metrics["unique_visitors"]
                    user_metrics["page_views"] = cloudflare_metrics["page_views"]
                    user_metrics["sessions"] = cloudflare_metrics["unique_visitors"]
                    user_metrics["edge_requests"] = cloudflare_metrics["requests"]
                    user_metrics["edge_threats"] = cloudflare_metrics["threats"]
                    user_metrics["edge_cached_requests"] = cloudflare_metrics["cached_requests"]
                    user_metrics["edge_bytes"] = cloudflare_metrics["bytes"]
                    user_metrics["peak_daily_uniques"] = cloudflare_metrics["peak_daily_uniques"]
                    user_metrics["data_source"] = "cloudflare"
                    user_metrics["unique_visitors_source"] = cloudflare_metrics.get(
                        "unique_visitors_source"
                    )
                    if user_metrics.get("daily_trends"):
                        user_metrics["daily_trends_platform"] = user_metrics["daily_trends"]
                    user_metrics["daily_trends"] = cloudflare_metrics["daily_trends"]
                else:
                    user_metrics["data_source"] = "platform_events"
                    user_metrics["data_source_note"] = (
                        "Cloudflare configured but the API call failed; "
                        "showing platform_events numbers."
                    )
            else:
                user_metrics["data_source"] = "platform_events"
        except Exception as cloudflare_error:
            backend.logger.warning(
                "Cloudflare metrics override skipped: %s", cloudflare_error
            )
            metrics.setdefault("user_metrics", {})["data_source"] = "platform_events"

        backend._api_cache_set(overview_cache_key, metrics, overview_metrics_ttl)
        return jsonify(metrics), 200
    except Exception as error:
        backend.logger.error(
            "Error fetching admin metrics overview: %s", error
        )
        return jsonify({"error": "Failed to fetch admin metrics"}), 500


def register_admin_overview_metrics_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/metrics/overview",
        endpoint="get_admin_metrics_overview",
        view_func=get_admin_metrics_overview,
        methods=["GET"],
    )
