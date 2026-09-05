"""Tests for the dealer auto-approval worker's pure decision + the worker loop.

The pure decision (`_fire_pending_approval`) is testable without Supabase.
The DB-touching pieces are exercised via the same module, with their HTTP
calls monkey-patched out.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from workers import dealer_auto_approval_worker as w


# --- _fire_pending_approval (pure decision) ----------------------------------

def _row(**overrides):
    base = {
        "id": "p1", "user_id": "u1",
        "trade_license_confidence": 0.95,
        "tax_registration_confidence": 0.92,
        "threshold": 0.90,
        "scheduled_for": "2026-08-18T10:00:00Z",
    }
    base.update(overrides)
    return base


def test_fire_approves_when_still_high_confidence():
    docs = [
        {"document_type": "trade_license", "ocr_confidence": 0.95, "replaced_at": None},
        {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None},
    ]
    out = w._fire_pending_approval(_row(), current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "approve"


def test_fire_cancels_if_doc_replaced():
    replaced = {"document_type": "trade_license", "ocr_confidence": 0.95,
                "replaced_at": "2026-08-18T10:00:00Z"}
    docs = [replaced,
            {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None}]
    out = w._fire_pending_approval(_row(), current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "cancel"
    assert out["reason"] == "missing:trade_license"


def test_fire_cancels_if_confidence_dropped():
    docs = [
        {"document_type": "trade_license", "ocr_confidence": 0.50, "replaced_at": None},
        {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None},
    ]
    out = w._fire_pending_approval(_row(), current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "cancel"
    assert out["reason"] == "confidence_dropped"


def test_fire_skips_if_user_already_verified():
    out = w._fire_pending_approval(
        _row(),
        current_docs=[],
        user_row={"dealer_verified": True},
        delay_seconds=0, threshold=0.90,
    )
    assert out["decision"] == "skip"
    assert out["reason"] == "already_verified"


def test_fire_waits_if_not_due():
    future = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    out = w._fire_pending_approval(
        _row(scheduled_for=future), current_docs=[], delay_seconds=600, threshold=0.90,
    )
    assert out["decision"] == "wait"


# --- _process_one (DB integration via monkey-patch) --------------------------

def test_process_one_calls_approve_then_marks_fired():
    captured = {}

    def fake_approve(uid):
        captured["approve_user_id"] = uid

    def fake_mark(rid, **fields):
        captured.setdefault("marks", []).append((rid, fields))

    def fake_email(uid):
        captured["emailed"] = uid

    docs = [
        {"document_type": "trade_license", "ocr_confidence": 0.95, "replaced_at": None},
        {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None},
    ]
    with patch.object(w, "_claim", return_value=True), \
         patch.object(w, "_approve_user", side_effect=fake_approve), \
         patch.object(w, "_mark", side_effect=fake_mark), \
         patch.object(w, "_send_approval_email", side_effect=fake_email), \
         patch.object(w, "_fetch_active_docs", return_value=docs), \
         patch.object(w, "_fetch_user", return_value={"dealer_verified": False}):
        decision = w._process_one(_row())

    assert decision["decision"] == "approve"
    assert captured["approve_user_id"] == "u1"
    assert captured["emailed"] == "u1"
    # The first mark is the 'fired' update; the email is sent between them.
    assert any(fields.get("state") == "fired" for _, fields in captured["marks"])


def test_process_one_marks_ocr_verified_documents_approved():
    captured = {}

    docs = [
        {"id": "doc-trade", "document_type": "trade_license", "ocr_confidence": 0.95, "replaced_at": None},
        {"id": "doc-trn", "document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None},
    ]

    with patch.object(w, "_claim", return_value=True), \
         patch.object(w, "_approve_user"), \
         patch.object(w, "_mark"), \
         patch.object(w, "_send_approval_email"), \
         patch.object(w, "_fetch_active_docs", return_value=docs), \
         patch.object(w, "_fetch_user", return_value={"dealer_verified": False}), \
         patch.object(w, "_approve_documents", create=True, side_effect=lambda rows: captured.setdefault("docs", rows)):
        decision = w._process_one(_row())

    assert decision["decision"] == "approve"
    assert [doc["id"] for doc in captured["docs"]] == ["doc-trade", "doc-trn"]


def test_process_one_cancels_when_doc_replaced_between_upload_and_fire():
    replaced = {"document_type": "trade_license", "ocr_confidence": 0.95,
                "replaced_at": "2026-08-18T10:00:00Z"}
    docs = [replaced,
            {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None}]
    captured = {}

    def fake_approve(uid):
        captured["approve"] = uid  # must NOT be called

    with patch.object(w, "_claim", return_value=True), \
         patch.object(w, "_approve_user", side_effect=fake_approve), \
         patch.object(w, "_mark", side_effect=lambda rid, **f: captured.setdefault("marks", []).append((rid, f))), \
         patch.object(w, "_send_approval_email", side_effect=lambda uid: captured.setdefault("emails", []).append(uid)), \
         patch.object(w, "_fetch_active_docs", return_value=docs), \
         patch.object(w, "_fetch_user", return_value={"dealer_verified": False}):
        decision = w._process_one(_row())

    assert decision["decision"] == "cancel"
    assert "approve" not in captured
    assert "emails" not in captured
    assert any(fields.get("state") == "cancelled" for _, fields in captured["marks"])


def test_claim_uses_allowed_fired_state_and_duplicate_response_is_noop():
    responses = [([{"id": "p1", "state": "fired"}], 200), ([], 200)]
    with patch.object(w, "SUPABASE_URL", "https://supabase.test"), \
         patch.object(w, "SUPABASE_SERVICE_KEY", "test-service-key"), \
         patch.object(w, "supabase_request", side_effect=responses) as request:
        first_claim = w._claim("p1")
        duplicate_claim = w._claim("p1")

    assert first_claim is True
    assert duplicate_claim is False
    for call in request.call_args_list:
        assert call.args == (
            "patch",
            "/rest/v1/dealer_pending_approvals?id=eq.p1&state=eq.pending",
        )
        assert call.kwargs["data"] == {"state": "fired"}


def test_claim_rejects_empty_204_conditional_response():
    with patch.object(w, "SUPABASE_URL", "https://supabase.test"), \
         patch.object(w, "SUPABASE_SERVICE_KEY", "test-service-key"), \
         patch.object(w, "supabase_request", return_value=({}, 204)):
        assert w._claim("p2") is False
