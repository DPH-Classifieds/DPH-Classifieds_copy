"""Admin VIN unlock route."""

from functools import wraps

from flask import Blueprint, current_app, jsonify


vin_admin_bp = Blueprint("vin_admin", __name__)


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


@vin_admin_bp.route("/api/admin/listings/<item_type>/<item_id>/vin-unlock", methods=["POST"])
@_token_required
def admin_vin_unlock(current_user, item_type, item_id):
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        listing_meta = _admin_get_listing_meta(item_type)
        if not listing_meta:
            return jsonify({"error": "Invalid listing type"}), 400

        listing_rows, listing_status = supabase_request(
            "get",
            f"/rest/v1/{listing_meta['table']}",
            params={
                "select": "id,user_id,vin_number",
                "id": f"eq.{item_id}",
                "limit": 1,
            },
            use_service_role=True,
        )
        if listing_status >= 400:
            return jsonify({"error": "Failed to fetch listing"}), listing_status
        if not listing_rows:
            return jsonify({"error": "Listing not found"}), 404

        listing = listing_rows[0]
        owner_id = listing.get("user_id")
        if not owner_id:
            return jsonify({"error": "Listing owner not found"}), 400

        owner_profile = _get_user_profile_for_verification(owner_id) or {}
        if not _normalize_phone_number(
            owner_profile.get("phone"), owner_profile.get("country_code")
        ):
            return jsonify(
                {
                    "error": "Listing owner must have a valid phone number on file before VIN unlock can mark them verified."
                }
            ), 400

        _sync_user_verification_flags(
            owner_id,
            phone_verified=True,
            phone_verified_at=_isoformat_utc(_utc_now()),
            phone=owner_profile.get("phone"),
            country_code=owner_profile.get("country_code"),
        )

        return jsonify(
            {
                "success": True,
                "message": "VIN unlocked for listing owner",
                "listing_id": listing.get("id"),
                "owner_id": owner_id,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error unlocking VIN: {e}")
        return jsonify({"error": "Failed to unlock VIN"}), 500




def register_vin_admin_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "_get_user_details_with_admin_status",
        "_admin_get_listing_meta",
        "supabase_request",
        "_get_user_profile_for_verification",
        "_normalize_phone_number",
        "_sync_user_verification_flags",
        "_isoformat_utc",
        "_utc_now",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(vin_admin_bp)

