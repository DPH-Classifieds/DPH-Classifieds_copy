"""Pure-logic tests for the featured-listings helpers."""
from datetime import datetime, timedelta, timezone

from services.featured_listings import (
    is_listing_active_featured,
    validate_featured_input,
    normalize_featured_until_input,
    ALLOWED_LISTING_TYPES,
    MAX_FEATURED_DURATION_DAYS,
)

NOW = datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc)


# --- is_listing_active_featured ----------------------------------------------

def test_active_when_no_until():
    assert is_listing_active_featured({"featured_until": None}, now=NOW) is True


def test_active_when_until_in_future():
    row = {"featured_until": (NOW + timedelta(days=1)).isoformat()}
    assert is_listing_active_featured(row, now=NOW) is True


def test_inactive_when_until_in_past():
    row = {"featured_until": (NOW - timedelta(days=1)).isoformat()}
    assert is_listing_active_featured(row, now=NOW) is False


def test_inactive_for_empty_or_none_row():
    assert is_listing_active_featured(None, now=NOW) is False
    assert is_listing_active_featured({}, now=NOW) is False


def test_inactive_for_unparseable_until():
    assert is_listing_active_featured({"featured_until": "not-a-date"}, now=NOW) is False


def test_handles_naive_datetime_in_string():
    # Supabase returns ISO with timezone; verify both Z and +00:00 are accepted
    row = {"featured_until": "2026-08-19T12:00:00Z"}
    assert is_listing_active_featured(row, now=NOW) is True
    row2 = {"featured_until": "2026-08-19T12:00:00+00:00"}
    assert is_listing_active_featured(row2, now=NOW) is True


# --- validate_featured_input -------------------------------------------------

def test_validate_ok_no_until():
    out, err = validate_featured_input("car", "abc-123-uuid")
    assert err is None
    assert out == {"listing_type": "car", "listing_id": "abc-123-uuid", "featured_until": None}


def test_validate_ok_with_future_until():
    future = (NOW + timedelta(days=7)).isoformat()
    out, err = validate_featured_input("bike", "abc-123", featured_until=future)
    assert err is None
    assert out["listing_type"] == "bike"
    assert out["featured_until"] == future


def test_validate_rejects_bad_listing_type():
    out, err = validate_featured_input("rocket", "abc-123")
    assert err is not None and err["code"] == "invalid_listing_type"
    assert out is None


def test_validate_rejects_missing_listing_id():
    out, err = validate_featured_input("car", None)
    assert err is not None and err["code"] == "invalid_listing_id"
    out, err = validate_featured_input("car", "")
    assert err is not None and err["code"] == "invalid_listing_id"


def test_validate_rejects_too_short_listing_id():
    out, err = validate_featured_input("car", "abc")
    assert err is not None and err["code"] == "invalid_listing_id"


def test_validate_rejects_past_until():
    past = (NOW - timedelta(days=1)).isoformat()
    out, err = validate_featured_input("car", "abc-123", featured_until=past)
    assert err is not None and err["code"] == "featured_until_in_past"


def test_validate_rejects_until_too_far_in_future():
    far = (NOW + timedelta(days=MAX_FEATURED_DURATION_DAYS + 1)).isoformat()
    out, err = validate_featured_input("car", "abc-123", featured_until=far)
    assert err is not None and err["code"] == "featured_until_too_far"


def test_validate_accepts_until_within_max():
    within = (NOW + timedelta(days=MAX_FEATURED_DURATION_DAYS - 1)).isoformat()
    out, err = validate_featured_input("car", "abc-123", featured_until=within)
    assert err is None
    assert out["featured_until"] == within


def test_validate_rejects_unparseable_until():
    out, err = validate_featured_input("car", "abc-123", featured_until="not-a-date")
    assert err is not None and err["code"] == "invalid_featured_until"


def test_validate_accepts_datetime_object():
    out, err = validate_featured_input("car", "abc-123", featured_until=NOW + timedelta(days=1))
    assert err is None
    assert out["featured_until"] is not None


def test_validate_strips_listing_id():
    out, err = validate_featured_input("car", "  abc-123  ")
    assert err is None
    assert out["listing_id"] == "abc-123"


# --- normalize_featured_until_input ------------------------------------------

def test_normalize_none():
    assert normalize_featured_until_input(None) is None
    assert normalize_featured_until_input("") is None


def test_normalize_string_passthrough():
    assert normalize_featured_until_input("2026-08-19T00:00:00Z") == "2026-08-19T00:00:00Z"


def test_normalize_naive_datetime_to_utc_iso():
    naive = datetime(2026, 8, 19, 12, 0)
    out = normalize_featured_until_input(naive)
    assert out is not None
    assert out.startswith("2026-08-19T12:00:00")


def test_all_listing_types_accepted():
    for t in ALLOWED_LISTING_TYPES:
        out, err = validate_featured_input(t, "abc-123")
        assert err is None
        assert out["listing_type"] == t
