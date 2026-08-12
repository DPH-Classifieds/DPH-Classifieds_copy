from __future__ import annotations

import re
from dataclasses import dataclass, field

from .decision import FailReason

PROFANITY_TOKENS = (
    r"\bf[\W_]*u[\W_]*c[\W_]*k\b",
    r"\bsh[\W_!1]*t\b",
    r"\bb[\W_]*itch\b",
    r"\bcunt\b",
    r"\basshole\b",
)
_PROFANITY_RE = re.compile("|".join(PROFANITY_TOKENS), re.IGNORECASE)

PHONE_RE = re.compile(r"\+?\d[\d\s\-]{7,}")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
SOCIAL_RE = re.compile(
    r"\b(?:t\.me|wa\.me|whatsapp|instagram|insta|tiktok|snap)\b", re.IGNORECASE
)


@dataclass(frozen=True)
class ImageAnalysis:
    ok: bool
    reasons: list = field(default_factory=list)
    raw: list = field(default_factory=list)


def evaluate_profanity(texts):
    for t in texts or []:
        if not t:
            continue
        if _PROFANITY_RE.search(t):
            return [FailReason("profanity_detected", {"sample": t[:80]})]
    return []


def _looks_like_contact_text(text):
    if not text:
        return False
    if PHONE_RE.search(text):
        return True
    if EMAIL_RE.search(text):
        return True
    if SOCIAL_RE.search(text):
        return True
    return False


def evaluate_image_blockers(image_bytes_list, provider, *, face_confidence_threshold):
    reasons = []
    raw = []
    for idx, blob in enumerate(image_bytes_list or []):
        result = provider.analyze(blob)
        raw.append(result)
        if not result.available:
            reasons.append(FailReason("vision_unavailable", {"image_index": idx}))
            continue
        # A face is review-only and only when the provider has an actual
        # confidence score. Haar cascades do not expose reliable confidence and
        # frequently see faces in headlights, grilles and reflections.
        confirmed_faces = [
            score for score in (getattr(result, "face_confidences", None) or [])
            if score >= face_confidence_threshold
        ]
        if confirmed_faces:
            reasons.append(
                FailReason(
                    "face_detected_in_image",
                    {
                        "image_index": idx,
                        "face_count": len(confirmed_faces),
                        "max_confidence": max(confirmed_faces),
                    },
                )
            )
        if result.nsfw_likely:
            reasons.append(FailReason("nsfw_image", {"image_index": idx}))
        for txt in result.contact_text or []:
            if _looks_like_contact_text(txt):
                reasons.append(
                    FailReason(
                        "contact_info_in_image",
                        {"image_index": idx, "sample": txt[:80]},
                    )
                )
                break
    return ImageAnalysis(ok=not reasons, reasons=reasons, raw=raw)
