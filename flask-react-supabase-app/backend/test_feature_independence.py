"""Cross-feature independence tests.

Each new feature should be PLUG-AND-PLAY: if a feature's table is missing
or the email service is down, the other features must keep working. These
tests verify that defensive guards exist on every cross-cutting boundary.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent
APP_PY = REPO / "app.py"


def _read_app():
    return (
        APP_PY.read_text(encoding="utf-8")
        + "\n"
        + (REPO / "routes" / "dealer_verification.py").read_text(encoding="utf-8")
        + "\n"
        + (REPO / "routes" / "admin_users.py").read_text(encoding="utf-8")
        + "\n"
        + (REPO / "routes" / "admin_upgrade_decisions.py").read_text(encoding="utf-8")
    )


def test_admin_upgrade_requests_does_not_query_featured_table():
    """The admin upgrade-requests handler must not touch featured_listings."""
    src = _read_app()
    # Find the admin_list_listing_upgrade_requests function
    m = re.search(
        r"def admin_list_listing_upgrade_requests\(.*?\n(?=\n@|\ndef )", src, re.S
    )
    assert m, "admin_list_listing_upgrade_requests not found"
    body = m.group(0)
    assert "featured_listings" not in body, (
        "admin_list_listing_upgrade_requests must not query featured_listings"
    )


def test_admin_featured_does_not_query_upgrade_table():
    src = _read_app()
    m = re.search(r"def admin_list_featured_listings\(.*?\n(?=\n@|\ndef )", src, re.S)
    assert m, "admin_list_featured_listings not found"
    body = m.group(0)
    assert "dealer_listing_upgrade_requests" not in body, (
        "admin_list_featured_listings must not query dealer_listing_upgrade_requests"
    )


def test_dealer_listing_limit_does_not_query_optional_tables():
    """The dealer limit endpoint must work even if the optional tables are missing."""
    src = _read_app()
    m = re.search(r"def dealer_listing_limit\(.*?\n(?=\n@|\ndef )", src, re.S)
    assert m, "dealer_listing_limit not found"
    body = m.group(0)
    assert "featured_listings" not in body
    assert "dealer_listing_upgrade_requests" not in body


def test_signup_email_is_not_called_from_submission():
    """Dealer signup submission must NOT call the admin signup email helper.

    PaddleOCR + the minute-tick dealer_auto_approval_worker is now the only
    approval path. The helper is kept as a definition for the admin override
    flow but must never be invoked from dealer_submit_application.
    Spec: docs/superpowers/specs/2026-08-25-dealer-ocr-auto-approval-copy-and-admin-override.md
    """
    import re

    src = _read_app()

    m = re.search(r"def dealer_submit_application\(.*?\n(?=\n@|\ndef )", src, re.S)
    assert m, "dealer_submit_application not found"
    body = m.group(0)
    assert "_send_dealer_signup_admin_notification" not in body, (
        "dealer_submit_application must NOT invoke _send_dealer_signup_admin_notification"
    )


def test_approved_email_block_is_wrapped_in_try_except():
    """The dealer_approved_admin_notification call must not crash the approval flow."""
    src = _read_app()
    # The call site has the helper name preceded by whitespace + a tab.
    # The function definition has it preceded by "def ". Match a non-"def" prefix.
    import re as _re

    matches = [
        m.start()
        for m in _re.finditer(
            r"(?<!def )_send_dealer_approved_admin_notification\(",
            src,
        )
    ]
    assert len(matches) >= 1, "approved email call site not found"
    call_idx = matches[0]
    # The call site must be inside a try block
    window = src[max(0, call_idx - 500) : call_idx]
    assert "try:" in window, (
        f"approved email call must be inside a try block; "
        f"context before: {window[-200:]!r}"
    )
    forward = src[call_idx : call_idx + 800]
    assert "except" in forward, "no except handler after approved email call"


def test_500_hints_for_missing_tables():
    """When a table is missing, the API must return a useful 500 (not a stack trace)."""
    src = _read_app()
    assert (
        "is missing. Run migrations/2026_08_18_dealer_listing_upgrade_requests.sql"
        in src
    )
    assert "is missing. Run migrations/2026_08_19_featured_listings.sql" in src


def test_auto_approval_uses_lazy_imports():
    """The auto-approval scheduler must lazy-import to avoid breaking module load."""
    src = _read_app()
    m = re.search(
        r"def _schedule_dealer_auto_approval_if_eligible\(.*?\n(?=\n\ndef )", src, re.S
    )
    assert m, "_schedule_dealer_auto_approval_if_eligible not found"
    body = m.group(0)
    # The import should be inside the function, not at the top of the module
    assert "from services.registration_ocr import should_auto_approve_dealer" in body


def test_email_helpers_all_have_resend_disabled_branch():
    """Each email helper must return gracefully when RESEND_FROM_EMAIL is unset."""
    from app import (
        _send_dealer_signup_admin_notification,
        _send_dealer_approved_admin_notification,
        _send_dealer_listing_upgrade_admin_notification,
    )

    for fn in (
        _send_dealer_signup_admin_notification,
        _send_dealer_approved_admin_notification,
        _send_dealer_listing_upgrade_admin_notification,
    ):
        import inspect

        src = inspect.getsource(fn)
        assert "RESEND_FROM_EMAIL" in src, (
            f"{fn.__name__} doesn't check RESEND_FROM_EMAIL"
        )
        assert "Missing RESEND_FROM_EMAIL" in src, (
            f"{fn.__name__} doesn't return None on missing key"
        )
