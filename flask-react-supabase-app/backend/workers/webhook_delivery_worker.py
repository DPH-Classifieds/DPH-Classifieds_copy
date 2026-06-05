"""Deliver queued dealer_webhook_deliveries with HMAC signing + backoff."""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import requests

from services.dealer_secrets import decrypt_secret, KeyMissingError
from services.webhook_signing import sign

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

BATCH_LIMIT = int(os.getenv("WEBHOOK_BATCH_LIMIT", "20"))
BACKOFF_SECONDS = [60, 300, 1500, 7200, 43200]
MAX_ATTEMPTS = 5


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
            "select": "id,webhook_id,event_type,payload,attempt_count",
            "status": "eq.pending",
            "next_retry_at": f"lte.{now_iso}",
            "order": "next_retry_at.asc",
            "limit": str(BATCH_LIMIT),
        },
        timeout=15,
    )
    return r.json() if r.status_code == 200 else []


def _fetch_webhook(webhook_id):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer=""),
        params={"select": "id,url,secret_enc", "id": f"eq.{webhook_id}", "limit": 1},
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return None
    return r.json()[0]


def _mark(delivery_id, body):
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_webhook_deliveries?id=eq.{delivery_id}",
        headers=_svc(prefer="return=minimal"),
        json=body,
        timeout=10,
    )


def _backoff_at(attempt_count):
    idx = min(max(attempt_count - 1, 0), len(BACKOFF_SECONDS) - 1)
    return datetime.now(timezone.utc) + timedelta(seconds=BACKOFF_SECONDS[idx])


def _process(delivery):
    webhook = _fetch_webhook(delivery["webhook_id"])
    if not webhook:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "last_error": "webhook_missing",
        })
        return

    try:
        secret = decrypt_secret(webhook["secret_enc"])
    except KeyMissingError:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "last_error": "key_missing",
        })
        return
    if secret is None:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "last_error": "secret_unreadable",
        })
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
        resp = requests.post(webhook["url"], data=body_bytes, headers=headers,
                             timeout=(10, 10))
    except Exception as exc:
        if new_attempt >= MAX_ATTEMPTS:
            _mark(delivery["id"], {
                "status": "dead_letter",
                "attempt_count": new_attempt,
                "last_error": str(exc)[:300],
            })
        else:
            _mark(delivery["id"], {
                "status": "pending",
                "attempt_count": new_attempt,
                "next_retry_at": _backoff_at(new_attempt).isoformat(),
                "last_error": str(exc)[:300],
            })
        return

    body_text = (resp.text or "")[:500]
    if 200 <= resp.status_code < 300:
        _mark(delivery["id"], {
            "status": "succeeded",
            "attempt_count": new_attempt,
            "delivered_at": now_iso,
            "last_response_code": resp.status_code,
            "last_response_body": body_text,
            "last_error": None,
        })
        return

    if new_attempt >= MAX_ATTEMPTS:
        _mark(delivery["id"], {
            "status": "dead_letter",
            "attempt_count": new_attempt,
            "last_response_code": resp.status_code,
            "last_response_body": body_text,
            "last_error": f"HTTP {resp.status_code}",
        })
    else:
        _mark(delivery["id"], {
            "status": "pending",
            "attempt_count": new_attempt,
            "next_retry_at": _backoff_at(new_attempt).isoformat(),
            "last_response_code": resp.status_code,
            "last_response_body": body_text,
            "last_error": f"HTTP {resp.status_code}",
        })


def run():
    deliveries = _due_deliveries()
    for d in deliveries:
        try:
            _process(d)
        except Exception as e:
            logger.exception("delivery worker crashed on %s", d.get("id"))
            _mark(d.get("id"), {
                "status": "dead_letter",
                "last_error": f"worker_exception: {str(e)[:200]}",
            })
    return len(deliveries)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("webhook_delivery_worker: processed=%d", run())
