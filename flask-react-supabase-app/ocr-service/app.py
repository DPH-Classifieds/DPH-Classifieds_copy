"""PaddleOCR microservice — a pure image->text engine.

All business logic (VIN validation, plate extraction, field parsing) lives in
the main backend. This service only turns an image into text, so it can be
scaled independently of the main API.

Endpoints:
  GET  /health  -> 200 once the model is loaded (readiness), 503 while loading
  POST /scan    -> multipart `image` -> { "text": "<space-joined OCR text>" }

Auth: every /scan request must send `X-OCR-Service-Key: $OCR_SERVICE_KEY`.
"""
import asyncio
import io
import logging
import os
import threading

import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("ocr-service")

OCR_LANG = os.getenv("OCR_LANG", "en")
OCR_SERVICE_KEY = os.getenv("OCR_SERVICE_KEY", "")
OCR_MIN_CONFIDENCE = float(os.getenv("OCR_MIN_CONFIDENCE", "0.3"))
OCR_MAX_CONCURRENCY = int(os.getenv("OCR_MAX_CONCURRENCY", "2"))
OCR_QUEUE_TIMEOUT = float(os.getenv("OCR_QUEUE_TIMEOUT_SECONDS", "20"))
MAX_IMAGE_BYTES = int(os.getenv("OCR_MAX_IMAGE_MB", "20")) * 1024 * 1024

app = FastAPI(title="ocr-service", docs_url=None, redoc_url=None)

# The predictor is heavy and NOT thread-safe, so we (a) load it in a background
# thread at startup so /health can report readiness without blocking, and
# (b) serialise inference behind a lock, running it in a threadpool so the
# event loop stays free. Horizontal scale comes from more workers/replicas.
_predictor = None
_predictor_error = None
_ready = threading.Event()
_infer_lock = threading.Lock()
_semaphore = asyncio.Semaphore(OCR_MAX_CONCURRENCY)


def _load_predictor():
    global _predictor, _predictor_error
    try:
        from paddleocr import PaddleOCR

        logger.info("Loading PaddleOCR (lang=%s)...", OCR_LANG)
        _predictor = PaddleOCR(use_angle_cls=True, lang=OCR_LANG, show_log=False)
        logger.info("PaddleOCR ready.")
    except Exception as exc:  # noqa: BLE001 - surface any load failure via /health
        _predictor_error = exc
        logger.exception("PaddleOCR failed to load: %s", exc)
    finally:
        _ready.set()


@app.on_event("startup")
def _startup():
    threading.Thread(target=_load_predictor, daemon=True).start()


@app.get("/health")
def health():
    if not _ready.is_set():
        return JSONResponse({"status": "loading"}, status_code=503)
    if _predictor is None:
        return JSONResponse(
            {"status": "error", "detail": str(_predictor_error)}, status_code=503
        )
    return {"status": "ok"}


def _run_ocr(image_bytes):
    """Blocking OCR. Returns space-joined text in reading order."""
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("invalid image") from exc
    from PIL import ImageOps

    image = ImageOps.exif_transpose(image).convert("RGB")
    array = np.array(image)

    with _infer_lock:
        result = _predictor.ocr(array, cls=True)

    # PaddleOCR returns [[ [box, (text, conf)], ... ]] (one page). Sort the
    # detected lines top-to-bottom then left-to-right so downstream regexes see
    # a sensible reading order, and drop low-confidence noise. We keep each
    # line's recognition confidence so the backend can report REAL per-field
    # confidence instead of guessing.
    rows = []
    for page in (result or []):
        for entry in (page or []):
            try:
                box, (text, conf) = entry
            except (ValueError, TypeError):
                continue
            if not text or conf is None or float(conf) < OCR_MIN_CONFIDENCE:
                continue
            top = min(pt[1] for pt in box)
            left = min(pt[0] for pt in box)
            rows.append((round(top / 10), left, text, float(conf)))
    rows.sort(key=lambda item: (item[0], item[1]))
    text = " ".join(r[2] for r in rows).strip()
    lines = [{"text": r[2], "conf": round(r[3], 4)} for r in rows]
    return text, lines


@app.post("/scan")
async def scan(
    image: UploadFile = File(...),
    x_ocr_service_key: str = Header(default=""),
):
    if OCR_SERVICE_KEY and x_ocr_service_key != OCR_SERVICE_KEY:
        raise HTTPException(status_code=401, detail="invalid service key")
    if not _ready.is_set():
        raise HTTPException(status_code=503, detail="model loading")
    if _predictor is None:
        raise HTTPException(status_code=503, detail="model unavailable")

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty image")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")

    # Bound in-flight inferences; if the queue is saturated, fail fast with 503
    # so the caller can retry rather than piling up unbounded work (OOM guard).
    try:
        await asyncio.wait_for(_semaphore.acquire(), timeout=OCR_QUEUE_TIMEOUT)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="ocr service busy")
    try:
        loop = asyncio.get_running_loop()
        text, lines = await loop.run_in_executor(None, _run_ocr, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.exception("OCR inference failed: %s", exc)
        raise HTTPException(status_code=500, detail="ocr failed")
    finally:
        _semaphore.release()

    # `text` stays for back-compat; `lines` carries per-detection confidence.
    return {"text": text, "lines": lines}
