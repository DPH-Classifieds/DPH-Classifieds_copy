"""Authenticated car listing update route."""

from functools import wraps

from flask import Blueprint, current_app, jsonify, request


car_update_bp = Blueprint("car_update", __name__)


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


@car_update_bp.route("/api/cars/<string:car_id>/update", methods=["POST"])
@car_update_bp.route("/api/cars/<string:car_id>", methods=["PUT", "PATCH", "POST"])
@_token_required
def update_car(current_user, car_id):
    try:
        logger.info(f"Updating car {car_id} for user {current_user}")

        # Check if this is FormData or JSON
        is_form_data = (
            request.content_type and "multipart/form-data" in request.content_type
        )

        # Also treat as form data if request.form has fields (some proxies strip content-type)
        if not is_form_data and request.form:
            is_form_data = True

        # Try JSON as fallback
        parsed_json = None
        try:
            parsed_json = request.get_json(silent=True)
        except Exception:
            pass

        if not is_form_data and not parsed_json:
            return jsonify(
                {"error": "Invalid request data", "content_type": request.content_type}
            ), 400

        # Verify car ownership
        car_data, car_status = supabase_request(
            "get",
            f"/rest/v1/cars",
            params={"select": "user_id", "id": f"eq.{car_id}", "limit": 1},
            user_id=current_user,
        )

        if car_status >= 400:
            return jsonify(car_data), car_status

        if not car_data:
            return jsonify({"error": "Car not found"}), 404

        if car_data[0]["user_id"] != current_user:
            return jsonify(
                {"error": "You do not have permission to update this car"}
            ), 403

        # Extract data based on content type
        if is_form_data:
            logger.info("Processing FormData request")
            update_data = {}
            images = None

            # Extract form fields
            for key in request.form.keys():
                value = request.form.get(key)
                if key in ["keep_image_ids", "crop_data"]:
                    continue
                if value in ["undefined", "null"]:
                    continue
                if value == "":
                    continue
                # Convert boolean strings
                if value == "true":
                    update_data[key] = True
                elif value == "false":
                    update_data[key] = False
                # Convert numeric strings
                elif (
                    key
                    in [
                        "make_year",
                        "mileage",
                        "expected_selling_price",
                        "price",
                        "kilometer_driven",
                    ]
                    and value.lstrip("-").isdigit()
                ):
                    update_data[key] = int(value)
                else:
                    update_data[key] = value

            logger.info(f"Extracted form data: {update_data}")

            # Handle extras array (multiple checkboxes with same name)
            if "extras[]" in request.form:
                extras_list = request.form.getlist("extras[]")
                update_data["extras"] = extras_list

                # Also map to boolean columns for backward compatibility
                extras_mapping = {
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

                # Set all extras boolean fields to False first
                for db_field in extras_mapping.values():
                    update_data[db_field] = False

                # Set selected extras to True
                for extra in extras_list:
                    if extra in extras_mapping:
                        update_data[extras_mapping[extra]] = True

            # Handle new images
            new_images = (
                request.files.getlist("images") if "images" in request.files else []
            )
            keep_image_ids = request.form.getlist("keep_image_ids")
            crop_data = _parse_crop_data_payload(
                request.form.get("crop_data"), len(new_images)
            )

        else:
            logger.info("Processing JSON request")
            update_data = parsed_json or {}
            new_images = []
            keep_image_ids = []
            crop_data = []
            images = update_data.pop("images", None)

        _normalize_listing_vin(update_data)

        # Normalize legacy/alternate frontend keys.
        if "description" in update_data and "car_description" not in update_data:
            update_data["car_description"] = update_data.pop("description")
        if "location" in update_data and "car_location" not in update_data:
            update_data["car_location"] = update_data.get("location")
        if "location" in update_data and "car_city" not in update_data:
            update_data["car_city"] = update_data.get("location")
        if "location" in update_data and "area" not in update_data:
            update_data["area"] = update_data.get("location")
        if (
            "contact_phone" in update_data
            and "car_owner_phone_number" not in update_data
        ):
            update_data["car_owner_phone_number"] = update_data.get("contact_phone")
        if "car_variant" in update_data and "trim" not in update_data:
            update_data["trim"] = update_data.get("car_variant")
        if "exterior_color" in update_data and "color" not in update_data:
            update_data["color"] = update_data.get("exterior_color")
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "cars")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        try:
            if "make_year" in update_data:
                update_data["make_year"] = _to_int(
                    update_data.get("make_year"),
                    "make_year",
                    minimum=MIN_ALLOWED_YEAR,
                    maximum=datetime.datetime.now().year + 1,
                    allow_empty=False,
                )
            if "mileage" in update_data and "kilometer_driven" not in update_data:
                update_data["kilometer_driven"] = _to_int(
                    update_data.get("mileage"), "kilometer_driven", minimum=0
                )
            if "kilometer_driven" in update_data:
                update_data["kilometer_driven"] = _to_int(
                    update_data.get("kilometer_driven"), "kilometer_driven", minimum=0
                )
            if "expected_selling_price" in update_data:
                update_data["expected_selling_price"] = _to_int(
                    update_data.get("expected_selling_price"),
                    "expected_selling_price",
                    minimum=0,
                )
            if "regional_spec" in update_data:
                update_data["regional_spec"] = _normalize_regional_spec(
                    update_data.get("regional_spec")
                )
            if "transmission_type" in update_data and update_data.get(
                "transmission_type"
            ):
                if update_data["transmission_type"] not in CAR_TRANSMISSION_OPTIONS:
                    return jsonify(
                        {"error": "Transmission must be Automatic or Manual"}
                    ), 400
            # Validate fuel_type if provided
            if "fuel_type" in update_data and update_data.get("fuel_type"):
                if not _is_valid_car_fuel_type(update_data["fuel_type"]):
                    return jsonify(
                        {
                            "error": "Fuel type must be Petrol, Diesel, Electric, Hybrid, Other, or Other - <custom>"
                        }
                    ), 400
            # Validate steering_side if provided
            if "steering_side" in update_data and update_data.get("steering_side"):
                if update_data["steering_side"] not in STEERING_SIDE_OPTIONS:
                    return jsonify(
                        {"error": "Steering side must be Left or Right"}
                    ), 400
            if "car_description" in update_data:
                _validate_description_word_count(
                    update_data.get("car_description"), field_name="car_description"
                )
                _validate_no_profanity(
                    update_data.get("car_description"), field_name="car_description"
                )
            if "description" in update_data and "car_description" not in update_data:
                _validate_description_word_count(
                    update_data.get("description"), field_name="car_description"
                )
                _validate_no_profanity(
                    update_data.get("description"), field_name="car_description"
                )
                update_data["car_description"] = update_data.pop("description")
            if "listing_title" in update_data:
                _validate_no_profanity(
                    update_data.get("listing_title"), field_name="listing_title"
                )
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Whitelist allowed columns (cars schema)
        allowed_fields = {
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
            "registration_document_url",
        }
        # Sanitize update data to ensure 'id' is NOT sent to Supabase as part of the body
        # (Supabase/PostgREST rejects updates where the primary key is in the body)
        update_data.pop("id", None)

        # Strictly apply allowed fields filter
        update_data = {k: v for k, v in update_data.items() if k in allowed_fields}

        if "expected_selling_price" in update_data and update_data["expected_selling_price"] is not None:
            _maybe_record_price_drop("cars", car_id, update_data["expected_selling_price"])
            _record_price_point("cars", car_id, update_data["expected_selling_price"])

        # Update the car using PATCH for partial update
        data, status_code = supabase_request(
            "patch",
            f"/rest/v1/cars",
            params={"id": f"eq.{car_id}"},
            data=update_data,
            user_id=current_user,
        )

        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(data, status_code, "car")
            return jsonify(friendly_data), friendly_status

        # Handle image updates for FormData requests
        if is_form_data and (new_images or keep_image_ids):
            logger.info(
                f"Managing images: keeping {len(keep_image_ids)} existing, uploading {len(new_images)} new"
            )

            # Get all current images
            current_images_resp, current_images_status = supabase_request(
                "get",
                "/rest/v1/car_images",
                params={"select": "*", "car_id": f"eq.{car_id}"},
                user_id=current_user,
            )

            current_images = current_images_resp if current_images_status < 400 else []
            kept_images = [img for img in current_images if img["id"] in keep_image_ids]

            upload_failures = []
            inserted_new_images = 0

            # Upload new images
            if new_images:
                if not ensure_storage_bucket("listing-images"):
                    return jsonify({"error": "Storage bucket not available."}), 500

                # Check if any kept image is primary
                has_primary_kept = any(
                    img.get("is_primary", False) for img in kept_images
                )
                primary_assigned = has_primary_kept

                for index, file in enumerate(new_images):
                    if file and file.filename:
                        upload_metadata, upload_error = upload_to_supabase_storage(
                            file,
                            bucket_name="listing-images",
                            folder=str(current_user),
                            return_metadata=True,
                            crop_settings=crop_data[index],
                        )

                        if upload_error:
                            message = f"Failed to upload new image {file.filename}: {upload_error}"
                            logger.error(message)
                            upload_failures.append(message)
                            continue

                        image_data = {
                            "car_id": car_id,
                            "url": upload_metadata["url"],
                            "image_url": upload_metadata["image_url"],
                            "display_url": upload_metadata.get("display_url"),
                            "focal_x": upload_metadata.get("focal_x", 50),
                            "focal_y": upload_metadata.get("focal_y", 50),
                            "crop_meta": upload_metadata.get("crop_meta"),
                            "cropped_at": _isoformat_utc(_utc_now()),
                        }

                        image_insert_response, image_insert_status = supabase_request(
                            "post",
                            "/rest/v1/car_images",
                            data=image_data,
                            user_id=current_user,
                        )
                        if image_insert_status >= 400:
                            message = (
                                f"Failed to save image metadata for {file.filename}: "
                                f"{image_insert_status} - {image_insert_response}"
                            )
                            logger.error(message)
                            upload_failures.append(message)
                            continue

                        inserted_new_images += 1
                        primary_assigned = True

                if upload_failures and inserted_new_images == 0 and not kept_images:
                    return jsonify(
                        {
                            "error": "All uploaded images failed to save. Existing images were kept.",
                            "details": upload_failures,
                        }
                    ), 500

            # Delete images not in keep_image_ids after new uploads succeed.
            for img in current_images:
                if img["id"] not in keep_image_ids:
                    logger.info(f"Deleting image {img['id']}")
                    supabase_request(
                        "delete",
                        "/rest/v1/car_images",
                        params={"id": f"eq.{img['id']}"},
                        user_id=current_user,
                    )

        elif not is_form_data and images is not None:
            image_inserts = []
            for image_entry in images:
                if isinstance(image_entry, str):
                    image_url = image_entry
                    display_url = image_url
                    normalized_crop = _normalize_crop_settings({})
                    crop_meta = None
                elif isinstance(image_entry, dict):
                    image_url = image_entry.get("image_url") or image_entry.get("url")
                    if not image_url:
                        continue
                    display_url = image_entry.get("display_url") or image_url
                    normalized_crop = _normalize_crop_settings(image_entry)
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
                        "cropped_at": _isoformat_utc(_utc_now()),
                    }
                )

            if not image_inserts:
                return jsonify({"error": "At least one valid image is required."}), 400

            # Snapshot existing image IDs BEFORE inserting replacements so we can
            # delete them only after the new rows land. If the insert fails we
            # leave the originals intact rather than wiping the listing.
            existing_images_resp, existing_images_status = supabase_request(
                "get",
                "/rest/v1/car_images",
                params={"select": "id", "car_id": f"eq.{car_id}"},
                user_id=current_user,
            )
            existing_image_ids = (
                [row["id"] for row in existing_images_resp if isinstance(row, dict) and row.get("id")]
                if existing_images_status < 400 and isinstance(existing_images_resp, list)
                else []
            )

            images_response, images_status = supabase_request(
                "post",
                "/rest/v1/car_images",
                data=image_inserts,
                user_id=current_user,
            )

            inserted_rows = []
            if images_status >= 400:
                for image_insert in image_inserts:
                    single_image_response, single_image_status = supabase_request(
                        "post",
                        "/rest/v1/car_images",
                        data=image_insert,
                        user_id=current_user,
                    )
                    if single_image_status < 400 and single_image_response:
                        if isinstance(single_image_response, list):
                            inserted_rows.extend(single_image_response)
                        else:
                            inserted_rows.append(single_image_response)

                if not inserted_rows:
                    logger.error(
                        f"Failed to replace car images for {car_id}: "
                        f"{images_status} - {images_response}"
                    )
                    # No new rows landed → leave originals untouched.
                    return jsonify({"error": "Failed to save listing images."}), 500
            else:
                if isinstance(images_response, list):
                    inserted_rows = images_response
                elif isinstance(images_response, dict):
                    inserted_rows = [images_response]

            # New rows are persisted; safe to drop the originals now.
            if existing_image_ids:
                inserted_ids = {
                    row.get("id")
                    for row in inserted_rows
                    if isinstance(row, dict) and row.get("id")
                }
                to_delete = [img_id for img_id in existing_image_ids if img_id not in inserted_ids]
                if to_delete:
                    quoted_ids = ",".join(f'"{img_id}"' for img_id in to_delete)
                    supabase_request(
                        "delete",
                        "/rest/v1/car_images",
                        params={"id": f"in.({quoted_ids})"},
                        user_id=current_user,
                    )

            images_data = _sort_listing_images(inserted_rows)

        # Get updated car with images
        updated_car, updated_status = supabase_request(
            "get",
            f"/rest/v1/cars",
            params={"select": "*", "id": f"eq.{car_id}", "limit": 1},
            user_id=current_user,
        )

        if updated_status >= 400 or not updated_car:
            return jsonify({"message": "Car updated successfully"}), 200

        car = updated_car[0]

        # Get car images
        images_data, images_status = supabase_request(
            "get",
            "/rest/v1/car_images",
            params={
                "select": "*",
                "car_id": f"eq.{car_id}",
                "order": "uploaded_at.asc",
            },
            user_id=current_user,
        )

        if images_status < 400:
            # Transform url to image_url for frontend compatibility
            for image in images_data:
                if "url" in image and "image_url" not in image:
                    image["image_url"] = image["url"]
            car["images"] = _sort_listing_images(images_data)
        else:
            car["images"] = []

        # Send edit notification email
        try:
            user_email = car.get("user_email") or car.get("contact_email")
            if not user_email:
                user_email = get_user_email(current_user)
            if user_email and EMAIL_REGEX.match(user_email):
                _, email_error = _send_listing_status_email(
                    user_email,
                    "cars",
                    car,
                    "updated",
                    request.headers.get("Origin"),
                )
                if email_error:
                    logger.error(f"Edit email failed for car {car_id}: {email_error}")
                else:
                    logger.info(f"Edit email sent for car {car_id}")
        except Exception as email_err:
            logger.error(f"Error sending edit email: {email_err}")

        _invalidate_public_inventory_cache("cars")
        _invalidate_api_cache_prefixes([f"/api/cars/{car_id}"])
        return jsonify(car), 200
    except Exception as e:
        logger.error(f"Error updating car: {e}")
        return jsonify({"error": str(e)}), 500




def register_car_update_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_normalize_listing_vin",
        "_normalize_regional_spec",
        "_normalize_crop_settings",
        "_parse_crop_data_payload",
        "_sort_listing_images",
        "_to_int",
        "_validate_description_word_count",
        "_validate_no_profanity",
        "_require_whatsapp_prefill_and_phone_alignment",
        "_record_price_point",
        "_maybe_record_price_drop",
        "_invalidate_public_inventory_cache",
        "_invalidate_api_cache_prefixes",
        "_send_listing_status_email",
        "get_user_email",
        "_utc_now",
        "_isoformat_utc",
        "upload_to_supabase_storage",
        "ensure_storage_bucket",
        "_is_valid_car_fuel_type",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(car_update_bp)

