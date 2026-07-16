"""Warm the PaddleOCR model cache at build time so the runtime container never
needs network access to fetch models. PaddleOCR downloads its detection,
recognition and angle-classification models on first construction and caches
them under ~/.paddleocr (or PADDLE_OCR_BASE_DIR). Constructing it once here
during the Docker build bakes those models into the image layer.
"""
import os
import sys

lang = os.getenv("OCR_LANG", "en")
print(f"Warming PaddleOCR model cache (lang={lang})...", flush=True)
try:
    from paddleocr import PaddleOCR

    PaddleOCR(use_angle_cls=True, lang=lang, show_log=False)
except Exception as exc:  # noqa: BLE001
    # Fatal: PaddleOCR is the only OCR engine. A missing model means every
    # scan would 503 in production, so fail the build instead of shipping it.
    print(f"ERROR: PaddleOCR model warm-up failed ({exc}). Failing the build.", file=sys.stderr, flush=True)
    sys.exit(1)

print("PaddleOCR models ready.", flush=True)
