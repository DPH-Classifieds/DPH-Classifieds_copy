import io
import logging
import os
import threading

logger = logging.getLogger(__name__)

_MODEL_DIR = os.getenv("EASYOCR_MODEL_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "easyocr_models",
)

_reader = None
_ready = threading.Event()


def _init():
    global _reader
    import easyocr
    try:
        logger.info("Loading EasyOCR (en + ar) from %s", _MODEL_DIR)
        _reader = easyocr.Reader(
            ["en", "ar"],
            model_storage_directory=_MODEL_DIR,
            download_enabled=True,
            verbose=False,
        )
        logger.info("EasyOCR ready.")
    except Exception as exc:
        logger.error("EasyOCR failed to load (model_dir=%s): %s", _MODEL_DIR, exc)
    finally:
        _ready.set()


# Start in background so imports are never blocking
threading.Thread(target=_init, daemon=True).start()


def _get_reader():
    if not _ready.is_set():
        return None  # still initialising — caller should return 503
    return _reader   # None if init failed permanently


def extract_text(stream):
    """Run EasyOCR on an image stream. Returns plain text string."""
    reader = _get_reader()
    if reader is None:
        raise RuntimeError("EasyOCR not ready")
    import numpy as np
    from PIL import Image

    stream.seek(0)
    img = Image.open(io.BytesIO(stream.read())).convert("RGB")
    results = reader.readtext(np.array(img))
    return " ".join(text for _, text, conf in results if conf > 0.3)
