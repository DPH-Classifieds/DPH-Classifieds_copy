from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class VisionResult:
    available: bool
    nsfw_likely: bool = False
    face_count: int = 0
    contains_vehicle: bool = False
    contact_text: list = field(default_factory=list)


class NullVisionProvider:
    """No vision API configured — skip image checks entirely (pass-through)."""

    def analyze(self, image_bytes):
        return VisionResult(available=True)


class GoogleVisionProvider:
    """Stub: real implementation should call Vision API annotate with
    FACE_DETECTION + SAFE_SEARCH_DETECTION + OBJECT_LOCALIZATION +
    TEXT_DETECTION features and map response → VisionResult.

    Filter ``faceAnnotations`` by ``detectionConfidence >= face_confidence_threshold``
    before populating face_count.
    """

    def __init__(self, api_key, face_confidence_threshold=0.6):
        if not api_key:
            raise ValueError("GoogleVisionProvider requires api_key")
        self._api_key = api_key
        self._face_threshold = face_confidence_threshold

    def analyze(self, image_bytes):
        raise NotImplementedError("GoogleVisionProvider HTTP call not yet wired")


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

    def __init__(self, face_confidence_threshold=0.6, nsfw_score_threshold=0.5):
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
        # minNeighbors=8 trades a little recall for far fewer false positives
        # on car photos (grilles/reflections). Real faces still detect well.
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
        )


def select_vision_provider(env=None):
    env = env if env is not None else os.environ
    name = (env.get("AUTO_REVIEW_VISION_PROVIDER") or "null").strip().lower()
    if name in ("", "null", "none"):
        return NullVisionProvider()
    try:
        threshold = float(env.get("AUTO_REVIEW_FACE_CONFIDENCE_THRESHOLD", "0.6"))
    except (TypeError, ValueError):
        threshold = 0.6
    if name == "local":
        return LocalVisionProvider(face_confidence_threshold=threshold)
    if name == "google":
        return GoogleVisionProvider(
            api_key=env.get("GOOGLE_VISION_API_KEY", ""),
            face_confidence_threshold=threshold,
        )
    raise ValueError("Unknown AUTO_REVIEW_VISION_PROVIDER: " + name)
