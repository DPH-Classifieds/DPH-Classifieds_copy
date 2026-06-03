# flask-react-supabase-app/backend/routes/dealer/diagnostic.py
"""GET /api/dealer/listings/<type>/<id>/diagnostic"""
import os
import requests
from flask import Blueprint, g, jsonify

from services.dealer_diagnostic import build_findings, verdict_from
from services.dealer_market import compute_snapshot
from ._decorators import dealer_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

diagnostic_bp = Blueprint("dealer_diagnostic", __name__, url_prefix="/api/dealer")


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


@diagnostic_bp.route("/listings/<listing_type>/<listing_id>/diagnostic", methods=["GET"])
def listing_diagnostic(listing_type, listing_id):
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        table = {"car": "cars", "bike": "bikes", "plate": "license_plates", "part": "car_parts"}.get(listing_type)
        if not table:
            return jsonify({"error": {"code": "bad_listing_type"}}), 400
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_svc(),
            params={"select": "*", "id": f"eq.{listing_id}", "limit": 1},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return jsonify({"error": {"code": "listing_not_found"}}), 404
        listing = r.json()[0]

        # Latest market snapshot (or compute).
        ms_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_market_snapshots",
            headers=_svc(),
            params={
                "select": "*",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"eq.{listing_id}",
                "order": "snapshot_at.desc",
                "limit": 1,
            }, timeout=10,
        )
        market = (ms_r.json()[0] if ms_r.status_code == 200 and ms_r.json() else None) or {}
        if not market or market.get("comp_count", 0) < 5:
            snap = compute_snapshot(listing_type, listing_id, g.dealer_ctx["dealership_id"])
            if snap and not snap.get("insufficient_comps"):
                market = snap

        # KPI snapshot for this listing (very lightweight - leave deep dive to per-listing analytics).
        kpi = {
            "impressions": listing.get("view_count") or 0,
            "days_on_market": _days_between(listing.get("created_at")),
            "days_since_edit": _days_between(listing.get("updated_at")),
            "cohort_photo_median": 8,   # placeholder until cohort photo-count is wired
            "cohort_desc_p75": 200,
            "cohort_dom_p75": 30,
            "cohort_impressions_median": 50,
        }
        listing["days_on_market"] = kpi["days_on_market"]
        listing["days_since_edit"] = kpi["days_since_edit"]

        findings = build_findings(listing, kpi, market)
        verdict = verdict_from(kpi, market, findings)

        return jsonify({
            "verdict": verdict,
            "findings": [{
                "code": f.code, "problem": f.problem, "evidence": f.evidence,
                "action": f.action, "severity": round(f.severity, 2),
            } for f in findings],
            "cohort_meta": {
                "comp_count": market.get("comp_count"),
                "median_price": market.get("median_price"),
                "p25_price": market.get("p25_price"),
                "p75_price": market.get("p75_price"),
            },
        })

    return _inner()


def _days_between(iso_str):
    if not iso_str:
        return 0
    from datetime import datetime, timezone
    try:
        s = iso_str.replace("Z", "+00:00") if iso_str.endswith("Z") else iso_str
        t = datetime.fromisoformat(s)
        if not t.tzinfo:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).days
    except Exception:
        return 0
