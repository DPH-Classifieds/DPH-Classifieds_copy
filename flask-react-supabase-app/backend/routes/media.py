"""Authenticated listing image upload routes."""

from functools import wraps

from flask import Blueprint, current_app, jsonify, request


media_bp = Blueprint("media", __name__)


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


@media_bp.route("/api/cars/<string:car_id>/images", methods=["POST"])
@_token_required
def upload_car_images(current_user, car_id):
    try:
        # Verify the car belongs to the user
        verify_query = f"/rest/v1/cars?id=eq.{car_id}&user_id=eq.{current_user}"
        verify_response, verify_status = supabase_request("get", verify_query)

        if verify_status >= 400 or not verify_response:
            return jsonify({"error": "Car not found or you don't have permission"}), 403

        # Process the images (in a real implementation, you would handle file uploads)
        data = request.json
        image_urls = data.get("image_urls", [])
        if not isinstance(image_urls, list) or len(image_urls) > PART_IMAGE_MAX_COUNT:
            return jsonify({"error": "Invalid image list"}), 400
        if any(not _validate_listing_image_entry(image_url, current_user) for image_url in image_urls):
            return jsonify({"error": "Images must be public listing uploads for this user"}), 400

        # Save each image URL to the database
        for index, image_url in enumerate(image_urls):
            image_data = {
                "car_id": car_id,
                "url": image_url,
                "image_url": image_url,  # Add image_url field for frontend compatibility
                "crop_meta": {"sort_index": index},
                "cropped_at": _isoformat_utc(_utc_now()),
            }
            supabase_request(
                "post", "/rest/v1/car_images", data=image_data, user_id=current_user
            )

        return jsonify({"message": f"{len(image_urls)} images uploaded successfully"})
    except Exception as e:
        logger.error(f"Error uploading images: {e}")
        return jsonify({"error": str(e)}), 500




@media_bp.route("/api/upload-images", methods=["POST"])
@_token_required
def upload_images(current_user):
    try:
        logger.info(f"Image upload request received from user: {current_user}")

        # Ensure storage bucket exists
        if not ensure_storage_bucket("listing-images"):
            logger.error("Failed to ensure storage bucket exists")
            return jsonify(
                {"error": "Storage bucket not available. Please try again later."}
            ), 500

        # Check if files were uploaded
        if "images" not in request.files:
            logger.error("No images field in request")
            return jsonify({"error": "No images provided"}), 400

        files = request.files.getlist("images")
        if not files or all(file.filename == "" for file in files):
            logger.error("No image files selected")
            return jsonify({"error": "No images selected"}), 400

        crop_data = _parse_crop_data_payload(request.form.get("crop_data"), len(files))

        logger.info(f"Processing {len(files)} images for user {current_user}")
        image_records = []
        image_urls = []
        errors = []

        for index, file in enumerate(files):
            if file and file.filename:
                upload_metadata, error = upload_to_supabase_storage(
                    file,
                    bucket_name="listing-images",
                    folder=str(current_user),
                    return_metadata=True,
                    crop_settings=crop_data[index],
                )

                if upload_metadata:
                    image_records.append(upload_metadata)
                    image_urls.append(upload_metadata["url"])
                else:
                    errors.append(f"Failed to upload {file.filename}: {error}")
                    logger.error(f"Failed to upload {file.filename}: {error}")

        if not image_records and errors:
            return jsonify(
                {"error": "All image uploads failed", "details": errors}
            ), 500

        logger.info(
            f"Successfully uploaded {len(image_records)} images to Supabase Storage"
        )

        return jsonify(
            {
                "images": image_records,
                "urls": image_urls,
                "absolute_urls": image_urls,  # Already absolute URLs from Supabase
                "count": len(image_records),
                "errors": errors if errors else None,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error in upload_images: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


# Serve uploaded files
@media_bp.route("/static/uploads/<filename>")


def register_media_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_validate_listing_image_entry",
        "_isoformat_utc",
        "_utc_now",
        "ensure_storage_bucket",
        "_parse_crop_data_payload",
        "upload_to_supabase_storage",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(media_bp)

