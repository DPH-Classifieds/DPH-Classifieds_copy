# flask-react-supabase-app/backend/routes/dealer/diagnostic.py
"""GET /api/dealer/listings/<type>/<id>/diagnostic"""
import os
import requests
from functools import wraps
from flask import Blueprint, current_app, g, jsonify

from services.dealer_diagnostic import build_findings, verdict_from
from services.dealer_kpi import dedupe_impressions
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


def _token_required(fn):
    @wraps(fn)
    def decorated(*args, **kwargs):
        return current_app.extensions["dph_user_backend"]["token_required"](fn)(*args, **kwargs)

    return decorated


@diagnostic_bp.route("/listings/<listing_type>/<listing_id>/diagnostic", methods=["GET"])
@_token_required
@dealer_required
def listing_diagnostic(current_user, listing_type, listing_id):
    table = {"car": "cars", "bike": "bikes", "plate": "license_plates", "part": "car_parts"}.get(listing_type)
    if not table:
        return jsonify({"error": {"code": "bad_listing_type"}}), 400
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_svc(),
        params={"select": "*", "id": f"eq.{listing_id}",
                "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}", "limit": 1},
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return jsonify({"error": {"code": "listing_not_found"}}), 404
    listing = r.json()[0]

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
    market = (ms_r.json()[0] if ms_r.status_code == 200 and ms_r.json() else None)
    if not market or market.get("comp_count", 0) < 5:
        snap = compute_snapshot(listing_type, listing_id, g.dealer_ctx["dealership_id"])
        if snap and not snap.get("insufficient_comps"):
            market = snap

    if not market or market.get("comp_count", 0) < 5:
        market = None

    events_r = requests.get(
        f"{SUPABASE_URL}/rest/v1/platform_events",
        headers=_svc(),
        params={
            "select": "visitor_id,user_id,session_id,event_name,page_kind,created_at",
            "listing_type": f"eq.{listing_type}",
            "listing_id": f"eq.{listing_id}",
            "limit": "5000",
        },
        timeout=15,
    )
    impression_events = events_r.json() if events_r.status_code == 200 else []
    impressions = dedupe_impressions(impression_events if isinstance(impression_events, list) else [])

    kpi = {
        "impressions": impressions,
        "days_on_market": _days_between(listing.get("created_at")),
        "days_since_edit": _days_between(listing.get("updated_at")),
        # Cohort thresholds must come from real comparable data. Until that
        # aggregation exists, rules that depend on them stay unavailable.
        "cohort_photo_median": None,
        "cohort_desc_p75": None,
        "cohort_dom_p75": None,
        "cohort_impressions_median": None,
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
        "cohort_meta": ({
            "comp_count": market.get("comp_count"),
            "median_price": market.get("median_price"),
            "p25_price": market.get("p25_price"),
            "p75_price": market.get("p75_price"),
        } if market else None),
    })


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
