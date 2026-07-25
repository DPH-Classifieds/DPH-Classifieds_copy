"""One-off backfill: import eligible r/DubaiPetrolHeads sale posts from the last
N days (default 30) into cars/bikes/license_plates/car_parts.

Run AFTER applying migrations/2026_07_23_reddit_imported_listings.sql. It is
idempotent (dedupes on source_external_id) so re-running is safe, and it does
NOT require REDDIT_IMPORT_ENABLED — it's an explicit manual seed. Ongoing 4-hour
runs then pick up only new posts.

Usage (uses the worker service's real env):
    railway run --service DPH_Classifieds-worker python backend/seed_reddit_import.py [days]
or locally (loads backend/.env):
    python backend/seed_reddit_import.py 30
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

# Load backend/.env for local runs (Railway injects env directly).
_env_path = Path(__file__).with_name(".env")
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from services.reddit_import import (
    OAUTH_BASE_URL, RedditSubmission, LISTING_TABLES,
    get_app_access_token, parse_listing,
)
import workers.reddit_import_worker as w


def _paginate(session, token, subreddit, user_agent, cutoff_epoch, hard_cap=1000):
    """Yield submissions newest-first until older than cutoff or hard_cap reached."""
    after = None
    seen = 0
    while seen < hard_cap:
        params = {"limit": 100, "raw_json": 1}
        if after:
            params["after"] = after
        r = session.get(f"{OAUTH_BASE_URL}/r/{subreddit}/new", params=params,
                        headers={"Authorization": f"Bearer {token}", "User-Agent": user_agent},
                        timeout=20)
        r.raise_for_status()
        data = (r.json() or {}).get("data") or {}
        children = data.get("children") or []
        if not children:
            return
        for ch in children:
            d = (ch or {}).get("data")
            if not isinstance(d, dict):
                continue
            sub = RedditSubmission.from_api(d)
            seen += 1
            if sub.created_utc and sub.created_utc < cutoff_epoch:
                return  # newest-first: everything past here is older
            yield sub
        after = data.get("after")
        if not after:
            return


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    subreddit = os.getenv("REDDIT_IMPORT_SUBREDDIT", "DubaiPetrolHeads")
    owner_id = os.getenv("REDDIT_IMPORT_OWNER_ID", "").strip()
    cid = os.getenv("REDDIT_CLIENT_ID", "").strip()
    csec = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
    ua = os.getenv("REDDIT_USER_AGENT", "").strip()
    if not all([owner_id, cid, csec, ua]):
        print("Missing REDDIT_* config; aborting."); sys.exit(1)
    if not w._validate_owner(owner_id):
        print("Owner validation failed (UUID/email mismatch); aborting."); sys.exit(1)

    now = w._now()
    cutoff_epoch = (now - timedelta(days=days)).timestamp()
    session = requests.Session()
    token = get_app_access_token(session, cid, csec, ua)

    subs = list(_paginate(session, token, subreddit, ua, cutoff_epoch))
    print(f"Fetched {len(subs)} posts from the last {days} days.")

    by_category = {cat: [] for cat in LISTING_TABLES}
    skipped = 0
    for sub in subs:
        parsed = parse_listing(sub, now)
        if parsed and parsed.category in by_category:
            by_category[parsed.category].append(parsed)
        else:
            skipped += 1

    # Respect the admin kill switch so a backfill never un-hides listings the
    # admin has switched off (env REDDIT_LISTINGS_VISIBLE / redis reddit:visible).
    visible = w._reddit_visible()
    print(f"  visibility: {'shown' if visible else 'HIDDEN'}")
    counts = {k: 0 for k in ("created", "updated", "failed")}
    for cat, plist in by_category.items():
        if not plist:
            continue
        table = LISTING_TABLES[cat]["table"]
        existing = w._fetch_existing_by_source_ids(table, [p.source_id for p in plist])
        for parsed in plist:
            w._upsert_listing(parsed, owner_id, existing, now, counts, visible=visible)
        print(f"  {cat:5}: {len(plist)} eligible")

    print(f"\nDone. created={counts['created']} updated={counts['updated']} "
          f"failed={counts['failed']} skipped={skipped}")


if __name__ == "__main__":
    main()
