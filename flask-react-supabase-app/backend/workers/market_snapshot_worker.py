# flask-react-supabase-app/backend/workers/market_snapshot_worker.py
"""Hourly worker: recompute dealer_market_snapshots for every active dealership listing.

Strategy:
- Iterate active dealerships -> their active cars (v1 listing type).
- compute_snapshot() per listing; upsert row if comp_count >= 5.
- Purge snapshots older than 90 days.

Schedule via cron (every hour). Safe to run multiple times -- uses UNIQUE
(listing_type, listing_id, snapshot_at) to avoid exact duplicates.
"""
import os
from datetime import datetime, timedelta, timezone

import requests

from services.dealer_market import compute_snapshot, upsert_snapshot

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


def run():
    # Active cars under any dealership (v1 limits to 'car' type).
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/cars",
        headers=_svc(),
        params={"select": "id,dealership_id,status",
                "status": "eq.active",
                "dealership_id": "not.is.null",
                "limit": 5000},
        timeout=30,
    )
    for row in (r.json() if r.status_code == 200 else []):
        snap = compute_snapshot("car", row["id"], row["dealership_id"])
        if snap and not snap.get("insufficient_comps"):
            upsert_snapshot(snap, row["dealership_id"])

    # Purge snapshots > 90 days.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    requests.delete(
        f"{SUPABASE_URL}/rest/v1/dealer_market_snapshots",
        headers=_svc(),
        params={"snapshot_at": f"lt.{cutoff}"},
        timeout=30,
    )


if __name__ == "__main__":
    run()
