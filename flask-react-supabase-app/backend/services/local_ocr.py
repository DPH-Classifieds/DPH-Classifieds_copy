import io
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

_MODEL_DIR = os.getenv("EASYOCR_MODEL_DIR") or "/app/easyocr_models"
_INIT_TIMEOUT_SECONDS = int(os.getenv("EASYOCR_INIT_TIMEOUT", "30"))

_reader = None
_init_error = None
_ready = threading.Event()


def _log_runtime_diagnostics():
    model_path = Path(_MODEL_DIR)
    exists = model_path.is_dir()
    entries = []
    if exists:
        try:
            entries = sorted(child.name for child in model_path.iterdir())
        except OSError:
            entries = []
    model_files_present = any(name.endswith(".pth") or name.endswith(".zip") for name in entries)
    logger.info(
        "EasyOCR model directory: %s (exists=%s, files=%s)",
        _MODEL_DIR,
        exists,
        len(entries),
    )
    logger.info(
        "EasyOCR models present: %s",
        "yes" if model_files_present else "no",
    )
    if not model_files_present:
        logger.warning(
            "EasyOCR model directory is missing expected model files: %s",
            _MODEL_DIR,
        )


def _init():
    global _reader, _init_error
    try:
        import easyocr

        logger.info("Loading EasyOCR (en + ar) from %s", _MODEL_DIR)
        _reader = easyocr.Reader(
            ["en", "ar"],
            model_storage_directory=_MODEL_DIR,
            download_enabled=False,
            verbose=False,
        )
        logger.info("EasyOCR ready.")
    except Exception as exc:
        _init_error = exc
        logger.error("EasyOCR failed to load (model_dir=%s): %s", _MODEL_DIR, exc)
    finally:
        _ready.set()


# Skip EasyOCR loading in worker mode — it's not needed there and wastes memory.
if os.getenv("SERVICE_ROLE") != "worker":
    _log_runtime_diagnostics()
    threading.Thread(target=_init, daemon=True).start()
else:
    _ready.set()  # mark ready so _get_reader() returns None cleanly


def _get_reader():
    if not _ready.is_set():
        return None  # still initialising — caller should return 503
    return _reader   # None if init failed permanently


def _load_image(stream):
    stream.seek(0)
    raw = stream.read()
    if raw[:5] == b"%PDF-":
        try:
            import pypdfium2 as pdfium
        except ImportError as exc:
            raise RuntimeError("pypdfium2 is not installed") from exc

        pdf = pdfium.PdfDocument(raw)
        if len(pdf) < 1:
            raise ValueError("PDF upload must contain at least one page")
        return pdf[0].render(scale=3).to_pil()

    return io.BytesIO(raw)


def extract_text(stream):
    """Run EasyOCR on an image stream. Returns plain text string."""
    if not _ready.wait(timeout=_INIT_TIMEOUT_SECONDS):
        raise RuntimeError("EasyOCR not ready")

    reader = _get_reader()
    if reader is None:
        if _init_error is not None:
            raise RuntimeError(f"EasyOCR failed to load: {_init_error}") from _init_error
        raise RuntimeError("EasyOCR not ready")
    import numpy as np
    from PIL import Image

    image_source = _load_image(stream)
    if isinstance(image_source, io.BytesIO):
        img = Image.open(image_source).convert("RGB")
    else:
        img = image_source.convert("RGB")
    results = reader.readtext(np.array(img))
    return " ".join(text for _, text, conf in results if conf > 0.3)
