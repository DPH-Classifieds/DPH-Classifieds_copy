import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest
from routes import dealer_document_review


MODULE_PATH = Path(__file__).parent / "routes" / "dealer_document_review.py"
ROUTE = "/api/admin/dealer-documents/<doc_id>/review"
DOCUMENTS_ROUTE = "/api/admin/dealers/<dealer_id>/documents"


def test_dealer_document_review_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_dealer_document_review_keeps_single_route_and_legacy_export():
    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "review_dealer_document"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert (
        backend.review_dealer_document
        is dealer_document_review.review_dealer_document
    )
    document_contracts = [
        c for c in build_route_manifest(backend.app) if c.rule == DOCUMENTS_ROUTE
    ]
    assert len(document_contracts) == 1
    assert document_contracts[0].endpoint == "get_admin_dealer_documents"
    assert document_contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert (
        backend.get_admin_dealer_documents
        is dealer_document_review.get_admin_dealer_documents
    )


def test_dealer_document_review_requires_authentication():
    response = backend.app.test_client().post(
        "/api/admin/dealer-documents/doc-1/review",
        json={"action": "approve"},
    )
    assert response.status_code == 401


def test_dealer_document_review_rejects_unknown_action_before_provider_call():
    with backend.app.test_request_context(
        "/api/admin/dealer-documents/doc-1/review", method="POST", json={"action": "oops"}
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ):
        response, status = backend.review_dealer_document.__wrapped__("admin-1", "doc-1")

    assert status == 400
    assert response.get_json()["error"] == "action must be 'approve', 'deny', or 'pending'"


def test_admin_dealer_documents_requires_authentication():
    response = backend.app.test_client().get(
        "/api/admin/dealers/dealer-1/documents"
    )
    assert response.status_code == 401


def test_admin_dealer_documents_keeps_private_url_shaping_and_provider_failure():
    class FailedResponse:
        status_code = 503

    with backend.app.test_request_context(
        "/api/admin/dealers/dealer-1/documents", method="GET"
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(
        dealer_document_review.requests,
        "get",
        return_value=FailedResponse(),
    ) as provider_get:
        response, status = backend.get_admin_dealer_documents.__wrapped__(
            "admin-1", "dealer-1"
        )

    assert status == 500
    assert response.get_json() == {"error": "Failed to fetch documents"}
    provider_get.assert_called_once()
