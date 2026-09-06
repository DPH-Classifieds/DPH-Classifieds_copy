"""Authenticated bike creation with root-supplied runtime dependencies."""

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request


@dataclass(frozen=True, slots=True)
class BikeCreateDependencies:
    """Runtime collaborators retained by the compatibility root."""

    require_verified_user_for_listing: Callable[[str], Any]
    enforce_listing_limit: Callable[[str], Any]
    require_dealer_verified: Callable[[str], Any]
    initial_listing_status: Callable[[], str]
    new_listing_lifecycle_fields: Callable[[], dict[str, Any]]
    normalize_listing_vin: Callable[[dict[str, Any]], Any]
    require_whatsapp_prefill_and_phone_alignment: Callable[
        [dict[str, Any], str], Any
    ]
    to_int: Callable[..., int | None]
    current_year: Callable[[], int]
    minimum_allowed_year: int
    validate_description_word_count: Callable[..., Any]
    validate_no_profanity: Callable[..., Any]
    sync_gate_error: Callable[[str, dict[str, Any], int], Any]
    validate_listing_image_entry: Callable[[Any, str], bool]
    get_user_email: Callable[[str], str]
    create_listing_with_lifecycle_fallback: Callable[..., tuple[Any, int]]
    friendly_db_error: Callable[[Any, int, str], tuple[Any, int]]
    isoformat_utc: Callable[[Any], str]
    utc_now: Callable[[], Any]
    supabase_request: Callable[..., tuple[Any, int]]
    get_user_email_by_id: Callable[[str], dict[str, Any] | None]
    send_new_listing_admin_notification: Callable[[str, dict[str, Any], Any], Any]
    send_new_listing_user_confirmation: Callable[[str, str, dict[str, Any]], Any]
    trigger_auto_review_async: Callable[[], Any]
    logger: logging.Logger


_ALLOWED_BIKE_FIELDS = {
    "bike_brand",
    "bike_model",
    "bike_type",
    "make",
    "model",
    "year",
    "mileage",
    "engine_size",
    "color",
    "condition",
    "price",
    "location",
    "area",
    "emirate",
    "contact_number",
    "contact_phone",
    "country_code",
    "vin_number",
    "whatsapp_number",
    "whatsapp_prefill_text",
    "description",
    "transmission",
    "fuel_type",
    "features",
    "cylinders",
    "wheels",
    "status",
    "user_id",
    "user_email",
    "is_dealer",
    "expires_at",
    "expired_at",
    "retention_expires_at",
    "last_extended_at",
    "extension_count",
    "is_archived",
    "registration_doc_url",
}


def register_bike_create_route(
    app: Flask,
    *,
    token_required: Callable[[Callable[..., Any]], Callable[..., Any]],
    dependencies: Callable[[], BikeCreateDependencies],
) -> Callable[..., Any]:
    """Register authenticated ``POST /api/bikes`` with endpoint ``create_bike``."""

    @app.route("/api/bikes", methods=["POST"])
    @token_required
    def create_bike(current_user):
        deps = None
        try:
            deps = dependencies()

            if not request.json:
                return jsonify({"error": "Invalid request data"}), 400

            verification_check = deps.require_verified_user_for_listing(current_user)
            if verification_check:
                return verification_check

            limit_response = deps.enforce_listing_limit(current_user)
            if limit_response:
                return limit_response

            dealer_check = deps.require_dealer_verified(current_user)
            if dealer_check:
                return dealer_check

            bike_data = request.json
            bike_data["user_id"] = current_user
            bike_data["status"] = deps.initial_listing_status()
            bike_data.update(deps.new_listing_lifecycle_fields())
            deps.normalize_listing_vin(bike_data)

            if "make" in bike_data and "bike_brand" not in bike_data:
                bike_data["bike_brand"] = bike_data.get("make")
            if "model" in bike_data and "bike_model" not in bike_data:
                bike_data["bike_model"] = bike_data.get("model")
            if "contact_phone" in bike_data and "contact_number" not in bike_data:
                bike_data["contact_number"] = bike_data.get("contact_phone")
            if "engine_capacity" in bike_data and "engine_size" not in bike_data:
                bike_data["engine_size"] = bike_data.get("engine_capacity")
            if "area" not in bike_data and bike_data.get("location"):
                bike_data["area"] = bike_data.get("location")
            try:
                deps.require_whatsapp_prefill_and_phone_alignment(
                    bike_data, "bikes"
                )
            except ValueError as validation_error:
                return jsonify({"error": str(validation_error)}), 400

            try:
                if "year" in bike_data:
                    bike_data["year"] = deps.to_int(
                        bike_data.get("year"),
                        "year",
                        minimum=deps.minimum_allowed_year,
                        maximum=deps.current_year() + 1,
                        allow_empty=False,
                    )
                if "price" in bike_data:
                    bike_data["price"] = deps.to_int(
                        bike_data.get("price"),
                        "price",
                        minimum=0,
                        allow_empty=False,
                    )
                if "mileage" in bike_data:
                    bike_data["mileage"] = deps.to_int(
                        bike_data.get("mileage"), "mileage", minimum=0
                    )
                if (
                    "engine_capacity" in bike_data
                    and str(bike_data.get("engine_capacity", "")).strip()
                ):
                    raw_engine = str(bike_data.get("engine_capacity"))
                    engine_numeric_match = re.search(r"\d+", raw_engine)
                    if engine_numeric_match:
                        engine_capacity = int(engine_numeric_match.group())
                        if engine_capacity < 0:
                            raise ValueError(
                                "engine_capacity must be non-negative"
                            )
                deps.validate_description_word_count(
                    bike_data.get("description"), field_name="description"
                )
                deps.validate_no_profanity(
                    bike_data.get("description"), field_name="description"
                )
                deps.validate_no_profanity(
                    bike_data.get("bike_brand"), field_name="bike_brand"
                )
                deps.validate_no_profanity(
                    bike_data.get("bike_model"), field_name="bike_model"
                )
            except ValueError as validation_error:
                return jsonify({"error": str(validation_error)}), 400

            images = bike_data.pop("images", [])
            sync_error = deps.sync_gate_error("bike", bike_data, len(images))
            if sync_error:
                return sync_error
            if not images:
                return jsonify(
                    {
                        "error": "At least one image is required for a bike listing."
                    }
                ), 400
            if any(
                not deps.validate_listing_image_entry(image, current_user)
                for image in images
            ):
                return jsonify(
                    {
                        "error": (
                            "Images must be public listing uploads for this user"
                        )
                    }
                ), 400

            bike_data = {
                key: value
                for key, value in bike_data.items()
                if key in _ALLOWED_BIKE_FIELDS
            }
            bike_data["user_email"] = deps.get_user_email(current_user)

            bike_data["make"] = (
                bike_data.get("make") or bike_data.get("bike_brand") or ""
            )
            bike_data["model"] = (
                bike_data.get("model") or bike_data.get("bike_model") or ""
            )
            bike_data.setdefault("auto_review_reasons", [])

            data, status_code = deps.create_listing_with_lifecycle_fallback(
                "/rest/v1/bikes", bike_data, user_id=current_user
            )

            if status_code >= 400:
                friendly_data, friendly_status = deps.friendly_db_error(
                    data, status_code, "bike"
                )
                return jsonify(friendly_data), friendly_status

            bike_id = data[0]["id"]

            if images:
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
                                "bike_id": bike_id,
                                "url": image_url.get("url") or url_value,
                                "image_url": image_url.get("image_url")
                                or url_value,
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
                            "bike_id": bike_id,
                            "url": image_url,
                            "image_url": image_url,
                            "cropped_at": deps.isoformat_utc(deps.utc_now()),
                        }
                    )

                images_data, images_status = deps.supabase_request(
                    "post",
                    "/rest/v1/bike_images",
                    data=image_inserts,
                    user_id=current_user,
                )

                if images_status < 400:
                    data[0]["images"] = images_data
                else:
                    data[0]["images"] = []

            try:
                user_details = deps.get_user_email_by_id(current_user)
                user_email = user_details.get("email") if user_details else None
                if deps.initial_listing_status() == "pending":
                    deps.send_new_listing_admin_notification(
                        "bike", data[0], user_email
                    )
                if user_email:
                    deps.send_new_listing_user_confirmation(
                        user_email, "bike", data[0]
                    )
            except Exception as email_error:
                deps.logger.warning(
                    "Failed to send listing notification emails: %s", email_error
                )

            deps.trigger_auto_review_async()
            return jsonify(data[0]), 201
        except Exception as error:
            route_logger = deps.logger if deps is not None else logging.getLogger(__name__)
            route_logger.error("Error creating bike listing: %s", error)
            return jsonify({"error": str(error)}), 500

    return create_bike
