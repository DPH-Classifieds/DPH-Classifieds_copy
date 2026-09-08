"""Authenticated signed-upload URL route."""

from functools import wraps

from flask import Flask, current_app, jsonify, request


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


@_token_required
def create_storage_signed_upload_url(current_user):
    backend = _backend()
    try:
        payload = request.get_json(silent=True) or {}
        bucket_name = str(payload.get("bucket_name") or "").strip()
        object_path = str(payload.get("object_path") or "").strip()
        content_type = str(payload.get("content_type") or "").strip().lower()
        try:
            file_size = int(payload.get("file_size"))
        except (TypeError, ValueError):
            file_size = 0
        upsert = bool(payload.get("upsert"))

        if bucket_name not in {
            "listing-images",
            "profile-photos",
            "dealer-documents",
            "registration-documents",
        }:
            return jsonify({"error": "Unsupported bucket"}), 400

        if not backend._safe_generated_object_path(object_path, current_user):
            return jsonify(
                {"error": "object_path must be a safe generated path scoped to the authenticated user"}
            ), 400

        if bucket_name in {"listing-images", "profile-photos"}:
            allowed_types = set(backend.LISTING_IMAGE_ALLOWED_MIME_TYPES)
            max_size = (
                backend.PROFILE_PHOTO_FILE_SIZE_LIMIT_BYTES
                if bucket_name == "profile-photos"
                else backend.LISTING_IMAGE_FILE_SIZE_LIMIT_BYTES
            )
        else:
            allowed_types = set(
                backend.DEALER_DOCUMENT_ALLOWED_MIME_TYPES
                if bucket_name == "dealer-documents"
                else backend.REGISTRATION_DOCUMENT_ALLOWED_MIME_TYPES
            )
            max_size = (
                backend.DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES
                if bucket_name == "dealer-documents"
                else backend.REGISTRATION_DOCUMENT_FILE_SIZE_LIMIT_BYTES
            )
        if content_type not in allowed_types or file_size <= 0 or file_size > max_size:
            return jsonify({"error": "Invalid upload type or size"}), 400

        extension = object_path.rsplit(".", 1)[-1].lower() if "." in object_path else ""
        if bucket_name in {"listing-images", "profile-photos"} and extension not in {
            "jpg", "jpeg", "png", "gif", "webp"
        }:
            return jsonify({"error": "Image uploads require an image extension"}), 400
        if bucket_name in {"dealer-documents", "registration-documents"} and extension not in {
            "jpg", "jpeg", "png", "pdf", "webp"
        }:
            return jsonify({"error": "Document uploads require an allowed extension"}), 400

        if not backend.ensure_storage_bucket(bucket_name):
            return jsonify({"error": "Storage bucket not available"}), 500

        signed_upload, error = backend._create_signed_upload_url(
            bucket_name=bucket_name,
            object_path=object_path,
            upsert=upsert,
        )
        if error:
            return jsonify({"error": error}), 502

        return jsonify(signed_upload), 200
    except Exception as exc:
        backend.logger.error("Error creating signed upload URL: %s", exc, exc_info=True)
        return jsonify({"error": "Failed to create signed upload URL"}), 500


def register_storage_upload_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/storage/signed-upload-url",
        endpoint="create_storage_signed_upload_url",
        view_func=create_storage_signed_upload_url,
        methods=["POST"],
    )
