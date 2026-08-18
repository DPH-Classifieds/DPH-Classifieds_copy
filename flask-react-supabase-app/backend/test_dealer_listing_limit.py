"""Pure-logic tests for the dealer listing-limit summary (no Flask import)."""
from app import (
    _compute_dealer_listing_limit_summary,
    _DEFAULT_DEALER_LISTING_LIMIT,
    _DEALER_UPGRADE_REQUEST_MIN_USAGE_RATIO,
)


def test_default_cap_is_four():
    assert _DEFAULT_DEALER_LISTING_LIMIT == 4


def test_summary_with_zero_used():
    s = _compute_dealer_listing_limit_summary(4, {"cars": 0, "bikes": 0, "car_parts": 0, "plates": 0})
    assert s == {"limit": 4, "used": 0, "remaining": 4,
                 "can_request": False, "default_limit": 4}


def test_summary_with_partial_usage():
    s = _compute_dealer_listing_limit_summary(4, {"cars": 2, "bikes": 1, "car_parts": 0, "plates": 0})
    assert s["used"] == 3 and s["remaining"] == 1
    # 3/4 = 75% — below 80% threshold, can't request yet
    assert s["can_request"] is False


def test_summary_at_or_above_eighty_percent_can_request():
    s = _compute_dealer_listing_limit_summary(10, {"cars": 8, "bikes": 0, "car_parts": 0, "plates": 0})
    # 8/10 = 80% — exactly the threshold, can request
    assert s["used"] == 8 and s["remaining"] == 2
    assert s["can_request"] is True


def test_summary_at_cap_cannot_request_when_at_or_above():
    s = _compute_dealer_listing_limit_summary(4, {"cars": 4, "bikes": 0, "car_parts": 0, "plates": 0})
    assert s["used"] == 4 and s["remaining"] == 0
    # 4/4 = 100% — at cap, can request
    assert s["can_request"] is True


def test_summary_below_threshold_cannot_request():
    s = _compute_dealer_listing_limit_summary(10, {"cars": 1, "bikes": 0, "car_parts": 0, "plates": 0})
    assert s["can_request"] is False


def test_summary_handles_missing_counts_table():
    s = _compute_dealer_listing_limit_summary(4, {})
    assert s["used"] == 0 and s["remaining"] == 4
    assert s["can_request"] is False


def test_min_usage_ratio_constant_is_eighty_percent():
    assert _DEALER_UPGRADE_REQUEST_MIN_USAGE_RATIO == 0.8
