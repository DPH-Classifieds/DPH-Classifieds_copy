# flask-react-supabase-app/backend/workers/dealer_api_source_poller.py
"""Poll enabled dealer_api_sources rows and import listings via the generic_json adapter.

For each tick: fetch up to 5 sources whose next poll is due, decrypt their
credentials, call the endpoint, normalise rows through the same pipeline as
inventory_import_worker, upsert into cars, then update last_pulled_at and
last_status on the source row.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone

import requests
from services.url_safety import assert_safe_outbound, request_with_safe_redirects

from services.dealer_credentials import decrypt_credentials, KeyMissingError
from services.dealer_inventory import apply_column_mapping, validate_row, coerce_row

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

# How many sources to process per tick
_BATCH_SIZE = 5
_MAX_RESPONSE_BYTES = max(1024, int(os.getenv("DEALER_API_MAX_RESPONSE_BYTES", str(5 * 1024 * 1024))))
_MIN_POLL_INTERVAL = 5
_MAX_POLL_INTERVAL = 7 * 24 * 60
_CLAIM_STALE_SECONDS = max(60, int(os.getenv("DEALER_API_CLAIM_STALE_SECONDS", "300")))


def _read_bounded_response(response, max_bytes=_MAX_RESPONSE_BYTES):
    content_length = response.headers.get("Content-Length")
    if content_length is not None:
        try:
            declared_size = int(content_length)
        except (TypeError, ValueError):
            declared_size = None
        if declared_size is not None and declared_size > max_bytes:
            raise ValueError("response_too_large")

    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("response_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


def _svc(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": prefer,
    }


def _fetch_due_sources():
    """Return up to _BATCH_SIZE enabled sources whose poll interval has elapsed."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(prefer=""),
        params={
            "select": "id,dealership_id,adapter,endpoint_url,auth_type,"
                      "credentials_enc,field_mapping,poll_interval_min,"
                      "last_pulled_at,last_status,enabled",
            "enabled": "eq.true",
            "order": "last_pulled_at.asc.nullsfirst",
            "limit": _BATCH_SIZE,
        },
        timeout=10,
    )
    if r.status_code != 200:
        logger.warning("dealer_api_source_poller: source SELECT failed %s", r.status_code)
        return []

    now = datetime.now(timezone.utc)
    due = []
    for src in r.json():
        last = src.get("last_pulled_at")
        if last is None:
            due.append(src)
            continue
        # Parse ISO timestamp (Postgres returns timezone-aware string)
        try:
            if last.endswith("Z"):
                last = last[:-1] + "+00:00"
            last_dt = datetime.fromisoformat(last)
            interval = int(src.get("poll_interval_min") or 60)
            interval = max(_MIN_POLL_INTERVAL, min(_MAX_POLL_INTERVAL, interval))
            if src.get("last_status") == "polling":
                interval_sec = _CLAIM_STALE_SECONDS
            else:
                interval_sec = interval * 60
            if (now - last_dt).total_seconds() >= interval_sec:
                due.append(src)
        except Exception:
            due.append(src)  # parse failure → treat as due
    return due


def _build_auth_headers(auth_type, credentials, endpoint_url, body=b""):
    """Return extra HTTP headers for the given auth_type."""
    if auth_type == "bearer":
        token = (credentials or {}).get("token", "")
        return {"Authorization": f"Bearer {token}"}
    if auth_type == "basic":
        username = (credentials or {}).get("username", "")
        password = (credentials or {}).get("password", "")
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        return {"Authorization": f"Basic {encoded}"}
    if auth_type == "hmac":
        secret = ((credentials or {}).get("secret") or "").encode()
        sig = hmac.new(secret, body, hashlib.sha256).hexdigest()
        return {"X-Signature": sig}
    # auth_type == "none" or anything else
    return {}


def _generic_json_fetch(endpoint_url, auth_type, credentials):
    """Call the DMS endpoint and return (rows_list_or_None, error_status_or_None).

    Returns (rows, None) on success or (None, status_string) on failure.
    """
    try:
        endpoint_url = assert_safe_outbound(endpoint_url)
    except ValueError as exc:
        return None, f"unsafe_endpoint_url: {exc}"
    headers = _build_auth_headers(auth_type, credentials, endpoint_url)
    try:
        resp = request_with_safe_redirects(
            requests.get,
            endpoint_url,
            headers=headers,
            timeout=30,
            stream=True,
        )
    except ValueError as exc:
        return None, f"unsafe_endpoint_url: {exc}"
    except Exception as exc:
        return None, f"http_error_connection: {exc}"

    try:
        if resp.status_code == 401:
            return None, "auth_failed"
        if resp.status_code != 200:
            return None, f"http_error_{resp.status_code}"
        try:
            raw = _read_bounded_response(resp)
        except ValueError:
            return None, "response_too_large"
        try:
            payload = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            # A malformed successful response is a source contract failure, not
            # a transient transport error. Record it once; the normal source
            # poll interval controls the next attempt.
            return None, "parse_failed"
    finally:
        resp.close()

    if isinstance(payload, list):
        return payload, None
    if isinstance(payload, dict) and "listings" in payload:
        listings = payload["listings"]
        if isinstance(listings, list):
            return listings, None
    return None, "parse_failed"


def _build_car_payload(dealership_id, coerced):
    payload = {
        "dealership_id": dealership_id,
        "is_dealer": True,
        "is_approved": True,
        "status": "active",
        "external_id": coerced.get("external_id") or None,
        "make": coerced.get("make"),
        "car_model": coerced.get("car_model") or coerced.get("model"),
        "make_year": coerced.get("make_year"),
        "expected_selling_price": coerced.get("expected_selling_price"),
        "kilometers": coerced.get("kilometers"),
        "body_type": coerced.get("body_type"),
        "color": coerced.get("color"),
        "fuel_type": coerced.get("fuel_type"),
        "transmission": coerced.get("transmission"),
        "description": coerced.get("description"),
    }
    return {k: v for k, v in payload.items() if v is not None}


_UPSERT_CHUNK = 50


def _bulk_upsert_cars(dealership_id, rows_with_ext, rows_without_ext, counts):
    """Batch-upsert rows into cars, mutating counts in-place.

    Strategy: one batch GET per 50 external_ids to resolve existing rows,
    then chunked bulk INSERT for new ones and individual PATCH for existing.
    """
    # Resolve existing external_ids in batches.
    existing_id_map = {}  # external_id -> car_id
    all_ext_ids = [c["external_id"] for c in rows_with_ext]
    for i in range(0, len(all_ext_ids), _UPSERT_CHUNK):
        chunk_ids = all_ext_ids[i : i + _UPSERT_CHUNK]
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/cars",
            headers=_svc(prefer=""),
            params={
                "select": "id,external_id",
                "dealership_id": f"eq.{dealership_id}",
                "external_id": f"in.({','.join(chunk_ids)})",
            },
            timeout=15,
        )
        if r.status_code == 200:
            for row in r.json():
                existing_id_map[row["external_id"]] = row["id"]

    to_insert = [c for c in rows_with_ext if c["external_id"] not in existing_id_map]
    to_update = [(c, existing_id_map[c["external_id"]]) for c in rows_with_ext
                 if c["external_id"] in existing_id_map]

    # Bulk INSERT new rows (with and without external_id), chunked.
    for batch in (to_insert, rows_without_ext):
        for i in range(0, len(batch), _UPSERT_CHUNK):
            chunk = batch[i : i + _UPSERT_CHUNK]
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/cars",
                headers=_svc(prefer="return=minimal"),
                json=[_build_car_payload(dealership_id, c) for c in chunk],
                timeout=30,
            )
            if resp.status_code in (200, 201, 204):
                counts["created"] += len(chunk)
            else:
                counts["failed"] += len(chunk)

    # Individual PATCH for existing rows (payloads differ per row).
    for coerced, car_id in to_update:
        try:
            r = requests.patch(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                headers=_svc(prefer="return=minimal"),
                json=_build_car_payload(dealership_id, coerced),
                timeout=10,
            )
            if r.status_code in (200, 204):
                counts["updated"] += 1
            else:
                counts["failed"] += 1
        except Exception as exc:
            logger.warning("dealer_api_source_poller: update failed car=%s: %s", car_id, exc)
            counts["failed"] += 1


def _claim_source(source):
    """Atomically lease a due source using existing last_pulled_at/status columns."""
    claimed_at = datetime.now(timezone.utc).isoformat()
    params = {"id": f"eq.{source['id']}", "enabled": "eq.true"}
    previous = source.get("last_pulled_at")
    params["last_pulled_at"] = f"eq.{previous}" if previous else "is.null"
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(prefer="return=representation"),
        params=params,
        json={"last_pulled_at": claimed_at, "last_status": "polling", "last_error": None},
        timeout=10,
    )
    rows = response.json() if response.status_code < 300 and response.content else []
    return claimed_at if rows else None


def _update_source(source_id, last_status, last_error=None, claimed_at=None, disable=False):
    body = {
        "last_pulled_at": datetime.now(timezone.utc).isoformat(),
        "last_status": last_status,
        "last_error": last_error,
    }
    if disable:
        body["enabled"] = False
    params = {"id": f"eq.{source_id}"}
    if claimed_at:
        params.update({"last_status": "eq.polling", "last_pulled_at": f"eq.{claimed_at}"})
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(prefer="return=minimal"),
        params=params,
        json=body,
        timeout=10,
    )


def _process_source(source, claimed_at):
    source_id = source["id"]
    dealership_id = source["dealership_id"]
    credentials_enc = source.get("credentials_enc")
    auth_type = source.get("auth_type", "none")
    endpoint_url = source["endpoint_url"]
    field_mapping = source.get("field_mapping") or {}

    # --- Decrypt credentials ---
    credentials = None
    if credentials_enc:
        try:
            credentials = decrypt_credentials(credentials_enc)
        except KeyMissingError:
            _update_source(source_id, "key_missing",
                           "DEALER_INTEGRATIONS_KEY env var is unset", claimed_at)
            return
        if credentials is None:
            _update_source(source_id, "credentials_unreadable",
                           "Credentials token is tampered or invalid", claimed_at)
            return

    # --- Fetch from DMS ---
    rows, error_status = _generic_json_fetch(endpoint_url, auth_type, credentials)
    if error_status:
        _update_source(source_id, error_status,
                       f"Fetch failed: {error_status}", claimed_at)
        return

    # --- Import rows ---
    counts = {"created": 0, "updated": 0, "failed": 0}
    valid_with_ext = []
    valid_without_ext = []
    for raw in rows:
        mapped = apply_column_mapping(raw, field_mapping) if field_mapping else raw
        ok, err = validate_row(mapped)
        if not ok:
            counts["failed"] += 1
            continue
        coerced = coerce_row(mapped)
        if coerced.get("external_id"):
            valid_with_ext.append(coerced)
        else:
            valid_without_ext.append(coerced)
    _bulk_upsert_cars(dealership_id, valid_with_ext, valid_without_ext, counts)

    # --- Determine final status ---
    total_good = counts["created"] + counts["updated"]
    total_bad = counts["failed"]
    if total_bad == 0:
        final_status = "ok"
    elif total_good > 0:
        final_status = "partial"
    else:
        final_status = "failed"

    error_msg = (f"{total_bad} row(s) failed to import" if total_bad else None)
    # A feed that returns zero usable rows twice in a row isn't a transient
    # blip (the fetch succeeded — its own data is unparseable) and won't
    # self-heal by retrying forever on the normal poll cadence. Disable it so
    # a human has to fix the field mapping / feed before it resumes.
    consecutive_full_failure = final_status == "failed" and source.get("last_status") == "failed"
    if consecutive_full_failure:
        error_msg = (error_msg or "row import failed") + " — auto-disabled after repeated full failures"
    _update_source(source_id, final_status, error_msg, claimed_at, disable=consecutive_full_failure)


def run():
    """Process all due sources for this tick. Returns count of sources processed."""
    due_sources = _fetch_due_sources()
    processed = 0
    for source in due_sources:
        try:
            claimed_at = _claim_source(source)
            if claimed_at:
                processed += 1
                _process_source(source, claimed_at)
        except Exception:
            logger.exception("dealer_api_source_poller: unexpected error on source %s",
                             source.get("id"))
    return processed


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("dealer_api_source_poller: processed=%d", run())
