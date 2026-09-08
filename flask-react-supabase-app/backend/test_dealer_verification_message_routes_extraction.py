import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "dealer_verification.py"


def test_dealer_verification_message_routes_use_runtime_module():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_dealer_verification_message_routes_have_single_legacy_contracts():
    contracts = build_route_manifest(backend.app)
    expected = {
        "/api/dealer/verification/notify-admin": ("dealer_verification_notify_admin", ("OPTIONS", "POST")),
        "/api/dealer/verification/messages": ("dealer_verification_list_messages", ("GET", "HEAD", "OPTIONS")),
    }
    for rule, (endpoint, methods) in expected.items():
        matches = [contract for contract in contracts if contract.rule == rule]
        assert len(matches) == 1
        assert matches[0].endpoint == endpoint
        assert matches[0].methods == methods


def test_dealer_verification_notify_requires_dealer_and_preserves_response():
    with backend.app.test_request_context(
        "/api/dealer/verification/notify-admin", method="POST", json={"message": "Please help"}
    ), patch.object(backend, "supabase_request", return_value=([{"id": "u1", "is_dealer": False}], 200)):
        response, status = backend.dealer_verification_notify_admin.__wrapped__("u1")
    assert status == 403
    assert response.get_json() == {"error": "Only dealers can send verification updates"}

    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if method == "get":
            return ([{"id": "u1", "email": "dealer@example.com", "is_dealer": True, "dealer_verified": False, "dealer_application_status": "submitted"}], 200)
        return ({}, 201)

    with backend.app.test_request_context(
        "/api/dealer/verification/notify-admin", method="POST", json={"message": "Please help", "context": "documents"}
    ), patch.object(backend, "supabase_request", side_effect=fake_request), patch.object(
        backend, "_send_dealer_verification_update_admin_notification"
    ) as send_notification:
        response, status = backend.dealer_verification_notify_admin.__wrapped__("u1")
    assert status == 200
    assert response.get_json()["dealer"] == {
        "id": "u1",
        "email": "dealer@example.com",
        "dealer_verified": False,
        "application_status": "submitted",
    }
    send_notification.assert_called_once()
    assert calls[1][1] == "/rest/v1/dealer_admin_messages"


def test_dealer_verification_messages_maps_provider_errors():
    with backend.app.test_request_context("/api/dealer/verification/messages"), patch.object(
        backend, "supabase_request", return_value=([{"id": "m1"}], 200)
    ):
        response, status = backend.dealer_verification_list_messages.__wrapped__("u1")
    assert status == 200
    assert response.get_json() == {"messages": [{"id": "m1"}]}

    with backend.app.test_request_context("/api/dealer/verification/messages"), patch.object(
        backend, "supabase_request", side_effect=RuntimeError("provider unavailable")
    ):
        response, status = backend.dealer_verification_list_messages.__wrapped__("u1")
    assert status == 500
    assert response.get_json() == {"error": "Failed to load messages"}
