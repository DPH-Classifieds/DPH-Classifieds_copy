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
from datetime import datetime, timedelta, timezone

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
# Reddit listings drop off the site after this many days on it (0 disables).
try:
    _REDDIT_MAX_AGE_DAYS = int(os.getenv("REDDIT_LISTING_MAX_AGE_DAYS", "7"))
except ValueError:
    _REDDIT_MAX_AGE_DAYS = 7
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

def _fetch_existing_by_source_ids(table, source_ids, owner_id):
    """Return {source_external_id: {"id":.., "status":..}} for the given reddit
    source ids in a table. Status rides along so the update path can tell a
    live/source_removed row (safe to resync) from an admin-hidden or
    dedup-expired one (must not be silently resurrected)."""
    ids = [s for s in source_ids if s]
    if not ids:
        return {}
    body, status = supabase_request(
        "get", f"/rest/v1/{table}",
        params={
            "select": "id,source_external_id,status",
            "source_platform": "eq.reddit",
            "user_id": f"eq.{owner_id}",
            "source_external_id": f"in.({','.join(ids)})",
        },
    )
    if status >= 400 or not isinstance(body, list):
        return {}
    return {
        r["source_external_id"]: {"id": r["id"], "status": r.get("status")}
        for r in body if r.get("source_external_id")
    }


def _find_existing_source_rows(source_id, owner_id):
    """Find an imported source id across every category table.

    Classification rules evolve. A source that was previously misclassified
    must not remain live in its old table when a re-sync routes it correctly;
    otherwise the repair creates a second public listing. Only rows owned by
    the dedicated importer account are eligible for this move.
    """
    if not source_id or not owner_id:
        return []
    found = []
    for category, config in LISTING_TABLES.items():
        body, status = supabase_request(
            "get", f"/rest/v1/{config['table']}",
            params={
                "select": "id,source_external_id,status",
                "source_platform": "eq.reddit",
                "user_id": f"eq.{owner_id}",
                "source_external_id": f"eq.{source_id}",
            },
        )
        if status < 400 and isinstance(body, list):
            found.extend({**row, "category": category, "table": config["table"]}
                         for row in body if row.get("id"))
    return found


def _retire_misclassified_rows(rows, owner_id, counts):
    """Hide old-category copies before creating the correctly routed listing."""
    for row in rows:
        _, status = supabase_request(
            "patch", f"/rest/v1/{row['table']}?id=eq.{row['id']}&user_id=eq.{owner_id}",
            data={"status": "expired", "is_approved": False},
        )
        if status >= 400:
            counts["failed"] += 1
            return False
    return True


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
        params={"select": "id,image_url", fk: f"eq.{row_id}"},
    )
    image_column = "image_url"
    if status >= 400:
        # Older plate_images deployments expose only `url`.
        body, status = supabase_request(
            "get", f"/rest/v1/{images_table}",
            params={"select": "id,url", fk: f"eq.{row_id}"},
        )
        image_column = "url"
    existing = body if (status < 400 and isinstance(body, list)) else []
    if {img.get(image_column) for img in existing} == set(desired):
        return  # unchanged
    if existing:
        supabase_request("delete", f"/rest/v1/{images_table}?{fk}=eq.{row_id}")
    rows = [{fk: row_id, image_column: u, "is_primary": (i == 0)}
            for i, u in enumerate(desired)]
    _, insert_status = supabase_request("post", f"/rest/v1/{images_table}", data=rows)
    if insert_status >= 400 and image_column == "image_url":
        # If the deployment is on the legacy schema, retry with its real column.
        legacy_rows = [{fk: row_id, "url": u, "is_primary": (i == 0)}
                       for i, u in enumerate(desired)]
        supabase_request("post", f"/rest/v1/{images_table}", data=legacy_rows)


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


_VIN_DECODER = None


def _get_vin_decoder():
    global _VIN_DECODER
    if _VIN_DECODER is None:
        from services.vin_decoder import VINDecoder
        _VIN_DECODER = VINDecoder()
    return _VIN_DECODER


def _titlecase_make(make):
    m = str(make or "").strip()
    return m.title() if m.isupper() or m.islower() else m


def _enrich_car_with_vin(payload):
    """Overlay VIN-decoded details onto a car payload. Clean NHTSA decode is
    authoritative for make/model + the spec sheet; a non-clean/GCC VIN leaves
    the title + description-derived values in place. Never raises."""
    vin = payload.get("vin_number")
    if not vin:
        return
    from services.vin_decoder import map_decoded_to_listing, resolve_vin_year
    try:
        result = _get_vin_decoder().validate_and_decode(vin)
    except Exception as exc:
        logger.warning("reddit_import: VIN decode failed for %s: %s", vin, exc)
        return
    decoded = result.get("decoded") or {}
    sources = payload.get("import_field_sources") or {}

    def _fillable(key):
        # Never overwrite a value the seller explicitly wrote in the post; VIN
        # decode only fills fields that are missing / Unspecified.
        if sources.get(key) == "post":
            return False
        return payload.get(key) in (None, "", "Unspecified", "N/A")

    if result.get("is_valid") and decoded:
        if decoded.get("make") and _fillable("car_manufacturer"):
            payload["car_manufacturer"] = _titlecase_make(decoded["make"])
            sources["car_manufacturer"] = "vin"
        if decoded.get("model") and _fillable("car_model"):
            payload["car_model"] = str(decoded["model"]).strip()
            sources["car_model"] = "vin"
        mapped = map_decoded_to_listing(decoded)
        for k, v in mapped.items():  # spec sheet — fill gaps only
            if _fillable(k):
                payload[k] = v
                sources[k] = "vin"
    elif decoded.get("make_source") == "wmi" and decoded.get("make") and _fillable("car_manufacturer"):
        # No clean decode, but WMI still guarantees the manufacturer.
        payload["car_manufacturer"] = _titlecase_make(decoded["make"])
        sources["car_manufacturer"] = "vin"
    payload["import_field_sources"] = sources
    if not payload.get("make_year"):
        yr = resolve_vin_year(vin, payload.get("make_year"))
        if yr:
            payload["make_year"] = yr


def _upsert_listing(parsed, owner_id, existing_map, now, counts, visible=True):
    built = build_imported_payload(parsed, owner_id, now)
    config, payload = built["config"], built["payload"]
    payload["is_approved"] = bool(visible)  # honor the admin kill switch
    table = config["table"]
    existing_entry = existing_map.get(parsed.source_id) or {}
    row_id = existing_entry.get("id")
    current_status = existing_entry.get("status")

    # A corrected classifier can route a source into a different table than
    # its original import. Reconcile that source identity before inserting so
    # a backfill cannot leave both the misclassified and corrected rows live.
    parsed_category = getattr(parsed, "category", None)
    if not row_id and parsed_category is not None:
        source_rows = _find_existing_source_rows(parsed.source_id, owner_id)
        same_category = next(
            (r for r in source_rows if r["category"] == parsed_category),
            None,
        )
        if same_category:
            row_id = same_category["id"]
            current_status = same_category.get("status")
        else:
            wrong_category_rows = [
                r for r in source_rows if r["category"] != parsed_category
            ]
            if wrong_category_rows and not _retire_misclassified_rows(wrong_category_rows, owner_id, counts):
                return

    # A native DPH listing always takes priority over a Reddit import of the
    # same vehicle. This check deliberately runs for both new rows and rows
    # being refreshed: otherwise a later Reddit sync would overwrite an
    # already-hidden duplicate back to approved.
    if table == "cars" and payload.get("vin_number"):
        vin = payload["vin_number"]
        existing, dstatus = supabase_request(
            "get",
            f"/rest/v1/cars?select=id&vin_number=eq.{vin}"
            "&or=(source_platform.is.null,source_platform.neq.reddit)&limit=1",
        )
        if dstatus < 400 and isinstance(existing, list) and existing:
            if row_id:
                _, hide_status = supabase_request(
                    "patch",
                    f"/rest/v1/cars?id=eq.{row_id}",
                    data={"status": "expired", "is_approved": False},
                )
                if hide_status >= 400:
                    counts["failed"] += 1
                    return
            counts["skipped"] = counts.get("skipped", 0) + 1
            logger.info(
                "reddit_import: hid car VIN=%s — DPH listing already exists", vin
            )
            return

        # A brand-new post (no DB row yet) whose VIN matches another live
        # Reddit import is a repost of a car already on the site — refuse the
        # second copy instead of creating a duplicate. Sequential processing
        # within a run means an earlier post in the same batch is already
        # committed by the time a later duplicate reaches this check.
        if not row_id:
            dupe, rstatus = supabase_request(
                "get",
                f"/rest/v1/cars?select=id&vin_number=eq.{vin}"
                "&source_platform=eq.reddit&status=neq.expired&limit=1",
            )
            if rstatus < 400 and isinstance(dupe, list) and dupe:
                counts["skipped"] = counts.get("skipped", 0) + 1
                logger.info(
                    "reddit_import: skipped repost VIN=%s — reddit import already live", vin
                )
                return

    if row_id:
        update = {k: v for k, v in payload.items() if k != "source_created_at"}
        # A routine resync must never resurrect a row we (or an admin) took
        # down on purpose. Only a row still 'approved' or hidden by our own
        # source_removed check is safe to have its status/is_approved touched;
        # anything else (expired by the VIN/repost dedup sweeps, or an admin
        # decision) keeps whatever status it currently has.
        if current_status not in ("approved", "source_removed", None):
            update.pop("status", None)
            update.pop("is_approved", None)
        _, status = supabase_request(
            "patch", f"/rest/v1/{table}?id=eq.{row_id}&user_id=eq.{owner_id}", data=update
        )
        if status >= 400 and "import_field_sources" in update:
            # provenance column not yet added (migration pending) — retry without it
            update.pop("import_field_sources")
            _, status = supabase_request(
                "patch", f"/rest/v1/{table}?id=eq.{row_id}&user_id=eq.{owner_id}", data=update
            )
        if status >= 400:
            counts["failed"] += 1
            return
        counts["updated"] += 1
    else:
        body, status = supabase_request("post", f"/rest/v1/{table}", data=payload)
        if (status >= 400 or not (isinstance(body, list) and body)) and "import_field_sources" in payload:
            payload = {k: v for k, v in payload.items() if k != "import_field_sources"}
            body, status = supabase_request("post", f"/rest/v1/{table}", data=payload)
        if status >= 400 or not (isinstance(body, list) and body):
            counts["failed"] += 1
            logger.warning("reddit_import: %s insert failed status=%s body=%s", table, status, str(body)[:200])
            return
        row_id = body[0].get("id")
        counts["created"] += 1
    _record_price_history(config, row_id, payload.get("expected_selling_price") or payload.get("price"))
    _sync_images(config, row_id, parsed.image_urls or ([parsed.image_url] if parsed.image_url else []))


def _record_price_history(config, row_id, new_price):
    """Log a price point when it's new or changed vs the last recorded value.
    Best-effort: a missing table (migration not yet applied) is ignored."""
    if new_price is None or not row_id:
        return
    body, st = supabase_request(
        "get", "/rest/v1/listing_price_history",
        params={"select": "price", "listing_id": f"eq.{row_id}",
                "order": "recorded_at.desc", "limit": "1"})
    if st < 400 and isinstance(body, list) and body:
        try:
            if float(body[0].get("price")) == float(new_price):
                return  # unchanged since last record
        except (TypeError, ValueError):
            pass
    supabase_request("post", "/rest/v1/listing_price_history", data={
        "listing_type": config["listing_type"], "listing_id": row_id,
        "price": new_price, "source": "import"})


# --- Removal sync -----------------------------------------------------------

def sync_removed_imports(session, access_token, live_source_ids, user_agent, now, owner_id):
    """Unpublish previously-imported rows (across all tables) whose source post is
    confirmed removed. A row is a candidate only if its source id was NOT in this
    run's fresh fetch; each candidate is then verified via /api/info."""
    removed = checked = 0
    for cat, config in LISTING_TABLES.items():
        table = config["table"]
        body, status = supabase_request(
            "get", f"/rest/v1/{table}",
            params={"select": "id,source_external_id", "source_platform": "eq.reddit",
                    "user_id": f"eq.{owner_id}",
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
                "patch", f"/rest/v1/{table}?id=eq.{row['id']}&user_id=eq.{owner_id}",
                data={"status": "source_removed", "is_approved": False,
                      "source_removed_at": now.isoformat()},
            )
            if st < 400:
                removed += 1
    return {"removed": removed, "checked": checked}


def _expire_stale_reddit(now, owner_id):
    """Unpublish Reddit rows that have been on the site longer than the max age
    (default 7 days, by created_at). Sets status='expired' so they leave every
    public feed (all require status=approved) and stay gone even if the Reddit
    visibility toggle later flips is_approved back on."""
    if _REDDIT_MAX_AGE_DAYS <= 0 or not owner_id:
        return {"expired": 0}
    cutoff = (now - timedelta(days=_REDDIT_MAX_AGE_DAYS)).isoformat()
    expired = 0
    for cat, config in LISTING_TABLES.items():
        table = config["table"]
        body, st = supabase_request(
            "patch", f"/rest/v1/{table}",
            params={"source_platform": "eq.reddit", "status": "eq.approved",
                    "user_id": f"eq.{owner_id}",
                    "created_at": f"lt.{cutoff}"},
            data={"status": "expired", "is_approved": False},
        )
        if st < 400 and isinstance(body, list):
            expired += len(body)
    if expired:
        logger.info("reddit_import: expired %s listing(s) older than %s days", expired, _REDDIT_MAX_AGE_DAYS)
    return {"expired": expired}


# --- Orchestration ----------------------------------------------------------

def run():
    # Expire stale Reddit listings FIRST, before any enable/config gate. The
    # 7-day cutoff must hold even when importing is paused or misconfigured —
    # otherwise old Reddit posts would stay live on the site forever instead of
    # dropping off at REDDIT_LISTING_MAX_AGE_DAYS.
    owner_id = os.getenv("REDDIT_IMPORT_OWNER_ID", "").strip()
    expired = _expire_stale_reddit(_now(), owner_id)["expired"]

    if not _truthy(os.getenv("REDDIT_IMPORT_ENABLED")):
        return {"status": "disabled", "expired": expired}

    subreddit = os.getenv("REDDIT_IMPORT_SUBREDDIT", DEFAULT_SUBREDDIT)
    client_id = os.getenv("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
    user_agent = os.getenv("REDDIT_USER_AGENT", "").strip()
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
        return {"status": "failed", "error": "missing configuration", "expired": expired}

    if not _validate_owner(owner_id):
        _record_failed_run(subreddit, "owner validation failed (missing UUID or email mismatch)")
        return {"status": "failed", "error": "owner validation failed", "expired": expired}

    now = _now()
    run_id = _start_run(subreddit)
    counts = {k: 0 for k in ("fetched", "eligible", "created", "updated", "skipped", "removed", "expired", "failed")}
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
            existing_map = _fetch_existing_by_source_ids(
                table, [p.source_id for p in parsed_list], owner_id
            )
            for parsed in parsed_list:
                try:
                    _upsert_listing(parsed, owner_id, existing_map, now, counts, visible=visible)
                except Exception:
                    counts["failed"] += 1
                    logger.exception("reddit_import: upsert error for %s", parsed.source_id)

        live_ids = {sub.id for sub in subs}
        counts["removed"] = sync_removed_imports(
            _SESSION, token, live_ids, user_agent, now, owner_id
        )["removed"]
        # Expiry already ran unconditionally at the top of run(); reuse that count.
        counts["expired"] = expired

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
