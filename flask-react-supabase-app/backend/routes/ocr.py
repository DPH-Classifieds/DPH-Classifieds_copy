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

    import io as _io
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as _FuturesTimeout

    _OCR_TIMEOUT = int(os.getenv("EASYOCR_REGISTRATION_TIMEOUT", "15"))
    doc_type = request.form.get("document_type")

    image.stream.seek(0)
    raw_bytes = image.stream.read()

    def _run_scan():
        return scan_registration_image(
            _io.BytesIO(raw_bytes), document_type=doc_type, metadata=metadata
        )

    # Not using a `with` block on purpose: ThreadPoolExecutor.__exit__ calls
    # shutdown(wait=True), which blocks until the submitted task finishes
    # regardless of a timeout already being raised below — that defeated the
    # timeout entirely and let slow scans run past Cloudflare's ~100s limit
    # (524). shutdown(wait=False) lets the response return immediately while
    # the thread finishes (or the reader itself gives up) in the background.
    _pool = ThreadPoolExecutor(max_workers=1)
    try:
        _future = _pool.submit(_run_scan)
        result = _future.result(timeout=_OCR_TIMEOUT)
        _pool.shutdown(wait=False)
        if result.get("fields", {}).get("vin"):
            logger.info("EasyOCR extracted VIN for user %s", current_user)
        return jsonify(result), 200
    except _FuturesTimeout:
        _pool.shutdown(wait=False)
        logger.warning("EasyOCR registration scan timed out after %ss", _OCR_TIMEOUT)
    except ValueError as exc:
        _pool.shutdown(wait=False)
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        _pool.shutdown(wait=False)
        logger.warning("EasyOCR registration scan unavailable: %s", exc)

    return jsonify(
        {
            "vin": "",
            "make": "",
            "model": "",
            "year": "",
            "raw_text": "",
            "confidence": {"vin": 0.0, "overall": 0.0},
            "needs_review": True,
            "review_reasons": ["ocr_unavailable"],
            "document_type": doc_type or "registration",
            "error": "registration OCR unavailable",
        }
    ), 200


@ocr_bp.route("/hf-extract", methods=["POST"])
@ocr_auth_required
def hf_extract(current_user):
    """Self-hosted EasyOCR endpoint (replaces HuggingFace proxy).
    Accepts JSON { image_b64: str }. Returns { text: str }.
    """
    import base64
    import io

    from services.local_ocr import extract_text
    from services.registration_ocr import upload_training_image

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
    except Exception:
        return jsonify({"error": "image_b64 is not valid base64"}), 400

    # Bike/plate registration docs also go through this endpoint (only cars
    # use /scan-registration) — retain them the same way for OCR training.
    upload_training_image(raw, metadata={"user_id": current_user})

    try:
        text = extract_text(io.BytesIO(raw))
    except Exception as exc:
        logger.warning("Local OCR hf-extract failed: %s", exc)
        return jsonify({"error": "OCR unavailable"}), 503

    return jsonify({"text": text}), 200
