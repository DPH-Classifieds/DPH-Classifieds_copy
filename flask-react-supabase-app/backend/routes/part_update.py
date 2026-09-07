"""Car-part listing read dispatch, update, and delete routes."""

import json
import logging
from functools import wraps

from flask import Blueprint, current_app, jsonify, request


part_update_bp = Blueprint("part_update", __name__)


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


@part_update_bp.route(
    "/api/parts/<part_id>", methods=["GET", "PUT", "PATCH", "POST"]
)
@_token_required_optional
def part_handler(current_user, part_id):
    if request.method == "GET":
        return _backend().get_part_details(part_id, current_user)

    # For update methods, token is required.
    if not current_user:
        return jsonify({"message": "Authentication required"}), 401

    return update_part(current_user, part_id)


def update_part(current_user, part_id):
    """Update a car part listing."""
    try:
        logger.info(f"Updating part listing: {part_id}")

        owner_rows, owner_status = supabase_request(
            "get",
            "/rest/v1/car_parts",
            params={"select": "user_id", "id": f"eq.{part_id}", "limit": 1},
            user_id=current_user,
        )
        if owner_status >= 400:
            return jsonify(owner_rows), owner_status
        if not owner_rows:
            return jsonify({"error": "Part not found"}), 404
        if owner_rows[0].get("user_id") != current_user:
            return jsonify(
                {"error": "You do not have permission to update this part"}
            ), 403

        # Check if this is FormData or JSON.
        is_form_data = (
            request.content_type and "multipart/form-data" in request.content_type
        )

        if is_form_data:
            update_data = {}
            for key, value in request.form.items():
                if key == "compatible_makes" or key == "compatible_models":
                    try:
                        update_data[key] = json.loads(value) if value else []
                    except Exception:
                        update_data[key] = []
                else:
                    update_data[key] = value

            keep_image_ids = request.form.getlist("keep_image_ids")
            new_images = request.files.getlist("images")
            images = None
        else:
            update_data = request.json.copy() if request.json else {}
            keep_image_ids = update_data.pop("keep_image_ids", None)
            new_images = []
            images = update_data.pop("images", None)

        # Sanitize update data.
        update_data.pop("id", None)
        update_data.pop("user_id", None)

        # Whitelist allowed fields.
        part_allowed_fields = {
            "name",
            "part_type",
            "condition",
            "compatible_makes",
            "compatible_models",
            "compatible_years",
            "price",
            "location",
            "area",
            "emirate",
            "contact_number",
            "whatsapp_prefill_text",
            "country_code",
            "whatsapp_number",
            "description",
            "is_negotiable",
            "is_dealer",
        }
        update_data = {
            key: value
            for key, value in update_data.items()
            if key in part_allowed_fields
        }

        # compatible_years is TEXT[] in the DB — coerce string values to array/null.
        if "compatible_years" in update_data:
            compatible_years = update_data["compatible_years"]
            if not compatible_years:
                update_data["compatible_years"] = None
            elif isinstance(compatible_years, str):
                update_data["compatible_years"] = [compatible_years]

        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "parts")
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
            if "name" in update_data:
                _validate_no_profanity(update_data.get("name"), field_name="name")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        if "price" in update_data and update_data["price"] is not None:
            _maybe_record_price_drop("car_parts", part_id, update_data["price"])
            _record_price_point("car_parts", part_id, update_data["price"])

        # Update the part.
        data, status_code = supabase_request(
            "patch",
            "/rest/v1/car_parts",
            params={"id": f"eq.{part_id}"},
            data=update_data,
            user_id=current_user,
        )

        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(
                data, status_code, "part"
            )
            return jsonify(friendly_data), friendly_status

        # Handle image updates from JSON payload (uploaded URLs). Snapshot
        # existing rows, insert replacements, then delete the originals only
        # once the new rows are persisted.
        if images is not None:
            existing_images_resp, existing_images_status = supabase_request(
                "get",
                "/rest/v1/part_images",
                params={"select": "id", "part_id": f"eq.{part_id}"},
                user_id=current_user,
            )
            existing_image_ids = (
                [
                    row["id"]
                    for row in existing_images_resp
                    if isinstance(row, dict) and row.get("id")
                ]
                if existing_images_status < 400
                and isinstance(existing_images_resp, list)
                else []
            )

            image_inserts = []
            for image_url in images:
                if isinstance(image_url, dict):
                    url_value = (
                        image_url.get("image_url")
                        or image_url.get("url")
                        or image_url.get("display_url")
                    )
                    if not url_value:
                        continue
                    image_inserts.append(
                        {
                            "part_id": part_id,
                            "url": image_url.get("url") or url_value,
                            "image_url": image_url.get("image_url") or url_value,
                            "display_url": image_url.get("display_url"),
                            "focal_x": image_url.get("focal_x"),
                            "focal_y": image_url.get("focal_y"),
                            "crop_meta": image_url.get("crop_meta"),
                            "cropped_at": _isoformat_utc(_utc_now()),
                        }
                    )
                    continue
                image_inserts.append(
                    {
                        "part_id": part_id,
                        "url": image_url,
                        "image_url": image_url,
                        "cropped_at": _isoformat_utc(_utc_now()),
                    }
                )

            inserted_rows = []
            if image_inserts:
                bulk_resp, bulk_status = supabase_request(
                    "post",
                    "/rest/v1/part_images",
                    data=image_inserts,
                    user_id=current_user,
                )
                if bulk_status < 400:
                    if isinstance(bulk_resp, list):
                        inserted_rows = bulk_resp
                    elif isinstance(bulk_resp, dict):
                        inserted_rows = [bulk_resp]
                else:
                    for image_insert in image_inserts:
                        single_resp, single_status = supabase_request(
                            "post",
                            "/rest/v1/part_images",
                            data=image_insert,
                            user_id=current_user,
                        )
                        if single_status < 400 and single_resp:
                            if isinstance(single_resp, list):
                                inserted_rows.extend(single_resp)
                            else:
                                inserted_rows.append(single_resp)

                    if not inserted_rows:
                        logger.error(
                            f"Failed to replace part images for {part_id}: "
                            f"{bulk_status} - {bulk_resp}"
                        )
                        return jsonify({"error": "Failed to save listing images."}), 500

            if existing_image_ids:
                inserted_ids = {
                    row.get("id")
                    for row in inserted_rows
                    if isinstance(row, dict) and row.get("id")
                }
                to_delete = [
                    image_id
                    for image_id in existing_image_ids
                    if image_id not in inserted_ids
                ]
                if to_delete:
                    quoted_ids = ",".join(f'"{image_id}"' for image_id in to_delete)
                    supabase_request(
                        "delete",
                        "/rest/v1/part_images",
                        params={"id": f"in.({quoted_ids})"},
                        user_id=current_user,
                    )

        # Fetch full part data for email.
        refreshed_resp, refreshed_status = supabase_request(
            "get",
            "/rest/v1/car_parts",
            params={"id": f"eq.{part_id}", "select": "*", "limit": 1},
            user_id=current_user,
        )

        if refreshed_status < 400 and refreshed_resp:
            part = refreshed_resp[0]
            # Send edit notification email.
            try:
                user_email = part.get("user_email") or part.get("contact_email")
                if not user_email:
                    user_email = get_user_email(current_user)
                if user_email and EMAIL_REGEX.match(user_email):
                    _, email_error = _send_listing_status_email(
                        user_email,
                        "parts",
                        part,
                        "updated",
                        request.headers.get("Origin"),
                    )
                    if email_error:
                        logger.error(
                            f"Edit email failed for part {part_id}: {email_error}"
                        )
            except Exception as email_error:
                logger.error(f"Error sending edit email: {email_error}")

        _invalidate_public_inventory_cache("parts")
        _invalidate_api_cache_prefixes([f"/api/parts/{part_id}"])
        return jsonify({"message": "Part updated successfully"}), 200

    except Exception as error:
        logger.error(f"Error updating part {part_id}: {error}")
        return jsonify({"error": str(error)}), 500


@part_update_bp.route("/api/parts/<part_id>", methods=["DELETE"])
@_token_required
def delete_part(current_user, part_id):
    try:
        delete_response, delete_status = _delete_user_owned_listing(
            current_user, "part", part_id
        )
        if delete_status >= 400:
            return jsonify(delete_response), delete_status
        _invalidate_public_inventory_cache("parts")
        _invalidate_api_cache_prefixes([f"/api/parts/{part_id}"])
        return jsonify({"message": "Part listing deleted successfully"}), 200
    except Exception as error:
        logger.error(f"Error deleting part {part_id}: {error}")
        return jsonify({"error": str(error)}), 500


def register_part_update_routes(app, backend_symbols):
    """Register part mutations while resolving root helpers at request time."""
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_require_whatsapp_prefill_and_phone_alignment",
        "_validate_description_word_count",
        "_validate_no_profanity",
        "_maybe_record_price_drop",
        "_record_price_point",
        "_friendly_db_error",
        "_isoformat_utc",
        "_utc_now",
        "logger",
        "get_user_email",
        "EMAIL_REGEX",
        "_send_listing_status_email",
        "_invalidate_public_inventory_cache",
        "_invalidate_api_cache_prefixes",
        "_delete_user_owned_listing",
    ):
        if name in {"logger", "EMAIL_REGEX"}:
            continue
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(part_update_bp)
