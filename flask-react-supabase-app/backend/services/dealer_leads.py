"""Pure helpers for the dealer lead aggregator and routes.

No I/O — these are deliberately stateless so they're easy to unit-test and
safe to call from both the worker and request handlers.
"""
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

# How lead_events.action maps to dealer_leads.source.
ACTION_TO_SOURCE = {
    "call_click": "call",
    "whatsapp_click": "whatsapp",
    "vin_open": "vin_open",
    "vin_reveal": "vin_open",
    "form_submit": "form",
}

VISITOR_WINDOW = timedelta(hours=24)
FINGERPRINT_WINDOW = timedelta(minutes=30)


def fingerprint_visitor(ip_address: Optional[str], user_agent: Optional[str]) -> Optional[str]:
    """Stable sha256 over (ip || '|' || user_agent). Returns None if either is empty."""
    if not ip_address or not user_agent:
        return None
    raw = f"{ip_address}|{user_agent}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _visitor_id_from_event(ev: dict) -> Optional[str]:
    payload = ev.get("payload") or {}
    vid = payload.get("visitor_id") or ev.get("visitor_id")
    return str(vid) if vid else None


def lead_dedupe_key(ev: dict) -> Optional[Tuple[str, str, str, str, str]]:
    """Return a 5-tuple uniquely identifying a lead, or None if not derivable.

    Tuple shape: (dealership_id, listing_type, listing_id, source, identity)
    where `identity` is either "visitor:<id>" or "fp:<sha256>".
    """
    source = ACTION_TO_SOURCE.get(ev.get("action"))
    if not source:
        return None
    dealership_id = ev.get("dealership_id")
    listing_id = ev.get("listing_id")
    listing_type = ev.get("listing_type")
    if not (dealership_id and listing_id and listing_type):
        return None

    vid = _visitor_id_from_event(ev)
    if vid:
        identity = f"visitor:{vid}"
    else:
        fp = fingerprint_visitor(ev.get("ip_address"), ev.get("user_agent"))
        if not fp:
            return None
        identity = f"fp:{fp}"
    return (dealership_id, listing_type, listing_id, source, identity)


def within_dedupe_window(first_at: datetime, candidate_at: datetime, identity: str) -> bool:
    """True iff candidate event should be folded into an existing lead."""
    if candidate_at < first_at:
        return False
    delta = candidate_at - first_at
    window = VISITOR_WINDOW if identity.startswith("visitor:") else FINGERPRINT_WINDOW
    return delta <= window


def lead_payload_from_event(ev: dict) -> Optional[dict]:
    """Build the JSON body for a brand-new dealer_leads row.

    Returns None if the event can't be mapped (unknown action, no dealership,
    no identity to dedupe on).
    """
    key = lead_dedupe_key(ev)
    if not key:
        return None
    dealership_id, listing_type, listing_id, source, identity = key
    visitor_id = identity[len("visitor:"):] if identity.startswith("visitor:") else None
    fingerprint = identity[len("fp:"):] if identity.startswith("fp:") else None
    ts = ev.get("created_at")
    return {
        "dealership_id": dealership_id,
        "listing_type": listing_type,
        "listing_id": listing_id,
        "source": source,
        "visitor_id": visitor_id,
        "fingerprint": fingerprint,
        "first_event_at": ts,
        "last_event_at": ts,
        "event_count": 1,
        "status": "new",
    }


def parse_event_timestamp(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
