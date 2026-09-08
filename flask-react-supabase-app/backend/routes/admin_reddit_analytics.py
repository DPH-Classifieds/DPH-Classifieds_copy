"""Aggregate-only admin analytics for imported Reddit listings.

The route deliberately exposes no raw event metadata, IPs, user agents, post
bodies, access tokens, or seller contact data.
"""

from collections import defaultdict
from functools import wraps

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def get_admin_reddit_import_analytics(current_user):
    backend = _backend()
    """Import health + Reddit outbound-open engagement for imported listings.

    Admin-only. Returns no IP/user-agent, raw event metadata, access token,
    post body, or seller contact — only aggregate counters and safe titles/links.
    """
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403
    try:
        days = max(min(int(request.args.get("days", 30)), 90), 1)
        cache_key = f"api-cache:admin-reddit-import-analytics:days={days}"
        cached = backend._api_cache_get(cache_key)
        if cached is not None:
            return jsonify(cached), 200
        cutoff = (backend._utc_now() - backend.datetime.timedelta(days=days)).isoformat()

        # 1. Imported listings across every category: totals, live/removed, links.
        backend._REDDIT_TABLES = [
            ("cars", "car", "listing_title"),
            ("bikes", "bike", None),  # title built from make/model
            ("license_plates", "plate", "listing_title"),
            ("car_parts", "part", "name"),
        ]
        listing_by_id = {}
        total = live = total_views = 0
        for table, ltype, title_col in backend._REDDIT_TABLES:
            select_cols = ["id", "source_url", "source_removed_at", "view_count"]
            if title_col:
                select_cols.append(title_col)
            if table == "bikes":
                select_cols += ["make", "model"]
            rows, _s = backend._fetch_all_rows(
                f"/rest/v1/{table}",
                {"select": ",".join(select_cols), "source_platform": "eq.reddit",
                 "order": "source_last_seen_at.desc"},
            )
            for r in (rows or []):
                total += 1
                if not r.get("source_removed_at"):
                    live += 1
                total_views += int(r.get("view_count") or 0)
                if title_col:
                    title = r.get(title_col)
                else:
                    title = " ".join(x for x in [r.get("make"), r.get("model")] if x) or None
                listing_by_id[str(r.get("id"))] = {
                    "title": title, "source_url": r.get("source_url"),
                    "views": int(r.get("view_count") or 0), "listing_type": ltype,
                }

        # 2. reddit_post_open events in the window (any imported category).
        events, _ev_status = backend._fetch_all_rows(
            "/rest/v1/platform_events",
            {
                "select": "listing_id,visitor_id,occurred_at",
                "event_name": "eq.reddit_post_open",
                "occurred_at": f"gte.{cutoff}",
                "order": "occurred_at.desc",
            },
        )
        events = events or []
        opens_total = len(events)
        unique_visitors = len({e.get("visitor_id") for e in events if e.get("visitor_id")})
        daily = defaultdict(int)
        per_listing = defaultdict(int)
        for event in events:
            day = (event.get("occurred_at") or "")[:10]
            if day:
                daily[day] += 1
            listing_id = str(event.get("listing_id") or "")
            if listing_id:
                per_listing[listing_id] += 1
        daily_opens = [{"date": day, "count": daily[day]} for day in sorted(daily)]
        top_listings = []
        for listing_id, opens in sorted(per_listing.items(), key=lambda kv: -kv[1])[:5]:
            item = listing_by_id.get(listing_id, {})
            top_listings.append({
                "listing_id": listing_id,
                "title": item.get("title") or "(listing removed)",
                "listing_type": item.get("listing_type"),
                "source_url": item.get("source_url"),
                "views": int(item.get("views") or 0),
                "opens": opens,
            })

        # 3. Latest import run health.
        run_rows, _run_status = backend.supabase_request(
            "get",
            "/rest/v1/reddit_import_runs",
            params={"select": "*", "order": "started_at.desc", "limit": "1"},
            use_service_role=True,
        )
        latest_run = run_rows[0] if isinstance(run_rows, list) and run_rows else None

        payload = {
            "window_days": days,
            "listings": {"total": total, "live": live, "removed": total - live, "views": total_views},
            "opens": {"total": opens_total, "unique_visitors": unique_visitors},
            "daily_opens": daily_opens,
            "top_listings": top_listings,
            "latest_run": latest_run,
        }
        backend._api_cache_set(cache_key, payload, ttl_seconds=60)
        return jsonify(payload), 200
    except Exception as exc:
        backend.logger.error("Failed to load Reddit import analytics: %s", exc)
        return jsonify({"error": "Failed to fetch Reddit import analytics"}), 500

 
 
def register_admin_reddit_analytics_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/reddit-import-analytics",
        endpoint="get_admin_reddit_import_analytics",
        view_func=get_admin_reddit_import_analytics,
        methods=["GET"],
    )
