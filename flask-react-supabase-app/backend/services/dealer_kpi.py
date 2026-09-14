"""Dealer-scoped KPI computation: dedupe + windowed aggregates.

Used by the dashboard endpoints and the nightly aggregator worker.
Mirrors the dedupe semantics finalised in the admin-stats refactor:
- impressions: dedupe by (visitor_id, listing_id, day)
- leads: genuine buyer-intent contact actions only (call_click / whatsapp_click /
  form_submit) — VIN opens/reveals are spec reveals, NOT leads — deduped by
  (visitor_id, listing_id, action, 24h-bucket-from-first-event)
"""
from datetime import datetime, timezone
from typing import Iterable, Mapping

# Genuine buyer-intent contact actions: phone-call taps and WhatsApp taps.
# VIN opens/reveals are excluded on purpose; form_submit is a generic UX event
# (not a listing contact) so it is not a lead either.
CONTACT_LEAD_ACTIONS = frozenset({"call_click", "whatsapp_click"})
VIN_ACTIONS = frozenset({"vin_open", "vin_reveal"})
DEALER_ANALYTICS_ACTIONS = CONTACT_LEAD_ACTIONS | VIN_ACTIONS
PAGE_VIEW_EVENTS = frozenset({"page_view", "listing_view"})
CANONICAL_ANALYTICS_CUTOVER_AT = datetime(2026, 7, 20, tzinfo=timezone.utc)


def _parse(ts: str) -> datetime:
    s = ts.replace("Z", "+00:00") if ts and ts.endswith("Z") else ts
    parsed = datetime.fromisoformat(s) if s else datetime.now(timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _identity(event: Mapping) -> str:
    return str(
        event.get("visitor_id")
        or event.get("user_id")
        or event.get("session_id")
        or ""
    ).strip()


def dedupe_impressions(events: Iterable[Mapping]) -> int:
    seen = set()
    for e in events:
        event_name = e.get("event_name")
        if event_name and event_name not in PAGE_VIEW_EVENTS:
            continue
        vid = _identity(e)
        if not vid:
            continue
        lid = e.get("listing_id") or ""
        ltype = e.get("listing_type") or ""
        day = _parse(e["created_at"]).date().isoformat()
        seen.add((vid, ltype, lid, day))
    return len(seen)


def dedupe_leads(events: Iterable[Mapping], actions=CONTACT_LEAD_ACTIONS) -> int:
    by_key = {}
    for e in events:
        if actions is not None and (e.get("action") or "") not in actions:
            continue
        identity = _identity(e)
        if not identity:
            continue
        key = (identity,
               e.get("listing_type") or "",
               e.get("listing_id") or "",
               e.get("action") or "")
        by_key.setdefault(key, []).append(_parse(e["created_at"]))

    total = 0
    for times in by_key.values():
        times.sort()
        if not times:
            continue
        anchor = times[0]
        total += 1
        for t in times[1:]:
            if (t - anchor).total_seconds() >= 24 * 3600:
                total += 1
                anchor = t
    return total


def normalize_lead_events(
    platform_events: Iterable[Mapping],
    legacy_lead_events: Iterable[Mapping],
    cutover_at: datetime = CANONICAL_ANALYTICS_CUTOVER_AT,
) -> list[dict]:
    """Build one dealer lead stream from canonical and historical events."""
    if cutover_at.tzinfo is None:
        cutover_at = cutover_at.replace(tzinfo=timezone.utc)

    normalized = []
    for source_event in platform_events or []:
        action = str(
            source_event.get("event_name") or source_event.get("action") or ""
        ).strip()
        if action not in DEALER_ANALYTICS_ACTIONS:
            continue
        row = dict(source_event)
        row["action"] = action
        row["visitor_id"] = _identity(source_event) or None
        normalized.append(row)

    for source_event in legacy_lead_events or []:
        created_at = source_event.get("created_at")
        if created_at:
            try:
                if _parse(str(created_at)) >= cutover_at:
                    continue
            except (TypeError, ValueError):
                continue
        action = str(source_event.get("action") or "").strip()
        if action not in DEALER_ANALYTICS_ACTIONS:
            continue
        row = dict(source_event)
        row["action"] = action
        row["visitor_id"] = _identity(source_event) or None
        normalized.append(row)

    return normalized
