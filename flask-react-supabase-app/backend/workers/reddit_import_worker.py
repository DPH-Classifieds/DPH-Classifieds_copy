"""Four-hourly Reddit sale-post importer (backend worker only).

Fetches the newest posts from r/DubaiPetrolHeads, classifies + parses eligible
sale posts, and idempotently upserts them into the correct table
(cars/bikes/license_plates/car_parts) + its images table, under the DPH
Classifieds owner via the service role. Dedupe key: <table>.source_external_id.
Removal is confirmed per-post via a bounded /api/info verification pass — never
inferred from "fell out of the newest window". Every run is audited in
`reddit_import_runs`.

Self-contained (no `app` import) so it is safely unit-testable and matches the
dealer_api_source_poller pattern. Cache invalidation is left to the public
5-minute TTL — negligible against a 4-hour import cycle.
# ponytail: TTL-based cache refresh; wire explicit invalidation if 5min latency matters.
"""
import logging
import os
from datetime import datetime, timezone

import requests

from services.reddit_import import (
    LISTING_TABLES,
    build_imported_payload,
    fetch_new_submissions,
    fetch_submissions_by_ids,
    get_app_access_token,
    parse_listing,
)

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
)
DEFAULT_SUBREDDIT = os.getenv("REDDIT_IMPORT_SUBREDDIT", "DubaiPetrolHeads")
EXPECTED_OWNER_EMAIL = os.getenv("REDDIT_IMPORT_OWNER_EMAIL", "admin@dphclassifieds.com").strip().lower()

_SESSION = requests.Session()
_REMOVAL_CHECK_CAP = 300  # bounded: at most 3 /api/info calls per run per table.
# ponytail: 300-id ceiling on removal verification; raise if the live pool grows.


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def supabase_request(method, path, data=None, params=None):
    """Thin service-role PostgREST call. Returns (body, status_code) like app.py."""
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }
    kwargs = {"headers": headers, "params": params, "timeout": 20}
    if method.lower() in ("post", "patch", "put") and data is not None:
        kwargs["json"] = data
    try:
        resp = _SESSION.request(method.upper(), url, **kwargs)
    except Exception as exc:  # network failure
        return {"error": str(exc)}, 500
    try:
        body = resp.json()
    except Exception:
        body = {}
    return body, resp.status_code


# --- Run audit --------------------------------------------------------------

def _start_run(subreddit):
    body, status = supabase_request(
        "post", "/rest/v1/reddit_import_runs",
        data={"subreddit": subreddit, "status": "running"},
    )
    if status < 400 and isinstance(body, list) and body:
        return body[0].get("id")
    logger.warning("reddit_import: could not open run row (%s)", status)
    return None


def _finish_run(run_id, status, counts=None, error_summary=None):
    counts = counts or {}
    if not run_id:
        return
    payload = {
        "status": status,
        "finished_at": _now().isoformat(),
        "fetched_count": counts.get("fetched", 0),
        "eligible_count": counts.get("eligible", 0),
        "created_count": counts.get("created", 0),
        "updated_count": counts.get("updated", 0),
        "skipped_count": counts.get("skipped", 0),
        "removed_count": counts.get("removed", 0),
        "failed_count": counts.get("failed", 0),
        "error_summary": (error_summary or None) and str(error_summary)[:500],
    }
    supabase_request("patch", f"/rest/v1/reddit_import_runs?id=eq.{run_id}", data=payload)


def _record_failed_run(subreddit, error_summary):
    supabase_request(
        "post", "/rest/v1/reddit_import_runs",
        data={
            "subreddit": subreddit, "status": "failed",
            "finished_at": _now().isoformat(), "error_summary": str(error_summary)[:500],
        },
    )
    logger.error("reddit_import: run failed before start: %s", error_summary)


# --- Owner preflight --------------------------------------------------------

def _validate_owner(owner_id):
    """Confirm the configured owner UUID exists and is the DPH import account."""
    if not owner_id:
        return None
    body, status = supabase_request(
        "get", "/rest/v1/users",
        params={"id": f"eq.{owner_id}", "select": "id,email"},
    )
    if status >= 400 or not isinstance(body, list) or not body:
        return None
    owner = body[0]
    if str(owner.get("email") or "").strip().lower() != EXPECTED_OWNER_EMAIL:
        logger.error("reddit_import: owner email mismatch for %s", owner_id)
        return None
    return owner


# --- Upsert -----------------------------------------------------------------

def _fetch_existing_by_source_ids(table, source_ids):
    """Return {source_external_id: row_id} for the given reddit source ids in a table."""
    ids = [s for s in source_ids if s]
    if not ids:
        return {}
    body, status = supabase_request(
        "get", f"/rest/v1/{table}",
        params={
            "select": "id,source_external_id",
            "source_platform": "eq.reddit",
            "source_external_id": f"in.({','.join(ids)})",
        },
    )
    if status >= 400 or not isinstance(body, list):
        return {}
    return {r["source_external_id"]: r["id"] for r in body if r.get("source_external_id")}


def _sync_images(config, row_id, image_urls):
    """Sync the full imported gallery (first = primary). Idempotent: leaves the
    rows untouched when the set already matches, else replaces them wholesale."""
    urls = [u for u in (image_urls or []) if u]
    # de-dup preserving order
    seen, desired = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u); desired.append(u)
    if not (row_id and desired):
        return
    images_table, fk = config["images_table"], config["fk"]
    body, status = supabase_request(
        "get", f"/rest/v1/{images_table}",
        params={"select": f"id,image_url", fk: f"eq.{row_id}"},
    )
    existing = body if (status < 400 and isinstance(body, list)) else []
    if {img.get("image_url") for img in existing} == set(desired):
        return  # unchanged
    if existing:
        supabase_request("delete", f"/rest/v1/{images_table}?{fk}=eq.{row_id}")
    rows = [{fk: row_id, "image_url": u, "url": u, "is_primary": (i == 0)}
            for i, u in enumerate(desired)]
    supabase_request("post", f"/rest/v1/{images_table}", data=rows)


def _reddit_visible():
    """Respect the admin kill switch: Redis flag reddit:visible (set from the
    admin UI), env fallback. Default visible. Keeps imports from re-showing
    listings an admin has switched off."""
    url = os.getenv("REDIS_URL")
    if url:
        try:
            import redis  # backend dep; present in the worker image
            val = redis.from_url(url, socket_connect_timeout=2).get("reddit:visible")
            if val is not None:
                raw = val.decode() if isinstance(val, bytes) else str(val)
                return raw == "1"
        except Exception as exc:
            logger.warning("reddit_import: redis visibility check failed (%s); defaulting to env", exc)
    raw = (os.getenv("REDDIT_LISTINGS_VISIBLE") or "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _upsert_listing(parsed, owner_id, existing_map, now, counts, visible=True):
    built = build_imported_payload(parsed, owner_id, now)
    config, payload = built["config"], built["payload"]
    payload["is_approved"] = bool(visible)  # honor the admin kill switch
    table = config["table"]
    row_id = existing_map.get(parsed.source_id)
    if row_id:
        update = {k: v for k, v in payload.items() if k != "source_created_at"}
        _, status = supabase_request("patch", f"/rest/v1/{table}?id=eq.{row_id}", data=update)
        if status >= 400:
            counts["failed"] += 1
            return
        counts["updated"] += 1
    else:
        body, status = supabase_request("post", f"/rest/v1/{table}", data=payload)
        if status >= 400 or not (isinstance(body, list) and body):
            counts["failed"] += 1
            logger.warning("reddit_import: %s insert failed status=%s body=%s", table, status, str(body)[:200])
            return
        row_id = body[0].get("id")
        counts["created"] += 1
    _sync_images(config, row_id, parsed.image_urls or ([parsed.image_url] if parsed.image_url else []))


# --- Removal sync -----------------------------------------------------------

def sync_removed_imports(session, access_token, live_source_ids, user_agent, now):
    """Unpublish previously-imported rows (across all tables) whose source post is
    confirmed removed. A row is a candidate only if its source id was NOT in this
    run's fresh fetch; each candidate is then verified via /api/info."""
    removed = checked = 0
    for cat, config in LISTING_TABLES.items():
        table = config["table"]
        body, status = supabase_request(
            "get", f"/rest/v1/{table}",
            params={"select": "id,source_external_id", "source_platform": "eq.reddit",
                    "source_removed_at": "is.null"},
        )
        if status >= 400 or not isinstance(body, list):
            continue
        candidates = [r for r in body
                      if r.get("source_external_id") and r["source_external_id"] not in live_source_ids
                      ][:_REMOVAL_CHECK_CAP]
        if not candidates:
            continue
        checked += len(candidates)
        found = {}
        if access_token:
            try:
                found = fetch_submissions_by_ids(
                    session, access_token, [r["source_external_id"] for r in candidates], user_agent)
            except Exception as exc:
                logger.warning("reddit_import: removal verification failed for %s: %s", table, exc)
                continue
        for row in candidates:
            sub = found.get(row["source_external_id"])
            if sub is not None and not sub.is_removed_or_deleted:
                continue  # still live upstream
            _, st = supabase_request(
                "patch", f"/rest/v1/{table}?id=eq.{row['id']}",
                data={"status": "source_removed", "is_approved": False,
                      "source_removed_at": now.isoformat()},
            )
            if st < 400:
                removed += 1
    return {"removed": removed, "checked": checked}


# --- Orchestration ----------------------------------------------------------

def run():
    if not _truthy(os.getenv("REDDIT_IMPORT_ENABLED")):
        return {"status": "disabled"}

    subreddit = os.getenv("REDDIT_IMPORT_SUBREDDIT", DEFAULT_SUBREDDIT)
    client_id = os.getenv("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
    user_agent = os.getenv("REDDIT_USER_AGENT", "").strip()
    owner_id = os.getenv("REDDIT_IMPORT_OWNER_ID", "").strip()
    try:
        max_posts = int(os.getenv("REDDIT_IMPORT_MAX_POSTS", "100"))
    except ValueError:
        max_posts = 100

    missing = [k for k, v in {
        "REDDIT_CLIENT_ID": client_id, "REDDIT_CLIENT_SECRET": client_secret,
        "REDDIT_USER_AGENT": user_agent, "REDDIT_IMPORT_OWNER_ID": owner_id,
    }.items() if not v]
    if missing:
        _record_failed_run(subreddit, f"missing configuration: {', '.join(missing)}")
        return {"status": "failed", "error": "missing configuration"}

    if not _validate_owner(owner_id):
        _record_failed_run(subreddit, "owner validation failed (missing UUID or email mismatch)")
        return {"status": "failed", "error": "owner validation failed"}

    now = _now()
    run_id = _start_run(subreddit)
    counts = {k: 0 for k in ("fetched", "eligible", "created", "updated", "skipped", "removed", "failed")}
    try:
        token = get_app_access_token(_SESSION, client_id, client_secret, user_agent)
        subs = fetch_new_submissions(_SESSION, token, subreddit, max_posts, user_agent)
        counts["fetched"] = len(subs)

        # Parse + group eligible listings by category (dedupe is per-table).
        by_category = {cat: [] for cat in LISTING_TABLES}
        for sub in subs:
            parsed = parse_listing(sub, now)
            if parsed and parsed.category in by_category:
                by_category[parsed.category].append(parsed)
            else:
                counts["skipped"] += 1
        counts["eligible"] = sum(len(v) for v in by_category.values())

        visible = _reddit_visible()
        if not visible:
            logger.info("reddit_import: visibility OFF — importing as hidden (is_approved=false)")
        for cat, parsed_list in by_category.items():
            if not parsed_list:
                continue
            table = LISTING_TABLES[cat]["table"]
            existing_map = _fetch_existing_by_source_ids(table, [p.source_id for p in parsed_list])
            for parsed in parsed_list:
                try:
                    _upsert_listing(parsed, owner_id, existing_map, now, counts, visible=visible)
                except Exception:
                    counts["failed"] += 1
                    logger.exception("reddit_import: upsert error for %s", parsed.source_id)

        live_ids = {sub.id for sub in subs}
        counts["removed"] = sync_removed_imports(_SESSION, token, live_ids, user_agent, now)["removed"]

        did_work = counts["created"] + counts["updated"]
        status = "succeeded" if counts["failed"] == 0 else ("partial" if did_work else "failed")
        _finish_run(run_id, status, counts)
        return {"status": status, **counts}
    except Exception as exc:
        logger.exception("reddit_import: run failed")
        _finish_run(run_id, "failed", counts, error_summary=str(exc))
        return {"status": "failed", "error": str(exc)[:200], **counts}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("reddit_import_worker: %s", run())
