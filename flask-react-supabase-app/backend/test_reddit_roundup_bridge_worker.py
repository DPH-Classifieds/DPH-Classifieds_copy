from datetime import datetime, timedelta, timezone

from workers.reddit_roundup_bridge_worker import _build_payload, _rolling_window


def test_rolling_window_is_exactly_48_hours_and_keeps_dubai_label():
    now = datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc)
    since, until, label = _rolling_window(48, now)
    assert datetime.fromisoformat(until) - datetime.fromisoformat(since) == timedelta(hours=48)
    assert label == "16 Aug 2026 - 18 Aug 2026"


def test_payload_uses_daily_cycle_and_all_rendered_posts(monkeypatch):
    rows = [{"id": "a", "make_year": 2022, "car_manufacturer": "BMW", "car_model": "M3", "expected_selling_price": 1}]
    monkeypatch.setattr('workers.reddit_roundup_bridge_worker._fetch_listings', lambda *_: rows)
    payload = _build_payload(48, datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc))
    assert payload['schema'] == 'dph-reddit-roundup/v2'
    assert payload['cycle_id'] == '2026-08-18-rolling-48h'
    assert payload['count'] == 1
    assert len(payload['posts']) == 1
    assert 'DPH Classifieds' not in payload['posts'][0]['title']
