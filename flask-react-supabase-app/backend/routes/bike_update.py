"""Authenticated bike listing update and delete routes."""

from functools import wraps

from flask import Blueprint, current_app, jsonify, request


bike_update_bp = Blueprint("bike_update", __name__)


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


@bike_update_bp.route("/api/bikes/<string:bike_id>", methods=["PUT", "PATCH", "POST"])
@_token_required
def update_bike(current_user, bike_id):
    try:
        if not request.json:
            return jsonify({"error": "Invalid request data"}), 400

        bike_data, bike_status = supabase_request(
            "get",
            "/rest/v1/bikes",
            params={"select": "user_id", "id": f"eq.{bike_id}", "limit": 1},
            user_id=current_user,
        )
        if bike_status >= 400:
            return jsonify(bike_data), bike_status
        if not bike_data:
            return jsonify({"error": "Bike not found"}), 404
        if bike_data[0]["user_id"] != current_user:
            return jsonify(
                {"error": "You do not have permission to update this bike"}
            ), 403

        update_data = request.json
        images = update_data.pop("images", None)
        _normalize_listing_vin(update_data)

        if "make" in update_data and "bike_brand" not in update_data:
            update_data["bike_brand"] = update_data.get("make")
        if "model" in update_data and "bike_model" not in update_data:
            update_data["bike_model"] = update_data.get("model")
        if "contact_phone" in update_data and "contact_number" not in update_data:
            update_data["contact_number"] = update_data.get("contact_phone")
        if "engine_capacity" in update_data and "engine_size" not in update_data:
            update_data["engine_size"] = update_data.get("engine_capacity")
        if "area" not in update_data and update_data.get("location"):
            update_data["area"] = update_data.get("location")
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "bikes")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        try:
            if "year" in update_data:
                update_data["year"] = _to_int(
                    update_data.get("year"),
                    "year",
                    minimum=MIN_ALLOWED_YEAR,
                    maximum=datetime.datetime.now().year + 1,
                    allow_empty=False,
                )
            if "price" in update_data:
                update_data["price"] = _to_int(update_data.get("price"), "price", minimum=0)
            if "mileage" in update_data:
                update_data["mileage"] = _to_int(update_data.get("mileage"), "mileage", minimum=0)
            if "description" in update_data:
                _validate_description_word_count(update_data.get("description"), field_name="description")
                _validate_no_profanity(update_data.get("description"), field_name="description")
            if "bike_brand" in update_data:
                _validate_no_profanity(update_data.get("bike_brand"), field_name="bike_brand")
            if "bike_model" in update_data:
                _validate_no_profanity(update_data.get("bike_model"), field_name="bike_model")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        allowed_fields = {
            "bike_brand", "bike_model", "bike_type", "make", "model", "year",
            "mileage", "engine_size", "color", "price", "location", "area",
            "emirate", "contact_number", "contact_phone", "vin_number",
            "whatsapp_number", "whatsapp_prefill_text", "description",
            "transmission", "fuel_type", "features", "cylinders", "wheels",
            "is_dealer", "registration_doc_url",
        }
        update_data.pop("id", None)
        update_data = {key: value for key, value in update_data.items() if key in allowed_fields}

        if "price" in update_data and update_data["price"] is not None:
            _maybe_record_price_drop("bikes", bike_id, update_data["price"])
            _record_price_point("bikes", bike_id, update_data["price"])

        data, status_code = supabase_request(
            "patch",
            "/rest/v1/bikes",
            params={"id": f"eq.{bike_id}"},
            data=update_data,
            user_id=current_user,
        )
        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(data, status_code, "bike")
            return jsonify(friendly_data), friendly_status

        if images is not None:
            existing_images_resp, existing_images_status = supabase_request(
                "get",
                "/rest/v1/bike_images",
                params={"select": "id", "bike_id": f"eq.{bike_id}"},
                user_id=current_user,
            )
            existing_image_ids = (
                [row["id"] for row in existing_images_resp if isinstance(row, dict) and row.get("id")]
                if existing_images_status < 400 and isinstance(existing_images_resp, list)
                else []
            )
            image_inserts = []
            for image_url in images:
                if isinstance(image_url, dict):
                    url_value = image_url.get("image_url") or image_url.get("url") or image_url.get("display_url")
                    if not url_value:
                        continue
                    image_inserts.append({
                        "bike_id": bike_id,
                        "url": image_url.get("url") or url_value,
                        "image_url": image_url.get("image_url") or url_value,
                        "display_url": image_url.get("display_url"),
                        "focal_x": image_url.get("focal_x"),
                        "focal_y": image_url.get("focal_y"),
                        "crop_meta": image_url.get("crop_meta"),
                        "cropped_at": _isoformat_utc(_utc_now()),
                    })
                else:
                    image_inserts.append({
                        "bike_id": bike_id,
                        "url": image_url,
                        "image_url": image_url,
                        "cropped_at": _isoformat_utc(_utc_now()),
                    })

            inserted_rows = []
            if image_inserts:
                bulk_resp, bulk_status = supabase_request(
                    "post", "/rest/v1/bike_images", data=image_inserts, user_id=current_user
                )
                if bulk_status < 400:
                    inserted_rows = bulk_resp if isinstance(bulk_resp, list) else [bulk_resp] if isinstance(bulk_resp, dict) else []
                else:
                    for image_insert in image_inserts:
                        single_resp, single_status = supabase_request(
                            "post", "/rest/v1/bike_images", data=image_insert, user_id=current_user
                        )
                        if single_status < 400 and single_resp:
                            inserted_rows.extend(single_resp if isinstance(single_resp, list) else [single_resp])
                    if not inserted_rows:
                        logger.error("Failed to replace bike images for %s: %s - %s", bike_id, bulk_status, bulk_resp)
                        return jsonify({"error": "Failed to save listing images."}), 500

            if existing_image_ids:
                inserted_ids = {row.get("id") for row in inserted_rows if isinstance(row, dict) and row.get("id")}
                to_delete = [image_id for image_id in existing_image_ids if image_id not in inserted_ids]
                if to_delete:
                    quoted_ids = ",".join(f'"{image_id}"' for image_id in to_delete)
                    supabase_request(
                        "delete", "/rest/v1/bike_images", params={"id": f"in.({quoted_ids})"}, user_id=current_user
                    )

        updated_bike, updated_status = supabase_request(
            "get", "/rest/v1/bikes", params={"select": "*", "id": f"eq.{bike_id}", "limit": 1}, user_id=current_user
        )
        if updated_status >= 400 or not updated_bike:
            return jsonify({"message": "Bike updated successfully"}), 200
        bike = updated_bike[0]
        images_data, images_status = supabase_request(
            "get", "/rest/v1/bike_images", params={"select": "*", "bike_id": f"eq.{bike_id}"}, user_id=current_user
        )
        bike["images"] = images_data if images_status < 400 else []

        try:
            user_email = bike.get("user_email") or bike.get("contact_email") or get_user_email(current_user)
            if user_email and EMAIL_REGEX.match(user_email):
                _, email_error = _send_listing_status_email(user_email, "bikes", bike, "updated", request.headers.get("Origin"))
                if email_error:
                    logger.error("Edit email failed for bike %s: %s", bike_id, email_error)
                else:
                    logger.info("Edit email sent for bike %s", bike_id)
        except Exception as email_err:
            logger.error("Error sending edit email: %s", email_err)

        _invalidate_public_inventory_cache("bikes")
        _invalidate_api_cache_prefixes([f"/api/bikes/{bike_id}"])
        return jsonify(bike), 200
    except Exception as error:
        logger.error("Error updating bike: %s", error)
        return jsonify({"error": str(error)}), 500


@bike_update_bp.route("/api/bikes/<string:bike_id>", methods=["DELETE"])
@_token_required
def delete_bike(current_user, bike_id):
    try:
        delete_resp, delete_status = _delete_user_owned_listing(current_user, "bike", bike_id)
        if delete_status >= 400:
            return jsonify(delete_resp), delete_status
        _invalidate_public_inventory_cache("bikes")
        _invalidate_api_cache_prefixes([f"/api/bikes/{bike_id}"])
        return jsonify({"message": "Bike listing deleted successfully"}), 200
    except Exception as error:
        logger.error("Error deleting bike: %s", error)
        return jsonify({"error": str(error)}), 500


def register_bike_update_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request", "_normalize_listing_vin", "_require_whatsapp_prefill_and_phone_alignment",
        "_to_int", "_validate_description_word_count", "_validate_no_profanity", "MIN_ALLOWED_YEAR",
        "_maybe_record_price_drop", "_record_price_point", "_friendly_db_error", "_isoformat_utc", "_utc_now",
        "logger", "get_user_email", "EMAIL_REGEX", "_send_listing_status_email", "_invalidate_public_inventory_cache",
        "_invalidate_api_cache_prefixes", "_delete_user_owned_listing", "datetime",
    ):
        value = backend_symbols[name]
        if callable(value):
            def _live_helper(*args, _name=name, **kwargs):
                return backend_symbols[_name](*args, **kwargs)
            globals()[name] = _live_helper
    app.register_blueprint(bike_update_bp)
