import ast
import os
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "car_model_request.py"
ROUTE = "/api/car-model-request"
PAYLOAD = {
    "name": "Test User",
    "email": "user@example.com",
    "make": "Toyota",
    "model": "Camry",
    "year": "2024",
    "notes": "Please add this model.",
    "source": "post-car",
}


def test_car_model_request_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_car_model_request_keeps_single_public_post_contract():
    from routes import car_model_request

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "send_car_model_request"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.send_car_model_request is car_model_request.send_car_model_request


def test_car_model_request_validates_before_provider():
    with backend.app.test_request_context(ROUTE, method="POST", json={}):
        response, status = backend.send_car_model_request()
    assert status == 400
    assert response.get_json() == {"error": "Name, email, make, and model are required"}

    invalid = {**PAYLOAD, "email": "not-an-email"}
    with backend.app.test_request_context(ROUTE, method="POST", json=invalid):
        response, status = backend.send_car_model_request()
    assert status == 400
    assert response.get_json() == {"error": "Invalid email address"}

    too_long = {**PAYLOAD, "notes": "x" * 2001}
    with backend.app.test_request_context(ROUTE, method="POST", json=too_long):
        response, status = backend.send_car_model_request()
    assert status == 400
    assert response.get_json() == {"error": "Request is too long"}


def test_car_model_request_maps_rate_limit_missing_provider_and_provider_failure():
    with patch.object(backend, "_request_client_ip", return_value="203.0.113.10"), patch.object(
        backend, "_contact_rate_limited", return_value=True
    ), backend.app.test_request_context(ROUTE, method="POST", json=PAYLOAD):
        response, status = backend.send_car_model_request()
    assert status == 429

    env = {key: value for key, value in os.environ.items() if key != "RESEND_FROM_EMAIL"}
    with patch.dict(os.environ, env, clear=True), patch.object(
        backend, "_request_client_ip", return_value="203.0.113.10"
    ), patch.object(backend, "_contact_rate_limited", return_value=False), backend.app.test_request_context(
        ROUTE, method="POST", json=PAYLOAD
    ):
        response, status = backend.send_car_model_request()
    assert status == 500
    assert response.get_json() == {"error": "Email service is not configured"}

    env = {"RESEND_FROM_EMAIL": "noreply@example.com", "PRIMARY_SUPER_ADMIN_EMAIL": "admin@example.com"}
    with patch.dict(os.environ, env, clear=False), patch.object(
        backend, "_request_client_ip", return_value="203.0.113.10"
    ), patch.object(backend, "_contact_rate_limited", return_value=False), patch.object(
        backend, "_send_resend_email", return_value=(None, "provider down")
    ), backend.app.test_request_context(ROUTE, method="POST", json=PAYLOAD):
        response, status = backend.send_car_model_request()
    assert status == 502
    assert response.get_json() == {"error": "Failed to send request"}


def test_car_model_request_escapes_html_and_returns_provider_result():
    env = {"RESEND_FROM_EMAIL": "noreply@example.com", "PRIMARY_SUPER_ADMIN_EMAIL": "admin@example.com"}
    payload = {**PAYLOAD, "name": "<Test>"}
    with patch.dict(os.environ, env, clear=False), patch.object(
        backend, "_request_client_ip", return_value="203.0.113.10"
    ), patch.object(backend, "_contact_rate_limited", return_value=False), patch.object(
        backend, "_send_resend_email", return_value=({"id": "email-1"}, None)
    ) as send_email, backend.app.test_request_context(ROUTE, method="POST", json=payload):
        response, status = backend.send_car_model_request()

    assert status == 200
    assert response.get_json() == {
        "message": "Request sent successfully",
        "result": {"id": "email-1"},
    }
    email_payload = send_email.call_args.args[0]
    assert email_payload["to"] == ["admin@example.com"]
    assert email_payload["subject"] == "[Model Request] Toyota Camry"
    assert "&lt;Test&gt;" in email_payload["html"]
