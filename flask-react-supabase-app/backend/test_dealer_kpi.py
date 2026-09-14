from datetime import datetime, timedelta, timezone
from services.dealer_kpi import (
    CANONICAL_ANALYTICS_CUTOVER_AT,
    dedupe_impressions,
    dedupe_leads,
    normalize_lead_events,
)


def _ev(visitor_id, listing_id, when, action=None, kind="page_view"):
    return {
        "visitor_id": visitor_id,
        "listing_id": listing_id,
        "listing_type": "car",
        "action": action,
        "event_name": kind,
        "created_at": when.isoformat(),
    }


def test_impressions_dedupe_same_visitor_same_day():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [_ev("v1", "L1", t), _ev("v1", "L1", t + timedelta(hours=1))]
    assert dedupe_impressions(events) == 1


def test_impressions_dedupe_different_day_counts_separately():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [_ev("v1", "L1", t), _ev("v1", "L1", t + timedelta(days=1, hours=1))]
    assert dedupe_impressions(events) == 2


def test_impressions_dedupe_different_listings_counted_separately():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [_ev("v1", "L1", t), _ev("v1", "L2", t)]
    assert dedupe_impressions(events) == 2


def test_impressions_ignore_non_view_events():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [
        _ev("v1", "L1", t, kind="listing_view"),
        _ev("v1", "L1", t + timedelta(minutes=1), kind="click"),
    ]
    assert dedupe_impressions(events) == 1


def test_normalize_leads_uses_canonical_events_and_excludes_post_cutover_legacy_rows():
    canonical_time = CANONICAL_ANALYTICS_CUTOVER_AT + timedelta(hours=1)
    events = normalize_lead_events(
        [
            {
                "event_name": "call_click",
                "visitor_id": "visitor-1",
                "listing_type": "car",
                "listing_id": "L1",
                "created_at": canonical_time.isoformat(),
            }
        ],
        [
            {
                "action": "call_click",
                "visitor_id": "visitor-1",
                "listing_type": "car",
                "listing_id": "L1",
                "created_at": (canonical_time + timedelta(minutes=1)).isoformat(),
            },
            {
                "action": "whatsapp_click",
                "visitor_id": "visitor-2",
                "listing_type": "car",
                "listing_id": "L1",
                "created_at": (CANONICAL_ANALYTICS_CUTOVER_AT - timedelta(days=1)).isoformat(),
            },
        ]
    )
    assert [(e["action"], e["visitor_id"]) for e in events] == [
        ("call_click", "visitor-1"),
        ("whatsapp_click", "visitor-2"),
    ]


def test_normalize_canonical_lead_falls_back_to_authenticated_identity():
    events = normalize_lead_events(
        [
            {
                "event_name": "whatsapp_click",
                "user_id": "user-1",
                "listing_type": "car",
                "listing_id": "L1",
                "created_at": "2026-09-01T10:00:00+00:00",
            }
        ],
        [],
    )
    assert events[0]["action"] == "whatsapp_click"
    assert events[0]["visitor_id"] == "user-1"


def test_leads_dedupe_same_visitor_same_action_24h_window():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [
        _ev("v1", "L1", t, action="call_click"),
        _ev("v1", "L1", t + timedelta(hours=5), action="call_click"),
        _ev("v1", "L1", t + timedelta(hours=30), action="call_click"),
    ]
    assert dedupe_leads(events) == 2


def test_leads_dedupe_different_actions_counted_separately():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [
        _ev("v1", "L1", t, action="call_click"),
        _ev("v1", "L1", t + timedelta(hours=1), action="whatsapp_click"),
    ]
    assert dedupe_leads(events) == 2
