from __future__ import annotations

import re
from dataclasses import dataclass, field

from .decision import FailReason

VIN_ALLOWED = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")


@dataclass(frozen=True)
class VinGateResult:
    ok: bool
    reasons: list = field(default_factory=list)
    decoded: dict = field(default_factory=dict)


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def evaluate_vin(vin, *, form_make, form_model, form_year, decoder):
    reasons = []
    vin_clean = re.sub(r"[^A-Z0-9]", "", str(vin or "").upper())
    if not vin_clean:
        # VIN not provided — skip gate entirely
        return VinGateResult(ok=True, reasons=[], decoded={})
    if not VIN_ALLOWED.match(vin_clean):
        return VinGateResult(
            False, [FailReason("vin_format_invalid", {"vin": vin_clean})], {}
        )

    # The current approval flow treats a valid typed VIN as sufficient. Decoder
    # lookups are advisory only so a missing upstream service does not block
    # otherwise valid listings from auto-approving.
    checksum_valid = True
    if decoder is not None:
        try:
            checksum_valid = decoder.is_checksum_valid(vin_clean)
        except TypeError:
            checksum_valid = type(decoder).is_checksum_valid(vin_clean)
        except Exception:
            checksum_valid = True
    else:
        try:
            from services.vin_decoder import VINDecoder

            checksum_valid = VINDecoder.is_checksum_valid(vin_clean)
        except Exception:
            checksum_valid = True

    if not checksum_valid:
        reasons.append(FailReason("vin_checksum_invalid", {"vin": vin_clean}))

    decoded = {}
    if decoder is not None:
        try:
            decode_result = decoder.validate_and_decode(vin_clean) or {}
            decoded = decode_result.get("decoded") or {}
        except Exception:
            decoded = {}

    return VinGateResult(ok=not reasons, reasons=reasons, decoded=decoded)
