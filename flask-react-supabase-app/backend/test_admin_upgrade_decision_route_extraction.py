import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest
from routes import admin_upgrade_decisions


MODULE_PATH = Path(__file__).parent / "routes" / "admin_upgrade_decisions.py"
ROUTE = "/api/admin/dealer/listing-upgrade-requests/<request_id>/decision"


def test_admin_upgrade_decision_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_admin_upgrade_decision_keeps_single_route_and_legacy_export():
    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "admin_decide_listing_upgrade_request"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert (
        backend.admin_decide_listing_upgrade_request
        is admin_upgrade_decisions.admin_decide_listing_upgrade_request
    )


def test_admin_upgrade_decision_requires_authentication():
    response = backend.app.test_client().post(
        "/api/admin/dealer/listing-upgrade-requests/request-1/decision",
        json={"decision": "reject"},
    )
    assert response.status_code == 401


def test_admin_upgrade_decision_guards_admin_missing_and_resolved_requests():
    with backend.app.test_request_context(
        "/api/admin/dealer/listing-upgrade-requests/request-1/decision",
        method="POST",
        json={"decision": "reject"},
    ), patch.object(backend, "_require_admin_api_user", return_value=False):
        response, status = backend.admin_decide_listing_upgrade_request.__wrapped__(
            "user-1", "request-1"
        )
    assert status == 403
    assert response.get_json() == {"error": "Admin only"}

    with backend.app.test_request_context(
        "/api/admin/dealer/listing-upgrade-requests/request-1/decision",
        method="POST",
        json={"decision": "reject"},
    ), patch.object(backend, "_require_admin_api_user", return_value=True), patch.object(
        backend, "supabase_request", return_value=([], 200)
    ):
        response, status = backend.admin_decide_listing_upgrade_request.__wrapped__(
            "admin-1", "request-1"
        )
    assert status == 404
    assert response.get_json() == {"error": "Upgrade request not found"}

    with backend.app.test_request_context(
        "/api/admin/dealer/listing-upgrade-requests/request-1/decision",
        method="POST",
        json={"decision": "reject"},
    ), patch.object(backend, "_require_admin_api_user", return_value=True), patch.object(
        backend,
        "supabase_request",
        return_value=([{"status": "approved"}], 200),
    ):
        response, status = backend.admin_decide_listing_upgrade_request.__wrapped__(
            "admin-1", "request-1"
        )
    assert status == 409
    assert response.get_json() == {
        "error": "Request already resolved",
        "status": "approved",
    }


def test_admin_upgrade_decision_rejects_and_updates_request():
    req = {
        "id": "request-1",
        "dealer_id": "dealer-1",
        "current_limit": 4,
        "requested_limit": 10,
        "status": "pending",
    }
    with backend.app.test_request_context(
        "/api/admin/dealer/listing-upgrade-requests/request-1/decision",
        method="POST",
        json={"decision": "reject", "note": "Insufficient evidence"},
    ), patch.object(backend, "_require_admin_api_user", return_value=True), patch.object(
        backend,
        "supabase_request",
        side_effect=[([req], 200), ({}, 204)],
    ) as supabase_request, patch.object(
        backend,
        "_utc_now",
        return_value=type("Now", (), {"isoformat": lambda self: "2026-09-08T00:00:00+00:00"})(),
    ), patch.object(
        backend,
        "decide_upgrade_request",
        return_value=(None, None, None),
    ):
        response, status = backend.admin_decide_listing_upgrade_request.__wrapped__(
            "admin-1", "request-1"
        )

    assert status == 200
    assert response.get_json() == {
        "new_limit": None,
        "request": req,
        "status": "rejected",
    }
    assert supabase_request.call_args_list[1].kwargs["data"] == {
        "status": "rejected",
        "resolved_by": "admin-1",
        "resolved_at": "2026-09-08T00:00:00+00:00",
        "resolution_note": "Insufficient evidence",
    }

