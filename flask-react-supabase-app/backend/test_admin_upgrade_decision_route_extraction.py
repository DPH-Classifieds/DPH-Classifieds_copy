import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest
from routes import admin_upgrade_decisions


MODULE_PATH = Path(__file__).parent / "routes" / "admin_upgrade_decisions.py"
ROUTE = "/api/admin/dealer/listing-upgrade-requests/<request_id>/decision"
LIST_ROUTE = "/api/admin/dealer/listing-upgrade-requests"
CREATE_ROUTE = "/api/dealer/listing-upgrade-requests"


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
    list_contracts = [c for c in build_route_manifest(backend.app) if c.rule == LIST_ROUTE]
    assert len(list_contracts) == 1
    assert list_contracts[0].endpoint == "admin_list_listing_upgrade_requests"
    assert list_contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert (
        backend.admin_list_listing_upgrade_requests
        is admin_upgrade_decisions.admin_list_listing_upgrade_requests
    )
    create_contracts = [c for c in build_route_manifest(backend.app) if c.rule == CREATE_ROUTE]
    assert len(create_contracts) == 1
    assert create_contracts[0].endpoint == "dealer_create_listing_upgrade_request"
    assert create_contracts[0].methods == ("OPTIONS", "POST")
    assert (
        backend.dealer_create_listing_upgrade_request
        is admin_upgrade_decisions.dealer_create_listing_upgrade_request
    )


def test_admin_upgrade_decision_requires_authentication():
    response = backend.app.test_client().post(
        "/api/admin/dealer/listing-upgrade-requests/request-1/decision",
        json={"decision": "reject"},
    )
    assert response.status_code == 401
    assert backend.app.test_client().get(LIST_ROUTE).status_code == 401
    assert backend.app.test_client().post(CREATE_ROUTE, json={}).status_code == 401


def test_dealer_upgrade_create_requires_verified_dealer_and_validates_request():
    with backend.app.test_request_context(CREATE_ROUTE, method="POST", json={}), patch.object(
        backend, "_fetch_dealer_listing_policy", return_value=None
    ):
        response, status = backend.dealer_create_listing_upgrade_request.__wrapped__("user-1")
    assert status == 403
    assert response.get_json() == {"error": "Not a dealer"}

    with backend.app.test_request_context(CREATE_ROUTE, method="POST", json={}), patch.object(
        backend, "_fetch_dealer_listing_policy", return_value={"verified": False, "limit": 4}
    ):
        response, status = backend.dealer_create_listing_upgrade_request.__wrapped__("dealer-1")
    assert status == 403
    assert "verified" in response.get_json()["error"]


def test_dealer_upgrade_create_inserts_and_notifies_admin_best_effort():
    row = {"id": "request-1", "dealer_id": "dealer-1", "status": "pending"}
    with backend.app.test_request_context(
        CREATE_ROUTE,
        method="POST",
        json={"requested_limit": 10, "reason": "We expanded our showroom"},
    ), patch.object(
        backend,
        "_fetch_dealer_listing_policy",
        return_value={"verified": True, "limit": 4},
    ), patch.object(
        backend, "validate_upgrade_request", return_value=None
    ), patch.object(
        backend,
        "supabase_request",
        side_effect=[([row], 201), ([{"email": "dealer@example.com"}], 200)],
    ) as supabase_request, patch.object(
        backend, "_send_dealer_listing_upgrade_admin_notification"
    ) as notify:
        response, status = backend.dealer_create_listing_upgrade_request.__wrapped__("dealer-1")

    assert status == 201
    assert response.get_json() == row
    assert supabase_request.call_args_list[0].kwargs["data"] == {
        "dealer_id": "dealer-1",
        "current_limit": 4,
        "requested_limit": 10,
        "reason": "We expanded our showroom",
    }
    notify.assert_called_once_with(row, {"email": "dealer@example.com"})


def test_admin_upgrade_list_filters_status_and_enriches_dealers():
    requests = [
        {
            "id": "request-1",
            "dealer_id": "dealer-1",
            "current_limit": 4,
            "requested_limit": 10,
            "reason": "More stock",
            "status": "pending",
        }
    ]
    dealers = [{"id": "dealer-1", "email": "dealer@example.com"}]
    with backend.app.test_request_context(f"{LIST_ROUTE}?status=approved", method="GET"), patch.object(
        backend, "_require_admin_api_user", return_value=True
    ), patch.object(
        backend,
        "supabase_request",
        side_effect=[(requests, 200), (dealers, 200)],
    ) as supabase_request:
        response, status = backend.admin_list_listing_upgrade_requests.__wrapped__("admin-1")

    assert status == 200
    assert response.get_json()[0]["dealer"] == dealers[0]
    assert supabase_request.call_args_list[0].kwargs["params"]["status"] == "eq.approved"


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
