"""Tests for the dealer auto-approval worker's pure decision + the worker loop.

The pure decision (`_fire_pending_approval`) is testable without Supabase.
The DB-touching pieces are exercised via the same module, with their HTTP
calls monkey-patched out.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest

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


class _FrozenDateTime(datetime):
    current = datetime(2026, 9, 6, 10, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return cls.current.replace(tzinfo=None)
        return cls.current.astimezone(tz)


class _PendingApprovalStore:
    """Minimal conditional-update model for the queue row under test."""

    def __init__(self, row_id="p1"):
        self.row = {"id": row_id, "state": "pending", "fired_at": None}
        self.calls = []

    def request(self, method, path, data=None, params=None):
        params = params or {}
        data = data or {}
        self.calls.append((method, path, data, params))
        if method != "patch" or "dealer_pending_approvals" not in path:
            raise AssertionError(f"unexpected request: {method} {path}")

        if "or" in params:
            cutoff_text = params["or"].split("fired_at.lt.", 1)[1][:-1]
            marker = self.row["fired_at"]
            claimable = (
                self.row["state"] == "pending"
                and (marker is None or datetime.fromisoformat(marker) < datetime.fromisoformat(cutoff_text))
            )
            if not claimable:
                return [], 200
            self.row.update(data)
            return [dict(self.row)], 200

        # Compatibility branch makes the test fail meaningfully against the
        # reviewed implementation, which claimed pending directly to fired.
        if "state=eq.pending" in path:
            if self.row["state"] != "pending":
                return [], 200
            self.row.update(data)
            return [dict(self.row)], 200

        expected_marker = params.get("fired_at", "").removeprefix("eq.")
        if (
            self.row["state"] != "pending"
            or self.row["fired_at"] != expected_marker
        ):
            return [], 200
        self.row.update(data)
        return [dict(self.row)], 200


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
        return True

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


def test_claim_lease_keeps_one_pending_guard_and_blocks_second_replica():
    store = _PendingApprovalStore()
    _FrozenDateTime.current = datetime(2026, 9, 6, 10, 0, tzinfo=timezone.utc)
    with patch.object(w, "SUPABASE_URL", "https://supabase.test"), \
         patch.object(w, "SUPABASE_SERVICE_KEY", "test-service-key"), \
         patch.object(w, "datetime", _FrozenDateTime), \
         patch.object(w, "supabase_request", side_effect=store.request):
        first_claim = w._claim("p1")
        duplicate_claim = w._claim("p1")

    assert isinstance(first_claim, str)
    assert duplicate_claim is None
    assert store.row == {"id": "p1", "state": "pending", "fired_at": first_claim}
    first_request = store.calls[0]
    assert first_request[1] == "/rest/v1/dealer_pending_approvals"
    assert first_request[2] == {"fired_at": first_claim}
    assert first_request[3]["state"] == "eq.pending"
    assert first_request[3]["or"].startswith("(fired_at.is.null,fired_at.lt.")


def test_crash_after_claim_recovers_after_lease_expiry_and_completes_once():
    store = _PendingApprovalStore()
    docs = [
        {"id": "doc-trade", "document_type": "trade_license", "ocr_confidence": 0.95,
         "replaced_at": None},
        {"id": "doc-trn", "document_type": "tax_registration", "ocr_confidence": 0.92,
         "replaced_at": None},
    ]
    _FrozenDateTime.current = datetime(2026, 9, 6, 10, 0, tzinfo=timezone.utc)
    with patch.object(w, "SUPABASE_URL", "https://supabase.test"), \
         patch.object(w, "SUPABASE_SERVICE_KEY", "test-service-key"), \
         patch.object(w, "datetime", _FrozenDateTime), \
         patch.object(w, "supabase_request", side_effect=store.request), \
         patch.object(w, "_fetch_active_docs", side_effect=[RuntimeError("crash"), docs]), \
         patch.object(w, "_fetch_user", return_value={"dealer_verified": False}), \
         patch.object(w, "_approve_documents") as approve_documents, \
         patch.object(w, "_approve_user") as approve_user, \
         patch.object(w, "_send_approval_email") as send_email, \
         patch.object(w, "_utc_now_iso", return_value="2026-09-06T10:01:01+00:00"):
        with pytest.raises(RuntimeError, match="crash"):
            w._process_one(_row())

        first_lease = store.row["fired_at"]
        assert store.row["state"] == "pending"
        assert w._claim("p1") is None

        _FrozenDateTime.current += timedelta(seconds=w.CLAIM_LEASE_SECONDS + 1)
        decision = w._process_one(_row())
        terminal_duplicate = w._claim("p1")

    assert decision == {"decision": "approve"}
    assert store.row == {
        "id": "p1",
        "state": "fired",
        "fired_at": "2026-09-06T10:01:01+00:00",
    }
    assert first_lease != store.row["fired_at"]
    assert terminal_duplicate is None
    approve_documents.assert_called_once_with(docs)
    approve_user.assert_called_once_with("u1")
    send_email.assert_called_once_with("u1")


def test_claim_rejects_empty_204_conditional_response():
    with patch.object(w, "SUPABASE_URL", "https://supabase.test"), \
        patch.object(w, "SUPABASE_SERVICE_KEY", "test-service-key"), \
         patch.object(w, "supabase_request", return_value=({}, 204)):
        assert w._claim("p2") is None


def test_finalize_requires_the_matching_pending_claim_lease():
    claim_lease = "2026-09-06T10:01:00+00:00"
    with patch.object(
        w, "supabase_request", return_value=([], 200)
    ) as request:
        finalized = w._mark(
            "p4",
            claim_lease=claim_lease,
            state="fired",
            fired_at="2026-09-06T10:01:01+00:00",
        )

    assert finalized is False
    assert request.call_args.args == (
        "patch", "/rest/v1/dealer_pending_approvals?id=eq.p4"
    )
    assert request.call_args.kwargs["params"] == {
        "state": "eq.pending",
        "fired_at": f"eq.{claim_lease}",
    }
