"""Deliver queued dealer_webhook_deliveries with HMAC signing + backoff."""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import requests

from services.dealer_secrets import decrypt_secret, KeyMissingError
from services.webhook_signing import sign
from services.url_safety import (
    SAFE_POST_REDIRECT_STATUSES,
    assert_safe_outbound,
    request_with_safe_redirects,
)

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

BATCH_LIMIT = int(os.getenv("WEBHOOK_BATCH_LIMIT", "20"))
BACKOFF_SECONDS = [60, 300, 1500, 7200, 43200]
MAX_ATTEMPTS = 5
MAX_RESPONSE_BYTES = max(500, int(os.getenv("DEALER_WEBHOOK_MAX_RESPONSE_BYTES", "8192")))
LEASE_SECONDS = max(30, int(os.getenv("DEALER_WEBHOOK_LEASE_SECONDS", "60")))


def _svc(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": prefer,
    }


def _due_deliveries():
    now_iso = datetime.now(timezone.utc).isoformat()
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhook_deliveries",
        headers=_svc(prefer=""),
        params={
            "select": "id,webhook_id,dealership_id,event_type,payload,attempt_count,next_retry_at",
            "status": "eq.pending",
            "next_retry_at": f"lte.{now_iso}",
            "order": "next_retry_at.asc",
            "limit": str(BATCH_LIMIT),
        },
        timeout=15,
    )
    return r.json() if r.status_code == 200 else []


def _fetch_webhook(webhook_id, dealership_id):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer=""),
        params={
            "select": "id,dealership_id,url,secret_enc",
            "id": f"eq.{webhook_id}",
            "dealership_id": f"eq.{dealership_id}",
            "limit": 1,
        },
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return None
    return r.json()[0]


def _claim(delivery):
    lease_until = (
        datetime.now(timezone.utc) + timedelta(seconds=LEASE_SECONDS)
    ).isoformat()
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_webhook_deliveries",
        headers=_svc(prefer="return=representation"),
        params={
            "id": f"eq.{delivery['id']}",
            "dealership_id": f"eq.{delivery['dealership_id']}",
            "status": "eq.pending",
            "next_retry_at": f"eq.{delivery['next_retry_at']}",
        },
        json={"next_retry_at": lease_until}, timeout=10,
    )
    rows = r.json() if r.status_code < 300 else []
    return lease_until if rows else None


def _mark(delivery_id, body, dealership_id=None, lease_until=None):
    if not lease_until:
        return False
    params = {"id": f"eq.{delivery_id}"}
    if dealership_id:
        params["dealership_id"] = f"eq.{dealership_id}"
    if lease_until:
        params.update({"status": "eq.pending", "next_retry_at": f"eq.{lease_until}"})
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_webhook_deliveries",
        headers=_svc(prefer="return=representation"),
        params=params,
        json=body,
        timeout=10,
    )
    rows = response.json() if response.status_code < 300 else []
    return bool(rows)


def _backoff_at(attempt_count):
    idx = min(max(attempt_count - 1, 0), len(BACKOFF_SECONDS) - 1)
    return datetime.now(timezone.utc) + timedelta(seconds=BACKOFF_SECONDS[idx])


def _bounded_response_text(response):
    """Read only the configured response prefix; never materialize the full body."""
    content_length = response.headers.get("Content-Length")
    if content_length:
        try:
            if int(content_length) > MAX_RESPONSE_BYTES:
                return "[response body exceeded limit]"
        except ValueError:
            pass

    body = bytearray()
    for chunk in response.iter_content(chunk_size=1024):
        if not chunk:
            continue
        remaining = MAX_RESPONSE_BYTES + 1 - len(body)
        body.extend(chunk[:remaining])
        if len(body) > MAX_RESPONSE_BYTES:
            return bytes(body[:500]).decode("utf-8", errors="replace")
    return bytes(body[:500]).decode("utf-8", errors="replace")


def _process(delivery):
    lease_until = _claim(delivery)
    if not lease_until:
        return
    delivery["_lease_until"] = lease_until
    dealership_id = delivery["dealership_id"]
    webhook = _fetch_webhook(delivery["webhook_id"], dealership_id)
    if not webhook:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "last_error": "webhook_missing",
        }, dealership_id, lease_until)
        return

    try:
        secret = decrypt_secret(webhook["secret_enc"])
    except KeyMissingError:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "last_error": "key_missing",
        }, dealership_id, lease_until)
        return
    if secret is None:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "last_error": "secret_unreadable",
        }, dealership_id, lease_until)
        return
    try:
        webhook["url"] = assert_safe_outbound(webhook["url"])
    except ValueError:
        _mark(delivery["id"], {"status": "dead_letter", "last_error": "unsafe_url"},
              dealership_id, lease_until)
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    body_dict = {
        "id": delivery["id"],
        "event": delivery["event_type"],
        "delivered_at": now_iso,
        "data": delivery["payload"],
    }
    body_bytes = json.dumps(body_dict, sort_keys=True).encode("utf-8")
    signature = sign(secret, body_bytes)
    headers = {
        "Content-Type": "application/json",
        "X-DPH-Signature": signature,
        "X-DPH-Delivery": delivery["id"],
        "X-DPH-Event": delivery["event_type"],
    }

    new_attempt = int(delivery.get("attempt_count") or 0) + 1
    try:
        resp = request_with_safe_redirects(
            requests.post,
            webhook["url"],
            data=body_bytes,
            headers=headers,
            timeout=(10, 10),
            stream=True,
            redirect_statuses=SAFE_POST_REDIRECT_STATUSES,
        )
    except Exception as exc:
        if new_attempt >= MAX_ATTEMPTS:
            _mark(delivery["id"], {
                "status": "dead_letter",
                "attempt_count": new_attempt,
                "last_error": str(exc)[:300],
            }, dealership_id, lease_until)
        else:
            _mark(delivery["id"], {
                "status": "pending",
                "attempt_count": new_attempt,
                "next_retry_at": _backoff_at(new_attempt).isoformat(),
                "last_error": str(exc)[:300],
            }, dealership_id, lease_until)
        return

    try:
        body_text = _bounded_response_text(resp)
    finally:
        resp.close()
    if 200 <= resp.status_code < 300:
        _mark(delivery["id"], {
            "status": "succeeded",
            "attempt_count": new_attempt,
            "delivered_at": now_iso,
            "last_response_code": resp.status_code,
            "last_response_body": body_text,
            "last_error": None,
        }, dealership_id, lease_until)
        return

    if new_attempt >= MAX_ATTEMPTS:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "attempt_count": new_attempt,
            "last_response_code": resp.status_code,
            "last_response_body": body_text,
            "last_error": f"HTTP {resp.status_code}",
        }, dealership_id, lease_until)
    else:
        _mark(delivery["id"], {
            "status": "pending",
            "attempt_count": new_attempt,
            "next_retry_at": _backoff_at(new_attempt).isoformat(),
            "last_response_code": resp.status_code,
            "last_response_body": body_text,
            "last_error": f"HTTP {resp.status_code}",
        }, dealership_id, lease_until)


def run():
    deliveries = _due_deliveries()
    processed = 0
    for d in deliveries:
        try:
            _process(d)
        except Exception as e:
            logger.exception("delivery worker crashed on %s", d.get("id"))
            lease_until = d.get("_lease_until")
            if lease_until:
                _mark(d.get("id"), {
                    "status": "dead_letter",
                    "last_error": f"worker_exception: {str(e)[:200]}",
                }, d.get("dealership_id"), lease_until)
            else:
                logger.warning(
                    "delivery ownership unknown; skipping exception finalization for %s",
                    d.get("id"),
                )
        if d.get("_lease_until"):
            processed += 1
    return processed


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("webhook_delivery_worker: processed=%d", run())
