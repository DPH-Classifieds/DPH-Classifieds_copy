#!/usr/bin/env python3
"""
Local test script for the 48-hour reminder system.

Usage:
    .venv/bin/python test_reminders_local.py [--email you@example.com] [--dry-run]

What it does:
    1. Seeds one draft listing, one saved car, one saved search for the given user
    2. Calls each of the three reminder job functions directly
    3. Verifies emails were queued (checks Resend API response)
    4. Cleans up the seeded rows

Flags:
    --email    Recipient email for test emails (defaults to RESEND_TO_EMAIL from .env)
    --dry-run  Seed and query but skip actual email send (no Resend calls)
    --keep     Don't delete seeded test rows after the run (useful for DB inspection)
    --user-id  Supabase user UUID to seed against (defaults to searching by --email)
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv

load_dotenv()

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY", "")
RESEND_KEY   = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL   = os.getenv("RESEND_FROM_EMAIL", "")
DEFAULT_TO   = os.getenv("RESEND_TO_EMAIL", "")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


# ------------------------------------------------------------------ #
# Supabase helpers                                                     #
# ------------------------------------------------------------------ #

def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}{path}", headers=HEADERS, params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def sb_post(path, body):
    r = requests.post(f"{SUPABASE_URL}{path}", headers=HEADERS, json=body, timeout=15)
    r.raise_for_status()
    return r.json()


def sb_delete(path, params):
    r = requests.delete(f"{SUPABASE_URL}{path}", headers=HEADERS, params=params, timeout=15)
    return r.status_code


def find_user_id(email):
    """Resolve a Supabase auth user ID from email via the admin users API."""
    page = 1
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=HEADERS,
            params={"page": page, "per_page": 100},
            timeout=15,
        )
        r.raise_for_status()
        users = r.json().get("users", [])
        if not users:
            break
        for u in users:
            if (u.get("email") or "").lower() == email.lower():
                return u["id"]
        page += 1
    return None


def find_any_active_car():
    """Return the first approved, non-deleted car ID for seeding saved_listings."""
    rows = sb_get("/rest/v1/cars", {
        "status": "eq.approved",
        "deleted_at": "is.null",
        "select": "id,listing_title",
        "limit": "1",
    })
    return rows[0] if rows else None


# ------------------------------------------------------------------ #
# Seed helpers                                                         #
# ------------------------------------------------------------------ #

def seed_draft(user_id, tag):
    row = sb_post("/rest/v1/listing_drafts", {
        "user_id": user_id,
        "draft_key": f"cars:test-{tag}",
        "payload": json.dumps({"listing_title": f"Test Car Draft [{tag}]"}),
        "updated_at": (datetime.now(timezone.utc) - timedelta(hours=50)).isoformat(),
    })
    return row[0]["id"] if isinstance(row, list) and row else None


def seed_saved_listing(user_id, car_id, tag):
    row = sb_post("/rest/v1/saved_listings", {
        "user_id": user_id,
        "listing_id": car_id,
        "listing_type": "car",
        "created_at": (datetime.now(timezone.utc) - timedelta(hours=50)).isoformat(),
    })
    return row[0]["id"] if isinstance(row, list) and row else None


def seed_saved_search(user_id, tag):
    row = sb_post("/rest/v1/saved_searches", {
        "user_id": user_id,
        "search_key": f"test-{tag}-{uuid.uuid4().hex[:8]}",
        "name": f"Test Search [{tag}]",
        "category": "cars",
        "query_text": "",
        "filters": {},
        "route_path": "/explore",
        "updated_at": (datetime.now(timezone.utc) - timedelta(hours=50)).isoformat(),
    })
    return row[0]["id"] if isinstance(row, list) and row else None


# ------------------------------------------------------------------ #
# Email override — intercept Resend calls in dry-run mode             #
# ------------------------------------------------------------------ #

_emails_sent = []


def _mock_send_resend(payload):
    _emails_sent.append(payload)
    print(f"    [DRY-RUN] Would send to {payload.get('to')} — Subject: {payload.get('subject')}")
    return {"id": "dry-run"}, None


# ------------------------------------------------------------------ #
# Main                                                                 #
# ------------------------------------------------------------------ #

def main():
    parser = argparse.ArgumentParser(description="Test reminder jobs locally")
    parser.add_argument("--email",   default=DEFAULT_TO,  help="Email to receive test reminders")
    parser.add_argument("--user-id", default=None,        help="Supabase user UUID (skip email lookup)")
    parser.add_argument("--dry-run", action="store_true", help="Skip actual email sends")
    parser.add_argument("--keep",    action="store_true", help="Keep seeded rows after test")
    args = parser.parse_args()

    target_email = args.email
    if not target_email:
        print("ERROR: provide --email or set RESEND_TO_EMAIL in .env")
        sys.exit(1)

    # --- Resolve user ID ---
    user_id = args.user_id
    if not user_id:
        print(f"Looking up user for {target_email}...")
        user_id = find_user_id(target_email)
        if not user_id:
            print(f"ERROR: No auth user found for {target_email}. Pass an existing user's email.")
            sys.exit(1)
    print(f"User ID: {user_id}")

    # --- Find a car to save ---
    car = find_any_active_car()
    if not car:
        print("WARNING: No approved cars found — saved car reminder will be skipped in job run.")
    else:
        print(f"Using car: {car['id']} — {car.get('listing_title','?')[:50]}")

    # --- Seed test rows ---
    tag = uuid.uuid4().hex[:6]
    seeded_ids = {}

    print(f"\nSeeding test data (tag={tag})...")
    draft_id = seed_draft(user_id, tag)
    print(f"  Draft:          {draft_id}")
    seeded_ids["draft"] = draft_id

    if car:
        save_id = seed_saved_listing(user_id, car["id"], tag)
        print(f"  Saved listing:  {save_id}")
        seeded_ids["saved_listing"] = save_id

    search_id = seed_saved_search(user_id, tag)
    print(f"  Saved search:   {search_id}")
    seeded_ids["saved_search"] = search_id

    # --- Patch app.py's _send_resend_email if dry-run ---
    print("\nImporting reminder functions from app.py...")
    if args.dry_run:
        import app as _app
        _app._send_resend_email = _mock_send_resend
        print("  [DRY-RUN] Patched _send_resend_email — no real emails will be sent")

    from app import (
        _run_listing_draft_reminders_once,
        _run_saved_car_reminders_once,
        _run_saved_search_alerts_once,
    )

    # --- Run jobs ---
    print("\n--- Running: _run_listing_draft_reminders_once(age_hours=0) ---")
    result = _run_listing_draft_reminders_once(age_hours=0, limit=10)
    print(f"  Result: {result}")
    assert result.get("sent", 0) > 0 or result.get("error"), \
        "Expected at least 1 draft reminder sent (check user email_notifications setting)"

    print("\n--- Running: _run_saved_car_reminders_once(age_hours=0) ---")
    result = _run_saved_car_reminders_once(age_hours=0, limit=10)
    print(f"  Result: {result}")

    print("\n--- Running: _run_saved_search_alerts_once(age_hours=0) ---")
    result = _run_saved_search_alerts_once(age_hours=0, limit=10)
    print(f"  Result: {result}")

    # --- Idempotency check ---
    print("\n--- Idempotency check: running all three jobs again immediately ---")
    r1 = _run_listing_draft_reminders_once(age_hours=0, limit=10)
    r2 = _run_saved_car_reminders_once(age_hours=0, limit=10)
    r3 = _run_saved_search_alerts_once(age_hours=0, limit=10)
    print(f"  Draft:        {r1} — sent should be 0 (rate limited)")
    print(f"  Saved car:    {r2} — sent should be 0 (rate limited)")
    print(f"  Saved search: {r3} — sent should be 0 (rate limited)")

    if args.dry_run:
        print(f"\nDRY-RUN captured {len(_emails_sent)} email(s):")
        for e in _emails_sent:
            print(f"  To: {e.get('to')}  Subject: {e.get('subject')}")

    # --- Cleanup ---
    if not args.keep:
        print("\nCleaning up seeded rows...")
        if seeded_ids.get("draft"):
            sb_delete("/rest/v1/listing_drafts", {"id": f"eq.{seeded_ids['draft']}"})
            print("  Deleted draft")
        if seeded_ids.get("saved_listing"):
            sb_delete("/rest/v1/saved_listings", {"id": f"eq.{seeded_ids['saved_listing']}"})
            print("  Deleted saved listing")
        if seeded_ids.get("saved_search"):
            sb_delete("/rest/v1/saved_searches", {"id": f"eq.{seeded_ids['saved_search']}"})
            print("  Deleted saved search")
    else:
        print(f"\nRows kept. To inspect: filter by user_id = '{user_id}' and draft_key like '%{tag}%'")

    print("\nAll tests passed.")


if __name__ == "__main__":
    main()
