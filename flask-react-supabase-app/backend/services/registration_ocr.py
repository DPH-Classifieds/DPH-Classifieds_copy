import logging
import os
import re
from datetime import datetime, timezone

from PIL import Image, ImageEnhance, ImageOps

from services.vin_decoder import VINDecoder

logger = logging.getLogger(__name__)

FIELD_ALIASES = {
    "make": {"make", "manufacturer", "brand"},
    "model": {"model", "type"},
    "year": {"year", "model year", "manufacture year", "mfg year"},
    "vin": {"vin", "chassis", "chassis number", "frame number", "vehicle id"},
}

VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19[8-9]\d|20[0-4]\d)\b")
DEFAULT_CONFIDENCE_THRESHOLD = 0.75


class TesseractOCRProvider:
    def extract_text(self, image):
        try:
            import pytesseract
        except ImportError as exc:
            raise RuntimeError("pytesseract is not installed") from exc

        return pytesseract.image_to_string(image)


def get_default_ocr_provider():
    return TesseractOCRProvider()


def get_default_vin_decoder():
    return VINDecoder()


def _normalize_label(label):
    return re.sub(r"[^a-z0-9]+", " ", (label or "").lower()).strip()


def _field_for_label(label):
    normalized = _normalize_label(label)
    for field, aliases in FIELD_ALIASES.items():
        if normalized in aliases:
            return field
    return None


def _clean_value(value):
    return re.sub(r"\s+", " ", (value or "").strip(" \t:-#")).strip()


def _clean_vin(value):
    match = VIN_RE.search((value or "").upper().replace(" ", ""))
    if match:
        return match.group(0)
    return re.sub(r"[^A-HJ-NPR-Z0-9]", "", (value or "").upper())


def preprocess_image(image_file):
    image_file.seek(0)
    image = Image.open(image_file)
    image.load()
    image = ImageOps.exif_transpose(image).convert("RGB")
    image = ImageOps.grayscale(image)
    image = ImageOps.autocontrast(image)
    image = ImageEnhance.Sharpness(image).enhance(1.5)
    if image.width < 1200:
        ratio = 1200 / max(image.width, 1)
        image = image.resize((1200, int(image.height * ratio)))
    return image


def extract_registration_fields(raw_text):
    fields = {"make": None, "model": None, "year": None, "vin": None}
    confidence = {field: 0.0 for field in fields}

    for raw_line in (raw_text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue

        match = re.match(r"^([A-Za-z][A-Za-z0-9 /_-]{1,40})\s*[:\-]\s*(.+)$", line)
        if not match:
            continue

        field = _field_for_label(match.group(1))
        if not field:
            continue

        value = _clean_value(match.group(2))
        if field == "vin":
            value = _clean_vin(value)
        elif field == "year":
            year_match = YEAR_RE.search(value)
            value = year_match.group(1) if year_match else value

        if value and not fields[field]:
            fields[field] = value
            confidence[field] = 0.95

    if not fields["vin"]:
        match = VIN_RE.search((raw_text or "").upper().replace(" ", ""))
        if match:
            fields["vin"] = match.group(0)
            confidence["vin"] = 0.80

    if not fields["year"]:
        match = YEAR_RE.search(raw_text or "")
        if match:
            fields["year"] = match.group(1)
            confidence["year"] = 0.65

    confidence["overall"] = round(
        sum(confidence[field] for field in ("make", "model", "year", "vin")) / 4,
        4,
    )
    return fields, confidence


def _normalized_compare(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def cross_check_vin(fields, vin_result):
    validation = dict(vin_result or {})
    decoded = validation.get("decoded") or {}
    mismatches = []

    for field in ("make", "model", "year"):
        ocr_value = fields.get(field)
        decoded_value = decoded.get(field)
        if not ocr_value or not decoded_value:
            continue
        ocr_norm = _normalized_compare(ocr_value)
        decoded_norm = _normalized_compare(decoded_value)
        if (
            ocr_norm
            and decoded_norm
            and ocr_norm not in decoded_norm
            and decoded_norm not in ocr_norm
        ):
            mismatches.append(field)

    validation["mismatches"] = mismatches
    return validation


def _confidence_threshold():
    try:
        return float(
            os.getenv(
                "OCR_CONFIDENCE_REVIEW_THRESHOLD",
                str(DEFAULT_CONFIDENCE_THRESHOLD),
            )
        )
    except ValueError:
        return DEFAULT_CONFIDENCE_THRESHOLD


def _extract_scan_id(persisted):
    if isinstance(persisted, list) and persisted:
        return persisted[0].get("id")
    if isinstance(persisted, dict):
        return persisted.get("id")
    return None


def _default_supabase_request(method, path, data=None, **kwargs):
    import app as backend_app

    return backend_app.supabase_request(method, path, data=data, **kwargs)


def persist_scan(payload, supabase_request_func=None):
    request_func = supabase_request_func or _default_supabase_request
    response, status_code = request_func(
        "post",
        "/rest/v1/listing_verification_scans",
        data=payload,
        use_service_role=True,
    )
    if status_code >= 400:
        raise RuntimeError(f"Supabase scan persistence failed: {status_code} {response}")
    return response


def _scan_record(
    metadata,
    document_type,
    raw_text,
    fields,
    vin_validation,
    confidence,
    needs_review,
):
    metadata = metadata or {}
    return {
        "listing_type": metadata.get("listing_type"),
        "listing_id": metadata.get("listing_id"),
        "user_id": metadata.get("user_id"),
        "document_type": document_type,
        "raw_text": raw_text,
        "fields": fields,
        "vin_validation": vin_validation,
        "confidence": confidence,
        "needs_review": needs_review,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def scan_registration_image(
    image_file,
    document_type=None,
    metadata=None,
    ocr_provider=None,
    vin_decoder=None,
    persist_func=None,
):
    provider = ocr_provider or get_default_ocr_provider()
    decoder = vin_decoder or get_default_vin_decoder()
    persist = persist_func or persist_scan
    normalized_document_type = (document_type or "registration").strip().lower()

    processed_image = preprocess_image(image_file)
    raw_text = provider.extract_text(processed_image) or ""
    fields, confidence = extract_registration_fields(raw_text)

    if fields.get("vin"):
        vin_validation = cross_check_vin(
            fields,
            decoder.validate_and_decode(fields["vin"]),
        )
    else:
        vin_validation = {
            "vin": None,
            "is_valid": False,
            "checksum_valid": False,
            "decoded": {},
            "errors": ["missing_vin"],
            "mismatches": [],
        }

    review_reasons = []
    if not vin_validation.get("is_valid"):
        review_reasons.append("vin_invalid")
    if vin_validation.get("mismatches"):
        review_reasons.append("decoder_mismatch")
    if confidence.get("overall", 0) < _confidence_threshold():
        review_reasons.append("low_confidence")

    needs_review = bool(review_reasons)
    scan_payload = _scan_record(
        metadata,
        normalized_document_type,
        raw_text,
        fields,
        vin_validation,
        confidence,
        needs_review,
    )
    persisted = persist(scan_payload)

    return {
        "scan_id": _extract_scan_id(persisted),
        "document_type": normalized_document_type,
        "fields": fields,
        "vin_validation": vin_validation,
        "confidence": confidence,
        "needs_review": needs_review,
        "review_reasons": review_reasons,
    }
