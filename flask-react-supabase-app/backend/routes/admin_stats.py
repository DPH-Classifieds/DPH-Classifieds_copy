"""Admin dashboard stats route.

The route remains separate from the metrics overview and listing-search
surfaces. Shared pagination, lifecycle summaries, analytics identity rules,
and cache helpers resolve through the runtime backend boundary.
"""

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
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
def get_admin_stats(current_user):
    """Return dashboard summary counts plus visitor totals."""
    backend = _backend()
    try:
        if not backend._require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        days = max(min(int(request.args.get("days", 30)), 90), 1)
        # 60s cache. This endpoint scans up to ~13k Supabase rows per call —
        # admin dashboards refresh on every focus, so without the cache each
        # operator session generates dozens of needless full table scans.
        cache_key = f"api-cache:admin-stats:days={days}"
        cached_payload = backend._api_cache_get(cache_key)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

        now = backend._utc_now()
        window_start = now - backend.datetime.timedelta(days=days)
        cutoff = window_start.isoformat()

        # platform_events: query directly so we can detect "table missing"
        # explicitly and feed that into data_health for the admin UI.
        platform_events = []
        platform_events_status = "ok"
        events_resp, events_status = backend._fetch_all_rows(
            "/rest/v1/platform_events",
            {
                "select": "event_name,visitor_id,user_id,session_id,page_kind,listing_type,created_at",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
            },
        )
        if events_status == 404 or (
            events_status >= 400 and "does not exist" in str(events_resp).lower()
        ):
            platform_events_status = "missing"
            backend.logger.warning(
                "platform_events table is missing in production Supabase. "
                "Apply backend/migrations/add_platform_analytics_tracking.sql."
            )
        elif events_status >= 400:
            platform_events_status = "error"
            backend.logger.warning(
                "platform_events query failed: status=%s body=%s", events_status, events_resp
            )
        else:
            platform_events = events_resp or []
            if not platform_events:
                platform_events_status = "empty"

        lead_events, lead_events_status = backend._fetch_all_rows(
            "/rest/v1/lead_events",
            {
                "select": "action,listing_type,listing_id,created_at,user_id,session_id",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
            },
        )
        if lead_events_status >= 400:
            backend.logger.warning("lead_events query failed: status=%s", lead_events_status)
            lead_events = []

        aux_rows = {}
        aux_jobs = {
            "users": (
                "/rest/v1/users",
                {
                    "select": "id,created_at,is_dealer,dealer_verified",
                    "order": "created_at.desc",
                    "limit": "5000",
                },
            ),
            "reports": (
                "/rest/v1/reports",
                {
                    "select": "id,status,created_at",
                    "order": "created_at.desc",
                    "limit": "5000",
                },
            ),
            "saved_searches": (
                "/rest/v1/saved_searches",
                {
                    "select": "id,created_at",
                    "order": "created_at.desc",
                    "limit": "5000",
                },
            ),
            "listing_drafts": (
                "/rest/v1/listing_drafts",
                {
                    "select": "id,created_at,updated_at",
                    "order": "updated_at.desc",
                    "limit": "5000",
                },
            ),
        }
        with ThreadPoolExecutor(max_workers=len(aux_jobs)) as executor:
            future_map = {
                executor.submit(backend._fetch_rows, path, params): key
                for key, (path, params) in aux_jobs.items()
            }
            for future in as_completed(future_map):
                aux_rows[future_map[future]] = future.result()

        users = aux_rows.get("users", [])
        reports = aux_rows.get("reports", [])
        saved_searches = aux_rows.get("saved_searches", [])
        listing_drafts = aux_rows.get("listing_drafts", [])

        listing_rows_by_type = backend._fetch_listing_lifecycle_rows()
        listing_lifecycle = backend._build_listing_lifecycle_summary_from_rows(
            listing_rows_by_type,
            draft_total=len(listing_drafts),
        )
        lifecycle_totals = listing_lifecycle.get("totals", {})

        cars_total = len(listing_rows_by_type.get("cars", []))
        bikes_total = len(listing_rows_by_type.get("bikes", []))
        parts_total = len(listing_rows_by_type.get("parts", []))
        plates_total = len(listing_rows_by_type.get("plates", []))
        cars_pending = listing_lifecycle.get("by_type", {}).get("cars", {}).get("pending", 0)
        bikes_pending = listing_lifecycle.get("by_type", {}).get("bikes", {}).get("pending", 0)
        parts_pending = listing_lifecycle.get("by_type", {}).get("parts", {}).get("pending", 0)
        plates_pending = listing_lifecycle.get("by_type", {}).get("plates", {}).get("pending", 0)
        total_reports = len(reports)
        pending_reports = sum(
            1 for report in reports if str(report.get("status") or "").lower() == "pending"
        )
        saved_searches_total = len(saved_searches)
        saved_searches_window = sum(
            1
            for saved_search in saved_searches
                if (backend._parse_datetime(saved_search.get("created_at")) or backend.datetime.datetime.min.replace(tzinfo=backend.datetime.timezone.utc))
            >= window_start
        )
        total_users = len(users)
        total_dealers = sum(1 for user in users if user.get("is_dealer"))
        verified_dealers = sum(
            1
            for user in users
            if user.get("is_dealer") and user.get("dealer_verified")
        )
        platform_events_window_count = (
            backend._supabase_count("platform_events", {"created_at": f"gte.{cutoff}"})
            if platform_events_status == "ok"
            else 0
        )

        # Unique visitors: collapse all signal sources onto a canonical identity
        # key (auth user_id > visitor_id > session_id) so the same person showing
        # up across platform_events, lead_events, and the signups list counts
        # once. The previous pe:/le:/u: prefix scheme avoided in-source
        # collisions but inflated cross-source counts.
        unique_visitors = set()
        live_visitors = set()
        unique_sources = set()
        live_cutoff = now - backend.datetime.timedelta(minutes=5)

        for event in platform_events:
            key = backend._canonical_visitor_key(event)
            if not key:
                # Row had no user_id / visitor_id / session_id — no identity, no visitor.
                # Previously bucketed under "pe:anonymous" which inflated the count by
                # collapsing all anonymous-no-ID traffic into a single fake visitor.
                continue
            unique_visitors.add(key)
            unique_sources.add("platform_events")
            event_time = backend._parse_datetime(event.get("created_at"))
            if event_time and event_time >= live_cutoff:
                live_visitors.add(key)

        # Source views from platform_events page_view rows tagged as
        # page_kind="listing_detail" — that's where PlatformAnalyticsTracker
        # writes them, with listing_type already parsed from page_path.
        view_counts_by_type = defaultdict(int)
        for event in platform_events:
            if (event.get("page_kind") or "").strip() != "listing_detail":
                continue
            listing_type = (event.get("listing_type") or "").strip().rstrip("s")
            if listing_type:
                view_counts_by_type[listing_type] += 1
            view_counts_by_type["__total__"] += 1

        lead_event_counts = defaultdict(int)       # raw event counts per action
        lead_unique_actors = defaultdict(set)      # unique actors per action
        # New interactions have a canonical event row. Count those first so
        # retries and the legacy compatibility insert cannot inflate leads.
        for event in platform_events:
            action = str(event.get("event_name") or "")
            if action not in backend.LEAD_EVENT_ACTIONS:
                continue
            lead_event_counts[action] += 1
            key = backend._canonical_visitor_key(event)
            if key:
                lead_unique_actors[action].add(key)
                unique_visitors.add(key)
                unique_sources.add("platform_events")

        # ``lead_events`` is the historical source only. Every event emitted
        # after the canonical migration is written to both tables for legacy
        # integrations, so including it here would double-count contacts.
        for event in lead_events:
            created_at = backend._parse_datetime(event.get("created_at"))
            if created_at and created_at >= backend.CANONICAL_ANALYTICS_CUTOVER_AT:
                continue
            action = str(event.get("action") or "unknown")
            if action not in backend.LEAD_EVENT_ACTIONS:
                continue
            lead_event_counts[action] += 1
            key = backend._canonical_visitor_key(event)
            if key:
                lead_unique_actors[action].add(key)
                unique_visitors.add(key)
                unique_sources.add("lead_events")

        new_signups_in_window = 0
        for user in users:
            created_at = backend._parse_datetime(user.get("created_at"))
            if created_at and created_at >= window_start and user.get("id"):
                # users-table rows use `id` (not `user_id`), so we form the
                # canonical key inline rather than via backend._canonical_visitor_key.
                unique_visitors.add(f"v:{user['id']}")
                unique_sources.add("new_signups")
                new_signups_in_window += 1

        data_health = {
            "platform_events": platform_events_status,
            "platform_events_window_count": platform_events_window_count,
            "platform_events_truncated": events_status == 206,
            "unique_visitor_sources": sorted(unique_sources),
            "new_signups_window_count": new_signups_in_window,
            "lead_events_window_count": len(lead_events),
            "lead_events_truncated": lead_events_status == 206,
        }

        stats = {
            "cars_pending": cars_pending,
            "bikes_pending": bikes_pending,
            "parts_pending": parts_pending,
            "plates_pending": plates_pending,
            "cars_views": view_counts_by_type.get("car", 0),
            "bikes_views": view_counts_by_type.get("bike", 0),
            "parts_views": view_counts_by_type.get("part", 0),
            "plates_views": view_counts_by_type.get("plate", 0),
            "total_views": view_counts_by_type.get("__total__", 0),
            "total_users": total_users,
            "total_reports": total_reports,
            # Deduped: unique visitors who called/WhatsApp'd, not raw taps (a
            # single person tapping call 3x is 1 lead, not 3). Matches total_calls/
            # total_whatsapp and the dealer-KPI dedupe semantics.
            "total_leads": sum(len(lead_unique_actors.get(a, set())) for a in backend.CONTACT_LEAD_ACTIONS),
            "total_calls": len(lead_unique_actors.get("call_click", set())),
            "total_call_events": lead_event_counts.get("call_click", 0),
            "total_whatsapp": len(lead_unique_actors.get("whatsapp_click", set())),
            "total_whatsapp_events": lead_event_counts.get("whatsapp_click", 0),
            "total_dealers": total_dealers,
            "unique_visitors": len(unique_visitors),
            "live_users": len(live_visitors),
            "data_health": data_health,
            "cars_total": cars_total,
            "bikes_total": bikes_total,
            "parts_total": parts_total,
            "plates_total": plates_total,
            "saved_searches_total": saved_searches_total,
            "saved_searches_window": saved_searches_window,
            "listing_lifecycle": listing_lifecycle,
            "sold_listings_total": lifecycle_totals.get("sold_total", 0),
            "sold_on_dph_total": lifecycle_totals.get("sold_on_dph", 0),
            "sold_elsewhere_total": lifecycle_totals.get("sold_elsewhere", 0),
            "no_response_total": lifecycle_totals.get("no_response", 0),
            "expired_listings_total": lifecycle_totals.get("expired", 0),
            "draft_listings_total": lifecycle_totals.get("draft", 0),
            "active_listings_total": lifecycle_totals.get("active", 0),
            "verified_dealers": verified_dealers,
            "pending_reports": pending_reports,
            "total_vin_reveals": len(lead_unique_actors.get("vin_reveal", set())),
            "total_vin_reveal_events": lead_event_counts.get("vin_reveal", 0),
        }
        stats["cropped_at_pct"] = backend._cached_cropped_at_pct()

        # Cloudflare override for the headline traffic tiles. Edge metrics are
        # truth for "how many real humans hit the domain" — platform_events only
        # sees clients that successfully loaded our JS, which under-counts.
        # We override unique_visitors/total_views/page_views and tag the source
        # so the dashboard can render a "Source: Cloudflare" badge. Per-listing
        # views (cars_views/bikes_views/etc.) stay platform_events because the
        # edge can't tell us which listing got viewed.
        stats["data_source"] = "platform_events"
        stats["data_source_note"] = None
        try:
            from services.cloudflare_analytics import (
                fetch_zone_metrics as _cf_fetch,
                is_enabled as _cf_enabled,
            )
            if _cf_enabled():
                cf = _cf_fetch(days)
                if cf:
                    stats["site_visitors_platform"] = stats["unique_visitors"]
                    stats["total_views_platform"] = stats["total_views"]
                    stats["unique_visitors"] = cf["unique_visitors"]
                    stats["page_views"] = cf["page_views"]
                    stats["edge_requests"] = cf["requests"]
                    stats["edge_threats"] = cf["threats"]
                    stats["edge_cached_requests"] = cf["cached_requests"]
                    stats["edge_bytes"] = cf["bytes"]
                    stats["peak_daily_uniques"] = cf["peak_daily_uniques"]
                    stats["data_source"] = "cloudflare"
                    # Which path produced unique_visitors: 'cf_rest' (truth),
                    # 'cf_graphql_estimate' (heuristic from daily uniques),
                    # 'none' (no data). Surfaced in the dashboard tooltip so
                    # operators know how trustworthy the number is.
                    stats["unique_visitors_source"] = cf.get("unique_visitors_source")
                else:
                    stats["data_source_note"] = (
                        "Cloudflare configured but the API call failed; "
                        "showing in-app platform_events numbers. "
                        "Hit /api/admin/cloudflare/status to debug."
                    )
            else:
                stats["data_source_note"] = (
                    "Cloudflare not configured. Set CLOUDFLARE_API_TOKEN plus "
                    "CLOUDFLARE_ACCOUNT_ID (or CLOUDFLARE_ZONE_ID) to switch to "
                    "edge-truth visitor numbers."
                )
        except Exception as cf_err:
            backend.logger.warning("Cloudflare override on admin stats skipped: %s", cf_err)

        backend._api_cache_set(cache_key, stats, ttl_seconds=60)
        return jsonify(stats), 200
    except Exception as exc:
        backend.logger.error(f"Error fetching admin stats: {exc}")
        return jsonify({"error": "Failed to fetch admin stats"}), 500



def register_admin_stats_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/stats",
        endpoint="get_admin_stats",
        view_func=get_admin_stats,
        methods=["GET"],
    )
