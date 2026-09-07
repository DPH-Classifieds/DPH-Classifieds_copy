"""Authenticated license plate update and delete routes."""

from functools import wraps

from flask import Blueprint, current_app, jsonify, request


plate_update_bp = Blueprint("plate_update", __name__)


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


def _token_required_optional(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required_optional(function)(*args, **kwargs)

    return decorated


@plate_update_bp.route(
    "/api/plates/<plate_id>", methods=["GET", "PUT", "PATCH", "POST"]
)
@_token_required_optional
def plate_handler(current_user, plate_id):
    if request.method == "GET":
        return _backend().get_plate_details(plate_id, current_user)

    # For update methods, token is required.
    if not current_user:
        return jsonify({"message": "Authentication required"}), 401

    return _backend().update_plate(current_user, plate_id)


def update_plate(current_user, plate_id):
    """Update a license plate listing."""
    try:
        logger.info(f"Updating plate listing: {plate_id}")

        data = request.form if request.form else (request.get_json(silent=True) or {})

        # Prepare update payload.
        update_data = {}
        allowed_fields = {
            "city",
            "code",
            "digits",
            "price",
            "number",
            "plate_format",
            "contact_name",
            "contact_phone",
            "country_code",
            "whatsapp_number",
            "whatsapp_prefill_text",
            "description",
            "area",
            "emirate",
            "is_dealer",
            "proof_document_url",
            "registration_doc_url",
        }

        for key in allowed_fields:
            if key in data:
                update_data[key] = data[key]
        if "proof_document_url" in update_data and not _validate_private_document_path(
            update_data["proof_document_url"], current_user, required_prefix="plate-proofs"
        ):
            return jsonify(
                {
                    "error": "proof_document_url must be a server-issued private document path"
                }
            ), 400
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "plates")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        try:
            if "description" in update_data:
                _validate_description_word_count(
                    update_data.get("description"), field_name="description"
                )
                _validate_no_profanity(
                    update_data.get("description"), field_name="description"
                )
            if "contact_name" in update_data:
                _validate_no_profanity(
                    update_data.get("contact_name"), field_name="contact_name"
                )
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Sanitize.
        update_data.pop("id", None)

        if "price" in update_data and update_data["price"] is not None:
            _maybe_record_price_drop("license_plates", plate_id, update_data["price"])
            _record_price_point("license_plates", plate_id, update_data["price"])

        # Include user_id in the update filter so a non-owner mutation is a
        # no-op even if a service-role request bypasses database RLS.
        data, status_code = supabase_request(
            "patch",
            "/rest/v1/license_plates",
            params={"id": f"eq.{plate_id}", "user_id": f"eq.{current_user}"},
            data=update_data,
            use_service_role=True,
        )

        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(
                data, status_code, "plate"
            )
            return jsonify(friendly_data), friendly_status

        # Fetch full plate data for the edit notification email.
        refreshed_resp, refreshed_status = supabase_request(
            "get",
            "/rest/v1/license_plates",
            params={"id": f"eq.{plate_id}", "select": "*", "limit": 1},
            user_id=current_user,
        )

        if refreshed_status < 400 and refreshed_resp:
            plate = refreshed_resp[0]
            try:
                user_email = plate.get("user_email") or plate.get("contact_email")
                if not user_email:
                    user_email = get_user_email(current_user)
                if user_email and EMAIL_REGEX.match(user_email):
                    _, email_error = _send_listing_status_email(
                        user_email,
                        "plates",
                        plate,
                        "updated",
                        request.headers.get("Origin"),
                    )
                    if email_error:
                        logger.error(
                            f"Edit email failed for plate {plate_id}: {email_error}"
                        )
            except Exception as email_err:
                logger.error(f"Error sending edit email: {email_err}")

        _invalidate_public_inventory_cache("plates")
        _invalidate_api_cache_prefixes([f"/api/plates/{plate_id}"])
        return jsonify({"message": "Plate updated successfully"}), 200

    except Exception as e:
        logger.error(f"Error updating plate {plate_id}: {e}")
        return jsonify({"error": str(e)}), 500


@plate_update_bp.route("/api/plates/<plate_id>", methods=["DELETE"])
@_token_required
def delete_plate(current_user, plate_id):
    try:
        delete_response, delete_status = _delete_user_owned_listing(
            current_user, "plate", plate_id
        )
        if delete_status >= 400:
            return jsonify(delete_response), delete_status
        _invalidate_public_inventory_cache("plates")
        _invalidate_api_cache_prefixes([f"/api/plates/{plate_id}"])
        return jsonify({"message": "Plate listing deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting plate {plate_id}: {e}")
        return jsonify({"error": str(e)}), 500


def register_plate_update_routes(app, backend_symbols):
    """Register plate mutation routes against the live compatibility symbols."""
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_validate_private_document_path",
        "_require_whatsapp_prefill_and_phone_alignment",
        "_validate_description_word_count",
        "_validate_no_profanity",
        "_maybe_record_price_drop",
        "_record_price_point",
        "_friendly_db_error",
        "get_user_email",
        "_send_listing_status_email",
        "_invalidate_public_inventory_cache",
        "_invalidate_api_cache_prefixes",
        "_delete_user_owned_listing",
        "EMAIL_REGEX",
        "logger",
    ):
        if name in {"logger", "EMAIL_REGEX"}:
            continue
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(plate_update_bp)
