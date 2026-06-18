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
    """Always returns available=False. Worker treats that as soft-fail → human queue."""

    def analyze(self, image_bytes):
        return VisionResult(available=False)


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


def select_vision_provider(env=None):
    env = env if env is not None else os.environ
    name = (env.get("AUTO_REVIEW_VISION_PROVIDER") or "null").strip().lower()
    if name in ("", "null", "none"):
        return NullVisionProvider()
    if name == "google":
        try:
            threshold = float(env.get("AUTO_REVIEW_FACE_CONFIDENCE_THRESHOLD", "0.6"))
        except (TypeError, ValueError):
            threshold = 0.6
        return GoogleVisionProvider(
            api_key=env.get("GOOGLE_VISION_API_KEY", ""),
            face_confidence_threshold=threshold,
        )
    raise ValueError("Unknown AUTO_REVIEW_VISION_PROVIDER: " + name)
