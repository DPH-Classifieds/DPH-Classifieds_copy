"""Four-hourly Reddit sale-post importer (backend worker only).

Fetches the newest posts from r/DubaiPetrolHeads, parses eligible sale posts,
and idempotently upserts them into `cars` + `car_images` under the DPH
Classifieds owner via the service role. Dedupe key: cars.source_external_id.
Removal is confirmed per-post via a bounded /api/info verification pass — never
inferred from "fell out of the newest window". Every run is audited in
`reddit_import_runs`.

Self-contained (no `app` import) so it is safely unit-testable and matches the
dealer_api_source_poller pattern. Cache invalidation is left to the public
/api/cars 5-minute TTL — negligible against a 4-hour import cycle.
# ponytail: TTL-based cache refresh; wire explicit invalidation if 5min latency matters.
"""
import logging
import os
from datetime import datetime, timezone

import requests

from services.reddit_import import (
    build_imported_car_payload,
    fetch_new_submissions,
    fetch_submissions_by_ids,
    get_app_access_token,
    parse_sale_post,
)

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
)
DEFAULT_SUBREDDIT = os.getenv("REDDIT_IMPORT_SUBREDDIT", "DubaiPetrolHeads")
EXPECTED_OWNER_EMAIL = os.getenv("REDDIT_IMPORT_OWNER_EMAIL", "admin@dphclassifieds.com").strip().lower()

_SESSION = requests.Session()
_REMOVAL_CHECK_CAP = 300  # bounded: at most 3 /api/info calls per run.
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
    body, status = supabase_request(
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

def _fetch_existing_by_source_ids(source_ids):
    """Return {source_external_id: car_id} for the given reddit source ids."""
    ids = [s for s in source_ids if s]
    if not ids:
        return {}
    body, status = supabase_request(
        "get", "/rest/v1/cars",
        params={
            "select": "id,source_external_id",
            "source_platform": "eq.reddit",
            "source_external_id": f"in.({','.join(ids)})",
        },
    )
    if status >= 400 or not isinstance(body, list):
        return {}
    return {r["source_external_id"]: r["id"] for r in body if r.get("source_external_id")}


def _sync_primary_image(car_id, image_url):
    """Ensure exactly one primary imported image, matching the current source URL."""
    if not (car_id and image_url):
        return
    body, status = supabase_request(
        "get", "/rest/v1/car_images",
        params={"select": "id,image_url,is_primary", "car_id": f"eq.{car_id}"},
    )
    existing = body if (status < 400 and isinstance(body, list)) else []
    if any(img.get("image_url") == image_url for img in existing):
        return  # unchanged
    # Drop stale imported images then insert the fresh primary.
    if existing:
        supabase_request("delete", f"/rest/v1/car_images?car_id=eq.{car_id}")
    supabase_request(
        "post", "/rest/v1/car_images",
        data={"car_id": car_id, "image_url": image_url, "url": image_url, "is_primary": True},
    )


def _upsert_car(parsed, owner_id, existing_map, now, counts):
    payload = build_imported_car_payload(parsed, owner_id, now)
    car_id = existing_map.get(parsed.source_id)
    if car_id:
        # Re-observe: refresh everything except the immutable create timestamp,
        # and republish (clear any prior source_removed_at).
        update = {k: v for k, v in payload.items() if k != "source_created_at"}
        _, status = supabase_request("patch", f"/rest/v1/cars?id=eq.{car_id}", data=update)
        if status >= 400:
            counts["failed"] += 1
            return
        counts["updated"] += 1
    else:
        body, status = supabase_request("post", "/rest/v1/cars", data=payload)
        if status >= 400 or not (isinstance(body, list) and body):
            counts["failed"] += 1
            logger.warning("reddit_import: car insert failed status=%s", status)
            return
        car_id = body[0].get("id")
        counts["created"] += 1
    _sync_primary_image(car_id, parsed.image_url)


# --- Removal sync -----------------------------------------------------------

def sync_removed_imports(session, access_token, live_source_ids, user_agent, now):
    """Unpublish previously-imported cars whose source post is confirmed removed.

    A car is a *candidate* only if its source id was NOT seen in this run's fresh
    fetch (live_source_ids). Each candidate is then verified via /api/info: absent
    from the response, or flagged removed/deleted, means it is truly gone. Falling
    out of the 100-post window alone never triggers removal.
    """
    body, status = supabase_request(
        "get", "/rest/v1/cars",
        params={
            "select": "id,source_external_id",
            "source_platform": "eq.reddit",
            "source_removed_at": "is.null",
        },
    )
    if status >= 400 or not isinstance(body, list):
        return {"removed": 0, "checked": 0}

    candidates = [
        r for r in body
        if r.get("source_external_id") and r["source_external_id"] not in live_source_ids
    ][:_REMOVAL_CHECK_CAP]
    if not candidates:
        return {"removed": 0, "checked": 0}

    candidate_ids = [r["source_external_id"] for r in candidates]
    found = {}
    if access_token:
        try:
            found = fetch_submissions_by_ids(session, access_token, candidate_ids, user_agent)
        except Exception as exc:
            logger.warning("reddit_import: removal verification fetch failed: %s", exc)
            return {"removed": 0, "checked": len(candidates)}

    removed = 0
    for row in candidates:
        sid = row["source_external_id"]
        sub = found.get(sid)
        if sub is not None and not sub.is_removed_or_deleted:
            continue  # still live upstream — leave published
        _, st = supabase_request(
            "patch", f"/rest/v1/cars?id=eq.{row['id']}",
            data={"status": "source_removed", "is_approved": False,
                  "source_removed_at": now.isoformat()},
        )
        if st < 400:
            removed += 1
    return {"removed": removed, "checked": len(candidates)}


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

        parsed_list = []
        for sub in subs:
            parsed = parse_sale_post(sub, now)
            if parsed:
                parsed_list.append(parsed)
            else:
                counts["skipped"] += 1
        counts["eligible"] = len(parsed_list)

        existing_map = _fetch_existing_by_source_ids([p.source_id for p in parsed_list])
        for parsed in parsed_list:
            try:
                _upsert_car(parsed, owner_id, existing_map, now, counts)
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
