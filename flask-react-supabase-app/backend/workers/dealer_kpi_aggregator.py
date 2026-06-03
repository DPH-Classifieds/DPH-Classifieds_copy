# flask-react-supabase-app/backend/workers/dealer_kpi_aggregator.py
"""Nightly worker: roll up yesterday's per-listing impressions/details/leads/saves
into dealer_kpi_daily so range queries don't scan platform_events.

Idempotent: upserts by (dealership_id, date, listing_type, listing_id).

Schedule via the project's existing cron (Railway, Heroku scheduler, or a
plain `python -m workers.dealer_kpi_aggregator` invocation at 02:00 UTC).
"""
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

from services.dealer_kpi import dedupe_impressions, dedupe_leads

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _svc():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _yesterday_window():
    end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=1)
    return start, end


def run():
    start, end = _yesterday_window()
    date_str = start.date().isoformat()

    # Active dealerships.
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers={**_svc(), "Prefer": ""},
        params={"select": "id", "status": "eq.active", "limit": 5000},
        timeout=30,
    )
    dealership_ids = [d["id"] for d in (r.json() if r.status_code == 200 else [])]

    upserts = []
    for did in dealership_ids:
        # Listings.
        listings = {"car": set(), "bike": set(), "plate": set(), "part": set()}
        for table, kind in (("cars", "car"), ("bikes", "bike"),
                            ("license_plates", "plate"), ("car_parts", "part")):
            lr = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": ""},
                params={"select": "id", "dealership_id": f"eq.{did}", "limit": 5000},
                timeout=20,
            )
            for row in (lr.json() if lr.status_code == 200 else []):
                listings[kind].add(str(row["id"]))

        # Platform events in window.
        events = []
        end_iso = end.isoformat()
        for kind, ids in listings.items():
            ids_list = list(ids)
            for i in range(0, len(ids_list), 200):
                chunk = ids_list[i:i + 200]
                er = requests.get(
                    f"{SUPABASE_URL}/rest/v1/platform_events",
                    headers={**_svc(), "Prefer": ""},
                    params={
                        "select": "visitor_id,listing_id,listing_type,event_name,page_kind,created_at",
                        "listing_type": f"eq.{kind}",
                        "listing_id": f"in.({','.join(chunk)})",
                        "created_at": f"gte.{start.isoformat()}",
                        "limit": 50000,
                    },
                    timeout=30,
                )
                if er.status_code == 200:
                    fetched = er.json()
                    # Client-side upper-bound filter to keep behaviour equivalent to the original intent.
                    events.extend(ev for ev in fetched if ev.get("created_at", "") < end_iso)

        # Lead events.
        lr = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers={**_svc(), "Prefer": ""},
            params={
                "select": "visitor_id,listing_id,listing_type,action,created_at",
                "dealership_id": f"eq.{did}",
                "created_at": f"gte.{start.isoformat()}",
                "limit": 50000,
            }, timeout=30,
        )
        if lr.status_code == 200:
            fetched_leads = lr.json()
            # Client-side upper-bound filter.
            leads = [ev for ev in fetched_leads if ev.get("created_at", "") < end_iso]
        else:
            leads = []

        # Aggregate per (listing_type, listing_id).
        by_listing = defaultdict(lambda: {"imp": [], "det": [], "calls": [], "wa": [], "vin": []})
        for e in events:
            key = (e["listing_type"], str(e["listing_id"]))
            by_listing[key]["imp"].append(e)
            if e.get("page_kind") == "listing_detail":
                by_listing[key]["det"].append(e)
        for e in leads:
            key = (e["listing_type"], str(e["listing_id"]))
            act = e.get("action")
            if act == "call_click":
                by_listing[key]["calls"].append(e)
            elif act == "whatsapp_click":
                by_listing[key]["wa"].append(e)
            elif act in ("vin_open", "vin_reveal"):
                by_listing[key]["vin"].append(e)

        for (lt, lid), agg in by_listing.items():
            upserts.append({
                "dealership_id": did,
                "date": date_str,
                "listing_type": lt,
                "listing_id": lid,
                "impressions": dedupe_impressions(agg["imp"]),
                "detail_views": dedupe_impressions(agg["det"]),
                "call_clicks": dedupe_leads(agg["calls"]),
                "whatsapp_clicks": dedupe_leads(agg["wa"]),
                "vin_reveals": dedupe_leads(agg["vin"]),
            })

    if not upserts:
        return

    # Batch upsert.
    for i in range(0, len(upserts), 500):
        chunk = upserts[i:i + 500]
        requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_kpi_daily",
            headers=_svc(), json=chunk, timeout=60,
        )


if __name__ == "__main__":
    run()
