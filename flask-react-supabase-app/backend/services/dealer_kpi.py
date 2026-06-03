"""Dealer-scoped KPI computation: dedupe + windowed aggregates.

Used by the dashboard endpoints and the nightly aggregator worker.
Mirrors the dedupe semantics finalised in the admin-stats refactor:
- impressions: dedupe by (visitor_id, listing_id, day)
- leads: dedupe by (visitor_id, listing_id, action, 24h-bucket-from-first-event)
"""
from datetime import datetime, timezone
from typing import Iterable, Mapping


def _parse(ts: str) -> datetime:
    s = ts.replace("Z", "+00:00") if ts and ts.endswith("Z") else ts
    return datetime.fromisoformat(s) if s else datetime.now(timezone.utc)


def dedupe_impressions(events: Iterable[Mapping]) -> int:
    seen = set()
    for e in events:
        vid = e.get("visitor_id") or ""
        lid = e.get("listing_id") or ""
        ltype = e.get("listing_type") or ""
        day = _parse(e["created_at"]).date().isoformat()
        seen.add((vid, ltype, lid, day))
    return len(seen)


def dedupe_leads(events: Iterable[Mapping]) -> int:
    by_key = {}
    for e in events:
        key = (e.get("visitor_id") or "",
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
