"""Private, self-hosted image moderation inference service.

It deliberately returns model scores and observations, not a final listing
decision. The DPH backend owns policy, audit records and any future rollout.
"""
import asyncio
import io
import logging
import os
import threading
import time

import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("vision-service")

VISION_SERVICE_KEY = os.getenv("VISION_SERVICE_KEY", "")
CLIP_MODEL = os.getenv("VISION_CLIP_MODEL", "ViT-B-32")
CLIP_PRETRAINED = os.getenv("VISION_CLIP_PRETRAINED", "laion2b_s34b_b79k")
NSFW_THRESHOLD = float(os.getenv("VISION_NSFW_SCORE_THRESHOLD", "0.85"))
MAX_IMAGE_BYTES = int(os.getenv("VISION_MAX_IMAGE_MB", "20")) * 1024 * 1024
MAX_CONCURRENCY = int(os.getenv("VISION_MAX_CONCURRENCY", "1"))
QUEUE_TIMEOUT = float(os.getenv("VISION_QUEUE_TIMEOUT_SECONDS", "20"))

app = FastAPI(title="vision-service", docs_url=None, redoc_url=None)
_ready = threading.Event()
_load_error = None
_nude_detector = None
_clip_model = None
_clip_preprocess = None
_clip_tokenizer = None
_clip_labels = ("a vehicle listing photo", "an unrelated image")
_lock = threading.Lock()
_semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

EXPOSED_CLASSES = frozenset({
    "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED",
    "BUTTOCKS_EXPOSED", "ANUS_EXPOSED",
})


def _load_models():
    global _load_error, _nude_detector, _clip_model, _clip_preprocess, _clip_tokenizer
    try:
        import open_clip
        import torch
        from nudenet import NudeDetector

        logger.info("Loading NudeNet and open_clip model=%s pretrained=%s", CLIP_MODEL, CLIP_PRETRAINED)
        _nude_detector = NudeDetector()
        _clip_model, _, _clip_preprocess = open_clip.create_model_and_transforms(
            CLIP_MODEL, pretrained=CLIP_PRETRAINED, device="cpu"
        )
        _clip_model.eval()
        _clip_tokenizer = open_clip.get_tokenizer(CLIP_MODEL)
        # Force one harmless CPU path before declaring readiness.
        with torch.no_grad():
            _clip_model.encode_text(_clip_tokenizer(["a vehicle listing photo"]))
        logger.info("Vision models ready")
    except Exception as exc:  # readiness endpoint exposes no internals
        _load_error = exc
        logger.exception("Vision model load failed")
    finally:
        _ready.set()


@app.on_event("startup")
def startup():
    threading.Thread(target=_load_models, daemon=True).start()


@app.get("/health")
def health():
    if not _ready.is_set():
        return JSONResponse({"status": "loading"}, status_code=503)
    if _load_error is not None:
        return JSONResponse({"status": "error"}, status_code=503)
    return {"status": "ok", "model_version": model_version()}


def model_version():
    return f"nudenet+openclip:{CLIP_MODEL}:{CLIP_PRETRAINED}"


def _image_from_bytes(data):
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("invalid image") from exc
    return ImageOps.exif_transpose(image).convert("RGB")


def _analyze(data):
    import torch

    image = _image_from_bytes(data)
    cv_image = np.asarray(image)[:, :, ::-1].copy()
    with _lock:
        detections = _nude_detector.detect(cv_image)
        image_tensor = _clip_preprocess(image).unsqueeze(0)
        tokens = _clip_tokenizer(list(_clip_labels))
        with torch.no_grad():
            image_features = _clip_model.encode_image(image_tensor)
            text_features = _clip_model.encode_text(tokens)
            image_features /= image_features.norm(dim=-1, keepdim=True)
            text_features /= text_features.norm(dim=-1, keepdim=True)
            probabilities = (100.0 * image_features @ text_features.T).softmax(dim=-1)[0]

    exposed = [
        {"class": d.get("class"), "score": round(float(d.get("score") or 0), 4)}
        for d in detections
        if d.get("class") in EXPOSED_CLASSES and float(d.get("score") or 0) >= NSFW_THRESHOLD
    ]
    return {
        "model_version": model_version(),
        "scores": {
            "vehicle": round(float(probabilities[0]), 4),
            "unrelated": round(float(probabilities[1]), 4),
            "explicit": round(max((item["score"] for item in exposed), default=0.0), 4),
        },
        "observations": {"explicit_detections": exposed},
        # A policy-neutral recommendation for shadow comparison only.
        "recommendation": "review" if exposed else "allow",
    }


@app.post("/v1/analyze")
async def analyze(image: UploadFile = File(...), x_vision_service_key: str = Header(default="")):
    if VISION_SERVICE_KEY and x_vision_service_key != VISION_SERVICE_KEY:
        raise HTTPException(status_code=401, detail="invalid service key")
    if not _ready.is_set() or _load_error is not None:
        raise HTTPException(status_code=503, detail="model unavailable")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty image")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    try:
        await asyncio.wait_for(_semaphore.acquire(), timeout=QUEUE_TIMEOUT)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="vision service busy")
    started = time.monotonic()
    try:
        result = await asyncio.get_running_loop().run_in_executor(None, _analyze, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("Vision inference failed")
        raise HTTPException(status_code=500, detail="vision inference failed")
    finally:
        _semaphore.release()
    result["latency_ms"] = round((time.monotonic() - started) * 1000)
    return result
