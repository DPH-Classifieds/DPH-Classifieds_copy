"""Admin live-user and live-user-history metrics routes.

Shared auth, cache, time, parsing, and Supabase helpers remain owned by the
compatibility root and are resolved at request time through Flask's runtime
registry.
"""

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
def get_admin_live_users(current_user):
    """Return an approximate count of currently live visitors.

    Uses distinct `visitor_id` values seen in `platform_events` within the lookback window.
    """
    backend = _backend()
    try:
        if not backend._require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        lookback_seconds = int(request.args.get("window_seconds", 300))
        lookback_seconds = max(min(lookback_seconds, 1800), 30)
        # 15s cache. Live-users is polled every 15s from the mobile dashboard;
        # serving the same payload twice in a tight loop is wasteful.
        cache_key = f"api-cache:admin-live-users:window={lookback_seconds}"
        cached_payload = backend._api_cache_get(cache_key)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

        cutoff = (backend._utc_now() - backend.datetime.timedelta(seconds=lookback_seconds)).isoformat()

        events_resp, status_code = backend.supabase_request(
            "get",
            "/rest/v1/platform_events",
            params={
                "select": "visitor_id,created_at",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "5000",
            },
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch live visitors"}), status_code

        visitors = {
            str(row.get("visitor_id")).strip()
            for row in (events_resp or [])
            if row and str(row.get("visitor_id") or "").strip()
        }

        payload = {
            "window_seconds": lookback_seconds,
            "live_visitors": len(visitors),
            "timestamp": backend._isoformat_utc(backend._utc_now()),
        }
        backend._api_cache_set(cache_key, payload, ttl_seconds=15)
        return jsonify(payload), 200
    except Exception as exc:
        backend.logger.error(f"Failed to compute live visitors: {exc}")
        return jsonify({"error": "Failed to compute live visitors"}), 500


@_token_required
def get_admin_live_users_history(current_user):
    """Per-minute distinct-visitor buckets over a lookback window.

    Lets the admin dashboard sparkline render historical context instead of
    starting empty and only filling in after several poll cycles.

    Query params:
      window_seconds  total lookback (default 1800, clamped 300..3600)
      bucket_seconds  bucket width  (default 60,   clamped 30..300)

    Returns: { window_seconds, bucket_seconds, points: [{ts, value}, ...] }
    where `ts` is the bucket-start ISO timestamp and `value` is the count of
    distinct visitor_id values seen in that bucket.
    """
    backend = _backend()
    try:
        if not backend._require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        window_seconds = int(request.args.get("window_seconds", 1800))
        window_seconds = max(min(window_seconds, 3600), 300)
        bucket_seconds = int(request.args.get("bucket_seconds", 60))
        bucket_seconds = max(min(bucket_seconds, 300), 30)

        cache_key = (
            f"api-cache:admin-live-users-history:"
            f"w={window_seconds}:b={bucket_seconds}"
        )
        cached_payload = backend._api_cache_get(cache_key)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

        now = backend._utc_now()
        cutoff = now - backend.datetime.timedelta(seconds=window_seconds)
        cutoff_iso = cutoff.isoformat()

        events_resp, status_code = backend.supabase_request(
            "get",
            "/rest/v1/platform_events",
            params={
                "select": "visitor_id,created_at",
                "created_at": f"gte.{cutoff_iso}",
                "order": "created_at.asc",
                "limit": "20000",
            },
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch live visitor history"}), status_code

        # Build empty buckets covering the entire window so the chart shows
        # zeros for quiet minutes instead of a jagged line.
        bucket_count = max(1, window_seconds // bucket_seconds)
        # Align the right edge of the window to "now", then walk backwards.
        end_epoch = int(now.timestamp())
        # Bucket start = end_epoch - bucket_seconds * (bucket_count - i)
        bucket_starts = [
            end_epoch - bucket_seconds * (bucket_count - i)
            for i in range(bucket_count)
        ]
        buckets = {start: set() for start in bucket_starts}

        for row in events_resp or []:
            visitor_id = str(row.get("visitor_id") or "").strip()
            if not visitor_id:
                continue
            ts = backend._parse_datetime(row.get("created_at"))
            if ts is None:
                continue
            ts_epoch = int(ts.timestamp())
            # Floor to bucket boundary using the window-aligned grid.
            offset = end_epoch - ts_epoch
            if offset < 0 or offset >= window_seconds:
                continue
            bucket_index = bucket_count - 1 - (offset // bucket_seconds)
            if 0 <= bucket_index < bucket_count:
                buckets[bucket_starts[bucket_index]].add(visitor_id)

        points = [
            {
                "ts": backend._isoformat_utc(
                    backend.datetime.datetime.fromtimestamp(start, tz=backend.datetime.timezone.utc)
                ),
                "value": len(buckets[start]),
            }
            for start in bucket_starts
        ]

        payload = {
            "window_seconds": window_seconds,
            "bucket_seconds": bucket_seconds,
            "points": points,
        }
        # Cache for one bucket interval — refreshing more often is wasted work.
        backend._api_cache_set(cache_key, payload, ttl_seconds=bucket_seconds)
        return jsonify(payload), 200
    except Exception as exc:
        backend.logger.error(f"Failed to compute live visitor history: {exc}")
        return jsonify({"error": "Failed to compute live visitor history"}), 500

def register_live_user_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/live-users",
        endpoint="get_admin_live_users",
        view_func=get_admin_live_users,
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/admin/live-users/history",
        endpoint="get_admin_live_users_history",
        view_func=get_admin_live_users_history,
        methods=["GET"],
    )
