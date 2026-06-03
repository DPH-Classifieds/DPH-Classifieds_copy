from datetime import datetime, timedelta, timezone
from services.dealer_kpi import dedupe_impressions, dedupe_leads


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
