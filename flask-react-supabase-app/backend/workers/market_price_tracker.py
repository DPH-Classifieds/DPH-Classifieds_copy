"""Daily worker that persists platform asking-price cohort snapshots."""

import os
from datetime import datetime, timezone

import requests

from services.market_tracker import build_snapshot_rows


SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
PAGE_SIZE = 1000


def _svc():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Accept": "application/json",
    }


def _fetch_all_cars():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return [], "supabase_not_configured"
    rows = []
    for offset in range(0, 100000, PAGE_SIZE):
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/cars",
            headers=_svc(),
            params={
                "select": "car_manufacturer,car_model,make_year,expected_selling_price,status,is_approved,is_archived,deleted_at,expired_at,sold_status",
                "limit": PAGE_SIZE,
                "offset": offset,
            },
            timeout=30,
        )
        if response.status_code != 200:
            return rows, f"cars_http_{response.status_code}"
        payload = response.json()
        page = payload if isinstance(payload, list) else []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
    return rows, None


def run():
    rows, error = _fetch_all_cars()
    if error:
        return {"cohorts": 0, "listings": len(rows), "stored": 0, "reason": error}

    snapshot_date = datetime.now(timezone.utc).date().isoformat()
    snapshots = build_snapshot_rows(rows, snapshot_date)
    if not snapshots:
        return {"cohorts": 0, "listings": 0, "stored": 0, "reason": "no_eligible_cars"}

    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/market_price_snapshots",
        headers={
            **_svc(),
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        params={"on_conflict": "cohort_key,snapshot_date"},
        json=snapshots,
        timeout=30,
    )
    if response.status_code >= 300:
        return {"cohorts": len(snapshots), "listings": len(rows), "stored": 0, "reason": f"snapshot_http_{response.status_code}"}
    return {"cohorts": len(snapshots), "listings": len(rows), "stored": len(snapshots)}


if __name__ == "__main__":
    run()
