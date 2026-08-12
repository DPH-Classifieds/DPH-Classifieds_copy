"""Client for the private self-hosted vision-service.

The default mode is disabled. Shadow mode records predictions for evaluation
without adding any moderation reason or changing a listing's status.
"""
from __future__ import annotations

import io
import os
import time


def vision_service_mode(env=None):
    env = env if env is not None else os.environ
    mode = str(env.get("VISION_SERVICE_MODE") or "disabled").strip().lower()
    return mode if mode in {"disabled", "shadow"} else "disabled"


class VisionServiceClient:
    def __init__(self, base_url=None, service_key=None, timeout=None):
        self.base_url = (base_url or os.getenv("VISION_SERVICE_URL", "")).rstrip("/")
        self.service_key = service_key or os.getenv("VISION_SERVICE_KEY", "")
        self.timeout = float(timeout or os.getenv("VISION_SERVICE_TIMEOUT_SECONDS", "12"))

    @property
    def configured(self):
        return bool(self.base_url)

    def analyze(self, image_bytes, filename="image.jpg"):
        if not self.configured:
            raise RuntimeError("vision service is not configured")
        import requests

        started = time.monotonic()
        headers = {"X-Vision-Service-Key": self.service_key} if self.service_key else {}
        response = requests.post(
            f"{self.base_url}/v1/analyze",
            files={"image": (filename, io.BytesIO(image_bytes), "image/jpeg")},
            headers=headers,
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"vision service returned {response.status_code}")
        payload = response.json() or {}
        return {
            "model_version": str(payload.get("model_version") or "unknown"),
            "scores": payload.get("scores") or {},
            "observations": payload.get("observations") or {},
            "recommendation": str(payload.get("recommendation") or "review"),
            "latency_ms": int(payload.get("latency_ms") or round((time.monotonic() - started) * 1000)),
        }
