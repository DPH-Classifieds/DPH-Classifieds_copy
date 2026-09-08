import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "dealer_admin_actions.py"
ROUTE = "/api/admin/dealers/<dealer_id>/verify"


def test_dealer_admin_actions_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_dealer_verify_keeps_single_route_and_legacy_export():
    from routes import dealer_admin_actions

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "api_verify_dealer"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.api_verify_dealer is dealer_admin_actions.api_verify_dealer


def test_dealer_verify_requires_authentication():
    response = backend.app.test_client().post(
        "/api/admin/dealers/dealer-1/verify", json={"reason": "manual review"}
    )
    assert response.status_code == 401


def test_dealer_verify_requires_admin_and_audit_reason():
    with backend.app.test_request_context(
        "/api/admin/dealers/dealer-1/verify", method="POST", json={}
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": False}
    ):
        response, status = backend.api_verify_dealer.__wrapped__("user-1", "dealer-1")
    assert status == 403
    assert response.get_json() == {"error": "Unauthorized - Admin access required"}

    with backend.app.test_request_context(
        "/api/admin/dealers/dealer-1/verify", method="POST", json={}
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ):
        response, status = backend.api_verify_dealer.__wrapped__("admin-1", "dealer-1")
    assert status == 400
    assert response.get_json()["code"] == "force_approve_reason_required"


def test_dealer_verify_blocks_incomplete_application_before_mutation():
    with backend.app.test_request_context(
        "/api/admin/dealers/dealer-1/verify", method="POST", json={"reason": "manual review"}
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(
        backend,
        "_get_dealer_application_readiness",
        return_value=({"ready_to_approve": False}, None),
    ), patch.object(backend, "supabase_request") as supabase_request:
        response, status = backend.api_verify_dealer.__wrapped__("admin-1", "dealer-1")

    assert status == 409
    assert response.get_json()["code"] == "dealer_application_not_ready_for_approval"
    supabase_request.assert_not_called()


def test_dealer_verify_updates_user_and_sends_approval_email():
    with backend.app.test_request_context(
        "/api/admin/dealers/dealer-1/verify",
        method="POST",
        json={"reason": "documents checked against registry"},
        headers={"Origin": "http://localhost:3000"},
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(
        backend,
        "_get_dealer_application_readiness",
        return_value=({"ready_to_approve": True}, None),
    ), patch.object(
        backend,
        "supabase_request",
        side_effect=[({}, 204), ([{"email": "dealer@example.com"}], 200)],
    ) as supabase_request, patch.object(
        backend, "_send_dealer_status_email", return_value=(True, None)
    ) as send_email:
        response, status = backend.api_verify_dealer.__wrapped__("admin-1", "dealer-1")

    assert status == 200
    assert response.get_json() == {"success": True, "message": "Dealer force-approved"}
    assert supabase_request.call_args_list[0].kwargs["data"]["dealer_verified"] is True
    send_email.assert_called_once_with(
        "dealer@example.com", "approved", "http://localhost:3000"
    )


def test_dealer_reject_requires_authentication():
    response = backend.app.test_client().post(
        "/api/admin/dealers/dealer-1/reject", json={"rejection_note": "Needs update"}
    )
    assert response.status_code == 401


def test_dealer_reject_preserves_rejection_note_and_fix():
    with backend.app.test_request_context(
        "/api/admin/dealers/dealer-1/reject",
        method="POST",
        json={"rejection_note": "Expired license", "rejection_fix": "Upload a current copy"},
        headers={"Origin": "http://localhost:3000"},
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(
        backend,
        "supabase_request",
        side_effect=[({}, 204), ([{"email": "dealer@example.com"}], 200)],
    ) as supabase_request, patch.object(
        backend, "_send_dealer_status_email", return_value=(True, None)
    ) as send_email:
        response, status = backend.api_reject_dealer.__wrapped__("admin-1", "dealer-1")

    assert status == 200
    assert response.get_json() == {
        "success": True,
        "message": "Dealer verification rejected",
    }
    assert supabase_request.call_args_list[0].kwargs["data"] == {
        "dealer_verified": False,
        "dealer_application_status": "rejected",
        "rejection_note": "Expired license",
    }
    send_email.assert_called_once_with(
        "dealer@example.com",
        "rejected",
        "http://localhost:3000",
        rejection_note="Expired license",
        rejection_fix="Upload a current copy",
    )
