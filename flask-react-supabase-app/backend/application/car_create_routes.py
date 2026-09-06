"""Authenticated car creation with root-supplied runtime dependencies."""

import logging
from collections.abc import Callable, Collection
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request


@dataclass(frozen=True, slots=True)
class CarCreateDependencies:
    """Runtime collaborators retained by the compatibility root."""

    require_verified_user_for_listing: Callable[[str], Any]
    enforce_listing_limit: Callable[[str], Any]
    require_dealer_verified: Callable[[str], Any]
    new_listing_lifecycle_fields: Callable[[], dict[str, Any]]
    normalize_listing_vin: Callable[[dict[str, Any]], Any]
    require_whatsapp_prefill_and_phone_alignment: Callable[
        [dict[str, Any], str], Any
    ]
    to_int: Callable[..., int | None]
    current_year: Callable[[], int]
    minimum_allowed_year: int
    normalize_regional_spec: Callable[[Any], Any]
    car_transmission_options: Collection[str]
    is_valid_car_fuel_type: Callable[[Any], bool]
    steering_side_options: Collection[str]
    validate_description_word_count: Callable[..., Any]
    validate_no_profanity: Callable[..., Any]
    sync_gate_error: Callable[[str, dict[str, Any], int], Any]
    get_user_email: Callable[[str], str]
    initial_listing_status: Callable[[], str]
    create_listing_with_lifecycle_fallback: Callable[..., tuple[Any, int]]
    friendly_db_error: Callable[[Any, int, str], tuple[Any, int]]
    normalize_crop_settings: Callable[[dict[str, Any]], dict[str, Any]]
    isoformat_utc: Callable[[Any], str]
    utc_now: Callable[[], Any]
    supabase_request: Callable[..., tuple[Any, int]]
    sort_listing_images: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    get_user_email_by_id: Callable[[str], dict[str, Any] | None]
    send_new_listing_admin_notification: Callable[[str, dict[str, Any], Any], Any]
    send_new_listing_user_confirmation: Callable[[str, str, dict[str, Any]], Any]
    invalidate_public_inventory_cache: Callable[[str], Any]
    trigger_auto_review_async: Callable[[], Any]
    capture_posthog_event: Callable[[str, str, dict[str, Any]], Any]
    logger: logging.Logger


_EXTRAS_MAPPING = {
    "Keyless Entry": "keyless_entry",
    "DVD Player": "dvd_player",
    "Climate Control": "climate_control",
    "Navigation System": "navigation_system",
    "Premium Sound System": "premium_sound_system",
    "Cooled Seats": "cooled_seats",
    "Front Wheel Drive": "front_wheel_drive",
    "Leather Seats": "leather_seats",
    "Parking Sensors": "parking_sensors",
    "Rear View Camera": "rear_view_camera",
}

_ALLOWED_CAR_FIELDS = {
    "car_manufacturer",
    "car_model",
    "trim",
    "regional_spec",
    "make_year",
    "kilometer_driven",
    "body_type",
    "is_insured",
    "expected_selling_price",
    "car_owner_phone_number",
    "car_city",
    "listing_title",
    "tour_url",
    "car_description",
    "fuel_type",
    "transmission_type",
    "seating_capacity",
    "horsepower",
    "engine_capacity",
    "steering_side",
    "color",
    "cylinders",
    "doors",
    "warranty",
    "service_history",
    "car_location",
    "area",
    "emirate",
    "vehicle_type",
    "is_approved",
    "user_id",
    "user_email",
    "country_code",
    "whatsapp_number",
    "whatsapp_prefill_text",
    "vin_number",
    "latitude",
    "longitude",
    "is_dealer",
    "keyless_entry",
    "dvd_player",
    "climate_control",
    "navigation_system",
    "premium_sound_system",
    "cooled_seats",
    "front_wheel_drive",
    "leather_seats",
    "parking_sensors",
    "rear_view_camera",
    "lady_driven",
    "extras",
    "expires_at",
    "expired_at",
    "retention_expires_at",
    "last_extended_at",
    "extension_count",
    "is_archived",
    "registration_document_url",
}


def register_car_create_route(
    app: Flask,
    *,
    token_required: Callable[[Callable[..., Any]], Callable[..., Any]],
    dependencies: Callable[[], CarCreateDependencies],
) -> Callable[..., Any]:
    """Register authenticated ``POST /api/cars`` with endpoint ``create_car``."""

    @app.route("/api/cars", methods=["POST"])
    @token_required
    def create_car(current_user):
        deps = None
        try:
            deps = dependencies()
            deps.logger.info(
                "POST /api/cars - Content-Type: %s", request.content_type
            )
            deps.logger.info(
                "POST /api/cars - Content-Length: %s", request.content_length
            )
            deps.logger.info(
                "POST /api/cars request received content_type=%s content_length=%s",
                request.content_type,
                request.content_length,
            )

            if not request.json:
                deps.logger.error("No JSON data in car listing request")
                return jsonify(
                    {
                        "error": "Invalid request data - no JSON received",
                        "content_type": request.content_type,
                        "raw_data": None,
                    }
                ), 400

            deps.logger.info("Creating car listing for user %s", current_user)
            deps.logger.info("Request data keys: %s", list(request.json.keys()))

            verification_check = deps.require_verified_user_for_listing(current_user)
            if verification_check:
                return verification_check

            limit_response = deps.enforce_listing_limit(current_user)
            if limit_response:
                return limit_response

            dealer_check = deps.require_dealer_verified(current_user)
            if dealer_check:
                return dealer_check

            car_data = request.json
            car_data["user_id"] = current_user
            car_data.update(deps.new_listing_lifecycle_fields())
            deps.normalize_listing_vin(car_data)

            if "description" in car_data and "car_description" not in car_data:
                car_data["car_description"] = car_data.pop("description")
            if "location" in car_data and "car_location" not in car_data:
                car_data["car_location"] = car_data.get("location")
            if "location" in car_data and "car_city" not in car_data:
                car_data["car_city"] = car_data.get("location")
            if "location" in car_data and "area" not in car_data:
                car_data["area"] = car_data.get("location")
            if (
                "contact_phone" in car_data
                and "car_owner_phone_number" not in car_data
            ):
                car_data["car_owner_phone_number"] = car_data.get("contact_phone")
            if "car_variant" in car_data and "trim" not in car_data:
                car_data["trim"] = car_data.get("car_variant")
            if "exterior_color" in car_data and "color" not in car_data:
                car_data["color"] = car_data.get("exterior_color")
            if "mileage" in car_data and "kilometer_driven" not in car_data:
                car_data["kilometer_driven"] = car_data.get("mileage")
            if (
                "transmission" in car_data
                and "transmission_type" not in car_data
            ):
                car_data["transmission_type"] = car_data.get("transmission")
            if "engine" in car_data and "engine_capacity" not in car_data:
                car_data["engine_capacity"] = car_data.get("engine")
            try:
                deps.require_whatsapp_prefill_and_phone_alignment(car_data, "cars")
            except ValueError as validation_error:
                return jsonify({"error": str(validation_error)}), 400

            try:
                deps.logger.info(
                    "Validating car data: make_year=%s, kilometer_driven=%s, "
                    "expected_selling_price=%s",
                    car_data.get("make_year"),
                    car_data.get("kilometer_driven"),
                    car_data.get("expected_selling_price"),
                )

                if "make_year" in car_data:
                    car_data["make_year"] = deps.to_int(
                        car_data.get("make_year"),
                        "make_year",
                        minimum=deps.minimum_allowed_year,
                        maximum=deps.current_year() + 1,
                        allow_empty=False,
                    )
                if "kilometer_driven" in car_data:
                    car_data["kilometer_driven"] = deps.to_int(
                        car_data.get("kilometer_driven"),
                        "kilometer_driven",
                        minimum=0,
                    )
                if "expected_selling_price" in car_data:
                    car_data["expected_selling_price"] = deps.to_int(
                        car_data.get("expected_selling_price"),
                        "expected_selling_price",
                        minimum=0,
                        allow_empty=False,
                    )
                if "regional_spec" in car_data:
                    car_data["regional_spec"] = deps.normalize_regional_spec(
                        car_data.get("regional_spec")
                    )
                if (
                    "transmission_type" in car_data
                    and car_data.get("transmission_type")
                    and car_data["transmission_type"]
                    not in deps.car_transmission_options
                ):
                    deps.logger.error(
                        "Invalid transmission_type: %s",
                        car_data.get("transmission_type"),
                    )
                    return jsonify(
                        {"error": "Transmission must be Automatic or Manual"}
                    ), 400

                if (
                    "fuel_type" in car_data
                    and car_data.get("fuel_type")
                    and not deps.is_valid_car_fuel_type(car_data["fuel_type"])
                ):
                    deps.logger.error(
                        "Invalid fuel_type: %s", car_data.get("fuel_type")
                    )
                    return jsonify(
                        {
                            "error": "Fuel type must be Petrol, Diesel, Electric, Hybrid, Other, or Other - <custom>"
                        }
                    ), 400

                if (
                    "steering_side" in car_data
                    and car_data.get("steering_side")
                    and car_data["steering_side"] not in deps.steering_side_options
                ):
                    deps.logger.error(
                        "Invalid steering_side: %s", car_data.get("steering_side")
                    )
                    return jsonify(
                        {"error": "Steering side must be Left or Right"}
                    ), 400

                deps.validate_description_word_count(
                    car_data.get("car_description"), field_name="car_description"
                )
                deps.validate_no_profanity(
                    car_data.get("listing_title"), field_name="listing_title"
                )
                deps.validate_no_profanity(
                    car_data.get("car_description"), field_name="car_description"
                )
                deps.logger.info("All validations passed")
            except ValueError as validation_error:
                deps.logger.error("Validation error: %s", validation_error)
                return jsonify({"error": str(validation_error)}), 400

            extras = car_data.get("extras", [])
            car_data["extras"] = extras
            for db_field in _EXTRAS_MAPPING.values():
                car_data[db_field] = False
            for extra in extras:
                if extra in _EXTRAS_MAPPING:
                    car_data[_EXTRAS_MAPPING[extra]] = True

            images = car_data.pop("images", [])
            sync_error = deps.sync_gate_error("car", car_data, len(images))
            if sync_error:
                return sync_error

            car_data = {
                key: value
                for key, value in car_data.items()
                if key in _ALLOWED_CAR_FIELDS
            }
            car_data["user_email"] = deps.get_user_email(current_user)
            car_data["status"] = deps.initial_listing_status()
            car_data.setdefault("auto_review_reasons", [])

            if not images or len(images) == 0:
                return jsonify(
                    {"error": "At least one image is required for a car listing."}
                ), 400

            deps.logger.info("Creating car with data: %s", car_data)
            data, status_code = deps.create_listing_with_lifecycle_fallback(
                "/rest/v1/cars", car_data, user_id=current_user
            )
            deps.logger.info(
                "Database insert result: status=%s, data=%s", status_code, data
            )

            if status_code >= 400:
                friendly_data, friendly_status = deps.friendly_db_error(
                    data, status_code, "car"
                )
                return jsonify(friendly_data), friendly_status

            car_id = data[0]["id"]
            image_inserts = []
            for image_entry in images:
                if isinstance(image_entry, str):
                    image_url = image_entry
                    display_url = image_url
                    normalized_crop = deps.normalize_crop_settings({})
                    crop_meta = None
                elif isinstance(image_entry, dict):
                    image_url = image_entry.get("image_url") or image_entry.get("url")
                    if not image_url:
                        continue
                    display_url = image_entry.get("display_url") or image_url
                    normalized_crop = deps.normalize_crop_settings(image_entry)
                    crop_meta = image_entry.get("crop_meta")
                else:
                    continue

                image_inserts.append(
                    {
                        "car_id": car_id,
                        "url": image_url,
                        "image_url": image_url,
                        "display_url": display_url,
                        "focal_x": normalized_crop["focal_x"],
                        "focal_y": normalized_crop["focal_y"],
                        "crop_meta": crop_meta,
                        "cropped_at": deps.isoformat_utc(deps.utc_now()),
                    }
                )

            if not image_inserts:
                deps.supabase_request(
                    "delete",
                    "/rest/v1/cars",
                    params={"id": f"eq.{car_id}"},
                    user_id=current_user,
                )
                return jsonify(
                    {"error": "At least one valid image is required."}
                ), 400

            images_data, images_status = deps.supabase_request(
                "post",
                "/rest/v1/car_images",
                data=image_inserts,
                user_id=current_user,
            )
            if images_status < 400:
                data[0]["images"] = deps.sort_listing_images(images_data)
            else:
                deps.logger.error(
                    "Bulk image insert failed for car %s: %s - %s",
                    car_id,
                    images_status,
                    images_data,
                )
                inserted_images = []
                for image_insert in image_inserts:
                    img_resp, img_status = deps.supabase_request(
                        "post",
                        "/rest/v1/car_images",
                        data=image_insert,
                        user_id=current_user,
                    )
                    if img_status < 400 and img_resp:
                        if isinstance(img_resp, list):
                            inserted_images.extend(img_resp)
                        else:
                            inserted_images.append(img_resp)
                    else:
                        deps.logger.error(
                            "Image insert failed for car %s: %s - %s",
                            car_id,
                            img_status,
                            img_resp,
                        )

                if not inserted_images:
                    deps.supabase_request(
                        "delete",
                        "/rest/v1/cars",
                        params={"id": f"eq.{car_id}"},
                        user_id=current_user,
                    )
                    return jsonify(
                        {"error": "Failed to save listing images. Please try again."}
                    ), 500

                data[0]["images"] = deps.sort_listing_images(inserted_images)

            try:
                user_details = deps.get_user_email_by_id(current_user)
                user_email = user_details.get("email") if user_details else None
                if deps.initial_listing_status() == "pending":
                    deps.send_new_listing_admin_notification(
                        "car", data[0], user_email
                    )
                if user_email:
                    deps.send_new_listing_user_confirmation(
                        user_email, "car", data[0]
                    )
            except Exception as email_error:
                deps.logger.warning(
                    "Failed to send listing notification emails: %s", email_error
                )

            deps.invalidate_public_inventory_cache("cars")
            deps.trigger_auto_review_async()
            deps.capture_posthog_event(
                "listing_created",
                current_user,
                {
                    "listing_type": "car",
                    "has_images": bool(images),
                    "is_dealer": bool(car_data.get("is_dealer")),
                    "submission_status": data[0].get("status"),
                },
            )
            return jsonify(data[0]), 201
        except Exception as error:
            route_logger = deps.logger if deps is not None else logging.getLogger(__name__)
            route_logger.error("Error creating car listing: %s", error)
            return jsonify({"error": str(error)}), 500

    return create_car
