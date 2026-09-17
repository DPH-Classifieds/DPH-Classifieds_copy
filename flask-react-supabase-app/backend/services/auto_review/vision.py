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


YUNET_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "models", "face_detection_yunet_2023mar.onnx"
)


class LocalVisionProvider:
    """Self-hosted, offline face + NSFW detection — no API keys, no per-image
    network calls. Nudity via NudeNet (ONNX/onnxruntime), faces via OpenCV's
    YuNet DNN detector. The heavy deps (nudenet, opencv, onnxruntime, numpy)
    are imported lazily so only the auto-review worker ever loads them — the web
    process never pays the memory cost.

    Faces used to be Haar, which produced no confidence and so — per
    hard_blockers.evaluate_image_blockers, which only acts on scored faces —
    could never flag anything: local face detection was inert. Measured over
    1,464 live car listings and 24 people photos:

        Haar (minNeighbors=8)  449/1464 false positives (30.7%), 87.5% recall
        YuNet @ 0.80            2/1464 false positives  (0.1%), 79.2% recall
        YuNet @ 0.85            0/1464 false positives  (0.0%), 75.0% recall

    Haar's "faces" were headlights, grilles and reflections. YuNet is also ~9x
    faster (4ms vs 36ms median). Drop the threshold to 0.80 to trade 2 extra
    manual reviews per ~1,500 listings for ~4 points of recall.
    """

    # NudeNet detection classes that count as explicit nudity.
    _EXPOSED_CLASSES = frozenset({
        "FEMALE_BREAST_EXPOSED",
        "FEMALE_GENITALIA_EXPOSED",
        "MALE_GENITALIA_EXPOSED",
        "BUTTOCKS_EXPOSED",
        "ANUS_EXPOSED",
    })
    # YuNet's own pre-NMS cutoff. Kept well below the policy threshold so the
    # caller, not the model, decides what counts as a confirmed face.
    _DETECTOR_SCORE_FLOOR = 0.3
    # Faces are found on a downscaled copy: 640px is plenty for a face large
    # enough to identify someone, and keeps inference at a few milliseconds.
    _DETECT_MAX_SIDE = 640

    def __init__(self, face_confidence_threshold=0.85, nsfw_score_threshold=0.85):
        self._face_threshold = face_confidence_threshold
        self._nsfw_threshold = nsfw_score_threshold
        self._detector = None
        self._face_detector = None

    def _ensure_loaded(self):
        if self._detector is not None:
            return
        import cv2
        from nudenet import NudeDetector

        self._detector = NudeDetector()
        model_path = os.getenv("AUTO_REVIEW_FACE_MODEL_PATH") or YUNET_MODEL_PATH
        self._face_detector = cv2.FaceDetectorYN.create(
            model_path, "", (320, 320), score_threshold=self._DETECTOR_SCORE_FLOOR
        )

    def _decode(self, image_bytes):
        """Decode to BGR, falling back to Pillow (with HEIF registered).

        cv2.imdecode cannot read HEIC, and iPhone uploads do reach storage as
        HEIC bytes behind a .jpg/.jpeg name — 9 of 1,473 images sampled from
        live listings were exactly that. Every one of them decoded to None and
        so skipped nudity and face moderation entirely, which is a moderation
        bypass anyone could trigger by renaming a file.
        """
        import cv2
        import numpy as np

        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is not None:
            return img
        try:
            import io

            from PIL import Image, ImageOps

            try:
                from pillow_heif import register_heif_opener

                register_heif_opener()
            except ImportError:  # HEIC then stays undecodable -> fails closed
                pass

            with Image.open(io.BytesIO(image_bytes)) as handle:
                handle.load()
                rgb = ImageOps.exif_transpose(handle).convert("RGB")
            return np.asarray(rgb)[:, :, ::-1].copy()
        except Exception:  # noqa: BLE001 - genuinely undecodable
            return None

    def _detect_faces(self, img):
        import cv2

        height, width = img.shape[:2]
        scale = min(1.0, self._DETECT_MAX_SIDE / max(height, width))
        small = (
            cv2.resize(img, (int(width * scale), int(height * scale)))
            if scale < 1.0
            else img
        )
        self._face_detector.setInputSize((small.shape[1], small.shape[0]))
        _, faces = self._face_detector.detect(small)
        return sorted(
            (round(float(face[-1]), 4) for face in (faces if faces is not None else [])),
            reverse=True,
        )

    def analyze(self, image_bytes):
        self._ensure_loaded()

        img = self._decode(image_bytes)
        if img is None:
            # Fail closed. An image nothing can decode is an image nothing has
            # moderated, and available=True here used to wave it straight
            # through. available=False raises vision_unavailable, which queues
            # the listing for a human (it is not one of the hard-block labels,
            # so nothing gets deleted on an unreadable file).
            return VisionResult(available=False)

        face_confidences = self._detect_faces(img)

        detections = self._detector.detect(img)
        nsfw_likely = any(
            d.get("class") in self._EXPOSED_CLASSES
            and d.get("score", 0.0) >= self._nsfw_threshold
            for d in detections
        )

        return VisionResult(
            available=True,
            nsfw_likely=nsfw_likely,
            # face_count stays the raw detector count for audit telemetry;
            # the blocker path only acts on scores above its own threshold.
            face_count=len(face_confidences),
            face_confidences=face_confidences,
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
