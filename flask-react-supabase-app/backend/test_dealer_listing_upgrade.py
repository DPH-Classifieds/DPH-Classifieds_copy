"""Pure-logic tests for the dealer listing-upgrade-request flow."""
from app import (
    validate_upgrade_request,
    _DEALER_UPGRADE_REQUEST_REASON_MIN,
    _DEALER_UPGRADE_REQUEST_REASON_MAX,
    _DEALER_UPGRADE_REQUEST_MAX_LIMIT,
)


# --- validate_upgrade_request ------------------------------------------------

def test_validate_ok():
    err = validate_upgrade_request(4, 10, "We have 4 active cars and want to expand the showroom.")
    assert err is None


def test_validate_rejects_too_low():
    err = validate_upgrade_request(4, 1, "Why would we ask for fewer slots?")
    assert err is not None and err["code"] == "invalid_requested_limit"


def test_validate_rejects_zero():
    assert validate_upgrade_request(4, 0, "0123456789") is not None
    assert validate_upgrade_request(4, -3, "0123456789") is not None


def test_validate_rejects_over_max():
    assert validate_upgrade_request(4, _DEALER_UPGRADE_REQUEST_MAX_LIMIT + 1, "0123456789") is not None
    assert validate_upgrade_request(4, 9999, "0123456789") is not None


def test_validate_rejects_short_reason():
    err = validate_upgrade_request(4, 8, "short")
    assert err is not None and err["code"] == "reason_too_short"


def test_validate_rejects_long_reason():
    err = validate_upgrade_request(4, 8, "x" * (_DEALER_UPGRADE_REQUEST_REASON_MAX + 1))
    assert err is not None and err["code"] == "reason_too_long"


def test_validate_rejects_requested_equal_or_below_current():
    err = validate_upgrade_request(4, 4, "asking for the same number as we have")
    assert err is not None and err["code"] == "invalid_requested_limit"


def test_validate_accepts_boundary_lengths():
    ok = "x" * _DEALER_UPGRADE_REQUEST_REASON_MIN
    err_min = validate_upgrade_request(4, 8, ok)
    assert err_min is None
    err_max = validate_upgrade_request(4, 8, "x" * _DEALER_UPGRADE_REQUEST_REASON_MAX)
    assert err_max is None


def test_validate_accepts_non_string_limit_raises_value_error_caught():
    # If a caller passes a non-int, we still return a structured error.
    err = validate_upgrade_request(4, "twenty", "0123456789")
    assert err is not None and err["code"] == "invalid_requested_limit"


# --- decide_upgrade_request --------------------------------------------------

from app import decide_upgrade_request


def test_decide_approve_resolves_and_writes_history():
    nl, hist, err = decide_upgrade_request(
        current_limit=4, requested_limit=10, decision="approve",
        new_limit=10, admin_id="admin-1")
    assert err is None
    assert nl == 10
    assert hist["source"] == "upgrade_request"
    assert hist["new_limit"] == 10
    assert hist["old_limit"] == 4
    assert hist["changed_by"] == "admin-1"


def test_decide_approve_requires_explicit_new_limit():
    nl, hist, err = decide_upgrade_request(4, 10, "approve", new_limit=None, admin_id="admin-1")
    assert err is not None and err["code"] == "new_limit_required"
    assert nl is None and hist is None


def test_decide_approve_rejects_invalid_new_limit():
    for bad in (0, -1, _DEALER_UPGRADE_REQUEST_MAX_LIMIT + 1, 9999):
        _, _, err = decide_upgrade_request(4, 10, "approve", new_limit=bad, admin_id="admin-1")
        assert err is not None and err["code"] == "invalid_new_limit"


def test_decide_reject_returns_none_for_both():
    nl, hist, err = decide_upgrade_request(4, 10, "reject", new_limit=None, admin_id="admin-1")
    assert err is None
    assert nl is None and hist is None


def test_decide_unknown_decision():
    _, _, err = decide_upgrade_request(4, 10, "weird", new_limit=None, admin_id="admin-1")
    assert err is not None and err["code"] == "invalid_decision"


def test_decide_rejects_non_numeric_new_limit():
    _, _, err = decide_upgrade_request(4, 10, "approve", new_limit="twenty", admin_id="admin-1")
    assert err is not None and err["code"] == "invalid_new_limit"
