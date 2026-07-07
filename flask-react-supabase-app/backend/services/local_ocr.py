import io
import logging
import os
import threading

logger = logging.getLogger(__name__)

_reader = None
_lock = threading.Lock()

# Models live in backend/easyocr_models/ — baked at build time by download_ocr_models.py.
# This path is relative to this file's location (services/) so it survives into the
# runtime container regardless of what HOME resolves to.
_DEFAULT_MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),  # backend/
    "easyocr_models",
)
_MODEL_DIR = os.getenv("EASYOCR_MODEL_DIR") or _DEFAULT_MODEL_DIR


def _get_reader():
    global _reader
    if _reader is None:
        with _lock:
            if _reader is None:
                import easyocr
                logger.info("Loading EasyOCR models (en + ar) from %s", _MODEL_DIR)
                try:
                    _reader = easyocr.Reader(
                        ["en", "ar"],
                        model_storage_directory=_MODEL_DIR,
                        download_enabled=False,  # models must be pre-baked at build time
                        verbose=False,
                    )
                    logger.info("EasyOCR ready.")
                except Exception as exc:
                    logger.error(
                        "EasyOCR failed to load (model_dir=%s): %s — "
                        "set EASYOCR_MODEL_DIR or ensure models are baked at build time",
                        _MODEL_DIR, exc,
                    )
                    raise
    return _reader


def extract_text(stream):
    """Run EasyOCR on an image stream. Returns plain text string."""
    import numpy as np
    from PIL import Image

    stream.seek(0)
    img = Image.open(io.BytesIO(stream.read())).convert("RGB")
    results = _get_reader().readtext(np.array(img))
    return " ".join(text for _, text, conf in results if conf > 0.3)
