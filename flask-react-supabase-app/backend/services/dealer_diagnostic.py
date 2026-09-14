# flask-react-supabase-app/backend/services/dealer_diagnostic.py
"""Rule-based diagnostic engine: 'why isn't this car selling?'

Each rule returns a Finding or None. Findings are ranked by
severity * rank_weight and the top N returned to the dashboard.
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class Finding:
    code: str
    problem: str       # one-line problem statement
    evidence: str      # the numbers backing it
    action: str        # what to do
    severity: float    # 0..1
    rank_weight: float = 1.0

    @property
    def score(self):
        return self.severity * self.rank_weight


class Rule:
    def evaluate(self, listing, kpi, market) -> Optional[Finding]:
        raise NotImplementedError


class PriceVsMarketRule(Rule):
    code = "price_vs_market"

    def evaluate(self, listing, kpi, market):
        if not market or market.get("comp_count", 0) < 5:
            return None
        rank = market.get("percentile_rank")
        if rank is None or rank < 0.75:
            return None
        median = market.get("median_price")
        p25 = market.get("p25_price")
        p75 = market.get("p75_price")
        price = listing.get("expected_selling_price")
        return Finding(
            code=self.code,
            problem=f"Your asking price sits above the {int(rank * 100)}th percentile of comparable listings.",
            evidence=f"Yours: AED {price:,}. Cohort median AED {int(median):,}; fair band AED {int(p25):,}–AED {int(p75):,} (n={market['comp_count']}).",
            action=f"Consider repricing into the fair band (AED {int(p25):,}–AED {int(p75):,}).",
            severity=min(1.0, (rank - 0.5) * 2),
            rank_weight=1.5,
        )


class PhotoCountRule(Rule):
    code = "photo_count"

    def evaluate(self, listing, kpi, market):
        n = listing.get("image_count") or 0
        median = kpi.get("cohort_photo_median")
        if median is None or median <= 0:
            return None
        if n >= median * 0.7:
            return None
        return Finding(
            code=self.code,
            problem="Listing has fewer photos than comparable listings.",
            evidence=f"Yours: {n}. Cohort median: {int(median)}.",
            action="Add interior, dashboard, engine bay and rear photos. Aim for 10+.",
            severity=min(1.0, (median - n) / max(1, median)),
            rank_weight=1.2,
        )


class TitleCompletenessRule(Rule):
    code = "title_completeness"

    def evaluate(self, listing, kpi, market):
        trim = (listing.get("trim") or "").strip()
        if trim:
            return None
        return Finding(
            code=self.code,
            problem="Listing title is missing trim (e.g. XLE, Sport, GCC).",
            evidence="Most comparable listings include trim in the title.",
            action="Edit the listing and add the trim level.",
            severity=0.5,
            rank_weight=0.8,
        )


class VinRule(Rule):
    code = "vin_missing"

    def evaluate(self, listing, kpi, market):
        if (listing.get("vin") or "").strip():
            return None
        return Finding(
            code=self.code,
            problem="VIN not provided.",
            evidence="Buyers expect a VIN for verification; listings with VIN convert better.",
            action="Add the VIN to the listing (from the registration card).",
            severity=0.6,
            rank_weight=1.0,
        )


class DescriptionLengthRule(Rule):
    code = "description_short"

    def evaluate(self, listing, kpi, market):
        desc = (listing.get("description") or "").strip()
        words = len(desc.split())
        target = kpi.get("cohort_desc_p75")
        if target is None or target <= 0:
            return None
        if words >= target * 0.6:
            return None
        return Finding(
            code=self.code,
            problem="Description is shorter than top-selling listings in your segment.",
            evidence=f"Yours: {words} words. Top-quartile sold listings: {int(target)}+ words.",
            action="Expand the description: service history, accidents, included extras, GCC/import, ownership.",
            severity=min(1.0, 1 - (words / max(1, target))),
            rank_weight=0.9,
        )


class DaysOnMarketRule(Rule):
    code = "dom_long"

    def evaluate(self, listing, kpi, market):
        dom = listing.get("days_on_market") or 0
        p75 = kpi.get("cohort_dom_p75")
        if p75 is None or p75 <= 0:
            return None
        if dom <= p75:
            return None
        return Finding(
            code=self.code,
            problem="Listing has been live longer than most comparable listings that sell.",
            evidence=f"Days on market: {dom}. Cohort 75th percentile: {p75}.",
            action="Refresh photos, lower price by 3–5%, or relist to bump search ranking.",
            severity=min(1.0, (dom - p75) / max(1, p75)),
            rank_weight=1.1,
        )


class EngagementWithoutContactRule(Rule):
    code = "engagement_no_contact"

    def evaluate(self, listing, kpi, market):
        eng = kpi.get("engagement_no_contact") or 0
        detail = kpi.get("detail_views") or 0
        if detail < 20:
            return None
        ratio = eng / max(1, detail)
        if ratio < 0.4:
            return None
        return Finding(
            code=self.code,
            problem="Many viewers engage but don't contact you.",
            evidence=f"{eng} of {detail} detail-page sessions spent 30s+ or browsed multiple photos without contacting.",
            action="Friction is likely price or trust. Verify your phone number is live; consider lowering price; add more photos.",
            severity=min(1.0, ratio),
            rank_weight=1.0,
        )


class StalePhotosRule(Rule):
    code = "stale_listing"

    def evaluate(self, listing, kpi, market):
        dom = listing.get("days_on_market") or 0
        last_edited_days = listing.get("days_since_edit") or 0
        if dom <= 30 or last_edited_days <= 30:
            return None
        return Finding(
            code=self.code,
            problem="Listing hasn't been edited in over 30 days; search ranking may be stale.",
            evidence=f"Last edit was {last_edited_days} days ago.",
            action="Edit any field to refresh the listing — even minor changes rebuild recommendations.",
            severity=0.4,
            rank_weight=0.7,
        )


class MissingFieldsRule(Rule):
    code = "missing_fields"
    REQUIRED = ("kilometers", "make_year", "transmission", "body_type", "exterior_color")

    def evaluate(self, listing, kpi, market):
        missing = [f for f in self.REQUIRED if not listing.get(f)]
        if not missing:
            return None
        missing_labels = ", ".join(m.replace("_", " ") for m in missing)
        return Finding(
            code=self.code,
            problem=f"Listing is missing {len(missing)} expected field(s): {missing_labels}.",
            evidence="Missing: " + missing_labels,
            action="Fill in the missing fields — buyers filter on them.",
            severity=min(1.0, len(missing) / len(self.REQUIRED)),
            rank_weight=0.9,
        )


class PhotoQualityRule(Rule):
    """v1 heuristic: count-only proxy (no image classification yet)."""
    code = "photo_quality"
    def evaluate(self, listing, kpi, market):
        return None  # Deferred to a later phase per spec §12.


ALL_RULES = [
    PriceVsMarketRule(), PhotoCountRule(), TitleCompletenessRule(),
    VinRule(), DescriptionLengthRule(), DaysOnMarketRule(),
    EngagementWithoutContactRule(), StalePhotosRule(),
    MissingFieldsRule(), PhotoQualityRule(),
]


def verdict_from(kpi, market, findings):
    impressions = kpi.get("impressions", 0)
    days_on_market = kpi.get("days_on_market") or 0
    cohort_imp_median = kpi.get("cohort_impressions_median")

    if days_on_market < 3 or impressions < 100:
        return "not_enough_data"
    if cohort_imp_median is None or cohort_imp_median <= 0:
        return "insufficient_benchmark_data"
    if impressions < cohort_imp_median * 0.5:
        return "underperforming_visibility"
    if findings and any(f.code == "engagement_no_contact" for f in findings):
        return "visibility_ok_not_converting"
    if findings:
        return "performing_par"
    return "top_performer"


def build_findings(listing, kpi, market):
    findings = []
    for rule in ALL_RULES:
        try:
            f = rule.evaluate(listing, kpi, market)
            if f:
                findings.append(f)
        except Exception:
            continue
    findings.sort(key=lambda f: f.score, reverse=True)
    return findings[:6]
