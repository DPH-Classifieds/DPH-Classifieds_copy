"""Authenticated listing lifecycle route."""

from functools import wraps

from flask import Blueprint, current_app, jsonify, request


listing_lifecycle_bp = Blueprint("listing_lifecycle", __name__)


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


@listing_lifecycle_bp.route("/api/user/listings/<item_type>/<item_id>/extend", methods=["POST"])
@_token_required
def extend_user_listing(current_user, item_type, item_id):
    config = LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return jsonify({"error": "Invalid listing type"}), 400

    listing_data, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"select": "*", "id": f"eq.{item_id}", "limit": 1},
        user_id=current_user,
    )

    if listing_status >= 400:
        return jsonify(listing_data), listing_status

    if not listing_data:
        return jsonify({"error": "Listing not found"}), 404

    listing = listing_data[0]
    if listing.get("user_id") != current_user:
        return jsonify(
            {"error": "You do not have permission to extend this listing"}
        ), 403

    if _is_listing_deleted(listing):
        return jsonify({"error": "Listing is no longer available"}), 410
    _apply_listing_lifecycle_metadata(listing)

    if listing.get("is_archived"):
        _delete_listing_with_assets(config["table"], item_id)
        return jsonify(
            {"error": "Listing has already passed its retention period"}
        ), 410

    if listing.get("status") in {"deleted", "rejected"}:
        return jsonify({"error": "This listing cannot be extended"}), 400

    refreshed_listing, refreshed_status, refresh_error = _renew_listing_and_verify(
        config["table"],
        item_id,
        listing,
        current_user=current_user,
    )
    if refreshed_status >= 400:
        return jsonify(refresh_error or {"error": "Failed to renew listing"}), refreshed_status

    _invalidate_public_inventory_cache(config["table"])

    try:
        renewal_record = refreshed_listing
        owner_email = renewal_record.get("user_email") or renewal_record.get(
            "contact_email"
        )
        if not owner_email:
            owner_email = get_user_email(current_user)
        if owner_email and EMAIL_REGEX.match(owner_email):
            _send_listing_status_email(
                owner_email,
                item_type,
                renewal_record,
                "renewed",
                request.headers.get("Origin"),
            )
    except Exception as email_err:
        logger.error(f"Error sending renewal email: {email_err}")

    return jsonify(
        {
            "message": "Listing extended successfully",
            "listing": refreshed_listing,
        }
    ), 200




def register_listing_lifecycle_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_is_listing_deleted",
        "_apply_listing_lifecycle_metadata",
        "_delete_listing_with_assets",
        "_renew_listing_and_verify",
        "_invalidate_public_inventory_cache",
        "get_user_email",
        "_send_listing_status_email",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(listing_lifecycle_bp)

