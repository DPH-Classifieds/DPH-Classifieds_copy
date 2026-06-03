"""GET /api/dealer/listings/<type>/<id>/market -> latest market snapshot."""
import os
import requests
from flask import Blueprint, g, jsonify

from services.dealer_market import compute_snapshot
from ._decorators import dealer_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)
market_bp = Blueprint("dealer_market", __name__, url_prefix="/api/dealer")


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


@market_bp.route("/listings/<listing_type>/<listing_id>/market", methods=["GET"])
def listing_market(listing_type, listing_id):
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        # Try latest stored snapshot first.
        r = requests.get(
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
        rows = r.json() if r.status_code == 200 else []
        if rows:
            return jsonify({"snapshot": rows[0]})

        # Compute on demand if missing.
        snap = compute_snapshot(listing_type, listing_id, g.dealer_ctx["dealership_id"])
        if snap is None or snap.get("insufficient_comps"):
            return jsonify({"snapshot": None,
                            "reason": "insufficient_comps",
                            "comp_count": snap.get("comp_count", 0) if snap else 0})
        return jsonify({"snapshot": snap})

    return _inner()
