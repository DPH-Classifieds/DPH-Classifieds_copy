import ast
import os
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "contact.py"
ROUTE = "/api/contact"
PAYLOAD = {
    "name": "Test User",
    "email": "user@example.com",
    "subject": "Question",
    "message": "Please contact me.",
}


def test_contact_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_contact_route_keeps_single_public_post_contract():
    from routes import contact

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "send_contact_message"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.send_contact_message is contact.send_contact_message


def test_contact_route_validates_before_rate_limit_or_provider():
    with backend.app.test_request_context(ROUTE, method="POST", json={}):
        response, status = backend.send_contact_message()
    assert status == 400
    assert response.get_json() == {"error": "Missing required fields"}

    invalid = {**PAYLOAD, "email": "not-an-email"}
    with backend.app.test_request_context(ROUTE, method="POST", json=invalid):
        response, status = backend.send_contact_message()
    assert status == 400
    assert response.get_json() == {"error": "Invalid email address"}

    too_long = {**PAYLOAD, "message": "x" * 5001}
    with backend.app.test_request_context(ROUTE, method="POST", json=too_long):
        response, status = backend.send_contact_message()
    assert status == 400
    assert response.get_json() == {"error": "Message is too long"}


def test_contact_route_maps_rate_limit_and_missing_provider():
    with patch.object(backend, "_request_client_ip", return_value="203.0.113.10"), patch.object(
        backend, "_contact_rate_limited", return_value=True
    ), backend.app.test_request_context(ROUTE, method="POST", json=PAYLOAD):
        response, status = backend.send_contact_message()
    assert status == 429

    env = {key: value for key, value in os.environ.items() if key not in {"RESEND_FROM_EMAIL", "RESEND_TO_EMAIL"}}
    with patch.dict(os.environ, env, clear=True), patch.object(
        backend, "_request_client_ip", return_value="203.0.113.10"
    ), patch.object(backend, "_contact_rate_limited", return_value=False), backend.app.test_request_context(
        ROUTE, method="POST", json=PAYLOAD
    ):
        response, status = backend.send_contact_message()
    assert status == 500
    assert response.get_json() == {"error": "Email service is not configured"}


def test_contact_route_sends_expected_payload_and_maps_provider_failure():
    env = {"RESEND_FROM_EMAIL": "noreply@example.com", "RESEND_TO_EMAIL": "support@example.com"}
    with patch.dict(os.environ, env, clear=False), patch.object(
        backend, "_request_client_ip", return_value="203.0.113.10"
    ), patch.object(backend, "_contact_rate_limited", return_value=False), patch.object(
        backend, "_send_resend_email", return_value=({}, None)
    ) as send_email, backend.app.test_request_context(ROUTE, method="POST", json=PAYLOAD):
        response, status = backend.send_contact_message()
    assert status == 200
    assert response.get_json() == {"message": "Message sent successfully"}
    assert send_email.call_args.args[0] == {
        "from": "noreply@example.com",
        "to": ["support@example.com"],
        "subject": "[Contact] Question",
        "reply_to": "user@example.com",
        "text": "From: Test User <user@example.com>\nSubject: Question\n\nPlease contact me.",
    }

    with patch.dict(os.environ, env, clear=False), patch.object(
        backend, "_request_client_ip", return_value="203.0.113.10"
    ), patch.object(backend, "_contact_rate_limited", return_value=False), patch.object(
        backend, "_send_resend_email", return_value=(None, "provider down")
    ), backend.app.test_request_context(ROUTE, method="POST", json=PAYLOAD):
        response, status = backend.send_contact_message()
    assert status == 502
    assert response.get_json() == {"error": "Failed to send message"}
