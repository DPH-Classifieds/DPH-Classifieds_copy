import logging
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from functools import wraps
from threading import BoundedSemaphore

from flask import Blueprint, current_app, jsonify, request

from services.registration_ocr import scan_registration_image

logger = logging.getLogger(__name__)

ocr_bp = Blueprint("ocr", __name__, url_prefix="/api/ocr")

_OCR_WORKERS = max(1, min(int(os.getenv("OCR_REGISTRATION_MAX_WORKERS", "2")), 8))
_OCR_MAX_INFLIGHT = max(
    _OCR_WORKERS,
    min(int(os.getenv("OCR_REGISTRATION_MAX_INFLIGHT", str(_OCR_WORKERS * 2))), 16),
)
_OCR_POOL = ThreadPoolExecutor(max_workers=_OCR_WORKERS, thread_name_prefix="registration-ocr")
_OCR_SLOTS = BoundedSemaphore(_OCR_MAX_INFLIGHT)

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


def _record_ocr_failure(user_id, doc_type, code, message):
    """Funnel a silent OCR failure into app_errors (admin Errors tab). Best-effort."""
    try:
        import app as backend_app

        backend_app.record_app_error(
            context="ocr_scan_registration",
            message=message,
            error_code=code,
            user_id=user_id,
            details={"document_type": doc_type or "registration"},
            source="backend",
        )
    except Exception:
        logger.warning("failed to record ocr error", exc_info=True)


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

    # Keep the API deadline below the upstream/gateway deadline. The Paddle
    # service has its own bounded queue; this only prevents a slow dependency
    # from tying up a web worker indefinitely.
    _OCR_TIMEOUT = int(os.getenv("OCR_REGISTRATION_TIMEOUT_SECONDS", "20"))
    doc_type = request.form.get("document_type")

    image.stream.seek(0)
    raw_bytes = image.stream.read()

    def _run_scan():
        return scan_registration_image(
            _io.BytesIO(raw_bytes), document_type=doc_type, metadata=metadata
        )

    if not _OCR_SLOTS.acquire(blocking=False):
        return jsonify({"error": "registration OCR is busy; retry shortly"}), 503

    _future = _OCR_POOL.submit(_run_scan)
    _future.add_done_callback(lambda _completed: _OCR_SLOTS.release())
    try:
        result = _future.result(timeout=_OCR_TIMEOUT)
        if result.get("fields", {}).get("vin"):
            logger.info("PaddleOCR extracted VIN for user %s", current_user)
        return jsonify(result), 200
    except FuturesTimeout:
        _future.cancel()
        logger.warning("PaddleOCR registration scan timed out after %ss", _OCR_TIMEOUT)
        _record_ocr_failure(current_user, doc_type, "ocr_timeout", f"registration OCR timed out after {_OCR_TIMEOUT}s")
    except ValueError as exc:
        _record_ocr_failure(current_user, doc_type, "ocr_invalid", str(exc))
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        logger.warning("PaddleOCR registration scan unavailable: %s", exc)
        _record_ocr_failure(current_user, doc_type, "ocr_unavailable", str(exc))

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
