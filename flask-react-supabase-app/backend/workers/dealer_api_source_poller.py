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
import logging
import os
from datetime import datetime, timezone

import requests

from services.dealer_credentials import decrypt_credentials, KeyMissingError
from services.dealer_inventory import apply_column_mapping, validate_row, coerce_row

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

# How many sources to process per tick
_BATCH_SIZE = 5


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
                      "last_pulled_at,enabled",
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
            interval_sec = (src.get("poll_interval_min") or 60) * 60
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
    headers = _build_auth_headers(auth_type, credentials, endpoint_url)
    try:
        resp = requests.get(endpoint_url, headers=headers, timeout=30)
    except Exception as exc:
        return None, f"http_error_connection: {exc}"

    if resp.status_code == 401:
        return None, "auth_failed"
    if resp.status_code != 200:
        return None, f"http_error_{resp.status_code}"

    try:
        payload = resp.json()
    except Exception:
        return None, "parse_failed"

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


def _upsert_car(dealership_id, coerced):
    """Returns ('created'|'updated', car_id) or raises."""
    ext_id = coerced.get("external_id")
    if ext_id:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/cars",
            headers=_svc(prefer=""),
            params={
                "select": "id",
                "dealership_id": f"eq.{dealership_id}",
                "external_id": f"eq.{ext_id}",
                "limit": 1,
            },
            timeout=10,
        )
        if r.status_code == 200 and r.json():
            car_id = r.json()[0]["id"]
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                headers=_svc(prefer="return=minimal"),
                json=_build_car_payload(dealership_id, coerced),
                timeout=10,
            )
            return ("updated", car_id)
    cr = requests.post(
        f"{SUPABASE_URL}/rest/v1/cars",
        headers=_svc(prefer="return=representation"),
        json=_build_car_payload(dealership_id, coerced),
        timeout=10,
    )
    if cr.status_code in (200, 201) and cr.json():
        return ("created", cr.json()[0]["id"])
    raise RuntimeError(f"insert failed: {cr.status_code} {cr.text[:200]}")


def _update_source(source_id, last_status, last_error=None):
    body = {
        "last_pulled_at": datetime.now(timezone.utc).isoformat(),
        "last_status": last_status,
        "last_error": last_error,
    }
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources?id=eq.{source_id}",
        headers=_svc(prefer="return=minimal"),
        json=body,
        timeout=10,
    )


def _process_source(source):
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
                           "DEALER_INTEGRATIONS_KEY env var is unset")
            return
        if credentials is None:
            _update_source(source_id, "credentials_unreadable",
                           "Credentials token is tampered or invalid")
            return

    # --- Fetch from DMS ---
    rows, error_status = _generic_json_fetch(endpoint_url, auth_type, credentials)
    if error_status:
        _update_source(source_id, error_status,
                       f"Fetch failed: {error_status}")
        return

    # --- Import rows ---
    counts = {"created": 0, "updated": 0, "failed": 0}
    for raw in rows:
        mapped = apply_column_mapping(raw, field_mapping) if field_mapping else raw
        ok, err = validate_row(mapped)
        if not ok:
            counts["failed"] += 1
            continue
        coerced = coerce_row(mapped)
        try:
            action, _ = _upsert_car(dealership_id, coerced)
            counts["created" if action == "created" else "updated"] += 1
        except Exception as exc:
            logger.warning("dealer_api_source_poller: upsert failed for source %s: %s",
                           source_id, exc)
            counts["failed"] += 1

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
    _update_source(source_id, final_status, error_msg)


def run():
    """Process all due sources for this tick. Returns count of sources processed."""
    due_sources = _fetch_due_sources()
    for source in due_sources:
        try:
            _process_source(source)
        except Exception:
            logger.exception("dealer_api_source_poller: unexpected error on source %s",
                             source.get("id"))
    return len(due_sources)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("dealer_api_source_poller: processed=%d", run())
