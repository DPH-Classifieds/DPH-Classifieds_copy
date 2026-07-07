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
import easyocr  # noqa: E402
easyocr.Reader(["en", "ar"], model_storage_directory=model_dir, download_enabled=True, verbose=True)
print("EasyOCR models ready.", flush=True)
