import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "dealer_document_review.py"
ROUTE = "/api/admin/dealer-documents/<doc_id>/review"


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
    from routes import dealer_document_review

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "review_dealer_document"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert (
        backend.review_dealer_document
        is dealer_document_review.review_dealer_document
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

