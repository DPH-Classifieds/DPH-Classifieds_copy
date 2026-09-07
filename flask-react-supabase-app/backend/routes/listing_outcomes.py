"""Authenticated listing outcome route."""

from functools import wraps

from flask import Blueprint, current_app, jsonify, request


listing_outcomes_bp = Blueprint("listing_outcomes", __name__)


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


@listing_outcomes_bp.route("/api/user/listings/<item_type>/<item_id>/outcome", methods=["POST"])
@_token_required
def set_listing_outcome(current_user, item_type, item_id):
    """Handle listing outcome popup action after expiry."""
    _PLURAL_TO_SINGULAR = {"cars": "car", "bikes": "bike", "parts": "part", "plates": "plate"}
    item_type = _PLURAL_TO_SINGULAR.get(item_type, item_type)
    config = LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return jsonify({"error": "Invalid listing type"}), 400

    data = request.json or {}
    outcome = (data.get("outcome") or "").strip()
    if outcome not in LISTING_OUTCOME_OPTIONS:
        return jsonify({"error": "Invalid outcome"}), 400

    listing_resp, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "select": "*", "limit": 1},
        user_id=current_user,
    )
    if listing_status >= 400:
        return jsonify({"error": "Failed to fetch listing"}), listing_status
    if not listing_resp:
        return jsonify({"error": "Listing not found"}), 404

    listing = listing_resp[0]
    if listing.get("user_id") != current_user:
        return jsonify(
            {"error": "You do not have permission to update this listing"}
        ), 403

    if _is_listing_deleted(listing):
        return jsonify({"error": "Listing is no longer available"}), 410
    _apply_listing_lifecycle_metadata(listing)

    now = _utc_now()
    updates = {
        "sold_status": outcome,
        "sold_status_set_at": _isoformat_utc(now),
    }

    if outcome == "not_sold_renew":
        refreshed, refreshed_status, refresh_error = _renew_listing_and_verify(
            config["table"],
            item_id,
            listing,
            current_user=current_user,
        )
        if refreshed_status >= 400:
            return jsonify(refresh_error or {"error": "Failed to renew listing"}), refreshed_status

        _invalidate_public_inventory_cache(config["table"])

        try:
            user_email = refreshed.get("user_email") or refreshed.get("contact_email")
            if not user_email:
                user_email = get_user_email(current_user)
            if user_email and EMAIL_REGEX.match(user_email):
                _send_listing_status_email(
                    user_email,
                    item_type,
                    refreshed,
                    "renewed",
                    request.headers.get("Origin"),
                )
        except Exception as email_err:
            logger.error(f"Error sending renewal email: {email_err}")

        return jsonify({"message": "Listing outcome saved", "listing": refreshed}), 200

    if outcome == "move_to_draft":
        expiry_anchor = _parse_datetime(listing.get("expires_at")) or now
        if expiry_anchor < now:
            expiry_anchor = now
        new_expires_at = expiry_anchor + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
        lifecycle_updates = _resubmission_listing_lifecycle_fields()
        lifecycle_updates["expires_at"] = _isoformat_utc(new_expires_at)
        lifecycle_updates["retention_expires_at"] = _isoformat_utc(
            new_expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
        )
        updates.update(
            {
                "status": "draft",
                "sold_status": None,
                "sold_status_set_at": None,
                "expired_at": None,
                "retention_expires_at": lifecycle_updates["retention_expires_at"],
                "sold_response_deadline": None,
                "auto_removed_at": None,
                "last_extended_at": lifecycle_updates["last_extended_at"],
                "is_archived": False,
                "expires_at": lifecycle_updates["expires_at"],
            }
        )
        if config["table"] == "cars":
            updates["is_approved"] = False
    else:
        updates.update(
            {
                "status": "sold",
                "sold_response_deadline": None,
            }
        )

    patch_resp, patch_status = supabase_request(
        "patch",
        f"/rest/v1/{config['table']}?id=eq.{item_id}",
        data=updates,
        use_service_role=True,
    )
    if patch_status >= 400:
        return jsonify({"error": "Failed to update listing outcome"}), patch_status

    _invalidate_public_inventory_cache(config["table"])

    if isinstance(patch_resp, list) and patch_resp:
        refreshed = patch_resp[0]
        _apply_listing_lifecycle_metadata(refreshed)
        return jsonify({"message": "Listing outcome saved", "listing": refreshed}), 200
    if isinstance(patch_resp, dict) and patch_resp:
        _apply_listing_lifecycle_metadata(patch_resp)
        return jsonify({"message": "Listing outcome saved", "listing": patch_resp}), 200

    refreshed_resp, refreshed_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "select": "*", "limit": 1},
        use_service_role=True,
    )
    if refreshed_status < 400 and refreshed_resp:
        refreshed = refreshed_resp[0]
        _apply_listing_lifecycle_metadata(refreshed)

        return jsonify({"message": "Listing outcome saved", "listing": refreshed}), 200

    return jsonify({"message": "Listing outcome saved"}), 200


# =====================


def register_listing_outcome_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_is_listing_deleted",
        "_apply_listing_lifecycle_metadata",
        "_utc_now",
        "_isoformat_utc",
        "_renew_listing_and_verify",
        "_invalidate_public_inventory_cache",
        "get_user_email",
        "_send_listing_status_email",
        "_parse_datetime",
        "_resubmission_listing_lifecycle_fields",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(listing_outcomes_bp)

