"""Regression check: GET /api/admin/dealers must attach a real per-dealer
document-readiness verdict (from dealer_documents + _evaluate_dealer_application)
instead of the frontend guessing it from user-row fields that don't exist
(trade_license_status, tax_status, trn, tax_registration_number) — that guess
made the doc chips read "missing" even when documents were uploaded and
approved.
"""
from unittest.mock import patch

import app as app_module


def _dealer_row(id_, **overrides):
    row = {
        "id": id_,
        "email": f"{id_}@example.com",
        "company_name": "Acme Motors",
        "legal_business_name": "Acme Motors LLC",
        "trn": "123456789012345",
        "is_dealer": True,
        "dealer_verified": False,
    }
    row.update(overrides)
    return row


def test_admin_dealers_attaches_readiness_from_batched_documents():
    dealers = [_dealer_row("dealer-1"), _dealer_row("dealer-2")]
    docs = [
        {"id": "d1", "user_id": "dealer-1", "document_type": "trade_license", "status": "approved"},
        {"id": "d2", "user_id": "dealer-1", "document_type": "tax_registration", "status": "approved"},
        {"id": "d3", "user_id": "dealer-2", "document_type": "trade_license", "status": "pending"},
    ]

    calls = {"n": 0}

    def fake_supabase_request(method, path, **kwargs):
        calls["n"] += 1
        if "dealer_documents" in path:
            return docs, 200
        return dealers, 200

    with app_module.app.test_request_context("/api/admin/dealers"), patch.object(
        app_module, "_get_user_details_with_admin_status",
        return_value={"id": "admin-1", "is_admin": True},
    ), patch.object(
        app_module, "supabase_request", side_effect=fake_supabase_request,
    ):
        resp = app_module.get_admin_dealers.__wrapped__("admin-1")
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        assert status == 200
        body = resp[0].get_json() if isinstance(resp, tuple) else resp.get_json()

    by_id = {d["id"]: d for d in body}
    assert by_id["dealer-1"]["readiness"]["ready_to_approve"] is True
    assert set(by_id["dealer-1"]["readiness"]["approved_documents"]) == {"trade_license", "tax_registration"}
    assert by_id["dealer-2"]["readiness"]["ready_to_approve"] is False
    assert by_id["dealer-2"]["readiness"]["pending_documents"] == ["trade_license"]
    assert by_id["dealer-2"]["readiness"]["missing_uploads"] == ["tax_registration"]


def test_admin_dealers_empty_list_skips_document_batch_call():
    """No dealers -> must not send a malformed `user_id=in.()` filter."""
    calls = []

    def fake_supabase_request(method, path, **kwargs):
        calls.append(path)
        return [], 200

    with app_module.app.test_request_context("/api/admin/dealers"), patch.object(
        app_module, "_get_user_details_with_admin_status",
        return_value={"id": "admin-1", "is_admin": True},
    ), patch.object(
        app_module, "supabase_request", side_effect=fake_supabase_request,
    ):
        resp = app_module.get_admin_dealers.__wrapped__("admin-1")
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        assert status == 200

    assert not any("dealer_documents" in c for c in calls)
