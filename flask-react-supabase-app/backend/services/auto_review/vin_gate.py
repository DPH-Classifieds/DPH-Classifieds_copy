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


def _text_mismatch(form_value, decoded_value):
    form_norm = _norm(form_value)
    decoded_norm = _norm(decoded_value)
    if not form_norm or not decoded_norm:
        return False
    # Substring match either direction tolerates trims/variants ("Camry" vs "Camry LE").
    return form_norm not in decoded_norm and decoded_norm not in form_norm


def _year_mismatch(form_year, decoded_year):
    try:
        return abs(int(form_year) - int(decoded_year)) > 1
    except (TypeError, ValueError):
        return False


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

    # A checksum-valid VIN is not enough for automatic approval when the
    # configured decoder cannot return a trustworthy result. The listing must
    # be surfaced for manual review so an upstream outage cannot silently turn
    # an unchecked VIN into an auto-approved listing.
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
            decode_errors = decode_result.get("errors") or []
            if decode_errors:
                reasons.append(
                    FailReason(
                        "vin_decoder_unavailable",
                        {"vin": vin_clean, "errors": list(decode_errors)},
                    )
                )
        except Exception as exc:
            reasons.append(
                FailReason(
                    "vin_decoder_unavailable",
                    {"vin": vin_clean, "error": type(exc).__name__},
                )
            )

    # A submitted make/model/year that contradicts what the VIN itself decodes
    # to is a strong fraud signal — force a human look rather than trusting
    # the submitter's tier.
    mismatches = {}
    if decoded.get("make") and _text_mismatch(form_make, decoded.get("make")):
        mismatches["make"] = {"submitted": form_make, "decoded": decoded.get("make")}
    if decoded.get("model") and _text_mismatch(form_model, decoded.get("model")):
        mismatches["model"] = {"submitted": form_model, "decoded": decoded.get("model")}
    decoded_year = decoded.get("year") or decoded.get("model_year")
    if decoded_year and _year_mismatch(form_year, decoded_year):
        mismatches["year"] = {"submitted": form_year, "decoded": decoded_year}
    if mismatches:
        reasons.append(FailReason("vin_decoded_mismatch", mismatches))

    return VinGateResult(ok=not reasons, reasons=reasons, decoded=decoded)
