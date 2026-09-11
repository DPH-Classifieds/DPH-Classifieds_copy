"""One-off backfill: import eligible r/DubaiPetrolHeads car sale posts from the
last N days (default 30) into cars.

Run AFTER applying migrations/2026_07_23_reddit_imported_listings.sql. It is
idempotent (dedupes on source_external_id) so re-running is safe, and it does
NOT require REDDIT_IMPORT_ENABLED — it's an explicit manual seed. Ongoing 4-hour
runs then pick up only new posts.

Usage (uses the worker service's real env):
    railway run --service DPH_Classifieds-worker python backend/seed_reddit_import.py [days] [--dry-run]
or locally (loads backend/.env):
    python backend/seed_reddit_import.py 30 --dry-run
    python backend/seed_reddit_import.py 30

The default is deliberately cars-only. It rehydrates all existing importer-owned
car source IDs through Reddit's bounded /api/info endpoint, in addition to the
recent discovery window. Pass --all-categories only for an explicit legacy-style
import of bikes, plates, and parts as well.
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
    fetch_submissions_by_ids, get_app_access_token, parse_listing,
)
import workers.reddit_import_worker as w


_CAR_IMPORT_LEGACY_FIELDS = (
    "vin_number", "color", "engine_capacity", "cylinders", "doors",
    "service_history", "import_field_sources",
)


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


def _existing_source_ids(owner_id, categories):
    """Return existing importer source IDs for the selected categories.

    The /new endpoint is intentionally bounded, so a backfill must also use the
    source IDs already stored in Supabase to cover older imported rows.
    """
    ids = set()
    for category in categories:
        table = LISTING_TABLES[category]["table"]
        body, status = w.supabase_request(
            "get", f"/rest/v1/{table}",
            params={
                "select": "source_external_id",
                "source_platform": "eq.reddit",
                "user_id": f"eq.{owner_id}",
                "source_external_id": "not.is.null",
                "limit": "1000",
            },
        )
        if status < 400 and isinstance(body, list):
            ids.update(row["source_external_id"] for row in body if row.get("source_external_id"))
    return sorted(ids)


def _rehydrate_source_ids(session, token, source_ids, user_agent):
    """Fetch existing Reddit posts in API-safe batches of at most 100 IDs."""
    found = {}
    for start in range(0, len(source_ids), 100):
        batch = source_ids[start:start + 100]
        found.update(fetch_submissions_by_ids(session, token, batch, user_agent))
    return list(found.values())


def _clear_legacy_car_fields(owner_id):
    """Normalize every importer-owned Reddit car, including unavailable posts."""
    rows, status = w.supabase_request(
        "get", "/rest/v1/cars",
        params={
            "select": "id,car_manufacturer,car_model,make_year,expected_selling_price,kilometer_driven",
            "source_platform": "eq.reddit",
            "user_id": f"eq.{owner_id}",
            "limit": "1000",
        },
    )
    if status >= 400 or not isinstance(rows, list):
        raise RuntimeError(f"legacy car field cleanup lookup failed with status {status}")

    _, status = w.supabase_request(
        "patch", "/rest/v1/cars",
        params={
            "source_platform": "eq.reddit",
            "user_id": f"eq.{owner_id}",
        },
        data={field: None for field in _CAR_IMPORT_LEGACY_FIELDS},
    )
    if status >= 400:
        raise RuntimeError(f"legacy car field cleanup failed with status {status}")

    normalized = 0
    for row in rows:
        year = row.get("make_year")
        make = str(row.get("car_manufacturer") or "").strip()
        model = str(row.get("car_model") or "").strip()
        price = row.get("expected_selling_price")
        mileage = row.get("kilometer_driven")
        if not (row.get("id") and year and make and model and price is not None):
            continue
        summary = [f"{year} {make} {model}", f"AED {int(price):,}"]
        if mileage not in (None, ""):
            summary.append(f"{int(mileage):,} km")
        description = (
            "Posted by DPH Classifieds, imported from r/DubaiPetrolHeads. "
            f"{' · '.join(summary)}. Listing details are supplied by the original Reddit post — "
            "see the linked post for full details before transacting."
        )
        _, row_status = w.supabase_request(
            "patch", f"/rest/v1/cars?id=eq.{row['id']}",
            data={"listing_title": f"{year} {make} {model}", "car_description": description},
        )
        if row_status >= 400:
            raise RuntimeError(f"car title/description cleanup failed with status {row_status}")
        normalized += 1
    return normalized


def _args(argv):
    positional = [arg for arg in argv if not arg.startswith("--")]
    days = int(positional[0]) if positional else 30
    if days <= 0:
        raise ValueError("days must be a positive integer")
    return days, "--dry-run" in argv, "--all-categories" in argv


def main(argv=None):
    days, dry_run, all_categories = _args(list(sys.argv[1:] if argv is None else argv))
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

    categories = list(LISTING_TABLES) if all_categories else ["car"]
    recent_subs = list(_paginate(session, token, subreddit, ua, cutoff_epoch))
    existing_ids = _existing_source_ids(owner_id, categories)
    existing_subs = _rehydrate_source_ids(session, token, existing_ids, ua)
    subs = {sub.id: sub for sub in recent_subs}
    subs.update({sub.id: sub for sub in existing_subs})
    subs = list(subs.values())
    print(f"Fetched {len(recent_subs)} recent posts and rehydrated {len(existing_subs)} existing source IDs.")

    by_category = {cat: [] for cat in categories}
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
    eligible = sum(len(plist) for plist in by_category.values())
    if dry_run:
        scope = "all categories" if all_categories else "cars"
        print(f"  dry-run: {eligible} eligible {scope}; no writes performed")
        print(f"\nDry run complete. eligible={eligible} skipped={skipped}")
        return 0

    normalized = _clear_legacy_car_fields(owner_id)
    print(f"  normalized: {normalized} existing importer-owned cars")

    counts = {k: 0 for k in ("created", "updated", "failed")}
    for cat, plist in by_category.items():
        if not plist:
            continue
        table = LISTING_TABLES[cat]["table"]
        existing = w._fetch_existing_by_source_ids(
            table, [p.source_id for p in plist], owner_id
        )
        for parsed in plist:
            # This is an explicit, verified backfill: /api/info returned the
            # source post, so an old importer expiry can be safely restored.
            # Routine worker syncs keep their anti-resurrection safeguards.
            w._upsert_listing(parsed, owner_id, existing, now, counts,
                               visible=visible, restore=True)
        print(f"  {cat:5}: {len(plist)} eligible")

    print(f"\nDone. created={counts['created']} updated={counts['updated']} "
          f"failed={counts['failed']} skipped={skipped}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ValueError as exc:
        print(f"Invalid arguments: {exc}")
        sys.exit(2)
