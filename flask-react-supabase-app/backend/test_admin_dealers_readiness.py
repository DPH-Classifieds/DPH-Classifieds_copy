"""Regression check: GET /api/admin/dealers must attach a real per-dealer
document-readiness verdict (from dealer_documents + the canonical admin readiness helper)
instead of the frontend guessing it from user-row fields that don't exist
(trade_license_status, tax_status, trn, tax_registration_number) — that guess
made the doc chips read "missing" even when documents were uploaded and
approved.
"""
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import app as app_module
import routes.admin as admin_routes


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


def _upstream_response(payload, status_code=200, headers=None):
    response = Mock()
    response.status_code = status_code
    response.headers = headers or {}
    response.json.return_value = payload
    return response


def _admin_auth_responses(dealers_response, documents_response):
    return [
        _upstream_response({"id": "admin-1", "role": "authenticated"}),
        _upstream_response([{"is_admin": True}]),
        dealers_response,
        documents_response,
    ]


def test_live_admin_dealers_supports_pending_compatibility_and_sentinel_pagination():
    dealers = [
        _dealer_row("dealer-1"),
        _dealer_row("dealer-2"),
        _dealer_row("dealer-3"),
    ]
    users_response = _upstream_response(dealers, status_code=206)
    documents_response = _upstream_response([])

    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=_admin_auth_responses(users_response, documents_response),
    ) as fetch:
        response = app_module.app.test_client().get(
            "/api/admin/dealers?pending=true&limit=2&offset=4",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 200
    assert [dealer["id"] for dealer in response.get_json()] == ["dealer-1", "dealer-2"]
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "6"

    users_call = fetch.call_args_list[2]
    query = parse_qs(urlsplit(users_call.args[0]).query)
    assert query["dealer_verified"] == ["eq.false"]
    assert query["limit"] == ["3"]
    assert query["offset"] == ["4"]


def test_live_admin_dealers_bounds_offset_query_and_accepts_200_without_more_rows():
    users_response = _upstream_response([_dealer_row("dealer-1")])
    documents_response = _upstream_response([])

    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=_admin_auth_responses(users_response, documents_response),
    ) as fetch:
        response = app_module.app.test_client().get(
            "/api/admin/dealers?status=verified&limit=99999&offset=-12",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 200
    assert response.get_json() == [_dealer_row("dealer-1") | {"readiness": mock_readiness()}]
    assert response.headers["X-Has-More"] == "false"
    assert "X-Next-Cursor" not in response.headers

    users_call = fetch.call_args_list[2]
    query = parse_qs(urlsplit(users_call.args[0]).query)
    assert query["dealer_verified"] == ["eq.true"]
    assert query["limit"] == ["201"]
    assert query["offset"] == ["0"]


def mock_readiness():
    return {
        "required_documents": ["trade_license", "tax_registration"],
        "document_labels": {
            "trade_license": "Trade License",
            "tax_registration": "Tax Registration (TRN)",
        },
        "missing_fields": [],
        "missing_uploads": ["trade_license", "tax_registration"],
        "pending_documents": [],
        "denied_documents": [],
        "expired_documents": [],
        "approved_documents": [],
        "ready_to_submit": False,
        "ready_to_approve": False,
    }


def test_live_admin_dealers_filters_malformed_rows_and_attaches_readiness():
    dealers = [
        _dealer_row("dealer-1"),
        "not-a-dealer-row",
        {},
        _dealer_row("dealer-2", company_name="", legal_business_name="", trn="bad"),
    ]
    documents = [
        {"user_id": "dealer-1", "document_type": "trade_license", "status": "approved"},
        {"user_id": "dealer-1", "document_type": "tax_registration", "status": "approved"},
        {"user_id": "dealer-2", "document_type": "trade_license", "status": "denied"},
        {"user_id": "dealer-2", "document_type": "tax_registration", "status": "pending"},
        "not-a-document-row",
        {"document_type": "tax_registration", "status": "approved"},
    ]
    users_response = _upstream_response(dealers, status_code=200)
    documents_response = _upstream_response(documents, status_code=206)

    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=_admin_auth_responses(users_response, documents_response),
    ) as fetch:
        response = app_module.app.test_client().get(
            "/api/admin/dealers?status=all",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 200
    payload = response.get_json()
    assert [dealer["id"] for dealer in payload] == ["dealer-1", "dealer-2"]
    assert payload[0]["readiness"]["ready_to_approve"] is True
    assert set(payload[0]["readiness"]["approved_documents"]) == {
        "trade_license",
        "tax_registration",
    }
    assert payload[1]["readiness"]["ready_to_approve"] is False
    assert payload[1]["readiness"]["denied_documents"] == ["trade_license"]
    assert payload[1]["readiness"]["pending_documents"] == ["tax_registration"]
    assert payload[1]["readiness"]["missing_uploads"] == []
    assert response.headers["X-Has-More"] == "false"

    documents_call = fetch.call_args_list[3]
    assert documents_call.kwargs["params"]["user_id"] == "in.(dealer-1,dealer-2)"
    assert documents_call.kwargs["params"]["replaced_at"] == "is.null"
