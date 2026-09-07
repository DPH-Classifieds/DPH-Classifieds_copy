"""Low-coupling admin email and application-error metrics routes.

The compatibility root retains the shared auth, cache, time, and Supabase
helpers.  Runtime lookup keeps this module independent from ``app.py`` while
preserving direct-call and monkeypatch compatibility for legacy consumers.
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
    """Apply the compatibility root's auth decorator at request time."""

    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def get_email_metrics(current_user):
    backend = _backend()
    user_details = backend._get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Unauthorized"}), 403

    days = max(min(int(request.args.get("days", 30)), 365), 1)
    cutoff = (backend._utc_now() - backend.datetime.timedelta(days=days)).isoformat()

    email_metrics_ttl = 60
    email_cache_key = f"api-cache:/api/admin/metrics/email?days={days}"
    email_cached = backend._api_cache_get(email_cache_key)
    if email_cached is not None:
        return jsonify(email_cached), 200
    if not backend._cache_lock_acquire(email_cache_key):
        backend.time.sleep(0.15)
        email_cached = backend._api_cache_get(email_cache_key)
        if email_cached is not None:
            return jsonify(email_cached), 200

    rows, status_code = backend.supabase_request(
        "get",
        "/rest/v1/outbound_emails",
        params={
            "select": "email_type,sent_at,delivered_at,opened_at,clicked_at,bounced_at,unsubscribed_at,open_count,click_count,error_message",
            "sent_at": f"gte.{cutoff}",
            "order": "sent_at.desc",
            "limit": "5000",
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if backend._looks_like_missing_table(rows):
            return jsonify(
                {
                    "error": "outbound_emails table not migrated yet",
                    "summary": {},
                    "by_type": [],
                    "daily": [],
                }
            ), 200
        return jsonify({"error": "Failed to fetch email events"}), status_code

    rows = rows or []
    total = len(rows)
    delivered = sum(1 for row in rows if row.get("delivered_at"))
    opened = sum(1 for row in rows if row.get("opened_at"))
    clicked = sum(1 for row in rows if row.get("clicked_at"))
    bounced = sum(1 for row in rows if row.get("bounced_at"))
    unsubscribed = sum(1 for row in rows if row.get("unsubscribed_at"))
    errored = sum(1 for row in rows if row.get("error_message"))

    by_type_map = backend.defaultdict(
        lambda: {"sent": 0, "opened": 0, "clicked": 0, "bounced": 0}
    )
    for row in rows:
        email_type = row.get("email_type") or "unknown"
        by_type_map[email_type]["sent"] += 1
        by_type_map[email_type]["opened"] += 1 if row.get("opened_at") else 0
        by_type_map[email_type]["clicked"] += 1 if row.get("clicked_at") else 0
        by_type_map[email_type]["bounced"] += 1 if row.get("bounced_at") else 0
    by_type = [
        {
            "type": email_type,
            "sent": values["sent"],
            "opened": values["opened"],
            "clicked": values["clicked"],
            "bounced": values["bounced"],
            "open_rate": round(values["opened"] / values["sent"] * 100, 1)
            if values["sent"]
            else 0,
            "click_rate": round(values["clicked"] / values["sent"] * 100, 1)
            if values["sent"]
            else 0,
        }
        for email_type, values in sorted(
            by_type_map.items(), key=lambda item: -item[1]["sent"]
        )
    ]

    daily_map = backend.defaultdict(int)
    for row in rows:
        day = str(row.get("sent_at") or "")[:10]
        if day:
            daily_map[day] += 1
    daily = [{"date": day, "count": count} for day, count in sorted(daily_map.items())]

    result = {
        "summary": {
            "total_sent": total,
            "delivered": delivered,
            "opened": opened,
            "clicked": clicked,
            "bounced": bounced,
            "unsubscribed": unsubscribed,
            "errored": errored,
            "open_rate": round(opened / total * 100, 1) if total else 0,
            "click_rate": round(clicked / total * 100, 1) if total else 0,
            "bounce_rate": round(bounced / total * 100, 1) if total else 0,
        },
        "by_type": by_type,
        "daily": daily,
    }
    backend._api_cache_set(email_cache_key, result, email_metrics_ttl)
    return jsonify(result), 200


@_token_required
def get_error_metrics(current_user):
    """Return recent client and server errors for the admin Errors tab."""

    backend = _backend()
    user_details = backend._get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Unauthorized"}), 403

    days = max(min(int(request.args.get("days", 30)), 365), 1)
    cutoff = (backend._utc_now() - backend.datetime.timedelta(days=days)).isoformat()

    rows, status_code = backend.supabase_request(
        "get",
        "/rest/v1/app_errors",
        params={
            "select": "created_at,user_id,context,error_code,message,source,url",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": "1000",
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if backend._looks_like_missing_table(rows):
            return jsonify(
                {
                    "error": "app_errors table not migrated yet",
                    "summary": {},
                    "by_context": [],
                    "recent": [],
                }
            ), 200
        return jsonify({"error": "Failed to fetch errors"}), status_code

    rows = rows or []
    by_context_map = backend.defaultdict(int)
    for row in rows:
        by_context_map[row.get("context") or "unknown"] += 1
    by_context = [
        {"context": context, "count": count}
        for context, count in sorted(
            by_context_map.items(), key=lambda item: -item[1]
        )
    ]

    return jsonify(
        {
            "summary": {
                "total": len(rows),
                "frontend": sum(1 for row in rows if row.get("source") == "frontend"),
                "backend": sum(1 for row in rows if row.get("source") != "frontend"),
            },
            "by_context": by_context,
            "recent": rows[:200],
        }
    ), 200


def register_admin_metrics_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/metrics/email",
        endpoint="get_email_metrics",
        view_func=get_email_metrics,
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/admin/metrics/errors",
        endpoint="get_error_metrics",
        view_func=get_error_metrics,
        methods=["GET"],
    )
