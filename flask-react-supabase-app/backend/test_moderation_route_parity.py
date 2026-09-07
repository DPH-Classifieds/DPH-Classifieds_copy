import ast
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import pytest
from flask import has_app_context

import app as backend
from application.route_manifest import build_route_manifest
from workers import auto_review_worker


BACKEND_DIR = Path(__file__).parent


def _contracts_for(rule, method):
    return [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == rule and method in contract.methods
    ]


def test_moderation_module_uses_runtime_boundary_without_app_import():
    source_path = BACKEND_DIR / "routes" / "moderation.py"
    tree = ast.parse(source_path.read_text())

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")

    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source_path.read_text()


def test_moderation_rules_have_single_ownership_and_admin_reject_stays_canonical():
    expected_rules = {
        ("/api/<item_type>/<item_id>/approve", "POST"): "moderation.api_approve_item",
        ("/api/<item_type>/<item_id>/reject", "POST"): "moderation.api_reject_item",
        ("/api/admin/approve/<item_type>", "GET"): "moderation.api_admin_list_items",
        (
            "/api/admin/approve/<item_type>/<item_id>/approve",
            "POST",
        ): "moderation.api_admin_approve_item",
        (
            "/api/admin/approve/<item_type>/<item_id>/reject",
            "POST",
        ): "admin.reject_item",
    }

    for (rule, method), endpoint in expected_rules.items():
        contracts = _contracts_for(rule, method)
        assert len(contracts) == 1
        assert contracts[0].endpoint == endpoint

    registrations = Counter(
        (contract.rule, method)
        for contract in build_route_manifest(backend.app)
        for method in contract.methods
    )
    assert registrations[
        ("/api/admin/approve/<item_type>/<item_id>/reject", "POST")
    ] == 1


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/cars/listing-1/approve"),
        ("post", "/api/cars/listing-1/reject"),
        ("get", "/api/admin/approve/cars"),
    ],
)
def test_moderation_auth_status_without_credentials_is_401(method, path):
    response = getattr(backend.app.test_client(), method)(path)

    assert response.status_code == 401


def test_approval_compatibility_callable_keeps_runtime_patching_and_service_role():
    calls = []

    def fake_supabase(method, path, data=None, **kwargs):
        calls.append((method, path, data, kwargs))
        if method == "patch":
            return [{"id": "listing-1", "user_id": "user-1", "user_email": "u@example.com"}], 200
        return [], 200

    with patch.object(backend, "supabase_request", side_effect=fake_supabase), \
         patch.object(backend, "_invalidate_public_inventory_cache") as invalidate, \
         patch.object(backend, "_send_listing_status_email", return_value=(True, None)):
        with backend.app.app_context():
            ok, payload, status = backend._perform_approval(
                "cars", "listing-1", actor="admin", actor_id="admin-1"
            )

    assert (ok, status) == (True, 200)
    assert payload["success"] is True
    patch_call = next(call for call in calls if call[0] == "patch")
    assert patch_call[1] == "/rest/v1/cars?id=eq.listing-1"
    assert patch_call[3]["use_service_role"] is True
    invalidate.assert_called_once_with("cars")


def test_rejection_requires_note_and_preserves_envelope_email_and_cache_behavior():
    with backend.app.test_request_context(
        "/api/cars/listing-1/reject", method="POST", json={}
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ):
        response, status = backend.api_reject_item.__wrapped__(
            "admin-1", "cars", "listing-1"
        )

    assert status == 400
    assert response.get_json() == {"error": "Rejection reason is required"}

    calls = []

    def fake_supabase(method, path, data=None, **kwargs):
        calls.append((method, path, data, kwargs))
        if method == "patch":
            return [{"id": "listing-1", "user_id": "user-1", "user_email": "u@example.com"}], 200
        return [], 200

    with patch.object(backend, "supabase_request", side_effect=fake_supabase), \
         patch.object(backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}), \
         patch.object(backend, "_send_listing_status_email", return_value=(True, None)) as send_email:
        with backend.app.test_request_context(
            "/api/cars/listing-1/reject",
            method="POST",
            json={"rejection_note": "Fix the VIN", "rejection_fix": "Upload a clear VIN photo"},
            headers={"Origin": "https://example.test"},
        ):
            response, status = backend.api_reject_item.__wrapped__(
                "admin-1", "cars", "listing-1"
            )

    assert status == 200
    assert response.get_json() == {
        "success": True,
        "message": "cars rejected successfully",
        "email_sent": True,
    }
    patch_call = next(call for call in calls if call[0] == "patch")
    assert patch_call[2] == {"status": "rejected", "rejection_note": "Fix the VIN"}
    assert patch_call[3]["use_service_role"] is True
    send_email.assert_called_once_with(
        "u@example.com",
        "cars",
        {"id": "listing-1", "user_id": "user-1", "user_email": "u@example.com"},
        "rejected",
        "https://example.test",
        rejection_fix="Upload a clear VIN photo",
    )


def test_pending_list_keeps_raw_listing_envelope_and_lead_metrics():
    listing = {"id": "listing-1", "status": "pending"}

    def fake_supabase(method, path, params=None, **kwargs):
        if path == "/rest/v1/cars":
            return [listing], 200
        if path == "/rest/v1/lead_events":
            return [
                {"listing_id": "listing-1", "action": "call_click"},
                {"listing_id": "listing-1", "action": "whatsapp_click"},
            ], 200
        raise AssertionError(f"unexpected Supabase call: {method} {path}")

    with patch.object(backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}), \
         patch.object(backend, "supabase_request", side_effect=fake_supabase):
        with backend.app.test_request_context("/api/admin/approve/cars"):
            response, status = backend.api_admin_list_items.__wrapped__(
                "admin-1", "cars"
            )

    assert status == 200
    assert response.get_json() == [
        {
            "id": "listing-1",
            "status": "pending",
            "lead_metrics": {
                "call_click": 1,
                "whatsapp_click": 1,
                "vin_open": 0,
                "vin_reveal": 0,
                "qualified_leads": 2,
            },
            "listing_type": "cars",
        }
    ]


def test_auto_review_compatibility_approver_enters_flask_context():
    observed = {}

    def fake_approval(*args, **kwargs):
        assert args == ("cars", "listing-1")
        observed.update(kwargs)
        assert has_app_context()
        return True, {"success": True}, 200

    with patch.object(backend, "_moderation_perform_approval", side_effect=fake_approval):
        result = auto_review_worker._approver()(
            item_type="cars",
            item_id="listing-1",
            actor="auto",
            actor_id="auto_review_worker",
            signals={"safe": True},
        )

    assert result == (True, {"success": True}, 200)
    assert observed["actor"] == "auto"
