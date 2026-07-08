from __future__ import annotations

from .decision import Decision, FailReason

VIN_REQUIRED_TYPES = {"car", "bike"}


def evaluate(listing_type, *, listing, signals):
    """Pure composer; see spec doc for the formula.

    signals dict carries pre-computed gate results from the worker glue:
      - trust:               TrustResult
      - image_analysis:      ImageAnalysis
      - vin:                 VinGateResult | None (ignored for parts/plates)
      - profanity:           list[FailReason]
      - duplicate:           FailReason | None
      - price_outlier:       FailReason | None
      - user_under_review:   bool
    """
    reasons = []
    t = (listing_type or "").lower()

    # Step 1 — hard blockers
    sync_gate = signals.get("sync_gate")
    if sync_gate is not None and not sync_gate.ok:
        reasons.append(FailReason("missing_required_fields", {"missing": sync_gate.missing}))
    reasons.extend(signals.get("profanity") or [])
    image_analysis = signals.get("image_analysis")
    if image_analysis is not None and not image_analysis.ok:
        reasons.extend(image_analysis.reasons)
    if signals.get("duplicate"):
        reasons.append(signals["duplicate"])
    if signals.get("price_outlier"):
        reasons.append(signals["price_outlier"])
    if signals.get("user_under_review"):
        reasons.append(FailReason("user_under_review", {}))

    # Step 2 — VIN gate (cars/bikes only); vin is None means evaluation threw — skip, don't block
    if t in VIN_REQUIRED_TYPES:
        vin = signals.get("vin")
        if vin is not None and not vin.ok:
            reasons.extend(vin.reasons)

    # Step 4 — trust tier
    trust = signals.get("trust")
    if trust is None or not trust.matched:
        reasons.append(FailReason("no_trust_tier", {}))

    if reasons:
        return Decision.queue(reasons, signals={"raw": _summarize(signals)})
    return Decision.approve(tier_matched=trust.tier, signals={"raw": _summarize(signals)})


def _summarize(signals):
    out = {}
    trust = signals.get("trust")
    if trust is not None:
        out["trust"] = {"matched": trust.matched, "tier": trust.tier}
    vin = signals.get("vin")
    if vin is not None:
        out["vin"] = {"ok": vin.ok, "decoded": vin.decoded}
    image_analysis = signals.get("image_analysis")
    if image_analysis is not None:
        out["image_count"] = len(image_analysis.raw)
    return out
