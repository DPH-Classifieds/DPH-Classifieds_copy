"""Authenticated plate creation with root-supplied runtime dependencies."""

import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request
from werkzeug.utils import secure_filename


@dataclass(frozen=True, slots=True)
class PlateCreateDependencies:
    """Runtime collaborators retained by the compatibility root."""

    require_verified_user_for_listing: Callable[[str], Any]
    require_dealer_verified: Callable[[str], Any]
    enforce_listing_limit: Callable[[str], Any]
    to_int: Callable[..., int | None]
    validate_description_word_count: Callable[..., Any]
    validate_no_profanity: Callable[..., Any]
    validate_private_document_path: Callable[..., bool]
    get_user_email: Callable[[str], str]
    initial_listing_status: Callable[[], str]
    new_listing_lifecycle_fields: Callable[[], dict[str, Any]]
    require_whatsapp_prefill_and_phone_alignment: Callable[
        [dict[str, Any], str], Any
    ]
    sync_gate_error: Callable[[str, dict[str, Any], int], Any]
    create_listing_with_lifecycle_fallback: Callable[..., tuple[Any, int]]
    friendly_db_error: Callable[[Any, int, str], tuple[Any, int]]
    supabase_request: Callable[..., tuple[Any, int]]
    get_user_email_by_id: Callable[[str], dict[str, Any] | None]
    send_new_listing_admin_notification: Callable[[str, dict[str, Any], Any], Any]
    send_new_listing_user_confirmation: Callable[[str, str, dict[str, Any]], Any]
    invalidate_public_inventory_cache: Callable[[str], Any]
    trigger_auto_review_async: Callable[[], Any]
    logger: logging.Logger


def _generate_plate_image(*, plate_id, city, code, plate_number_str):
    """Generate the legacy static image, returning its public relative URL."""

    from PIL import Image, ImageDraw, ImageFont

    plate_dir = os.path.join("static", "uploads", "plates", str(plate_id))
    os.makedirs(plate_dir, exist_ok=True)

    plate_width, plate_height = 600, 200
    plate_img = Image.new(
        "RGB", (plate_width, plate_height), color=(255, 255, 255)
    )
    draw = ImageDraw.Draw(plate_img)
    draw.rectangle(
        [(0, 0), (plate_width - 1, plate_height - 1)],
        outline=(0, 0, 0),
        width=5,
    )

    try:
        font_path = os.path.join("static", "fonts", "arial.ttf")
        if not os.path.exists(font_path):
            import matplotlib.font_manager as fm

            font_path = fm.findfont(fm.FontProperties(family="Arial"))
        font = ImageFont.truetype(font_path, 50)
    except Exception:
        font = ImageFont.load_default()

    text = f"{city} {code} {plate_number_str}"
    text_width = draw.textlength(text, font=font)
    draw.text(
        ((plate_width - text_width) / 2, plate_height / 3),
        text,
        fill=(0, 0, 0),
        font=font,
    )

    # Keep the legacy filename shape while bounding user-controlled path parts.
    image_filename = secure_filename(
        f"plate_{city}_{code}_{plate_number_str}.png"
    )
    image_path = os.path.join(plate_dir, image_filename)
    plate_img.save(image_path)
    return f"/static/uploads/plates/{plate_id}/{image_filename}"


def register_plate_create_route(
    app: Flask,
    *,
    token_required: Callable[[Callable[..., Any]], Callable[..., Any]],
    dependencies: Callable[[], PlateCreateDependencies],
) -> dict[str, Callable[..., Any]]:
    """Register both authenticated plate-create URLs."""

    def create_plate_impl(current_user):
        deps = None
        try:
            deps = dependencies()
            deps.logger.info("Creating plate listing with image upload")

            verification_check = deps.require_verified_user_for_listing(current_user)
            if verification_check:
                return verification_check

            dealer_check = deps.require_dealer_verified(current_user)
            if dealer_check:
                return dealer_check

            payload = (
                request.form
                if request.form
                else (request.get_json(silent=True) or {})
            )

            city = payload.get("city")
            code = payload.get("code")
            digits = payload.get("digits")
            price = payload.get("price")
            number = payload.get("number")
            plate_format = payload.get("plate_format")
            contact_name = payload.get("contact_name")
            contact_phone = payload.get("contact_phone")
            country_code = payload.get("country_code")
            whatsapp_number = payload.get("whatsapp_number")
            whatsapp_prefill_text = payload.get("whatsapp_prefill_text")
            description = payload.get("description")
            area = payload.get("area")
            emirate = payload.get("emirate")
            is_dealer = payload.get("is_dealer", False)
            if isinstance(is_dealer, str):
                is_dealer = is_dealer.lower() == "true"

            if not city or not code or not digits or price in [None, ""]:
                return jsonify({"error": "Missing required fields"}), 400

            try:
                digits = deps.to_int(
                    digits, "digits", minimum=1, maximum=5, allow_empty=False
                )
                price = deps.to_int(
                    price, "price", minimum=0, allow_empty=False
                )
                if number is not None and str(number).strip() != "":
                    if not str(number).isdigit():
                        return jsonify(
                            {"error": "Plate number must contain digits only"}
                        ), 400
                deps.validate_description_word_count(
                    description, field_name="description"
                )
                deps.validate_no_profanity(
                    description, field_name="description"
                )
                deps.validate_no_profanity(
                    contact_name, field_name="contact_name"
                )
            except ValueError as validation_error:
                return jsonify({"error": str(validation_error)}), 400

            limit_response = deps.enforce_listing_limit(current_user)
            if limit_response:
                return limit_response

            plate_number_str = str(number).strip() if number is not None else ""
            proof_document_url = payload.get("proof_document_url") or None
            if proof_document_url and not deps.validate_private_document_path(
                proof_document_url, current_user, required_prefix="plate-proofs"
            ):
                return jsonify(
                    {
                        "error": "proof_document_url must be a server-issued private document path"
                    }
                ), 400
            registration_doc_url = payload.get("registration_doc_url") or None
            plate_data = {
                "city": city,
                "code": code,
                "digits": digits,
                "price": price,
                "number": plate_number_str,
                "plate_format": plate_format,
                "contact_name": contact_name,
                "contact_phone": contact_phone,
                "country_code": country_code,
                "whatsapp_number": whatsapp_number,
                "whatsapp_prefill_text": whatsapp_prefill_text,
                "description": description,
                "area": area,
                "emirate": emirate,
                "is_dealer": is_dealer,
                "listing_title": f"{city} {code} {plate_number_str}".strip(),
                "user_id": current_user,
                "user_email": deps.get_user_email(current_user),
                "status": deps.initial_listing_status(),
                **(
                    {"proof_document_url": proof_document_url}
                    if proof_document_url
                    else {}
                ),
                **(
                    {"registration_doc_url": registration_doc_url}
                    if registration_doc_url
                    else {}
                ),
            }
            plate_data.update(deps.new_listing_lifecycle_fields())
            plate_data.setdefault("auto_review_reasons", [])
            try:
                deps.require_whatsapp_prefill_and_phone_alignment(
                    plate_data, "plates"
                )
            except ValueError as validation_error:
                return jsonify({"error": str(validation_error)}), 400

            sync_error = deps.sync_gate_error("plate", plate_data, 1)
            if sync_error:
                return sync_error

            response, status_code = deps.create_listing_with_lifecycle_fallback(
                "/rest/v1/license_plates", plate_data, user_id=current_user
            )
            if status_code >= 400:
                friendly_data, friendly_status = deps.friendly_db_error(
                    response, status_code, "plate"
                )
                return jsonify(friendly_data), friendly_status

            plate_id = response[0]["id"]
            try:
                image_url = _generate_plate_image(
                    plate_id=plate_id,
                    city=city,
                    code=code,
                    plate_number_str=plate_number_str,
                )
                response[0]["image_url"] = image_url
                image_data = {
                    "plate_id": plate_id,
                    "url": image_url,
                    "image_url": image_url,
                    "is_primary": True,
                }
                image_response, image_status = deps.supabase_request(
                    "post",
                    "/rest/v1/plate_images",
                    data=image_data,
                    user_id=current_user,
                )
                if image_status >= 400:
                    deps.logger.error(
                        "Failed to add plate image record: %s", image_response
                    )
            except Exception as image_error:
                deps.logger.warning(
                    "Plate PIL image generation skipped (non-fatal): %s",
                    image_error,
                )

            try:
                user_details = deps.get_user_email_by_id(current_user)
                user_email = user_details.get("email") if user_details else None
                if deps.initial_listing_status() == "pending":
                    deps.send_new_listing_admin_notification(
                        "plate", response[0], user_email
                    )
                if user_email:
                    deps.send_new_listing_user_confirmation(
                        user_email, "plate", response[0]
                    )
            except Exception as email_error:
                deps.logger.warning(
                    "Failed to send listing notification emails: %s", email_error
                )

            deps.invalidate_public_inventory_cache("plates")
            deps.trigger_auto_review_async()
            return jsonify(response[0]), 201
        except Exception as error:
            route_logger = (
                deps.logger if deps is not None else logging.getLogger(__name__)
            )
            route_logger.error("Error creating plate with image: %s", error)
            return jsonify({"error": str(error)}), 500

    @app.route("/api/plates", methods=["POST"])
    @token_required
    def create_plate(current_user):
        return create_plate_impl(current_user)

    @app.route("/api/plates/with-image", methods=["POST"])
    @token_required
    def create_plate_with_image(current_user):
        return create_plate_impl(current_user)

    return {
        "create_plate": create_plate,
        "create_plate_with_image": create_plate_with_image,
    }
