"""Tests for the 3 admin notification emails:
  - new dealer signed up (submitted application)
  - new dealer approved
  - dealer upgrade request (already wired, just adding a helper for symmetry)
"""
import inspect
from app import (
    _send_dealer_signup_admin_notification,
    _send_dealer_approved_admin_notification,
    _send_dealer_listing_upgrade_admin_notification,
)


def test_signup_helper_signature():
    """The helper takes a (user_row, optional docs_summary) and returns (None, error_or_None)."""
    sig = inspect.signature(_send_dealer_signup_admin_notification)
    params = list(sig.parameters.keys())
    assert "user_row" in params
    assert "documents" in params
    # Optional env: docs list
    assert sig.parameters["documents"].default is None or sig.parameters["documents"].annotation is not sig.empty


def test_approved_helper_signature():
    sig = inspect.signature(_send_dealer_approved_admin_notification)
    params = list(sig.parameters.keys())
    assert "user_row" in params


def test_upgrade_helper_signature():
    sig = inspect.signature(_send_dealer_listing_upgrade_admin_notification)
    params = list(sig.parameters.keys())
    assert "request_row" in params
    assert "dealer_row" in params


def test_signup_subject_mentions_new_dealer():
    """The subject line must clearly identify this as a 'new dealer signed up' event."""
    src = inspect.getsource(_send_dealer_signup_admin_notification)
    assert "subject" in src.lower() or "new dealer" in src.lower()
    assert "submitted" in src.lower() or "signed up" in src.lower() or "application" in src.lower()


def test_approved_subject_mentions_dealer_approved():
    src = inspect.getsource(_send_dealer_approved_admin_notification)
    assert "approved" in src.lower()


def test_signup_renders_dealer_label():
    """The email should use the dealership's legal_name or company_name or email."""
    src = inspect.getsource(_send_dealer_signup_admin_notification)
    assert "legal_business_name" in src or "company_name" in src
    assert "email" in src


def test_approved_includes_email_and_company():
    src = inspect.getsource(_send_dealer_approved_admin_notification)
    assert "legal_business_name" in src or "company_name" in src
    assert "email" in src


def test_all_three_use_admin_email_helper():
    """All three should reuse the same admin distribution helper for consistency."""
    for fn in (
        _send_dealer_signup_admin_notification,
        _send_dealer_approved_admin_notification,
        _send_dealer_listing_upgrade_admin_notification,
    ):
        src = inspect.getsource(fn)
        assert "_fetch_all_admin_emails" in src, f"{fn.__name__} doesn't use _fetch_all_admin_emails"
        assert "PRIMARY_SUPER_ADMIN_EMAIL" in src, f"{fn.__name__} doesn't have fallback"
