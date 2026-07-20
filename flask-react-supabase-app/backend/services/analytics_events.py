from datetime import datetime, timezone
from uuid import UUID, uuid4


EVENT_NAMES = {
    "listing_view", "call_click", "whatsapp_click", "vin_open", "vin_reveal",
    "page_view", "page_exit", "session_start", "session_end", "form_submit",
    "link_click", "button_click", "app_open",
}
LISTING_EVENTS = {"listing_view", "call_click", "whatsapp_click", "vin_open", "vin_reveal"}
METADATA_KEYS = {"source", "route", "schema_version", "referrer_host", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}
TYPE_ALIASES = {"cars": "car", "bikes": "bike", "plates": "plate", "parts": "part", "car-parts": "part"}


class AnalyticsEventError(ValueError):
    pass


def normalize_analytics_event(payload, authenticated_user_id=None):
    payload = payload or {}
    event_name = str(payload.get("event_name") or payload.get("action") or "").strip()
    if event_name not in EVENT_NAMES:
        raise AnalyticsEventError("unsupported event_name")
    event_id = payload.get("event_id") or str(uuid4())
    try:
        event_id = str(UUID(str(event_id)))
    except (TypeError, ValueError):
        raise AnalyticsEventError("event_id must be a UUID")
    listing_type = TYPE_ALIASES.get(str(payload.get("listing_type") or "").strip().lower(), str(payload.get("listing_type") or "").strip().lower()) or None
    listing_id = str(payload.get("listing_id") or "").strip() or None
    visitor_id = str(payload.get("visitor_id") or "").strip() or None
    session_id = str(payload.get("session_id") or "").strip() or None
    if event_name in LISTING_EVENTS and (not listing_type or not listing_id):
        raise AnalyticsEventError("listing events require listing_type and listing_id")
    if not authenticated_user_id and (not visitor_id or not session_id):
        raise AnalyticsEventError("anonymous events require visitor_id and session_id")
    metadata = payload.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    return {
        "event_id": event_id, "event_name": event_name, "listing_type": listing_type,
        "listing_id": listing_id, "visitor_id": visitor_id, "session_id": session_id,
        "user_id": authenticated_user_id, "platform": str(payload.get("platform") or "web")[:16],
        "occurred_at": payload.get("occurred_at") or datetime.now(timezone.utc).isoformat(),
        "metadata": {key: str(value)[:200] for key, value in metadata.items() if key in METADATA_KEYS and value is not None},
    }
