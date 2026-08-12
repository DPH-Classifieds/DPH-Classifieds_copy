from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field

import requests


@dataclass(frozen=True)
class VisionResult:
    available: bool
    nsfw_likely: bool = False
    face_count: int = 0
    # Only providers with calibrated confidence (for example Google Vision)
    # populate this. Local Haar detections intentionally remain unconfirmed.
    face_confidences: list = field(default_factory=list)
    contains_vehicle: bool = False
    contact_text: list = field(default_factory=list)


class NullVisionProvider:
    """No vision API configured — skip image checks entirely (pass-through)."""

    def analyze(self, image_bytes):
        return VisionResult(available=True)


class GoogleVisionProvider:
    """Google Cloud Vision provider with calibrated face + SafeSearch signals.

    It is optional: set AUTO_REVIEW_VISION_PROVIDER=google and a restricted
    GOOGLE_VISION_API_KEY. A request uses only the image bytes already stored
    for moderation; no public image URL is handed to the provider.
    """

    _ENDPOINT = "https://vision.googleapis.com/v1/images:annotate"
    _UNSAFE_LIKELIHOODS = {"LIKELY", "VERY_LIKELY"}
    _VEHICLE_LABELS = {"car", "vehicle", "automobile", "motorcycle", "truck", "suv"}

    def __init__(self, api_key, face_confidence_threshold=0.85):
        if not api_key:
            raise ValueError("GoogleVisionProvider requires api_key")
        self._api_key = api_key
        self._face_threshold = face_confidence_threshold

    def analyze(self, image_bytes):
        try:
            response = requests.post(
                f"{self._ENDPOINT}?key={self._api_key}",
                json={
                    "requests": [{
                        "image": {"content": base64.b64encode(image_bytes).decode("ascii")},
                        "features": [
                            {"type": "SAFE_SEARCH_DETECTION", "maxResults": 1},
                            {"type": "FACE_DETECTION", "maxResults": 10},
                            {"type": "OBJECT_LOCALIZATION", "maxResults": 20},
                            {"type": "TEXT_DETECTION", "maxResults": 5},
                        ],
                    }],
                },
                timeout=15,
            )
            response.raise_for_status()
            payload = (response.json().get("responses") or [{}])[0]
        except (requests.RequestException, ValueError, IndexError):
            # A provider outage must queue/review rather than silently approve.
            return VisionResult(available=False)

        safe = payload.get("safeSearchAnnotation") or {}
        nsfw_likely = str(safe.get("adult") or "").upper() in self._UNSAFE_LIKELIHOODS
        faces = [
            float(face.get("detectionConfidence") or 0)
            for face in (payload.get("faceAnnotations") or [])
        ]
        objects = payload.get("localizedObjectAnnotations") or []
        contains_vehicle = any(
            str(obj.get("name") or "").strip().lower() in self._VEHICLE_LABELS
            for obj in objects
        )
        text = (payload.get("fullTextAnnotation") or {}).get("text") or ""
        return VisionResult(
            available=True,
            nsfw_likely=nsfw_likely,
            face_count=len(faces),
            face_confidences=faces,
            contains_vehicle=contains_vehicle,
            contact_text=[text] if text else [],
        )


class LocalVisionProvider:
    """Self-hosted, offline face + NSFW detection — no API keys, no per-image
    network calls. Nudity via NudeNet (ONNX/onnxruntime), faces via OpenCV's
    bundled Haar cascade. The heavy deps (nudenet, opencv, onnxruntime, numpy)
    are imported lazily so only the auto-review worker ever loads them — the web
    process never pays the memory cost.
    """

    # NudeNet detection classes that count as explicit nudity.
    _EXPOSED_CLASSES = frozenset({
        "FEMALE_BREAST_EXPOSED",
        "FEMALE_GENITALIA_EXPOSED",
        "MALE_GENITALIA_EXPOSED",
        "BUTTOCKS_EXPOSED",
        "ANUS_EXPOSED",
    })

    def __init__(self, face_confidence_threshold=0.85, nsfw_score_threshold=0.85):
        # ponytail: Haar gives no per-face confidence, so face_threshold is
        # unused today — kept for the contract / a future DNN upgrade. Face
        # sensitivity is tuned via minNeighbors in analyze().
        self._face_threshold = face_confidence_threshold
        self._nsfw_threshold = nsfw_score_threshold
        self._detector = None
        self._face_cascade = None

    def _ensure_loaded(self):
        if self._detector is not None:
            return
        import cv2
        from nudenet import NudeDetector

        self._detector = NudeDetector()
        self._face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

    def analyze(self, image_bytes):
        import cv2
        import numpy as np

        self._ensure_loaded()

        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            # Undecodable image — don't block on it, let other gates decide.
            return VisionResult(available=True)

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Kept for audit telemetry only. Haar has no calibrated confidence and
        # must never trigger a rejection or review by itself.
        faces = self._face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=8, minSize=(40, 40)
        )
        face_count = len(faces)

        detections = self._detector.detect(img)
        nsfw_likely = any(
            d.get("class") in self._EXPOSED_CLASSES
            and d.get("score", 0.0) >= self._nsfw_threshold
            for d in detections
        )

        return VisionResult(
            available=True,
            nsfw_likely=nsfw_likely,
            face_count=face_count,
            face_confidences=[],
        )


def select_vision_provider(env=None):
    env = env if env is not None else os.environ
    name = (env.get("AUTO_REVIEW_VISION_PROVIDER") or "null").strip().lower()
    if name in ("", "null", "none"):
        return NullVisionProvider()
    try:
        threshold = float(env.get("AUTO_REVIEW_FACE_CONFIDENCE_THRESHOLD", "0.85"))
    except (TypeError, ValueError):
        threshold = 0.85
    if name == "local":
        try:
            nsfw_threshold = float(env.get("AUTO_REVIEW_NSFW_SCORE_THRESHOLD", "0.85"))
        except (TypeError, ValueError):
            nsfw_threshold = 0.85
        return LocalVisionProvider(
            face_confidence_threshold=threshold,
            nsfw_score_threshold=nsfw_threshold,
        )
    if name == "google":
        return GoogleVisionProvider(
            api_key=env.get("GOOGLE_VISION_API_KEY", ""),
            face_confidence_threshold=threshold,
        )
    raise ValueError("Unknown AUTO_REVIEW_VISION_PROVIDER: " + name)
