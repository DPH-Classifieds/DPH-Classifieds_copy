"""Canonical contact and VIN-reveal reporting helpers."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone


CUTOVER_AT = datetime(2026, 7, 20, tzinfo=timezone.utc)
CONTACT_ACTIONS = frozenset({"call_click", "whatsapp_click"})
VIN_REVEAL_ACTION = "vin_reveal"
LEAD_WINDOW = timedelta(hours=24)


def _when(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value or "").replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _identity(event):
    payload = event.get("payload") or {}
    for value in (event.get("user_id"), event.get("visitor_id"), payload.get("visitor_id"), event.get("session_id")):
        if value:
            return str(value)
    return None


def _event_rows(platform_events, lead_events, cutoff):
    """Yield one source of events on each side of the analytics cutover."""
    for event in platform_events or []:
        when = _when(event.get("created_at"))
        if when and when >= CUTOVER_AT and when >= cutoff:
            yield {**event, "action": event.get("event_name"), "occurred_at": when}
    for event in lead_events or []:
        when = _when(event.get("created_at"))
        if when and when < CUTOVER_AT and when >= cutoff:
            yield {**event, "occurred_at": when}


def _listing_key(event):
    listing_type = str(event.get("listing_type") or "").rstrip("s")
    listing_id = str(event.get("listing_id") or "")
    return (listing_type, listing_id) if listing_type and listing_id else None


def build_contact_analytics(platform_events, lead_events, days, now=None):
    """Return normalized summary and listing-level analytics for an admin window."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=int(days))
    rows = list(_event_rows(platform_events, lead_events, cutoff))
    summary = defaultdict(int)
    contacts = defaultdict(list)
    vin_by_listing = defaultdict(list)

    for row in rows:
        action = row.get("action")
        identity = _identity(row)
        listing = _listing_key(row)
        if action in CONTACT_ACTIONS:
            channel = "call" if action == "call_click" else "whatsapp"
            summary[f"raw_{channel}_taps"] += 1
            if identity and listing:
                contacts[(identity, *listing)].append({**row, "channel": channel, "identity": identity})
            else:
                summary["unattributed_contact_taps"] += 1
        elif action == VIN_REVEAL_ACTION:
            summary["raw_vin_reveals"] += 1
            if identity and listing:
                vin_by_listing[listing].append({**row, "identity": identity})
            else:
                summary["unattributed_vin_reveals"] += 1

    lead_listings = defaultdict(lambda: {"lead_windows": 0, "channels": set(), "raw_taps": 0})
    caller_ids, whatsapp_ids = set(), set()
    for (identity, listing_type, listing_id), events in contacts.items():
        events.sort(key=lambda row: row["occurred_at"])
        for event in events:
            if event["channel"] == "call":
                caller_ids.add((identity, listing_type, listing_id))
            else:
                whatsapp_ids.add((identity, listing_type, listing_id))
        anchor = None
        for event in events:
            if anchor is None or event["occurred_at"] - anchor >= LEAD_WINDOW:
                lead_listings[(listing_type, listing_id)]["lead_windows"] += 1
                anchor = event["occurred_at"]
            lead_listings[(listing_type, listing_id)]["channels"].add(event["channel"])
            lead_listings[(listing_type, listing_id)]["raw_taps"] += 1

    vin_listings = []
    unique_vin_revealers = set()
    for (listing_type, listing_id), events in vin_by_listing.items():
        unique_actors = {event["identity"] for event in events}
        unique_vin_revealers.update((actor, listing_type, listing_id) for actor in unique_actors)
        vin_listings.append({
            "listing_type": listing_type, "listing_id": listing_id,
            "raw_vin_reveals": len(events), "unique_vin_revealers": len(unique_actors),
        })
    vin_listings.sort(key=lambda row: (-row["raw_vin_reveals"], row["listing_type"], row["listing_id"]))

    lead_listing_rows = [
        {"listing_type": listing_type, "listing_id": listing_id,
         "unique_leads": values["lead_windows"], "channels": sorted(values["channels"]),
         "raw_contact_taps": values["raw_taps"]}
        for (listing_type, listing_id), values in lead_listings.items()
    ]
    lead_listing_rows.sort(key=lambda row: (-row["unique_leads"], row["listing_type"], row["listing_id"]))
    summary.update({
        "unique_leads": sum(row["unique_leads"] for row in lead_listing_rows),
        "unique_callers": len(caller_ids),
        "unique_whatsapp_contacts": len(whatsapp_ids),
        "unique_vin_revealers": len(unique_vin_revealers),
    })
    return {"summary": dict(summary), "lead_listings": lead_listing_rows, "vin_listings": vin_listings,
            "_vin_events": vin_by_listing}


def build_vin_listing_activity(analytics, listing_type, listing_id):
    events = analytics.get("_vin_events", {}).get((listing_type.rstrip("s"), str(listing_id)), [])
    grouped = defaultdict(list)
    for event in events:
        grouped[event["identity"]].append(event)
    activity = []
    for identity, rows in grouped.items():
        rows.sort(key=lambda row: row["occurred_at"], reverse=True)
        activity.append({"actor_id": identity, "reveal_count": len(rows), "last_revealed_at": rows[0]["occurred_at"].isoformat()})
    return sorted(activity, key=lambda row: (-row["reveal_count"], row["last_revealed_at"]), reverse=False)
