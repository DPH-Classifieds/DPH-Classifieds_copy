import io
import logging
import os
import re
from datetime import datetime, timezone

from PIL import Image, ImageEnhance, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

from services.vin_decoder import VIN_ALLOWED_RE, VINDecoder

FIELD_ALIASES = {
    "make": {"make", "manufacturer", "brand"},
    "model": {"model", "type", "veh type", "vehicle type"},
    "year": {"year", "model year", "manufacture year", "mfg year"},
    "vin": {"vin", "chassis", "chassis no", "chassis number", "frame number", "vehicle id"},
}

VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19[8-9]\d|20[0-4]\d)\b")
DEFAULT_ACCEPTANCE_THRESHOLD = 0.90
DEFAULT_MAX_IMAGE_PIXELS = 25000000
DEFAULT_MAX_RESIZE_PIXELS = 6000000
DEFAULT_MAX_RESIZE_WIDTH = 2400
DEFAULT_MAX_RESIZE_HEIGHT = 2400
# I, O, Q can never legally appear in a VIN (VIN_ALLOWED_RE excludes them) —
# any occurrence is definitely an OCR misread, so substituting these is a
# correction, not a guess, and is always applied to reach a charset-valid
# candidate at all.
REQUIRED_VIN_SUBSTITUTIONS = {
    "O": "0",
    "Q": "0",
    "I": "1",
}
# D and L ARE valid VIN letters in their own right, so swapping them for 0/1
# is a genuine guess, not a correction — only trust it where the checksum
# can actually confirm it (see VINDecoder.is_checksum_applicable). For
# non-NA VINs the checksum can't verify anything (see is_checksum_valid),
# so these are never applied there.
SPECULATIVE_VIN_SUBSTITUTIONS = {
    "D": ("0",),
    "L": ("1",),
}
# The VIN check digit only has ~1-in-11 discriminating power (it's meant to
# catch a single transcription typo, not to serve as a search oracle). Tried
# adding V<->W here; on a garbled read it let up to 64 blind substitution
# combinations be searched, and a synthetic test proved that finds a
# checksum-valid VIN that is NOT the real one (LOWDD7O51QJ614961 repaired to
# a *different*, wrong, but checksum-passing VIN). Reverted, and speculative
# repair is now capped at MAX_VIN_SUBSTITUTIONS below to bound the
# false-positive risk from the remaining table.
MAX_VIN_SUBSTITUTIONS = 2
# Below this, a EasyOCR detection is noise often enough that letting it into
# the VIN/field-candidate search does more harm than good. Deliberately much
# lower than a "trust this on its own" threshold (0.9) — extract_registration_fields
# and _repair_vin_candidate's checksum-based repair are the real accuracy gate;
# this floor only exists to drop blank/near-blank detections.
EASYOCR_MIN_CONFIDENCE = 0.1

class EasyOCRProvider:
    """Runs registration-doc OCR through the shared self-hosted EasyOCR
    reader (en+ar) — the same model instance backing /api/ocr/hf-extract,
    so the model is only ever loaded once per process.
    """

    def extract_text(self, image):
        from services import local_ocr

        reader = local_ocr._get_reader()
        if reader is None:
            if local_ocr._init_error is not None:
                raise RuntimeError(
                    f"EasyOCR failed to load: {local_ocr._init_error}"
                ) from local_ocr._init_error
            raise RuntimeError("EasyOCR not ready")

        import numpy as np

        results = reader.readtext(np.array(image.convert("RGB")))
        return " ".join(text for _, text, conf in results if conf > EASYOCR_MIN_CONFIDENCE).strip()


class PaddleOCRServiceProvider:
    """Runs OCR by calling the standalone PaddleOCR microservice over HTTP.
    Keeps this backend lean and lets OCR scale independently. Mirrors the
    VIN-decoder remote pattern (requests + timeout + env config).
    """

    def __init__(self, base_url=None, service_key=None, timeout=None):
        self.base_url = (base_url or os.getenv("OCR_SERVICE_URL", "")).rstrip("/")
        self.service_key = service_key or os.getenv("OCR_SERVICE_KEY", "")
        self.timeout = timeout or float(os.getenv("OCR_SERVICE_TIMEOUT_SECONDS", "30"))

    def extract_text(self, image):
        import requests

        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG")
        buffer.seek(0)

        headers = {"X-OCR-Service-Key": self.service_key} if self.service_key else {}
        url = f"{self.base_url}/scan"

        # One retry on 503 (service busy / still loading its model).
        last_exc = None
        for attempt in range(2):
            try:
                response = requests.post(
                    url,
                    files={"image": ("scan.png", buffer.getvalue(), "image/png")},
                    headers=headers,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                last_exc = exc
                break
            if response.status_code == 503 and attempt == 0:
                continue
            if response.status_code >= 400:
                raise RuntimeError(
                    f"OCR service returned {response.status_code}: {response.text[:200]}"
                )
            return (response.json() or {}).get("text", "") or ""

        raise RuntimeError(f"OCR service unavailable: {last_exc}")


def get_default_ocr_provider():
    # Prefer the PaddleOCR microservice when configured; fall back to the
    # in-process EasyOCR reader until the service is fully rolled out.
    if os.getenv("OCR_SERVICE_URL"):
        return PaddleOCRServiceProvider()
    return EasyOCRProvider()


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
    compact = (value or "").upper().replace(" ", "")
    match = VIN_RE.search(compact)
    if match:
        return match.group(0)
    cleaned = re.sub(r"[^A-Z0-9]", "", compact)
    if len(cleaned) == 17:
        repaired = _repair_vin_candidate(cleaned)
        if repaired:
            return repaired
    return re.sub(r"[^A-HJ-NPR-Z0-9]", "", cleaned)


def _collapse_repeated_phrase(value):
    tokens = re.findall(r"[A-Z0-9]+", str(value or "").upper())
    if len(tokens) >= 4 and len(tokens) % 2 == 0:
        half = len(tokens) // 2
        if tokens[:half] == tokens[half:]:
            return " ".join(tokens[:half])
    return " ".join(tokens)


def _split_vehicle_type(value):
    tokens = re.findall(r"[A-Z0-9]+", str(value or "").upper())
    if len(tokens) >= 3:
        return " ".join(tokens[:2]), " ".join(tokens[2:])
    if len(tokens) == 2:
        return tokens[0], tokens[1]
    return None, None


def _find_vin_candidate(raw_text):
    normalized = (raw_text or "").upper()
    seen = set()
    for token in re.findall(r"[A-Z0-9]{14,20}", normalized):
        cleaned = re.sub(r"[^A-Z0-9]", "", token)
        if len(cleaned) < 17:
            continue

        windows = [cleaned] if len(cleaned) == 17 else [cleaned[index : index + 17] for index in range(len(cleaned) - 16)]
        for candidate in windows:
            if candidate in seen:
                continue
            seen.add(candidate)
            repaired = _repair_vin_candidate(candidate)
            if repaired:
                return repaired
            return candidate

    return None


def _repair_vin_candidate(value):
    cleaned = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    if len(cleaned) != 17:
        return None

    # Step 1: I/O/Q are impossible in a real VIN, so fix them unconditionally
    # — this isn't a guess, it's a correction (needed just to reach a
    # charset-valid 17-char string at all).
    required_fixed = "".join(REQUIRED_VIN_SUBSTITUTIONS.get(c, c) for c in cleaned)
    if not VIN_ALLOWED_RE.match(required_fixed):
        return None

    # Step 2: if this VIN's WMI prefix isn't NA-market, the checksum can't
    # verify anything (see VINDecoder.is_checksum_applicable) — so there is
    # no way to confirm a speculative D<->0 / L<->1 guess. Return the
    # required-fix-only result as a best effort rather than inventing
    # further changes we can never check.
    if not VINDecoder.is_checksum_applicable(required_fixed):
        return required_fixed

    if VINDecoder.is_checksum_valid(required_fixed):
        return required_fixed

    # Step 3 (NA-market only): the checksum is real here, so it's safe to
    # search speculative substitutions and trust a pass. Each candidate
    # tracks how many changes it made from required_fixed — the more
    # substitutions needed, the more likely a "pass" is pure 1-in-11
    # coincidence rather than a real repair, so this is capped and the
    # fewest-substitution match wins.
    candidates = [(required_fixed, 0)]
    for index, char in enumerate(required_fixed):
        replacements = SPECULATIVE_VIN_SUBSTITUTIONS.get(char)
        if not replacements:
            continue
        next_candidates = []
        for candidate, subs in candidates:
            next_candidates.append((candidate, subs))
            if subs < MAX_VIN_SUBSTITUTIONS:
                for replacement in replacements:
                    next_candidates.append((candidate[:index] + replacement + candidate[index + 1:], subs + 1))
        candidates = next_candidates[:64]

    seen = set()
    best = None
    for candidate, subs in candidates:
        if candidate in seen or subs == 0:
            continue
        seen.add(candidate)
        if VIN_ALLOWED_RE.match(candidate) and VINDecoder.is_checksum_valid(candidate):
            if best is None or subs < best[1]:
                best = (candidate, subs)
    return best[0] if best else None


def _max_image_pixels():
    configured = os.getenv("OCR_MAX_IMAGE_PIXELS") or os.getenv("MAX_IMAGE_PIXELS")
    try:
        return int(configured or DEFAULT_MAX_IMAGE_PIXELS)
    except ValueError:
        return DEFAULT_MAX_IMAGE_PIXELS


def _env_int(name, fallback):
    try:
        return int(os.getenv(name, str(fallback)))
    except ValueError:
        return fallback


def _resize_guardrails(max_resize_pixels=None, max_width=None, max_height=None):
    return {
        "pixels": (
            _env_int("OCR_MAX_RESIZE_PIXELS", DEFAULT_MAX_RESIZE_PIXELS)
            if max_resize_pixels is None
            else max_resize_pixels
        ),
        "width": _env_int("OCR_MAX_IMAGE_WIDTH", DEFAULT_MAX_RESIZE_WIDTH)
        if max_width is None
        else max_width,
        "height": _env_int("OCR_MAX_IMAGE_HEIGHT", DEFAULT_MAX_RESIZE_HEIGHT)
        if max_height is None
        else max_height,
    }


def _looks_like_pdf(image_file):
    name = str(getattr(image_file, "name", "") or getattr(image_file, "filename", "")).lower()
    content_type = str(getattr(image_file, "content_type", "") or getattr(image_file, "mimetype", "")).lower()
    if name.endswith(".pdf") or content_type == "application/pdf":
        return True

    current_position = image_file.tell()
    try:
        header = image_file.read(5)
        return header == b"%PDF-"
    finally:
        image_file.seek(current_position)


def _render_pdf_first_page(image_file):
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:
        raise RuntimeError("pypdfium2 is not installed") from exc

    image_file.seek(0)
    pdf = pdfium.PdfDocument(image_file.read())
    if len(pdf) < 1:
        raise ValueError("PDF upload must contain at least one page")
    page = pdf[0]
    bitmap = page.render(scale=3).to_pil()
    return bitmap


def _build_ocr_variants(image):
    # Single pass: the contrast-enhanced second variant was tuned for
    # Tesseract's classical thresholding, which is sensitive to lighting.
    # EasyOCR's CRAFT/CRNN detector is materially more contrast-robust, and
    # a second deep-learning inference pass roughly doubles CPU wall-clock
    # time per scan — the main contributor to Cloudflare 524s on Railway.
    return [image.copy()]


def preprocess_image(
    image_file,
    max_pixels=None,
    max_resize_pixels=None,
    max_width=None,
    max_height=None,
):
    image_file.seek(0)
    try:
        if _looks_like_pdf(image_file):
            image = _render_pdf_first_page(image_file)
        else:
            image = Image.open(image_file)
    except UnidentifiedImageError as exc:
        raise ValueError("image upload must be a valid image") from exc
    max_pixels = _max_image_pixels() if max_pixels is None else max_pixels
    if image.width * image.height > max_pixels:
        raise ValueError("image dimensions are too large")
    try:
        image.load()
    except UnidentifiedImageError as exc:
        raise ValueError("image upload must be a valid image") from exc
    # Tested removing grayscale+sharpen on the theory that EasyOCR's CNN
    # doesn't need Tesseract-style binarization — verified against a real
    # clean scan that this is wrong: dropping sharpen alone turned a
    # correctly-read "S" into "$" (LGWFF7A51SJ614961 -> LGWFF7A51$J614961),
    # breaking VIN extraction that worked before. Keeping the full
    # grayscale+autocontrast+sharpen pipeline. Resolution is still the
    # dominant lever for small printed fields (Chassis No., Veh. Type) on
    # low-res source photos, so the upscale target is raised from 1200px.
    image = ImageOps.exif_transpose(image).convert("RGB")
    image = ImageOps.grayscale(image)
    image = ImageOps.autocontrast(image)
    image = ImageEnhance.Sharpness(image).enhance(1.5)
    target_width = _env_int("OCR_TARGET_WIDTH", 2000)
    if image.width < target_width:
        guardrails = _resize_guardrails(max_resize_pixels, max_width, max_height)
        # Bound the scale-up by whichever axis is more restrictive — a
        # portrait-oriented photo (e.g. two mulkiya faces stacked
        # vertically) can hit the height guardrail well before it reaches
        # the target width. Previously this only scaled by width, which
        # rejected legitimate portrait photos as "too large" once the
        # target width was raised for accuracy.
        ratio = min(
            target_width / max(image.width, 1),
            guardrails["width"] / max(image.width, 1),
            guardrails["height"] / max(image.height, 1),
        )
        target_size = (max(1, int(image.width * ratio)), max(1, int(image.height * ratio)))
        if target_size[0] * target_size[1] > guardrails["pixels"]:
            raise ValueError("resized image dimensions are too large")
        if target_size[0] > image.width or target_size[1] > image.height:
            image = image.resize(target_size, Image.LANCZOS)
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
        if field == "model":
            year_match = YEAR_RE.match(value)
            if year_match:
                if not fields["year"]:
                    fields["year"] = year_match.group(1)
                    confidence["year"] = 0.65
                continue

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
        else:
            candidate = _find_vin_candidate(raw_text)
            if candidate:
                fields["vin"] = candidate
                confidence["vin"] = 0.80

    if not fields["year"]:
        model_year_match = re.search(r"\bModel\b[\s\]\}\|:.\-]*((?:19[8-9]\d|20[0-4]\d))\b", raw_text or "", re.IGNORECASE)
        if model_year_match:
            fields["year"] = model_year_match.group(1)
            confidence["year"] = 0.65

    if not fields["make"] or not fields["model"]:
        vehicle_type_match = re.search(
            r"\b(?:Veh\.?\s*Type|Vehicle\s+Type)\b[\s\]\}\|:.\-]*([A-Z0-9][A-Z0-9 ]{3,80})",
            raw_text or "",
            re.IGNORECASE,
        )
        if vehicle_type_match:
            collapsed = _collapse_repeated_phrase(vehicle_type_match.group(1))
            inferred_make, inferred_model = _split_vehicle_type(collapsed)
            if inferred_make and not fields["make"]:
                fields["make"] = inferred_make
                confidence["make"] = max(confidence["make"], 0.6)
            if inferred_model and not fields["model"]:
                fields["model"] = inferred_model
                confidence["model"] = max(confidence["model"], 0.6)

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


# A UAE traffic plate on a mulkiya is a short code plus a 1-5 digit number,
# e.g. "CC/66182", "A 12345", "50 / 4321". The plate number is the digits.
# A LETTER code needs no separator (letter->digit is an unambiguous
# boundary: "CC66182"), but a NUMERIC code requires an explicit separator —
# otherwise a plain 5-digit plate ("44321") or a 4-digit year ("2025")
# would be wrongly split into code+number.
# ASCII digits only ([0-9], never \d) — \d also matches Arabic-Indic digits
# (٠-٩), which EasyOCR emits for the Arabic side of the card and which must
# never land in a form field that expects Western digits.
_PLATE_LETTER_CODE_RE = re.compile(r"\b([A-Z]{1,2})\s*[/\-]?\s*([0-9]{1,5})\b")
_PLATE_DIGIT_CODE_RE = re.compile(r"\b([0-9]{1,2})\s*[/\-]\s*([0-9]{1,5})\b")
_PLATE_SLASH_NUMBER_RE = re.compile(r"/\s*([0-9]{1,5})\b")
_PLATE_BARE_NUMBER_RE = re.compile(r"\b([0-9]{1,5})\b")
_PLATE_LABEL_RE = re.compile(r"(?:traffic\s*plate|plate\s*no|لوحة)", re.IGNORECASE)


def _is_year_like(digits):
    return len(digits) == 4 and re.match(r"(?:19[89]\d|20[0-4]\d)$", digits) is not None


def _match_plate_code_number(text):
    """First plate code+number token in `text`, skipping year-like numbers.
    Returns (code, number) or None."""
    for regex in (_PLATE_LETTER_CODE_RE, _PLATE_DIGIT_CODE_RE):
        for m in regex.finditer(text):
            if not _is_year_like(m.group(2)):
                return m.group(1), m.group(2)
    return None


def extract_plate_fields(raw_text):
    """Extract a UAE traffic plate {code, number} from OCR text.

    The old client-side approach grabbed the FIRST 1-5 digit token in the
    whole blob, which routinely picked the plate *code*, a fragment of the
    T.C. number, a policy number, or a year. This uses label proximity
    first, then the distinctive code+number token format, and refuses to
    return a year-like number.
    """
    text = raw_text or ""

    # 1. Label proximity — check BOTH sides of a plate label. The English
    #    label ("Traffic Plate No") sits to the left of its value; the
    #    Arabic label ("رقم اللوحة") sits to the right (RTL), so the value
    #    can appear before it in the flattened OCR text.
    for label in _PLATE_LABEL_RE.finditer(text):
        window = text[max(0, label.start() - 40): label.end() + 40]
        found = _match_plate_code_number(window)
        if found:
            return {"plate_code": found[0], "plate_number": found[1]}
        slash = _PLATE_SLASH_NUMBER_RE.search(window)
        if slash and not _is_year_like(slash.group(1)):
            return {"plate_code": None, "plate_number": slash.group(1)}
        num = _PLATE_BARE_NUMBER_RE.search(window)
        if num and not _is_year_like(num.group(1)):
            return {"plate_code": None, "plate_number": num.group(1)}

    # 2. Distinctive code+number token anywhere. Skip year-like numbers.
    found = _match_plate_code_number(text)
    if found:
        return {"plate_code": found[0], "plate_number": found[1]}

    return {"plate_code": None, "plate_number": None}


def _normalized_compare(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def cross_check_vin(fields, vin_result):
    validation = dict(vin_result or {})
    validation["valid"] = bool(validation.get("valid", validation.get("is_valid")))
    validation["is_valid"] = validation["valid"]
    decoded = validation.get("decoded") or {}
    if "model_year" not in decoded and decoded.get("year"):
        decoded["model_year"] = decoded.get("year")
    if "year" not in decoded and decoded.get("model_year"):
        decoded["year"] = decoded.get("model_year")
    validation["decoded"] = decoded
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


def _env_float(name, fallback):
    try:
        return float(os.getenv(name, str(fallback)))
    except ValueError:
        return fallback


def _acceptance_threshold():
    return _env_float("OCR_CONFIDENCE_THRESHOLD", DEFAULT_ACCEPTANCE_THRESHOLD)


def _confidence_threshold():
    return _acceptance_threshold()


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


TRAINING_BUCKET = "mulkiya-training-data"


def _sniff_extension(raw_bytes):
    if raw_bytes[:5] == b"%PDF-":
        return "pdf", "application/pdf"
    try:
        with Image.open(io.BytesIO(raw_bytes)) as probe:
            fmt = (probe.format or "JPEG").lower()
    except Exception:
        fmt = "jpeg"
    ext = {"jpeg": "jpg"}.get(fmt, fmt)
    return ext, f"image/{fmt}"


def upload_training_image(raw_bytes, metadata=None, upload_func=None):
    """Best-effort retention of the original (unprocessed) scan image in the
    private mulkiya-training-data bucket, for future OCR model training.
    Returns the object path, or None — never raises, since a storage hiccup
    must not block the user's actual OCR scan.
    """
    import uuid

    try:
        if upload_func is not None:
            return upload_func(raw_bytes, metadata)

        import app as backend_app

        ext, content_type = _sniff_extension(raw_bytes)
        metadata = metadata or {}
        prefix = metadata.get("user_id") or "anonymous"
        object_path = f"{prefix}/{uuid.uuid4()}.{ext}"
        upload_url = f"{backend_app.SUPABASE_URL}/storage/v1/object/{TRAINING_BUCKET}/{object_path}"
        response = backend_app.requests.post(
            upload_url,
            headers={
                "apikey": backend_app.SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {backend_app.SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=raw_bytes,
            timeout=30,
        )
        if response.status_code not in (200, 201):
            logger.warning(
                "Mulkiya training image upload failed: %s %s",
                response.status_code, response.text,
            )
            return None
        return object_path
    except Exception as exc:
        logger.warning("Mulkiya training image upload failed: %s", exc)
        return None


def _scan_record(
    metadata,
    document_type,
    raw_text,
    fields,
    vin_validation,
    confidence,
    needs_review,
    training_image_path=None,
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
        "training_image_path": training_image_path,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _backfill_fields_from_vin_decoder(fields, confidence, vin_validation):
    decoded = (vin_validation or {}).get("decoded") or {}
    if not decoded:
        return fields, confidence

    merged_fields = dict(fields)
    merged_confidence = dict(confidence)
    original_overall = merged_confidence.get("overall")

    for field, decoded_key in (("make", "make"), ("model", "model"), ("year", "model_year")):
        decoded_value = decoded.get(decoded_key) or decoded.get(field)
        if decoded_value and not merged_fields.get(field):
            merged_fields[field] = str(decoded_value)
            merged_confidence[field] = max(float(merged_confidence.get(field) or 0), 0.92)

    if original_overall is not None:
        merged_confidence["overall"] = original_overall
    return merged_fields, merged_confidence


def scan_registration_image(
    image_file,
    document_type=None,
    metadata=None,
    ocr_provider=None,
    vin_decoder=None,
    persist_func=None,
    training_upload_func=None,
):
    provider = ocr_provider or get_default_ocr_provider()
    decoder = vin_decoder or get_default_vin_decoder()
    persist = persist_func or persist_scan
    normalized_document_type = (document_type or "registration").strip().lower()

    # Retain the original (unprocessed) bytes for OCR training-data
    # collection before preprocess_image consumes the stream. Best-effort:
    # upload_training_image never raises, so a storage hiccup can't break
    # the actual scan response the user is waiting on.
    image_file.seek(0)
    original_bytes = image_file.read()
    image_file.seek(0)
    training_image_path = upload_training_image(
        original_bytes, metadata=metadata, upload_func=training_upload_func
    )

    processed_image = preprocess_image(image_file)
    best_raw_text = ""
    best_fields = {"make": None, "model": None, "year": None, "vin": None}
    best_confidence = {"make": 0.0, "model": 0.0, "year": 0.0, "vin": 0.0, "overall": 0.0}
    best_score = -1.0

    for variant in _build_ocr_variants(processed_image):
        raw_text = provider.extract_text(variant) or ""
        fields, confidence = extract_registration_fields(raw_text)
        score = (
            float(confidence.get("overall") or 0)
            + (0.4 if fields.get("vin") else 0)
            + (0.2 if fields.get("make") else 0)
            + (0.2 if fields.get("model") else 0)
            + (0.2 if fields.get("year") else 0)
        )
        if score > best_score:
            best_score = score
            best_raw_text = raw_text
            best_fields = fields
            best_confidence = confidence

    raw_text = best_raw_text
    fields = best_fields
    confidence = best_confidence

    # Plate number/code (for plate listings) — extracted from the same OCR
    # text via label proximity + format matching, not a blind first-number
    # grab. Car/bike flows simply ignore these keys.
    plate = extract_plate_fields(raw_text)
    fields = {**fields, "plate_number": plate["plate_number"], "plate_code": plate["plate_code"]}

    ocr_confidence_overall = confidence.get("overall", 0)

    if fields.get("vin"):
        vin_validation = cross_check_vin(
            fields,
            decoder.validate_and_decode(fields["vin"]),
        )
    else:
        vin_validation = {
            "vin": None,
            "valid": False,
            "is_valid": False,
            "checksum_valid": False,
            "decoded": {},
            "errors": ["missing_vin"],
            "mismatches": [],
        }

    fields, confidence = _backfill_fields_from_vin_decoder(fields, confidence, vin_validation)

    review_reasons = []
    if not vin_validation.get("is_valid"):
        review_reasons.append("vin_invalid")
    if vin_validation.get("mismatches"):
        review_reasons.append("decoder_mismatch")
    confidence_overall = ocr_confidence_overall
    if confidence_overall < _confidence_threshold():
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
        training_image_path=training_image_path,
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
