"""Download EasyOCR models into the app directory at build time.

Run from repo root:
    python flask-react-supabase-app/backend/download_ocr_models.py

Models land in  flask-react-supabase-app/backend/easyocr_models/
which is inside the app directory and survives into the runtime container.
"""
import os
import sys

model_dir = os.environ.get("EASYOCR_MODEL_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "easyocr_models"
)
os.makedirs(model_dir, exist_ok=True)

print(f"Downloading EasyOCR models (en + ar) to {model_dir}", flush=True)
try:
    import easyocr  # noqa: E402

    easyocr.Reader(
        ["en", "ar"],
        model_storage_directory=model_dir,
        download_enabled=True,
        verbose=True,
    )
except Exception as exc:
    # Fatal: EasyOCR is the only OCR engine (no Tesseract fallback exists
    # anymore). A missing model means every OCR request would silently
    # 503/needs_review in production, so fail the build instead of shipping it.
    print(f"ERROR: EasyOCR model download failed ({exc}). Failing the build.", file=sys.stderr, flush=True)
    sys.exit(1)

print("EasyOCR models ready.", flush=True)
