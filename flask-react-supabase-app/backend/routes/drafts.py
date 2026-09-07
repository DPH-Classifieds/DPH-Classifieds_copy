"""Authenticated listing draft routes."""

import re
from functools import wraps

from flask import Blueprint, current_app, jsonify, request


draft_bp = Blueprint("drafts", __name__)


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


@draft_bp.route("/api/user/drafts", methods=["GET"])
@_token_required
def list_user_drafts(current_user):
    """Return all in-progress wizard drafts for the user (for the Drafts tab)."""
    try:
        response, status = supabase_request(
            "get",
            "/rest/v1/listing_drafts",
            params={
                "user_id": f"eq.{current_user}",
                "select": "*",
                "order": "updated_at.desc",
            },
            use_service_role=True,
        )
        if status >= 400:
            if _looks_like_missing_table(response):
                return jsonify({"drafts": []}), 200
            return jsonify({"error": "Failed to load drafts"}), status

        drafts = response or []
        # Annotate each row with a friendly preview the UI can render directly,
        # so the Drafts tab doesn't need draft-type-specific code to show summaries.
        for draft in drafts:
            _annotate_draft_row(draft)

        return jsonify({"drafts": drafts}), 200
    except Exception as exc:
        logger.error(f"Failed to list user drafts: {exc}")
        return jsonify({"error": "Failed to load drafts"}), 500




@draft_bp.route("/api/user/drafts/<draft_key>", methods=["GET", "POST", "DELETE"])
@_token_required
def manage_user_draft(current_user, draft_key):
    """Persist a user's in-progress listing draft."""
    normalized_key = str(draft_key or "").strip().lower()
    if not normalized_key or not re.match(r"^[a-z0-9_-]+$", normalized_key):
        return jsonify({"error": "Invalid draft key"}), 400

    draft_table = "listing_drafts"
    service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }

    try:
        if request.method == "GET":
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/{draft_table}",
                headers=headers,
                params={
                    "user_id": f"eq.{current_user}",
                    "draft_key": f"eq.{normalized_key}",
                    "select": "*",
                    "order": "updated_at.desc",
                    "limit": "1",
                },
                timeout=10,
            )
            if response.status_code >= 400:
                try:
                    error_payload = response.json()
                except Exception:
                    error_payload = None
                if _looks_like_missing_table(error_payload):
                    return (
                        jsonify(
                            {
                                "error": "Supabase table listing_drafts is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_listing_drafts.sql"
                            }
                        ),
                        501,
                    )
                return jsonify({"error": "Failed to load draft"}), response.status_code
            drafts = response.json() or []
            return jsonify({"draft": _annotate_draft_row(drafts[0]) if drafts else None}), 200

        if request.method == "DELETE":
            response, status_code = supabase_request(
                "delete",
                f"/rest/v1/{draft_table}?user_id=eq.{current_user}&draft_key=eq.{normalized_key}",
                use_service_role=True,
            )
            if status_code >= 400:
                logger.warning(
                    "Failed to delete draft %s for user %s: %s",
                    normalized_key,
                    current_user,
                    response,
                )
            return jsonify({"success": True}), 200

        payload = request.get_json(silent=True) or {}
        draft_payload = payload.get("payload", payload)
        insert_response, insert_status = _save_listing_draft_record(
            current_user, normalized_key, draft_payload
        )
        if insert_status >= 400:
            logger.error(
                "Failed to save draft %s for user %s: %s",
                normalized_key,
                current_user,
                insert_response,
            )
            if _looks_like_missing_table(insert_response):
                return (
                    jsonify(
                        {
                            "error": "Supabase table listing_drafts is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_listing_drafts.sql"
                        }
                    ),
                    501,
                )
            return jsonify({"error": "Failed to save draft"}), 500

        saved_record = (
            insert_response[0]
            if isinstance(insert_response, list) and insert_response
            else insert_response
        )
        return jsonify({"success": True, "draft": saved_record}), 200
    except Exception as exc:
        logger.error(
            "Draft storage failed for %s/%s: %s", current_user, normalized_key, exc
        )
        return jsonify({"error": "Failed to save draft"}), 500




def register_draft_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_looks_like_missing_table",
        "_annotate_draft_row",
        "_save_listing_draft_record",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(draft_bp)

