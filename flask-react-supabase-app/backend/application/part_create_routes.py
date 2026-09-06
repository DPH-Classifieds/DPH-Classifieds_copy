"""Authenticated car-part creation with root-supplied runtime dependencies."""

import logging
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request


@dataclass(frozen=True, slots=True)
class PartCreateDependencies:
    """Runtime collaborators retained by the compatibility root."""

    require_verified_user_for_listing: Callable[[str], Any]
    require_dealer_verified: Callable[[str], Any]
    initial_listing_status: Callable[[], str]
    new_listing_lifecycle_fields: Callable[[], dict[str, Any]]
    require_whatsapp_prefill_and_phone_alignment: Callable[
        [dict[str, Any], str], Any
    ]
    sync_gate_error: Callable[[str, dict[str, Any], int], Any]
    validate_listing_image_entry: Callable[[Any, str], bool]
    part_image_max_count: int
    part_image_max_total_bytes: int
    upload_to_supabase_storage: Callable[..., tuple[Any, Any]]
    get_user_email: Callable[[str], str]
    create_listing_with_lifecycle_fallback: Callable[..., tuple[Any, int]]
    friendly_db_error: Callable[[Any, int, str], tuple[Any, int]]
    validate_description_word_count: Callable[..., Any]
    validate_no_profanity: Callable[..., Any]
    isoformat_utc: Callable[[Any], str]
    utc_now: Callable[[], Any]
    supabase_request: Callable[..., tuple[Any, int]]
    get_user_email_by_id: Callable[[str], dict[str, Any] | None]
    send_new_listing_admin_notification: Callable[[str, dict[str, Any], Any], Any]
    send_new_listing_user_confirmation: Callable[[str, str, dict[str, Any]], Any]
    trigger_auto_review_async: Callable[[], Any]
    logger: logging.Logger


_ALLOWED_PART_FIELDS = {
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
    "country_code",
    "whatsapp_number",
    "whatsapp_prefill_text",
    "description",
    "is_negotiable",
    "status",
    "user_id",
    "user_email",
    "is_dealer",
    "expires_at",
    "expired_at",
    "retention_expires_at",
    "last_extended_at",
    "extension_count",
    "last_extended_at",
    "is_archived",
}


def register_part_create_route(
    app: Flask,
    *,
    token_required: Callable[[Callable[..., Any]], Callable[..., Any]],
    dependencies: Callable[[], PartCreateDependencies],
) -> Callable[..., Any]:
    """Register authenticated ``POST /api/parts`` as endpoint ``create_part``."""

    @app.route("/api/parts", methods=["POST"])
    @token_required
    def create_part(current_user):
        deps = None
        try:
            deps = dependencies()
            deps.logger.info("Creating new car part listing")

            verification_check = deps.require_verified_user_for_listing(current_user)
            if verification_check:
                return verification_check

            dealer_check = deps.require_dealer_verified(current_user)
            if dealer_check:
                return dealer_check

            is_form_data = (
                request.content_type
                and "multipart/form-data" in request.content_type
            )

            if is_form_data:
                part_data = {}

                for key, value in request.form.items():
                    if key.startswith("image_"):
                        continue
                    if key == "compatible_makes" or key == "compatible_models":
                        try:
                            part_data[key] = json.loads(value) if value else []
                        except Exception:
                            part_data[key] = []
                    else:
                        part_data[key] = value

                part_files = [
                    file
                    for key, file in request.files.items()
                    if key.startswith("image_") and file and file.filename
                ]
                if len(part_files) > deps.part_image_max_count:
                    return jsonify(
                        {
                            "error": f"A maximum of {deps.part_image_max_count} images is allowed"
                        }
                    ), 413

                uploaded_files = []
                total_bytes = 0
                for file in part_files:
                    try:
                        file.seek(0)
                        raw = file.read(deps.part_image_max_total_bytes + 1)
                        file.seek(0)
                        total_bytes += len(raw)
                        if total_bytes > deps.part_image_max_total_bytes:
                            return jsonify(
                                {"error": "Total image upload size is too large"}
                            ), 413
                        metadata, upload_error = deps.upload_to_supabase_storage(
                            file,
                            bucket_name="listing-images",
                            folder=str(current_user),
                            return_metadata=True,
                        )
                        if not metadata:
                            return jsonify(
                                {"error": upload_error or "Invalid image upload"}
                            ), 400
                        uploaded_files.append(metadata)
                    except ValueError as validation_error:
                        return jsonify({"error": str(validation_error)}), 400
            else:
                if not request.json:
                    return jsonify({"error": "Invalid request data"}), 400
                part_data = request.json.copy()
                uploaded_files = part_data.pop("images", [])
                if (
                    not isinstance(uploaded_files, list)
                    or len(uploaded_files) > deps.part_image_max_count
                ):
                    return jsonify(
                        {
                            "error": f"A maximum of {deps.part_image_max_count} images is allowed"
                        }
                    ), 400
                if any(
                    not deps.validate_listing_image_entry(image, current_user)
                    for image in uploaded_files
                ):
                    return jsonify(
                        {"error": "Images must be public listing uploads for this user"}
                    ), 400

            part_data["user_id"] = current_user
            part_data["status"] = deps.initial_listing_status()
            part_data.update(deps.new_listing_lifecycle_fields())
            try:
                deps.require_whatsapp_prefill_and_phone_alignment(
                    part_data, "parts"
                )
            except ValueError as validation_error:
                return jsonify({"error": str(validation_error)}), 400

            sync_error = deps.sync_gate_error(
                "part", part_data, len(uploaded_files)
            )
            if sync_error:
                return sync_error

            part_data = {
                key: value
                for key, value in part_data.items()
                if key in _ALLOWED_PART_FIELDS
            }
            part_data["user_email"] = deps.get_user_email(current_user)
            part_data.setdefault("auto_review_reasons", [])

            compatible_years = part_data.get("compatible_years")
            if not compatible_years:
                part_data["compatible_years"] = None
            elif isinstance(compatible_years, str):
                part_data["compatible_years"] = [compatible_years]

            for field in ["name", "part_type", "price"]:
                if not part_data.get(field):
                    return jsonify({"error": f"Missing required field: {field}"}), 400

            try:
                deps.validate_description_word_count(
                    part_data.get("description"), field_name="description"
                )
                deps.validate_no_profanity(
                    part_data.get("description"), field_name="description"
                )
                deps.validate_no_profanity(part_data.get("name"), field_name="name")
            except ValueError as validation_error:
                return jsonify({"error": str(validation_error)}), 400

            deps.logger.info("Creating part with data: %s", part_data)
            data, status_code = deps.create_listing_with_lifecycle_fallback(
                "/rest/v1/car_parts", part_data, user_id=current_user
            )

            if status_code >= 400:
                friendly_data, friendly_status = deps.friendly_db_error(
                    data, status_code, "part"
                )
                return jsonify(friendly_data), friendly_status

            part_id = data[0]["id"]
            deps.logger.info("Created part with ID: %s", part_id)

            if uploaded_files:
                image_inserts = []
                for image_url in uploaded_files:
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
                                "cropped_at": deps.isoformat_utc(deps.utc_now()),
                            }
                        )
                        continue
                    image_inserts.append(
                        {
                            "part_id": part_id,
                            "url": image_url,
                            "image_url": image_url,
                            "cropped_at": deps.isoformat_utc(deps.utc_now()),
                        }
                    )

                images_data, images_status = deps.supabase_request(
                    "post",
                    "/rest/v1/part_images",
                    data=image_inserts,
                    user_id=current_user,
                )

                if images_status < 400:
                    data[0]["images"] = images_data
                    deps.logger.info("Added %s images to part", len(images_data))
                else:
                    data[0]["images"] = []
                    deps.logger.warning("Failed to add images: %s", images_data)
            else:
                data[0]["images"] = []

            try:
                user_details = deps.get_user_email_by_id(current_user)
                user_email = user_details.get("email") if user_details else None
                if deps.initial_listing_status() == "pending":
                    deps.send_new_listing_admin_notification(
                        "part", data[0], user_email
                    )
                if user_email:
                    deps.send_new_listing_user_confirmation(
                        user_email, "part", data[0]
                    )
            except Exception as email_error:
                deps.logger.warning(
                    "Failed to send listing notification emails: %s", email_error
                )

            deps.trigger_auto_review_async()
            return jsonify(data[0]), 201

        except Exception as error:
            route_logger = deps.logger if deps is not None else logging.getLogger(__name__)
            route_logger.error("Error creating car part listing: %s", error)
            return jsonify({"error": str(error)}), 500

    return create_part
