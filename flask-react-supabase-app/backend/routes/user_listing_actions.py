"""Authenticated actions for removing a terminal listing from the owner view."""

from functools import wraps

from flask import Flask, current_app, jsonify


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
def dismiss_user_listing(current_user, item_type, item_id):
    backend = _backend()
    config = backend.LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return jsonify({"error": "Invalid listing type"}), 400

    listing_data, listing_status = backend.supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={
            "select": "id,user_id,status,deleted_at,is_archived,user_dismissed_at",
            "id": f"eq.{item_id}",
            "limit": 1,
        },
        user_id=current_user,
    )
    if listing_status >= 400:
        return jsonify(listing_data), listing_status
    if not listing_data:
        return jsonify({"error": "Listing not found"}), 404

    original = listing_data[0]
    if original.get("user_id") != current_user:
        return jsonify(
            {"error": "You do not have permission to dismiss this listing"}
        ), 403

    status_value = str(original.get("status") or "").lower()
    if (
        status_value not in {"deleted", "rejected", "sold"}
        and not original.get("deleted_at")
        and not original.get("is_archived")
    ):
        return jsonify(
            {"error": "Only deleted, expired, or sold listings can be removed from your list"}
        ), 400

    if original.get("user_dismissed_at"):
        return jsonify({"message": "Listing already removed from your list"}), 200

    _, patch_status = backend.supabase_request(
        "patch",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "user_id": f"eq.{current_user}"},
        data={"user_dismissed_at": backend._isoformat_utc(backend._utc_now())},
        use_service_role=True,
    )
    if patch_status >= 400:
        return jsonify({"error": "Failed to remove listing from your list"}), 500

    return jsonify({"message": "Listing removed from your list"}), 200


def register_user_listing_action_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/user/listings/<item_type>/<item_id>/dismiss",
        endpoint="dismiss_user_listing",
        view_func=dismiss_user_listing,
        methods=["POST"],
    )
