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
    vin_clean = (vin or "").strip().upper()
    if not vin_clean:
        # VIN not provided — skip gate entirely
        return VinGateResult(ok=True, reasons=[], decoded={})
    if not VIN_ALLOWED.match(vin_clean):
        return VinGateResult(
            False, [FailReason("vin_format_invalid", {"vin": vin_clean})], {}
        )

    # Some decoders expose is_checksum_valid as a static/classmethod.
    checksum_valid = False
    try:
        checksum_valid = decoder.is_checksum_valid(vin_clean)
    except TypeError:
        checksum_valid = type(decoder).is_checksum_valid(vin_clean)
    if not checksum_valid:
        reasons.append(FailReason("vin_checksum_invalid", {"vin": vin_clean}))

    decode_result = decoder.validate_and_decode(vin_clean) or {}
    decoded = decode_result.get("decoded") or {}
    if not decoded:
        reasons.append(FailReason("vin_decoder_unavailable", {"vin": vin_clean}))
        return VinGateResult(False, reasons, decoded)

    d_make = _norm(decoded.get("make"))
    f_make = _norm(form_make)
    if d_make and f_make and (d_make not in f_make and f_make not in d_make):
        reasons.append(
            FailReason(
                "vin_make_mismatch",
                {"form": form_make, "decoded": decoded.get("make")},
            )
        )

    d_model = _norm(decoded.get("model"))
    f_model = _norm(form_model)
    if d_model and f_model and (d_model not in f_model and f_model not in d_model):
        reasons.append(
            FailReason(
                "vin_model_mismatch",
                {"form": form_model, "decoded": decoded.get("model")},
            )
        )

    try:
        d_year = int(decoded.get("model_year") or decoded.get("year") or 0)
        f_year = int(form_year or 0)
        if d_year and f_year and abs(d_year - f_year) > 1:
            reasons.append(
                FailReason("vin_year_mismatch", {"form": f_year, "decoded": d_year})
            )
    except (TypeError, ValueError):
        reasons.append(
            FailReason(
                "vin_year_mismatch",
                {"form": form_year, "decoded": decoded.get("model_year")},
            )
        )

    return VinGateResult(ok=not reasons, reasons=reasons, decoded=decoded)
