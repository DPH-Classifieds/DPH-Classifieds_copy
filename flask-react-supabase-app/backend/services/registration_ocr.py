import io
import logging
import os
import re
import warnings
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
_EXPIRY_LABEL_RE = re.compile(
    r"(?:valid\s*(?:until|to|till)|expir(?:y|es|ation)|validity)\D{0,40}",
    re.IGNORECASE,
)
_DATE_RE = re.compile(
    r"\b(?:\d{1,2}[/-]\d{1,2}[/-](?:20)?\d{2}|20\d{2}[/-]\d{1,2}[/-]\d{1,2})\b"
)
DEFAULT_ACCEPTANCE_THRESHOLD = 0.90
DEFAULT_MAX_IMAGE_PIXELS = 25000000
DEFAULT_MAX_RESIZE_PIXELS = 6000000
DEFAULT_MAX_RESIZE_WIDTH = 2400
DEFAULT_MAX_RESIZE_HEIGHT = 2400
DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_PDF_PAGES = 10
DEFAULT_MAX_PDF_PAGE_POINTS = 4_000_000
DEFAULT_MAX_PDF_PAGE_SIDE = 20_000
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


class PaddleOCRServiceProvider:
    """Runs OCR by calling the standalone PaddleOCR microservice over HTTP.
    Keeps this backend lean and lets OCR scale independently. Mirrors the
    VIN-decoder remote pattern (requests + timeout + env config).
    """

    def __init__(self, base_url=None, service_key=None, timeout=None):
        self.base_url = (base_url or os.getenv("OCR_SERVICE_URL", "")).rstrip("/")
        self.service_key = service_key or os.getenv("OCR_SERVICE_KEY", "")
        # The route has a 20-second end-to-end budget, so one upstream attempt
        # cannot consume it all and make a retry pointless. The compatibility
        # variable may still be set to a historical 30-40 seconds in Railway;
        # cap it explicitly until that setting can be cleaned up.
        if timeout is not None:
            self.timeout = timeout
        else:
            configured_timeout = float(os.getenv("OCR_SERVICE_TIMEOUT_SECONDS", "12"))
            attempt_cap = float(os.getenv("OCR_SERVICE_ATTEMPT_TIMEOUT_SECONDS", "8"))
            self.timeout = min(configured_timeout, attempt_cap)
        self.last_diagnostics = {}

    def extract(self, image):
        """Return (text, lines) where lines is [{text, conf}] carrying
        PaddleOCR's real per-detection recognition confidence."""
        import requests

        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG")
        buffer.seek(0)

        headers = {"X-OCR-Service-Key": self.service_key} if self.service_key else {}
        if not self.base_url:
            raise RuntimeError("OCR service is not configured")
        url = f"{self.base_url}/scan"

        # One retry on 503 (service busy / still loading its model).
        last_error = None
        for attempt in range(2):
            try:
                response = requests.post(
                    url,
                    files={"image": ("scan.png", buffer.getvalue(), "image/png")},
                    headers=headers,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                last_error = exc
                # A brief transient connection failure is safe to retry once.
                if attempt == 0:
                    continue
                break
            if response.status_code == 503 and attempt == 0:
                last_error = RuntimeError("OCR service busy")
                continue
            if response.status_code >= 400:
                raise RuntimeError(
                    f"OCR service returned {response.status_code}: {response.text[:200]}"
                )
            payload = response.json() or {}
            self.last_diagnostics = payload.get("diagnostics") or {}
            return payload.get("text", "") or "", payload.get("lines", []) or []

        raise RuntimeError(f"OCR service unavailable: {last_error or 'no response'}")

    def extract_text(self, image):
        return self.extract(image)[0]


def _ocr_extract(provider, image):
    """Get (text, lines) from a provider that may only implement the simple
    string-returning extract_text (e.g. test fakes)."""
    if hasattr(provider, "extract"):
        return provider.extract(image)
    return (provider.extract_text(image) or "", [])


def _confidence_from_lines(value, lines):
    """Real OCR confidence for an extracted field value: the max recognition
    confidence among the OCR lines whose (alnum-normalized) text contains, or
    is contained by, the value. 0.0 if none match."""
    if not value or not lines:
        return 0.0
    target = re.sub(r"[^A-Z0-9]", "", str(value).upper())
    if not target:
        return 0.0
    best = 0.0
    for line in lines:
        line_text = re.sub(r"[^A-Z0-9]", "", str(line.get("text", "")).upper())
        if len(line_text) < 2:
            continue
        if target in line_text or line_text in target:
            best = max(best, float(line.get("conf") or 0))
    return round(best, 4)


def extract_trade_license_expiry(raw_text, lines=None):
    """Extract an unambiguous future-style expiry date from a UAE trade licence.

    The result is evidence for an admin, not an automatic approval signal. OCR
    can make date mistakes, so the document remains pending for manual review.
    """
    text = raw_text or ""
    labelled = []
    for match in _EXPIRY_LABEL_RE.finditer(text):
        labelled.extend(_DATE_RE.findall(text[match.start():match.end() + 80]))
    candidates = labelled or _DATE_RE.findall(text)
    for candidate in candidates:
        normalized = candidate.replace("-", "/")
        parsed = None
        for date_format in ("%d/%m/%Y", "%d/%m/%y", "%Y/%m/%d"):
            try:
                parsed = datetime.strptime(normalized, date_format).date()
                break
            except ValueError:
                continue
        if parsed and parsed.year >= 2020:
            iso_value = parsed.isoformat()
            return {
                "expires_at": iso_value,
                "source_text": candidate,
                "confidence": _confidence_from_lines(candidate, lines or []),
                "label_matched": candidate in labelled,
            }
    return {"expires_at": None, "source_text": None, "confidence": 0.0, "label_matched": False}


def scan_trade_license_expiry(image_file, ocr_provider=None):
    """Run the existing PaddleOCR provider and return only trade-licence expiry evidence."""
    provider = ocr_provider or get_default_ocr_provider()
    processed_image = preprocess_image(image_file)
    raw_text, lines = _ocr_extract(provider, processed_image)
    result = extract_trade_license_expiry(raw_text or "", lines or [])
    return {"raw_text": raw_text or "", "lines": lines or [], **result}


# --- Dealer OCR auto-approval (Task 6) ---------------------------------------

# The two required documents for a UAE-classifieds dealer. Both must clear the
# threshold before the auto-approval worker fires.
REQUIRED_DEALER_DOCS_FOR_AUTO_APPROVAL = ("trade_license", "tax_registration")


def dealer_document_ocr_status(document, threshold=DEFAULT_ACCEPTANCE_THRESHOLD):
    """Return safe, dealer-facing OCR feedback for one document row.

    The raw OCR text stays private. Dealers only need to know whether the
    automatic read is complete, whether the scan needs replacing, and what to
    do next. ``ocr_expires_at`` is intentionally checked for trade licences:
    a manually supplied expiry is a valid recovery path, but it does not mean
    OCR successfully read the expiry date.
    """
    document = document or {}
    confidence = float(document.get("ocr_confidence") or 0.0)
    scanned = bool(document.get("ocr_scanned_at"))
    threshold = float(threshold)
    if not scanned:
        return {
            "status": "not_scanned",
            "confidence": confidence,
            "threshold": threshold,
            "message": "Automatic document check is still pending.",
        }
    if document.get("document_type") == "trade_license" and not document.get("ocr_expires_at"):
        return {
            "status": "needs_manual_expiry",
            "confidence": confidence,
            "threshold": threshold,
            "message": "We couldn't read the trade-license expiry date. Upload a sharper full-page scan or enter the expiry date manually.",
        }
    if confidence < threshold:
        return {
            "status": "needs_clearer_scan",
            "confidence": confidence,
            "threshold": threshold,
            "message": "We couldn't read this document clearly enough. Upload a sharper, well-lit full-page scan so automatic verification can continue.",
        }
    return {
        "status": "passed",
        "confidence": confidence,
        "threshold": threshold,
        "message": "Automatic document check passed. Final approval will follow once both required documents are ready.",
    }


DEALER_DOCUMENT_LABELS = {
    "trade_license": "Trade License",
    "tax_registration": "TRN Certificate",
}


def dealer_document_reupload_prompt(document, threshold=DEFAULT_ACCEPTANCE_THRESHOLD):
    """Build a safe notification payload when a dealer document needs action.

    This is deliberately pure and contains no OCR text or storage data. It is
    shared by email, push, and tests so every channel uses the same threshold,
    score, status, and next-step wording.
    """
    status = dealer_document_ocr_status(document, threshold=threshold)
    if status["status"] not in {"needs_clearer_scan", "needs_manual_expiry"}:
        return None
    document_type = str((document or {}).get("document_type") or "document")
    label = DEALER_DOCUMENT_LABELS.get(document_type, document_type.replace("_", " ").title())
    confidence = status["confidence"]
    threshold_value = status["threshold"]
    if status["status"] == "needs_manual_expiry":
        message = (
            f"Your {label} needs attention. We read it at {confidence:.1%} confidence, "
            f"below the {threshold_value:.1%} automatic-check threshold, and could not "
            "read the trade-license expiry date. Please re-upload a sharper, well-lit "
            "full-page scan or enter the expiry date manually."
        )
    else:
        message = (
            f"Your {label} needs to be re-uploaded. The automatic check read it at "
            f"{confidence:.1%} confidence, below the {threshold_value:.1%} threshold. "
            "Please upload a sharper, well-lit full-page scan so verification can continue."
        )
    return {
        "status": status["status"],
        "document_type": document_type,
        "document_label": label,
        "confidence": confidence,
        "threshold": threshold_value,
        "title": f"Action needed: re-upload your {label}",
        "message": message,
    }


def _overall_text_confidence(lines):
    """Mean recognition confidence across all OCR lines (PaddleOCR's per-line
    confidence). Returns 0.0 if there are no lines."""
    if not lines:
        return 0.0
    return round(sum(float(l.get("conf") or 0) for l in lines) / len(lines), 4)


def should_auto_approve_dealer(active_docs, threshold=0.90):
    """Pure decision: should the dealer's KYC auto-approve at fire time?

    - Both required documents must be present and not replaced.
    - min(ocr_confidence) must be >= threshold.
    - Documents with an explicit 'rejected' status disqualify auto-approval.

    Returns a dict: {approve, missing, min_confidence, blocking_field, confidences}
    so the worker has everything it needs to log + write a cancel reason.
    """
    by_type = {}
    for doc in (active_docs or []):
        if doc.get("replaced_at"):
            continue
        if doc.get("status") in {"denied", "rejected"}:
            # An explicit rejection disqualifies auto-approval; the dealer
            # must re-submit before the worker will consider them again.
            continue
        by_type[doc.get("document_type")] = doc
    missing = [d for d in REQUIRED_DEALER_DOCS_FOR_AUTO_APPROVAL if d not in by_type]
    if missing:
        return {"approve": False, "missing": missing, "min_confidence": 0.0,
                "blocking_field": missing[0], "confidences": {}}
    confidences = {d: float(by_type[d].get("ocr_confidence") or 0.0)
                   for d in REQUIRED_DEALER_DOCS_FOR_AUTO_APPROVAL}
    min_conf = min(confidences.values())
    if min_conf < float(threshold):
        blocking = min(confidences, key=confidences.get)
        return {"approve": False, "missing": [], "min_confidence": min_conf,
                "blocking_field": blocking, "confidences": confidences}
    return {"approve": True, "missing": [], "min_confidence": min_conf,
            "blocking_field": None, "confidences": confidences}


def scan_trn_document(image_file, ocr_provider=None):
    """Run PaddleOCR on a TRN (Tax Registration) certificate.

    Symmetric to scan_trade_license_expiry: returns the raw text + a confidence
    value so the dealer auto-approval decision has the same shape for both
    required documents. A TRN document has no "expiry" — we only care about
    its overall OCR confidence.
    """
    provider = ocr_provider or get_default_ocr_provider()
    processed_image = preprocess_image(image_file)
    raw_text, lines = _ocr_extract(provider, processed_image)
    return {
        "raw_text": raw_text or "",
        "lines": lines or [],
        "confidence": _overall_text_confidence(lines or []),
    }


FLOOR_CONFIDENCE = 0.6


def attribute_confidence(fields, lines):
    """Overwrite heuristic field confidences with PaddleOCR's actual line
    confidence.

    `overall` is the mean over fields that were CLEANLY read — i.e. present
    AND matched to a real OCR line. A value we extracted but couldn't match
    to a clean line (a make/model assembled from a garbled/repeated
    vehicle-type run) is uncertain: it keeps a modest floor and is still
    returned + autofilled for the user to verify, but it does not drag the
    summary confidence down. Missing fields are excluded entirely (so a
    scan with no model no longer averages ~0.3).
    """
    conf = {}
    floored = set()
    for field in ("make", "model", "year", "vin", "plate_number"):
        value = fields.get(field)
        if not value:
            conf[field] = 0.0
            continue
        c = _confidence_from_lines(value, lines)
        if c > 0:
            conf[field] = c
        else:
            conf[field] = FLOOR_CONFIDENCE
            floored.add(field)

    real = [conf[f] for f in ("make", "model", "year", "vin") if fields.get(f) and f not in floored]
    if real:
        conf["overall"] = round(sum(real) / len(real), 4)
    else:
        present = [conf[f] for f in ("make", "model", "year", "vin") if fields.get(f)]
        conf["overall"] = round(sum(present) / len(present), 4) if present else 0.0
    return conf


def get_default_ocr_provider():
    # OCR runs on the standalone PaddleOCR microservice (OCR_SERVICE_URL).
    return PaddleOCRServiceProvider()


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


def _max_upload_bytes():
    return max(1, _env_int("OCR_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES))


def _validate_upload_size(image_file, max_upload_bytes=None):
    """Reject oversized seekable uploads before image/PDF decoders inspect them."""
    limit = _max_upload_bytes() if max_upload_bytes is None else max_upload_bytes
    stream = getattr(image_file, "stream", image_file)
    if not hasattr(stream, "seek") or not hasattr(stream, "tell"):
        return
    current = stream.tell()
    try:
        stream.seek(0, os.SEEK_END)
        if stream.tell() > limit:
            raise ValueError("image upload is too large")
    finally:
        stream.seek(current)


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
    raw_pdf = image_file.read(_max_upload_bytes() + 1)
    if len(raw_pdf) > _max_upload_bytes():
        raise ValueError("image upload is too large")
    pdf = pdfium.PdfDocument(raw_pdf)
    if len(pdf) < 1:
        raise ValueError("PDF upload must contain at least one page")
    max_pages = max(1, _env_int("OCR_MAX_PDF_PAGES", DEFAULT_MAX_PDF_PAGES))
    if len(pdf) > max_pages:
        raise ValueError(f"PDF upload must contain at most {max_pages} pages")
    page = pdf[0]
    page_width, page_height = page.get_size()
    max_page_points = max(
        1, _env_int("OCR_MAX_PDF_PAGE_POINTS", DEFAULT_MAX_PDF_PAGE_POINTS)
    )
    max_page_side = max(
        1, _env_int("OCR_MAX_PDF_PAGE_SIDE", DEFAULT_MAX_PDF_PAGE_SIDE)
    )
    if (
        page_width <= 0
        or page_height <= 0
        or page_width > max_page_side
        or page_height > max_page_side
        or page_width * page_height > max_page_points
    ):
        raise ValueError("PDF page dimensions are too large")
    render_scale = 3
    if page_width * page_height * render_scale * render_scale > _max_image_pixels():
        raise ValueError("rendered PDF page dimensions are too large")
    bitmap = page.render(scale=render_scale)
    if bitmap.width * bitmap.height > _max_image_pixels():
        raise ValueError("rendered PDF page dimensions are too large")
    bitmap = bitmap.to_pil()
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
    _validate_upload_size(image_file)
    image_file.seek(0)
    try:
        if _looks_like_pdf(image_file):
            image = _render_pdf_first_page(image_file)
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                image = Image.open(image_file)
    except (UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ValueError("image upload must be a valid image") from exc
    except Image.DecompressionBombWarning as exc:
        raise ValueError("image dimensions are too large") from exc
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
    ocr_diagnostics=None,
):
    metadata = metadata or {}
    payload = {
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
    # The target column lands in the learning-foundation migration. Preserve
    # compatibility with live projects until that migration is intentionally run.
    if ocr_diagnostics and os.getenv("OCR_DIAGNOSTICS_AUDIT_ENABLED", "false").lower() in ("1", "true", "yes", "on"):
        payload["ocr_diagnostics"] = ocr_diagnostics
    return payload


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
    best_lines = []
    best_fields = {"make": None, "model": None, "year": None, "vin": None}
    best_score = -1.0

    for variant in _build_ocr_variants(processed_image):
        raw_text, lines = _ocr_extract(provider, variant)
        raw_text = raw_text or ""
        fields, _heuristic_conf = extract_registration_fields(raw_text)
        score = (
            (0.4 if fields.get("vin") else 0)
            + (0.2 if fields.get("make") else 0)
            + (0.2 if fields.get("model") else 0)
            + (0.2 if fields.get("year") else 0)
        )
        if score > best_score:
            best_score = score
            best_raw_text = raw_text
            best_lines = lines
            best_fields = fields

    ocr_diagnostics = dict(getattr(provider, "last_diagnostics", {}) or {})

    raw_text = best_raw_text
    fields = best_fields

    # Plate number/code (for plate listings) — extracted from the same OCR
    # text via label proximity + format matching, not a blind first-number
    # grab. Car/bike flows simply ignore these keys.
    plate = extract_plate_fields(raw_text)
    fields = {**fields, "plate_number": plate["plate_number"], "plate_code": plate["plate_code"]}

    # Real per-field confidence from PaddleOCR's recognition scores, with
    # overall averaged over PRESENT fields only.
    confidence = attribute_confidence(fields, best_lines)
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
        ocr_diagnostics=ocr_diagnostics,
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
