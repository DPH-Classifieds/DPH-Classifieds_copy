from datetime import datetime, timedelta, timezone

from workers.reddit_roundup_bridge_worker import _build_payload, _rolling_window, _sign_payload


def test_rolling_window_is_exactly_48_hours_and_keeps_dubai_label():
    now = datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc)
    since, until, first_day, last_day, label = _rolling_window(48, now)
    assert datetime.fromisoformat(until) - datetime.fromisoformat(since) == timedelta(hours=48)
    assert label == "16 Aug 2026 - 18 Aug 2026"
    # Explicit dates for the post title/body
    assert first_day.isoformat() == "2026-08-16"
    assert last_day.isoformat() == "2026-08-18"


def test_payload_uses_daily_cycle_and_all_rendered_posts(monkeypatch):
    rows = [{"id": "a", "make_year": 2022, "car_manufacturer": "BMW", "car_model": "M3", "expected_selling_price": 1}]
    monkeypatch.setattr('workers.reddit_roundup_bridge_worker._fetch_listings', lambda *_: rows)
    payload = _build_payload(48, datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc))
    assert payload['schema'] == 'dph-reddit-roundup/v2'
    assert payload['cycle_id'] == '2026-08-18-rolling-48h'
    assert payload['count'] == 1
    assert len(payload['posts']) == 1
    assert 'DPH Classifieds' not in payload['posts'][0]['title']
    # The post title now uses the explicit date range from the rolling window
    assert "16–18 Aug 2026" in payload['posts'][0]['title']


def test_hmac_signature_is_stable_and_excludes_refresh_timestamp(monkeypatch):
    rows = [{"id": "a", "make_year": 2022, "car_manufacturer": "BMW", "car_model": "M3", "expected_selling_price": 1}]
    monkeypatch.setattr('workers.reddit_roundup_bridge_worker._fetch_listings', lambda *_: rows)
    first = _build_payload(48, datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc))
    second = dict(first, generated_at="2026-08-18T08:01:00+00:00")
    assert _sign_payload(first, "test-secret")["signature"] == _sign_payload(second, "test-secret")["signature"]
    assert _sign_payload(first, "other-secret")["signature"] != _sign_payload(first, "test-secret")["signature"]


def test_hmac_signature_changes_when_signed_content_changes():
    payload = {"schema": "dph-reddit-roundup/v2", "cycle_id": "cycle", "content_hash": "hash"}
    signed = _sign_payload(payload, "test-secret")
    tampered = dict(signed, cycle_id="different")
    assert signed["signature_version"] == "hmac-sha256-v1"
    assert signed["signature"] != _sign_payload(tampered, "test-secret")["signature"]
