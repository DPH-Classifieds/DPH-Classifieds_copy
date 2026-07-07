import io
import logging
import os
import threading

logger = logging.getLogger(__name__)

_reader = None
_lock = threading.Lock()

# Allow override via env var; default to EasyOCR's own home-dir cache
_MODEL_DIR = os.getenv("EASYOCR_MODEL_DIR", os.path.expanduser("~/.EasyOCR"))


def _get_reader():
    global _reader
    if _reader is None:
        with _lock:
            if _reader is None:
                import easyocr
                logger.info("Loading EasyOCR models (en + ar) from %s", _MODEL_DIR)
                _reader = easyocr.Reader(
                    ["en", "ar"],
                    model_storage_directory=_MODEL_DIR,
                    download_enabled=True,
                    verbose=False,
                )
                logger.info("EasyOCR ready.")
    return _reader


def extract_text(stream):
    """Run EasyOCR on an image stream. Returns plain text string."""
    import numpy as np
    from PIL import Image

    stream.seek(0)
    img = Image.open(io.BytesIO(stream.read())).convert("RGB")
    results = _get_reader().readtext(np.array(img))
    return " ".join(text for _, text, conf in results if conf > 0.3)
