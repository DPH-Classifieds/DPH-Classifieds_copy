import logging
import os
from functools import wraps

from flask import Blueprint, current_app, jsonify, request

from services.registration_ocr import scan_registration_image

logger = logging.getLogger(__name__)

ocr_bp = Blueprint("ocr", __name__, url_prefix="/api/ocr")

LISTING_OWNERSHIP_TABLES = {
    "car": "cars",
    "cars": "cars",
    "bike": "bikes",
    "bikes": "bikes",
    "part": "car_parts",
    "parts": "car_parts",
    "car_part": "car_parts",
    "car_parts": "car_parts",
    "plate": "license_plates",
    "plates": "license_plates",
    "license_plate": "license_plates",
    "license_plates": "license_plates",
}


def _authenticate_bearer_token():
    import app as backend_app

    authenticated = {}

    def capture_user(current_user):
        authenticated["current_user"] = current_user
        return None

    auth_response = backend_app.token_required(capture_user)()
    current_user = authenticated.get("current_user")
    if current_user:
        return current_user, getattr(request, "user_data", {"id": current_user})
    return None, auth_response


def ocr_auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_result = _authenticate_bearer_token()
        if auth_result[0] is None:
            return auth_result[1]
        current_user, _user_data = auth_result
        return f(current_user, *args, **kwargs)

    return decorated


def _max_upload_bytes():
    configured = current_app.config.get("MAX_CONTENT_LENGTH")
    if configured:
        return int(configured)
    return int(os.getenv("MAX_UPLOAD_SIZE_MB", "20")) * 1024 * 1024


def _uploaded_file_size_bytes(image):
    stream = image.stream
    if not hasattr(stream, "seek") or not hasattr(stream, "tell"):
        return None

    try:
        current_position = stream.tell()
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        stream.seek(current_position)
        return size
    except (OSError, ValueError):
        return None


def _validate_registration_upload(image):
    if image is None or not image.filename:
        return jsonify({"error": "image is required"}), 400

    max_bytes = _max_upload_bytes()
    if request.content_length and request.content_length > max_bytes:
        return jsonify({"error": "image upload is too large"}), 413

    actual_size = _uploaded_file_size_bytes(image)
    if actual_size is not None and actual_size > max_bytes:
        return jsonify({"error": "image upload is too large"}), 413

    mimetype = (image.mimetype or "").lower()
    if not (mimetype.startswith("image/") or mimetype == "application/pdf"):
        return jsonify({"error": "image upload must be an image or PDF"}), 400

    return None


def _normalized_listing_linkage(form):
    listing_type = (form.get("listing_type") or "").strip().lower()
    listing_id = (form.get("listing_id") or "").strip()
    if not listing_type and not listing_id:
        return None, None, None
    if not listing_type or not listing_id:
        return (
            None,
            None,
            (
                jsonify({"error": "listing_type and listing_id are required together"}),
                400,
            ),
        )
    if listing_type not in LISTING_OWNERSHIP_TABLES:
        return None, None, (jsonify({"error": "unsupported listing_type"}), 400)
    return listing_type, listing_id, None


def verify_listing_ownership(listing_type, listing_id, current_user):
    import app as backend_app

    table = LISTING_OWNERSHIP_TABLES[listing_type]
    try:
        rows, status_code = backend_app.supabase_request(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": "id,user_id",
                "id": f"eq.{listing_id}",
                "user_id": f"eq.{current_user}",
                "limit": "1",
            },
            use_service_role=True,
        )
    except Exception as exc:
        logger.warning("OCR listing ownership verification failed: %s", exc)
        return False
    return status_code < 400 and bool(rows)


@ocr_bp.route("/scan-registration", methods=["POST"])
@ocr_auth_required
def scan_registration(current_user):
    image = request.files.get("image")
    validation_error = _validate_registration_upload(image)
    if validation_error:
        return validation_error

    listing_type, listing_id, linkage_error = _normalized_listing_linkage(request.form)
    if linkage_error:
        return linkage_error

    if listing_type and not verify_listing_ownership(listing_type, listing_id, current_user):
        return jsonify({"error": "listing ownership could not be verified"}), 403

    metadata = {
        "listing_type": listing_type,
        "listing_id": listing_id,
        "user_id": current_user,
    }

    # Try self-hosted EasyOCR first (no binary dependency, supports Arabic + English),
    # fall back to Tesseract for richer structured extraction when available.
    local_result = _local_ocr_scan(image)
    if local_result and local_result.get("vin"):
        logger.info("Local OCR extracted VIN for user %s", current_user)
        return jsonify(local_result), 200

    # Local OCR found no VIN — try Tesseract for full structured scan
    image.stream.seek(0)
    try:
        result = scan_registration_image(
            image.stream,
            document_type=request.form.get("document_type"),
            metadata=metadata,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        logger.warning("Tesseract OCR also unavailable: %s", exc)
        if local_result is not None:
            # Local OCR worked but found no VIN — return raw text so user can check
            return jsonify(local_result), 200
        return jsonify({"error": "registration OCR unavailable"}), 503

    return jsonify(result), 200


def _local_ocr_scan(image_file):
    """Run self-hosted EasyOCR and return a minimal scan result dict.
    Returns None only if EasyOCR itself fails to load or errors out.
    """
    import re as _re

    from services.local_ocr import extract_text

    try:
        image_file.stream.seek(0)
        text = extract_text(image_file.stream)
    except Exception as exc:
        logger.warning("Local OCR failed: %s", exc)
        return None

    vin_match = _re.search(r"\b[A-HJ-NPR-Z0-9]{17}\b", text.upper())
    vin = vin_match.group(0) if vin_match else ""

    return {
        "vin": vin,
        "make": "",
        "model": "",
        "year": "",
        "raw_text": text,
        "confidence": {"vin": 0.6 if vin else 0.0, "overall": 0.5 if vin else 0.0},
        "needs_review": True,
        "review_reasons": ["local_ocr"],
        "document_type": "registration",
    }


@ocr_bp.route("/hf-extract", methods=["POST"])
@ocr_auth_required
def hf_extract(current_user):
    """Self-hosted EasyOCR endpoint (replaces HuggingFace proxy).
    Accepts JSON { image_b64: str }. Returns { text: str }.
    """
    import base64
    import io

    from services.local_ocr import extract_text

    data = request.get_json(silent=True) or {}
    image_b64 = data.get("image_b64", "")
    if not image_b64:
        return jsonify({"error": "image_b64 is required"}), 400

    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    if len(image_b64) > 27 * 1024 * 1024:
        return jsonify({"error": "image_b64 exceeds 20 MB limit"}), 413

    try:
        raw = base64.b64decode(image_b64)
        text = extract_text(io.BytesIO(raw))
    except Exception as exc:
        logger.warning("Local OCR hf-extract failed: %s", exc)
        return jsonify({"error": "OCR unavailable"}), 503

    return jsonify({"text": text}), 200
