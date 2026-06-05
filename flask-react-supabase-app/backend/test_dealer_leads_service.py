from datetime import datetime, timezone, timedelta
from services.dealer_leads import (
    fingerprint_visitor,
    lead_dedupe_key,
    lead_payload_from_event,
    within_dedupe_window,
)


def _ev(**over):
    base = {
        "id": "evt-1",
        "listing_id": "L1",
        "listing_type": "car",
        "action": "call_click",
        "user_id": None,
        "session_id": "s1",
        "source": None,
        "user_agent": "ua-A",
        "ip_address": "1.2.3.4",
        "payload": {"visitor_id": "v1"},
        "created_at": "2026-06-05T10:00:00+00:00",
        "dealership_id": "d1",
    }
    base.update(over)
    return base


def test_fingerprint_is_stable_for_same_ip_and_ua():
    a = fingerprint_visitor("1.2.3.4", "ua-A")
    b = fingerprint_visitor("1.2.3.4", "ua-A")
    assert a == b
    assert a != fingerprint_visitor("1.2.3.5", "ua-A")
    assert a != fingerprint_visitor("1.2.3.4", "ua-B")


def test_fingerprint_returns_none_when_either_missing():
    assert fingerprint_visitor("", "ua-A") is None
    assert fingerprint_visitor("1.2.3.4", "") is None
    assert fingerprint_visitor(None, None) is None


def test_lead_dedupe_key_prefers_visitor_id():
    key = lead_dedupe_key(_ev())
    assert key == ("d1", "car", "L1", "call", "visitor:v1")


def test_lead_dedupe_key_falls_back_to_fingerprint_when_no_visitor_id():
    ev = _ev(payload={})
    key = lead_dedupe_key(ev)
    assert key[0:4] == ("d1", "car", "L1", "call")
    assert key[4].startswith("fp:")


def test_lead_dedupe_key_returns_none_when_no_identity_available():
    ev = _ev(payload={}, ip_address=None, user_agent=None)
    assert lead_dedupe_key(ev) is None


def test_within_dedupe_window_visitor_24h():
    t0 = datetime(2026, 6, 5, 10, 0, tzinfo=timezone.utc)
    assert within_dedupe_window(t0, t0 + timedelta(hours=23), "visitor:v1") is True
    assert within_dedupe_window(t0, t0 + timedelta(hours=25), "visitor:v1") is False


def test_within_dedupe_window_fingerprint_30min():
    t0 = datetime(2026, 6, 5, 10, 0, tzinfo=timezone.utc)
    assert within_dedupe_window(t0, t0 + timedelta(minutes=29), "fp:abc") is True
    assert within_dedupe_window(t0, t0 + timedelta(minutes=31), "fp:abc") is False


def test_payload_maps_call_click_to_call_source():
    ev = _ev(action="call_click")
    p = lead_payload_from_event(ev)
    assert p["source"] == "call"
    assert p["dealership_id"] == "d1"
    assert p["listing_id"] == "L1"
    assert p["listing_type"] == "car"
    assert p["visitor_id"] == "v1"
    assert p["first_event_at"] == "2026-06-05T10:00:00+00:00"
    assert p["last_event_at"] == "2026-06-05T10:00:00+00:00"


def test_payload_maps_whatsapp_and_vin_actions():
    assert lead_payload_from_event(_ev(action="whatsapp_click"))["source"] == "whatsapp"
    assert lead_payload_from_event(_ev(action="vin_open"))["source"] == "vin_open"
    assert lead_payload_from_event(_ev(action="vin_reveal"))["source"] == "vin_open"


def test_payload_returns_none_for_unknown_action():
    assert lead_payload_from_event(_ev(action="unknown")) is None


def test_payload_returns_none_when_dealership_missing():
    assert lead_payload_from_event(_ev(dealership_id=None)) is None
