"""Queue helper: turn one event into N pending webhook deliveries."""
import logging
import os
import requests

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

ALLOWED_EVENTS = {
    "lead.created", "lead.status_changed", "lead.assigned",
    "listing.sold", "listing.view_milestone", "inventory.import_completed",
}


def _svc():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=minimal",
    }


def dispatch(event_type: str, dealership_id: str, payload: dict) -> int:
    """Queue one delivery per enabled webhook subscribed to event_type.

    Returns the number of delivery rows created. Best-effort; returns 0 on
    any infrastructure failure so callers can stay non-blocking.
    """
    if event_type not in ALLOWED_EVENTS:
        logger.warning("dispatch: unknown event_type=%s", event_type)
        return 0
    if not dealership_id:
        return 0
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
            headers={**_svc(), "Prefer": ""},
            params={
                "select": "id",
                "dealership_id": f"eq.{dealership_id}",
                "enabled": "eq.true",
                "events": f"cs.{{{event_type}}}",
                "limit": 500,
            },
            timeout=10,
        )
    except Exception as e:
        logger.error("dispatch fetch webhooks failed: %s", e)
        return 0
    if r.status_code != 200:
        return 0
    webhooks = r.json() or []
    if not webhooks:
        return 0
    rows = [
        {
            "webhook_id": w["id"],
            "dealership_id": dealership_id,
            "event_type": event_type,
            "payload": payload,
        }
        for w in webhooks
    ]
    try:
        ir = requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_webhook_deliveries",
            headers=_svc(),
            json=rows,
            timeout=10,
        )
        if ir.status_code in (200, 201, 204):
            return len(rows)
    except Exception as e:
        logger.error("dispatch insert deliveries failed: %s", e)
    return 0
