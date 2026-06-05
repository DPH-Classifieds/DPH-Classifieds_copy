"""Tail lead_events and project them into dealer_leads + dealer_lead_events.

Runs on a short interval (default 30s) via worker.py:scheduled_loop. Reads a
single-row cursor table to remember where it left off; advances the cursor
once a batch has been written.
"""
import logging
import os
from datetime import datetime, timezone

import requests

from services.dealer_leads import (
    ACTION_TO_SOURCE,
    fingerprint_visitor,
    lead_dedupe_key,
    lead_payload_from_event,
    parse_event_timestamp,
    within_dedupe_window,
)

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

BATCH_LIMIT = int(os.getenv("DEALER_LEAD_AGG_BATCH", "500"))


def _svc(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": prefer,
    }


def _load_cursor():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_lead_aggregator_cursor",
        headers=_svc(prefer=""),
        params={"select": "last_processed_at", "id": "eq.1", "limit": 1},
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        raise RuntimeError("aggregator cursor row missing — apply 2026_06_05_dealer_leads.sql")
    return r.json()[0]["last_processed_at"]


def _save_cursor(ts_iso):
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_lead_aggregator_cursor?id=eq.1",
        headers=_svc(prefer="return=minimal"),
        json={"last_processed_at": ts_iso, "updated_at": datetime.now(timezone.utc).isoformat()},
        timeout=10,
    )


def _fetch_events_since(cursor_iso):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/lead_events",
        headers=_svc(prefer=""),
        params={
            "select": "id,dealership_id,listing_id,listing_type,action,ip_address,"
                      "user_agent,payload,created_at",
            "created_at": f"gt.{cursor_iso}",
            "dealership_id": "not.is.null",
            "order": "created_at.asc",
            "limit": str(BATCH_LIMIT),
        },
        timeout=20,
    )
    if r.status_code != 200:
        logger.warning("aggregator lead_events fetch failed: %s %s", r.status_code, r.text[:300])
        return []
    return r.json() or []


def _find_existing_lead(dealership_id, listing_type, listing_id, source, identity):
    """Look up the MOST RECENT existing dealer_leads row matching the identity.

    Always orders by first_event_at desc and takes 1 — so the caller's
    `within_dedupe_window` check runs against the newest candidate. Without
    that ordering, an old row outside the window could be returned, causing
    a duplicate within the current window.
    """
    base_params = {
        "select": "id,first_event_at,event_count",
        "dealership_id": f"eq.{dealership_id}",
        "listing_type": f"eq.{listing_type}",
        "listing_id": f"eq.{listing_id}",
        "source": f"eq.{source}",
        "order": "first_event_at.desc",
        "limit": 1,
    }
    if identity.startswith("visitor:"):
        params = {**base_params, "visitor_id": f"eq.{identity[len('visitor:'):]}"}
    else:
        params = {
            **base_params,
            "fingerprint": f"eq.{identity[len('fp:'):]}",
            "visitor_id": "is.null",
        }
    r = requests.get(f"{SUPABASE_URL}/rest/v1/dealer_leads",
                     headers=_svc(prefer=""), params=params, timeout=10)
    if r.status_code != 200 or not r.json():
        return None
    return r.json()[0]


def _insert_lead(payload):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/dealer_leads",
                      headers=_svc(), json=payload, timeout=10)
    if r.status_code not in (200, 201):
        logger.warning("dealer_leads insert failed: %s %s", r.status_code, r.text[:300])
        return None
    rows = r.json()
    return rows[0]["id"] if rows else None


def _update_lead_aggregate(lead_id, new_last_event_at, new_count):
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_leads?id=eq.{lead_id}",
        headers=_svc(prefer="return=minimal"),
        json={
            "last_event_at": new_last_event_at,
            "event_count": new_count,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        timeout=10,
    )


def _emit_lead_event(lead_id, kind, payload):
    requests.post(f"{SUPABASE_URL}/rest/v1/dealer_lead_events",
                  headers=_svc(prefer="return=minimal"),
                  json={"lead_id": lead_id, "kind": kind, "payload": payload}, timeout=10)


def run():
    """One tick. Returns (inserted_count, cursor_advanced)."""
    cursor = _load_cursor()
    events = _fetch_events_since(cursor)
    if not events:
        _save_cursor(datetime.now(timezone.utc).isoformat())
        return 0, True

    inserted = 0
    last_processed = cursor

    for ev in events:
        last_processed = ev["created_at"]
        payload = lead_payload_from_event(ev)
        if not payload:
            continue
        key = lead_dedupe_key(ev)
        if not key:
            continue
        dealership_id, listing_type, listing_id, source, identity = key
        existing = _find_existing_lead(dealership_id, listing_type, listing_id, source, identity)

        ev_ts = parse_event_timestamp(ev["created_at"])
        if existing:
            first_ts = parse_event_timestamp(existing["first_event_at"])
            if first_ts and ev_ts and within_dedupe_window(first_ts, ev_ts, identity):
                _update_lead_aggregate(existing["id"], ev["created_at"],
                                       int(existing.get("event_count") or 1) + 1)
                _emit_lead_event(existing["id"], "inbound_contact",
                                 {"source": source, "lead_event_id": ev["id"]})
                continue
            # Outside the dedupe window — fall through and insert a new lead.

        new_id = _insert_lead(payload)
        if new_id:
            inserted += 1
            _emit_lead_event(new_id, "inbound_contact",
                             {"source": source, "lead_event_id": ev["id"]})

    _save_cursor(last_processed)
    return inserted, True


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ins, _ = run()
    logger.info("dealer_lead_aggregator: inserted=%d", ins)
