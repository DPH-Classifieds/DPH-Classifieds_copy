from datetime import datetime, timezone

from services.contact_analytics import build_contact_analytics


NOW = datetime(2026, 7, 23, tzinfo=timezone.utc)


def ev(name, actor, listing_id="car-1", when="2026-07-22T10:00:00+00:00", listing_type="car"):
    return {
        "event_name": name,
        "visitor_id": actor,
        "listing_type": listing_type,
        "listing_id": listing_id,
        "created_at": when,
    }


def test_vin_reveals_are_reported_but_never_count_as_leads():
    result = build_contact_analytics([
        ev("vin_reveal", "buyer-1"),
        ev("call_click", "buyer-2"),
    ], [], 30, NOW)

    assert result["summary"]["unique_leads"] == 1
    assert result["summary"]["raw_vin_reveals"] == 1
    assert result["summary"]["unique_vin_revealers"] == 1


def test_call_and_whatsapp_on_one_listing_are_one_lead_with_two_channels():
    result = build_contact_analytics([
        ev("call_click", "buyer-1"),
        ev("whatsapp_click", "buyer-1", when="2026-07-22T11:00:00+00:00"),
    ], [], 30, NOW)

    assert result["summary"]["unique_leads"] == 1
    assert result["summary"]["unique_callers"] == 1
    assert result["summary"]["unique_whatsapp_contacts"] == 1
    assert result["lead_listings"][0]["channels"] == ["call", "whatsapp"]


def test_contact_after_24_hours_starts_a_new_lead_window():
    result = build_contact_analytics([
        ev("call_click", "buyer-1", when="2026-07-20T10:00:00+00:00"),
        ev("whatsapp_click", "buyer-1", when="2026-07-21T10:00:01+00:00"),
    ], [], 30, NOW)

    assert result["summary"]["unique_leads"] == 2


def test_post_cutover_legacy_rows_do_not_duplicate_canonical_events():
    canonical = ev("call_click", "buyer-1", when="2026-07-22T10:00:00+00:00")
    legacy = {
        "action": "call_click", "session_id": "session-1", "payload": {"visitor_id": "buyer-1"},
        "listing_type": "car", "listing_id": "car-1", "created_at": "2026-07-22T10:00:00+00:00",
    }
    result = build_contact_analytics([canonical], [legacy], 30, NOW)

    assert result["summary"]["raw_call_taps"] == 1
