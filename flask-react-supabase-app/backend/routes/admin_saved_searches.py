"""Admin saved-search analytics route."""

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
def get_admin_saved_searches(current_user):
    backend = _backend()
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    days = max(min(int(request.args.get("days", 30)), 365), 1)
    limit = max(min(int(request.args.get("limit", 200)), 1000), 1)
    cutoff = (backend._utc_now() - backend.datetime.timedelta(days=days)).isoformat()
    rows, status_code = backend.supabase_request(
        "get",
        "/rest/v1/saved_searches",
        params={
            "select": "*",
            "created_at": f"gte.{cutoff}",
            "order": "updated_at.desc",
            "limit": str(limit),
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if backend._looks_like_missing_table(rows):
            return backend._saved_search_missing_table_response()
        return jsonify({"error": "Failed to load saved searches"}), status_code

    rows = rows or []
    user_ids = sorted({str(row.get("user_id")) for row in rows if row.get("user_id")})
    owner_map = {}
    if user_ids:
        users, users_status = backend.supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "select": "id,email,username,display_name,first_name,last_name",
                "id": f"in.({','.join(user_ids)})",
            },
            use_service_role=True,
        )
        if users_status < 400:
            owner_map = {str(user.get("id")): user for user in users or []}

    categories = defaultdict(int)
    for row in rows:
        category = backend._normalize_saved_search_category(row.get("category"))
        categories[category] += 1
        owner = owner_map.get(str(row.get("user_id")))
        if owner:
            row["owner_email"] = owner.get("email")
            row["owner_name"] = backend._admin_display_name_from_user_row(owner)

    return jsonify(
        {
            "summary": {
                "total": len(rows),
                "unique_users": len(user_ids),
                "categories": dict(categories),
                "days": days,
            },
            "searches": rows,
        }
    ), 200


def register_admin_saved_search_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/saved-searches",
        endpoint="get_admin_saved_searches",
        view_func=get_admin_saved_searches,
        methods=["GET"],
    )
