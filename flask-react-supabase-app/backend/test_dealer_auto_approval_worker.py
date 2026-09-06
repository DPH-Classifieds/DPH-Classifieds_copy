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


class _ApprovalRecoveryStore(_PendingApprovalStore):
    """Queue + approval state for a failed-finalize recovery attempt."""

    def __init__(self):
        super().__init__()
        self.user = {"id": "u1", "dealer_verified": False}
        self.documents = {
            "doc-trade": {
                "id": "doc-trade", "document_type": "trade_license",
                "ocr_confidence": 0.95, "replaced_at": None, "status": "pending",
            },
            "doc-trn": {
                "id": "doc-trn", "document_type": "tax_registration",
                "ocr_confidence": 0.92, "replaced_at": None, "status": "pending",
            },
        }
        self.failed_finalize_once = False
        self.successful_user_approvals = 0
        self.successful_document_approvals = {doc_id: 0 for doc_id in self.documents}
        self.terminal_states = []

    def active_documents(self, user_id):
        assert user_id == self.user["id"]
        return [dict(doc) for doc in self.documents.values()]

    def current_user(self, user_id):
        assert user_id == self.user["id"]
        return dict(self.user)

    def request(self, method, path, data=None, params=None):
        params = params or {}
        data = data or {}

        if "dealer_pending_approvals" in path:
            if data.get("state") == "fired" and not self.failed_finalize_once:
                self.failed_finalize_once = True
                return [], 200
            body, status = super().request(method, path, data=data, params=params)
            if body and data.get("state") in {"fired", "cancelled"}:
                self.terminal_states.append(data["state"])
            return body, status

        if "dealer_documents" in path:
            doc_id = path.split("id=eq.", 1)[1]
            doc = self.documents[doc_id]
            if params.get("status") == "neq.approved" and doc["status"] == "approved":
                return [], 200
            doc.update(data)
            self.successful_document_approvals[doc_id] += 1
            return [dict(doc)], 200

        if "/rest/v1/users" in path:
            if (
                params.get("dealer_verified") == "not.is.true"
                and self.user["dealer_verified"] is True
            ):
                return [], 200
            self.user.update(data)
            self.successful_user_approvals += 1
            return [dict(self.user)], 200

        raise AssertionError(f"unexpected request: {method} {path}")


class _ApprovalWriteFailureStore(_PendingApprovalStore):
    """Queue + approval rows with one selected transient write failure."""

    def __init__(self, failure):
        super().__init__()
        self.failure = failure
        self.failure_seen = False
        self.user = {"id": "u1", "dealer_verified": False}
        self.documents = {
            "doc-trade": {
                "id": "doc-trade", "document_type": "trade_license",
                "ocr_confidence": 0.95, "replaced_at": None, "status": "pending",
            },
            "doc-trn": {
                "id": "doc-trn", "document_type": "tax_registration",
                "ocr_confidence": 0.92, "replaced_at": None, "status": "pending",
            },
        }
        self.successful_user_approvals = 0
        self.successful_document_approvals = {doc_id: 0 for doc_id in self.documents}
        self.terminal_states = []

    def active_documents(self, user_id):
        assert user_id == self.user["id"]
        return [dict(doc) for doc in self.documents.values()]

    def current_user(self, user_id):
        assert user_id == self.user["id"]
        return dict(self.user)

    def request(self, method, path, data=None, params=None):
        params = params or {}
        data = data or {}

        if "dealer_pending_approvals" in path:
            body, status = super().request(method, path, data=data, params=params)
            if body and data.get("state") in {"fired", "cancelled"}:
                self.terminal_states.append(data["state"])
            return body, status

        if "dealer_documents" in path:
            doc_id = path.split("id=eq.", 1)[1]
            doc = self.documents[doc_id]
            if self.failure == "document" and doc_id == "doc-trn" and not self.failure_seen:
                self.failure_seen = True
                return {"error": "temporary document update failure"}, 500
            if params.get("status") == "neq.approved" and doc["status"] == "approved":
                return [], 200
            doc.update(data)
            self.successful_document_approvals[doc_id] += 1
            return [dict(doc)], 200

        if "/rest/v1/users" in path:
            if self.failure == "user" and not self.failure_seen:
                self.failure_seen = True
                return {"error": "temporary user update failure"}, 500
            if (
                params.get("dealer_verified") == "not.is.true"
                and self.user["dealer_verified"] is True
            ):
                return [], 200
            self.user.update(data)
            self.successful_user_approvals += 1
            return [dict(self.user)], 200

        raise AssertionError(f"unexpected request: {method} {path}")


def _run_failed_finalize_recovery():
    store = _ApprovalRecoveryStore()
    emails = []
    _FrozenDateTime.current = datetime(2026, 9, 6, 10, 0, tzinfo=timezone.utc)
    with patch.object(w, "SUPABASE_URL", "https://supabase.test"), \
         patch.object(w, "SUPABASE_SERVICE_KEY", "test-service-key"), \
         patch.object(w, "datetime", _FrozenDateTime), \
         patch.object(w, "supabase_request", side_effect=store.request), \
         patch.object(w, "_fetch_active_docs", side_effect=store.active_documents), \
         patch.object(w, "_fetch_user", side_effect=store.current_user), \
         patch.object(w, "_send_approval_email", side_effect=emails.append), \
         patch.object(w, "_utc_now_iso", return_value="2026-09-06T10:01:01+00:00"):
        first_decision = w._process_one(_row())
        _FrozenDateTime.current += timedelta(seconds=w.CLAIM_LEASE_SECONDS + 1)
        retry_decision = w._process_one(_row())

    return store, emails, first_decision, retry_decision


def _run_approval_write_failure_recovery(failure):
    store = _ApprovalWriteFailureStore(failure)
    emails = []
    _FrozenDateTime.current = datetime(2026, 9, 6, 10, 0, tzinfo=timezone.utc)
    with patch.object(w, "SUPABASE_URL", "https://supabase.test"), \
         patch.object(w, "SUPABASE_SERVICE_KEY", "test-service-key"), \
         patch.object(w, "datetime", _FrozenDateTime), \
         patch.object(w, "supabase_request", side_effect=store.request), \
         patch.object(w, "_fetch_active_docs", side_effect=store.active_documents), \
         patch.object(w, "_fetch_user", side_effect=store.current_user), \
         patch.object(w, "_send_approval_email", side_effect=emails.append), \
         patch.object(w, "_utc_now_iso", return_value="2026-09-06T10:01:01+00:00"):
        first_decision = w._process_one(_row())
        first_state = {
            "queue": dict(store.row),
            "user": dict(store.user),
            "documents": {key: dict(value) for key, value in store.documents.items()},
            "emails": list(emails),
        }
        _FrozenDateTime.current += timedelta(seconds=w.CLAIM_LEASE_SECONDS + 1)
        retry_decision = w._process_one(_row())

    return store, emails, first_state, first_decision, retry_decision


def test_fire_approves_when_still_high_confidence():
    docs = [
        {"id": "doc-trade", "document_type": "trade_license", "ocr_confidence": 0.95,
         "replaced_at": None, "status": "pending"},
        {"id": "doc-trn", "document_type": "tax_registration", "ocr_confidence": 0.92,
         "replaced_at": None, "status": "pending"},
    ]
    out = w._fire_pending_approval(_row(), current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "approve"


def test_fire_cancels_if_doc_replaced():
    replaced = {"id": "doc-trade", "document_type": "trade_license",
                "ocr_confidence": 0.95, "replaced_at": "2026-08-18T10:00:00Z",
                "status": "pending"}
    docs = [replaced,
            {"id": "doc-trn", "document_type": "tax_registration",
             "ocr_confidence": 0.92, "replaced_at": None, "status": "pending"}]
    out = w._fire_pending_approval(_row(), current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "cancel"
    assert out["reason"] == "missing:trade_license"


def test_fire_cancels_if_confidence_dropped():
    docs = [
        {"id": "doc-trade", "document_type": "trade_license", "ocr_confidence": 0.50,
         "replaced_at": None, "status": "pending"},
        {"id": "doc-trn", "document_type": "tax_registration", "ocr_confidence": 0.92,
         "replaced_at": None, "status": "pending"},
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


def test_fetch_active_docs_distinguishes_valid_empty_from_provider_failure():
    with patch.object(
        w,
        "supabase_request",
        side_effect=[([], 200), ({"error": "temporary read failure"}, 500), ({}, 200)],
    ):
        assert w._fetch_active_docs("u1") == []
        assert w._fetch_active_docs("u1") is None
        assert w._fetch_active_docs("u1") is None


# --- _process_one (DB integration via monkey-patch) --------------------------

def test_process_one_calls_approve_then_marks_fired():
    captured = {}

    def fake_approve(uid):
        captured["approve_user_id"] = uid
        return True

    def fake_mark(rid, **fields):
        captured.setdefault("marks", []).append((rid, fields))
        return True

    def fake_email(uid):
        captured["emailed"] = uid

    docs = [
        {"id": "doc-trade", "document_type": "trade_license", "ocr_confidence": 0.95,
         "replaced_at": None, "status": "pending"},
        {"id": "doc-trn", "document_type": "tax_registration", "ocr_confidence": 0.92,
         "replaced_at": None, "status": "pending"},
    ]
    with patch.object(w, "_claim", return_value=True), \
         patch.object(w, "_approve_documents", return_value=True), \
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
    replaced = {"id": "doc-trade", "document_type": "trade_license",
                "ocr_confidence": 0.95, "replaced_at": "2026-08-18T10:00:00Z",
                "status": "pending"}
    docs = [replaced,
            {"id": "doc-trn", "document_type": "tax_registration",
             "ocr_confidence": 0.92, "replaced_at": None, "status": "pending"}]
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


def test_process_one_transient_document_read_failure_keeps_pending_claim():
    with patch.object(w, "_claim", return_value="lease-1"), \
         patch.object(w, "_fetch_active_docs", return_value=None), \
         patch.object(w, "_fetch_user") as fetch_user, \
         patch.object(w, "_approve_documents") as approve_documents, \
         patch.object(w, "_approve_user") as approve_user, \
         patch.object(w, "_mark") as mark, \
         patch.object(w, "_send_approval_email") as send_email:
        decision = w._process_one(_row())

    assert decision == {"decision": "wait", "reason": "document_read_failed"}
    fetch_user.assert_not_called()
    approve_documents.assert_not_called()
    approve_user.assert_not_called()
    mark.assert_not_called()
    send_email.assert_not_called()


def test_process_one_valid_empty_documents_remains_ineligible():
    marks = []
    with patch.object(w, "_claim", return_value="lease-1"), \
         patch.object(w, "_fetch_active_docs", return_value=[]), \
         patch.object(w, "_fetch_user", return_value={"dealer_verified": False}), \
         patch.object(w, "_approve_documents") as approve_documents, \
         patch.object(w, "_approve_user") as approve_user, \
         patch.object(w, "_mark", side_effect=lambda row_id, **fields: marks.append((row_id, fields))):
        decision = w._process_one(_row())

    assert decision == {
        "decision": "cancel",
        "reason": "missing:trade_license,tax_registration",
    }
    approve_documents.assert_not_called()
    approve_user.assert_not_called()
    assert marks[0][0] == "p1"
    assert marks[0][1]["claim_lease"] == "lease-1"
    assert marks[0][1]["state"] == "cancelled"


def test_process_one_transient_user_read_failure_keeps_pending_claim():
    docs = [
        {"id": "doc-trade", "document_type": "trade_license", "ocr_confidence": 0.95,
         "replaced_at": None, "status": "pending"},
        {"id": "doc-trn", "document_type": "tax_registration", "ocr_confidence": 0.92,
         "replaced_at": None, "status": "pending"},
    ]
    with patch.object(w, "_claim", return_value="lease-1"), \
         patch.object(w, "_fetch_active_docs", return_value=docs), \
         patch.object(w, "_fetch_user", return_value=None), \
         patch.object(w, "_approve_documents") as approve_documents, \
         patch.object(w, "_approve_user") as approve_user, \
         patch.object(w, "_mark") as mark, \
         patch.object(w, "_send_approval_email") as send_email:
        decision = w._process_one(_row())

    assert decision == {"decision": "wait", "reason": "user_read_failed"}
    approve_documents.assert_not_called()
    approve_user.assert_not_called()
    mark.assert_not_called()
    send_email.assert_not_called()


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


def test_partial_approval_retry_finalizes_claim_and_preserves_email():
    store, emails, first_decision, retry_decision = _run_failed_finalize_recovery()

    assert first_decision == {"decision": "approve"}
    assert retry_decision["decision"] == "approve"
    assert store.row["state"] == "fired"
    assert store.terminal_states == ["fired"]
    assert emails == ["u1"]


def test_finalization_retry_does_not_duplicate_approval_writes():
    store, _, _, _ = _run_failed_finalize_recovery()

    assert store.successful_document_approvals == {
        "doc-trade": 1,
        "doc-trn": 1,
    }
    assert store.successful_user_approvals == 1


@pytest.mark.parametrize("failure", ["document", "user"])
def test_approval_write_failure_never_finalizes_and_retries_after_lease(failure):
    store, emails, first_state, first_decision, retry_decision = (
        _run_approval_write_failure_recovery(failure)
    )

    assert first_decision == {"decision": "wait", "reason": f"{failure}_write_failed"}
    assert first_state["queue"]["state"] == "pending"
    assert first_state["user"]["dealer_verified"] is False
    assert first_state["emails"] == []
    assert store.row["state"] == "fired"
    assert store.terminal_states == ["fired"]
    assert retry_decision["decision"] == "approve"
    assert emails == ["u1"]


@pytest.mark.parametrize("failure", ["document", "user"])
def test_partial_approval_write_retry_is_idempotent(failure):
    store, _, _, _, _ = _run_approval_write_failure_recovery(failure)

    assert store.successful_document_approvals == {
        "doc-trade": 1,
        "doc-trn": 1,
    }
    assert store.successful_user_approvals == 1


def test_approval_writes_are_conditioned_on_unapproved_records():
    docs = [{"id": "doc-pending", "status": "pending"}]
    with patch.object(w, "supabase_request", return_value=([{"id": "updated"}], 200)) as request:
        assert w._approve_documents(docs) is True
        assert w._approve_user("u1") is True

    document_call, user_call = request.call_args_list
    assert document_call.args == (
        "patch", "/rest/v1/dealer_documents?id=eq.doc-pending"
    )
    assert document_call.kwargs["params"] == {"status": "neq.approved"}
    assert user_call.args == ("patch", "/rest/v1/users?id=eq.u1")
    assert user_call.kwargs["params"] == {"dealer_verified": "not.is.true"}


def test_approve_user_accepts_successful_empty_204_response():
    with patch.object(w, "supabase_request", return_value=({}, 204)):
        assert w._approve_user("u1") is True


def test_approve_documents_rejects_empty_conditional_update_response():
    docs = [{"id": "doc-pending", "status": "pending"}]
    with patch.object(w, "supabase_request", return_value=([], 200)):
        assert w._approve_documents(docs) is False


def test_approve_documents_rejects_unapproved_document_without_id():
    docs = [
        {"document_type": "trade_license", "status": "pending"},
        {"id": "doc-trn", "document_type": "tax_registration", "status": "pending"},
    ]
    with patch.object(
        w, "supabase_request", return_value=([{"id": "doc-trn"}], 200)
    ) as request:
        approved = w._approve_documents(docs)

    assert approved is False
    request.assert_not_called()


def test_process_one_missing_document_id_cannot_finalize_queue():
    docs = [
        {"document_type": "trade_license", "ocr_confidence": 0.95,
         "replaced_at": None, "status": "pending"},
        {"id": "doc-trn", "document_type": "tax_registration", "ocr_confidence": 0.92,
         "replaced_at": None, "status": "pending"},
    ]
    with patch.object(w, "_claim", return_value="lease-1"), \
         patch.object(w, "_fetch_active_docs", return_value=docs), \
         patch.object(w, "_fetch_user", return_value={"dealer_verified": False}), \
         patch.object(
             w, "supabase_request", return_value=([{"id": "doc-trn"}], 200)
         ) as request, \
         patch.object(w, "_approve_user") as approve_user, \
         patch.object(w, "_mark") as mark, \
         patch.object(w, "_send_approval_email") as send_email:
        decision = w._process_one(_row())

    assert decision == {"decision": "wait", "reason": "document_write_failed"}
    request.assert_not_called()
    approve_user.assert_not_called()
    mark.assert_not_called()
    send_email.assert_not_called()


def test_run_once_excludes_already_claimed_rows_from_processed_count():
    rows = [_row(id="p-owned"), _row(id="p-lost")]
    decisions = [
        {"decision": "approve"},
        {"decision": "skip", "reason": "already_claimed"},
    ]
    with patch.object(w, "_truthy", return_value=True), \
         patch.object(w, "_fetch_due_pending", return_value=rows), \
         patch.object(w, "_process_one", side_effect=decisions):
        result = w.run_once()

    assert result == {
        "status": "ok",
        "processed": 1,
        "approved": 1,
        "cancelled": 0,
        "skipped": 1,
        "wait": 0,
    }


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
