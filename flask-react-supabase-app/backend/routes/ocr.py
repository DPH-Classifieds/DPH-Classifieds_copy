import logging

from flask import Blueprint, jsonify, request

from services.registration_ocr import scan_registration_image

logger = logging.getLogger(__name__)

ocr_bp = Blueprint("ocr", __name__, url_prefix="/api/ocr")


@ocr_bp.route("/scan-registration", methods=["POST"])
def scan_registration():
    image = request.files.get("image")
    if image is None or not image.filename:
        return jsonify({"error": "image is required"}), 400

    metadata = {
        "listing_type": request.form.get("listing_type"),
        "listing_id": request.form.get("listing_id"),
        "user_id": request.form.get("user_id"),
    }

    try:
        result = scan_registration_image(
            image.stream,
            document_type=request.form.get("document_type"),
            metadata=metadata,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        logger.exception("Registration OCR scan failed")
        return (
            jsonify({"error": "registration OCR scan failed", "details": str(exc)}),
            500,
        )

    return jsonify(result), 200
