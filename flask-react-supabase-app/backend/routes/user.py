"""Authenticated user routes for saved listings, searches, and push tokens."""

import hashlib
import json
import re

from functools import wraps

from flask import Blueprint, current_app, jsonify, make_response, request


user_bp = Blueprint("user", __name__, url_prefix="/api/user")


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve runtime services without importing the compatibility root."""
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


SAVED_SEARCH_CATEGORIES = {
    "all",
    "cars",
    "car",
    "bikes",
    "bike",
    "parts",
    "part",
    "car-parts",
    "plates",
    "plate",
}


def _normalize_saved_search_category(value):
    normalized = str(value or "all").strip().lower()
    mapping = {
        "car": "cars",
        "bike": "bikes",
        "part": "parts",
        "car-parts": "parts",
        "plate": "plates",
    }
    normalized = mapping.get(normalized, normalized)
    return normalized if normalized in SAVED_SEARCH_CATEGORIES else "all"


def _clean_saved_search_filters(value):
    if not isinstance(value, dict):
        return {}
    cleaned = {}
    for key, raw_value in value.items():
        if raw_value in (None, ""):
            continue
        if isinstance(raw_value, dict):
            nested = _clean_saved_search_filters(raw_value)
            if nested:
                cleaned[str(key)] = nested
            continue
        if isinstance(raw_value, list):
            nested_list = [
                item
                for item in raw_value
                if item not in (None, "", [], {})
            ]
            if nested_list:
                cleaned[str(key)] = nested_list
            continue
        cleaned[str(key)] = raw_value
    return cleaned


def _build_saved_search_key(category, route_path, query_text, filters):
    normalized_payload = {
        "category": _normalize_saved_search_category(category),
        "route_path": str(route_path or "").strip()[:300],
        "query_text": str(query_text or "").strip().lower(),
        "filters": _clean_saved_search_filters(filters),
    }
    encoded = json.dumps(normalized_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _saved_search_missing_table_response():
    return (
        jsonify(
            {
                "error": "Supabase table saved_searches is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_saved_searches_and_reminders_20260618.sql"
            }
        ),
        501,
    )


@user_bp.route("/saved-listings", methods=["GET"])
@_token_required
def get_user_saved_listings(current_user):
    backend = _backend()
    payload, status_code = backend._fetch_saved_listing_cards(current_user)
    return jsonify(payload), status_code


@user_bp.route("/saved-listings", methods=["POST"])
@_token_required
def create_user_saved_listing(current_user):
    backend = _backend()
    data = request.json or {}
    listing_type = backend._normalize_saved_listing_type(data.get("listing_type"))
    listing_id = str(data.get("listing_id") or "").strip()

    if not listing_type or not listing_id:
        return jsonify({"error": "listing_type and listing_id are required"}), 400

    saved_rows, existing_status = backend.supabase_request(
        "get",
        "/rest/v1/saved_listings",
        params={
            "select": "id,user_id,listing_id,listing_type,created_at",
            "user_id": f"eq.{current_user}",
            "listing_id": f"eq.{listing_id}",
            "listing_type": f"eq.{listing_type}",
            "limit": 1,
        },
        user_id=current_user,
    )
    if existing_status >= 400 and backend._looks_like_missing_table(saved_rows):
        return (
            jsonify(
                {
                    "error": "Supabase table saved_listings is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_ecosystem_tables.sql"
                }
            ),
            501,
        )
    if existing_status < 400 and saved_rows:
        card, _, _ = backend._load_saved_listing_card(
            current_user, listing_type, listing_id, saved_rows[0]
        )
        return jsonify({"saved": True, "listing": card}), 200

    card, error_payload, error_status = backend._load_saved_listing_card(
        current_user, listing_type, listing_id
    )
    if error_payload:
        return jsonify(error_payload), error_status
    if not card or card.get("isUnavailable"):
        return jsonify({"error": "Listing not found"}), 404

    insert_payload = {
        "user_id": current_user,
        "listing_id": listing_id,
        "listing_type": listing_type,
    }
    insert_response, insert_status = backend.supabase_request(
        "post",
        "/rest/v1/saved_listings",
        data=insert_payload,
        user_id=current_user,
    )
    if insert_status >= 400:
        if insert_status == 409:
            return jsonify({"saved": True, "listing": card}), 200
        if backend._looks_like_missing_table(insert_response):
            return (
                jsonify(
                    {
                        "error": "Supabase table saved_listings is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_ecosystem_tables.sql"
                    }
                ),
                501,
            )
        return jsonify(insert_response), insert_status

    backend.capture_posthog_event(
        "listing_saved",
        current_user,
        {"listing_type": listing_type},
    )
    return jsonify(
        {
            "saved": True,
            "listing": card,
            "saved_listing": insert_response[0]
            if isinstance(insert_response, list) and insert_response
            else insert_response,
        }
    ), 200


@user_bp.route(
    "/saved-listings/<string:listing_type>/<string:listing_id>",
    methods=["DELETE"],
)
@_token_required
def delete_user_saved_listing(current_user, listing_type, listing_id):
    backend = _backend()
    normalized_type = backend._normalize_saved_listing_type(listing_type)
    if not normalized_type:
        return jsonify({"error": "Invalid listing type"}), 400

    delete_response, delete_status = backend.supabase_request(
        "delete",
        "/rest/v1/saved_listings",
        params={
            "user_id": f"eq.{current_user}",
            "listing_type": f"eq.{normalized_type}",
            "listing_id": f"eq.{listing_id}",
        },
        user_id=current_user,
    )

    if delete_status >= 400:
        if backend._looks_like_missing_table(delete_response):
            return (
                jsonify(
                    {
                        "error": "Supabase table saved_listings is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_ecosystem_tables.sql"
                    }
                ),
                501,
            )
        return jsonify(delete_response), delete_status

    return jsonify(
        {"saved": False, "listing_type": normalized_type, "listing_id": listing_id}
    ), 200


@user_bp.route("/saved-searches", methods=["GET"])
@_token_required
def get_user_saved_searches(current_user):
    backend = _backend()
    response, status_code = backend.supabase_request(
        "get",
        "/rest/v1/saved_searches",
        params={
            "select": "*",
            "user_id": f"eq.{current_user}",
            "order": "updated_at.desc",
            "limit": "100",
        },
        user_id=current_user,
    )
    if status_code >= 400:
        if backend._looks_like_missing_table(response):
            return _saved_search_missing_table_response()
        return jsonify({"error": "Failed to load saved searches"}), status_code
    return jsonify({"searches": response or []}), 200


@user_bp.route("/push-token", methods=["POST"])
@_token_required
def register_push_token(current_user):
    """Register/refresh an Expo push token for the signed-in user."""
    backend = _backend()
    payload = request.get_json(silent=True) or {}
    token = str(payload.get("expo_push_token") or "").strip()
    if not token:
        return jsonify({"error": "expo_push_token is required"}), 400
    if not backend.is_valid_expo_token(token):
        return jsonify({"error": "invalid expo_push_token"}), 400
    now_iso = backend._isoformat_utc(backend._utc_now())
    record = {
        "user_id": current_user,
        "expo_push_token": token,
        "platform": (str(payload.get("platform") or "").strip()[:20] or None),
        "device_id": (str(payload.get("device_id") or "").strip()[:200] or None),
        "enabled": True,
        "updated_at": now_iso,
        "last_used_at": now_iso,
    }
    # Delete-then-insert upsert on the unique expo_push_token (house convention).
    backend.supabase_request(
        "delete",
        "/rest/v1/push_tokens",
        params={"expo_push_token": f"eq.{token}"},
        use_service_role=True,
    )
    resp, status_code = backend.supabase_request(
        "post",
        "/rest/v1/push_tokens",
        data=record,
        use_service_role=True,
    )
    if status_code >= 400:
        return jsonify({"error": "Failed to save push token"}), status_code
    saved = resp[0] if isinstance(resp, list) and resp else resp
    return jsonify({"saved": True, "token": saved}), 200


@user_bp.route("/push-token", methods=["DELETE"])
@_token_required
def delete_push_token(current_user):
    """Remove a push token (device opted out or signed out)."""
    backend = _backend()
    token = str(request.args.get("expo_push_token") or "").strip()
    params = {"user_id": f"eq.{current_user}"}
    if token:
        params["expo_push_token"] = f"eq.{token}"
    backend.supabase_request(
        "delete",
        "/rest/v1/push_tokens",
        params=params,
        use_service_role=True,
    )
    return jsonify({"removed": True}), 200


@user_bp.route("/saved-searches", methods=["POST"])
@_token_required
def save_user_search(current_user):
    backend = _backend()
    payload = request.get_json(silent=True) or {}
    category = _normalize_saved_search_category(payload.get("category"))
    route_path = str(payload.get("route_path") or payload.get("routePath") or "").strip()[:300]
    query_text = str(
        payload.get("query")
        or payload.get("query_text")
        or payload.get("search")
        or ""
    ).strip()[:300]
    filters = _clean_saved_search_filters(payload.get("filters") or {})
    result_count = payload.get("result_count", payload.get("resultCount"))
    try:
        result_count = int(result_count) if result_count not in (None, "") else None
    except (TypeError, ValueError):
        result_count = None

    search_key = _build_saved_search_key(category, route_path, query_text, filters)
    now_iso = backend._isoformat_utc(backend._utc_now())
    record = {
        "user_id": current_user,
        "search_key": search_key,
        "category": category,
        "route_path": route_path,
        "query_text": query_text,
        "filters": filters,
        "result_count": result_count,
        "last_result_count": result_count,
        "updated_at": now_iso,
        "last_used_at": now_iso,
    }
    name = str(payload.get("name") or "").strip()[:120]
    if name:
        record["name"] = name

    delete_response, delete_status = backend.supabase_request(
        "delete",
        "/rest/v1/saved_searches",
        params={"user_id": f"eq.{current_user}", "search_key": f"eq.{search_key}"},
        user_id=current_user,
    )
    if delete_status >= 400 and backend._looks_like_missing_table(delete_response):
        return _saved_search_missing_table_response()

    insert_response, insert_status = backend.supabase_request(
        "post",
        "/rest/v1/saved_searches",
        data=record,
        user_id=current_user,
    )
    if insert_status >= 400:
        if backend._looks_like_missing_table(insert_response):
            return _saved_search_missing_table_response()
        return jsonify({"error": "Failed to save search"}), insert_status

    saved_record = (
        insert_response[0]
        if isinstance(insert_response, list) and insert_response
        else insert_response
    )
    return jsonify({"saved": True, "search": saved_record}), 200


@user_bp.route("/saved-searches/<string:search_id_or_key>", methods=["DELETE"])
@_token_required
def delete_user_saved_search(current_user, search_id_or_key):
    backend = _backend()
    identifier = str(search_id_or_key or "").strip()
    if not identifier:
        return jsonify({"error": "Missing saved search id"}), 400
    params = {"user_id": f"eq.{current_user}"}
    if re.match(r"^[0-9a-fA-F-]{32,36}$", identifier):
        params["id"] = f"eq.{identifier}"
    else:
        params["search_key"] = f"eq.{identifier}"
    response, status_code = backend.supabase_request(
        "delete",
        "/rest/v1/saved_searches",
        params=params,
        user_id=current_user,
    )
    if status_code >= 400:
        if backend._looks_like_missing_table(response):
            return _saved_search_missing_table_response()
        return jsonify({"error": "Failed to delete saved search"}), status_code
    return jsonify({"deleted": True}), 200


def _soft_delete_user_listing_table(table_name, user_id):
    backend = _backend()
    now_iso = backend._isoformat_utc(backend._utc_now())
    full_payload = {
        "status": "deleted",
        "listing_state": "deleted",
        "deleted_at": now_iso,
        "is_approved": False,
        "is_archived": True,
        "auto_removed_at": now_iso,
    }
    path = f"/rest/v1/{table_name}?user_id=eq.{user_id}"
    response, status_code = backend.supabase_request(
        "patch", path, data=full_payload, use_service_role=True
    )
    if status_code < 400:
        return True, None
    if backend._looks_like_missing_column(
        response,
        "listing_state",
        "deleted_at",
        "is_approved",
        "is_archived",
        "auto_removed_at",
    ):
        fallback_response, fallback_status = backend.supabase_request(
            "patch", path, data={"status": "deleted"}, use_service_role=True
        )
        if fallback_status < 400:
            return True, None
        return False, fallback_response
    return False, response


def _delete_user_scoped_table_rows(table_name, user_id, column_name="user_id"):
    backend = _backend()
    response, status_code = backend.supabase_request(
        "delete",
        f"/rest/v1/{table_name}",
        params={column_name: f"eq.{user_id}"},
        use_service_role=True,
    )
    if status_code < 400 or backend._looks_like_missing_table(response):
        return True, None
    return False, response


def _delete_supabase_auth_user(user_id):
    backend = _backend()
    service_key = backend.SUPABASE_SERVICE_ROLE_KEY or backend.os.getenv(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not backend.SUPABASE_URL or not service_key:
        return False, "Supabase service role is not configured"
    response = backend.requests.delete(
        f"{backend.SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        timeout=15,
    )
    if response.status_code in (200, 202, 204):
        return True, None
    return False, response.text[:500]


@user_bp.route("/delete-account", methods=["DELETE"])
@_token_required
def delete_user_account(current_user):
    backend = _backend()
    cleanup_errors = []
    for table_name in ("cars", "bikes", "car_parts", "license_plates"):
        ok, error = _soft_delete_user_listing_table(table_name, current_user)
        if not ok:
            cleanup_errors.append({"table": table_name, "error": error})

    for table_name in (
        "saved_listings",
        "listing_drafts",
        "saved_searches",
        "notifications",
        "user_verification",
    ):
        ok, error = _delete_user_scoped_table_rows(table_name, current_user)
        if not ok:
            cleanup_errors.append({"table": table_name, "error": error})

    for column_name in ("follower_id", "following_id"):
        ok, error = _delete_user_scoped_table_rows(
            "user_followers", current_user, column_name=column_name
        )
        if not ok:
            cleanup_errors.append({"table": "user_followers", "error": error})

    if cleanup_errors:
        backend.logger.error(
            "Account deletion cleanup failed for %s: %s", current_user, cleanup_errors
        )
        return jsonify({"deleted": False, "error": "Failed to clean up account data"}), 500

    public_user_response, public_user_status = backend.supabase_request(
        "delete",
        "/rest/v1/users",
        params={"id": f"eq.{current_user}"},
        use_service_role=True,
    )
    if public_user_status >= 400 and not backend._looks_like_missing_table(public_user_response):
        backend.logger.error(
            "Failed to delete public user row for %s: %s",
            current_user,
            public_user_response,
        )
        return jsonify({"deleted": False, "error": "Failed to delete profile"}), 500

    auth_deleted, auth_error = _delete_supabase_auth_user(current_user)
    if not auth_deleted:
        backend.logger.error("Failed to delete auth user %s: %s", current_user, auth_error)
        return jsonify(
            {
                "deleted": False,
                "error": "Profile cleanup completed but auth deletion failed",
                "details": auth_error,
            }
        ), 502

    response = make_response(jsonify({"deleted": True}), 200)
    response.set_cookie("access_token", "", expires=0)
    response.set_cookie("refresh_token", "", expires=0)
    return response, 200
