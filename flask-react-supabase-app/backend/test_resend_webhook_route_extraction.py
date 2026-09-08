import ast
import hashlib
import hmac
import json
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "resend_webhook.py"


def test_resend_webhook_module_uses_runtime_backend_only():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_resend_webhook_route_is_registered_once_with_legacy_export():
    from routes import resend_webhook

    contracts = [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == "/api/webhooks/resend"
    ]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "resend_webhook"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.resend_webhook is resend_webhook.resend_webhook


def test_resend_webhook_validates_signature_and_maps_delivery_event():
    body = json.dumps(
        {"type": "email.delivered", "data": {"id": "email-1", "created_at": "now"}}
    ).encode()
    signature = hmac.new(
        b"secret", b"123." + body, hashlib.sha256
    ).hexdigest()
    with patch.dict("os.environ", {"RESEND_WEBHOOK_SECRET": "secret"}), patch.object(
        backend, "supabase_request", return_value=([{"id": "email-1"}], 200)
    ) as request:
        response = backend.app.test_client().post(
            "/api/webhooks/resend",
            data=body,
            content_type="application/json",
            headers={"Resend-Signature": signature, "svix-timestamp": "123"},
        )

    assert response.status_code == 200
    assert response.get_json() == {"ok": True}
    request.assert_called_once_with(
        "patch",
        "/rest/v1/outbound_emails?resend_email_id=eq.email-1",
        data={"delivered_at": "now"},
        use_service_role=True,
    )

    with patch.dict("os.environ", {"RESEND_WEBHOOK_SECRET": "secret"}):
        invalid = backend.app.test_client().post(
            "/api/webhooks/resend",
            data=body,
            content_type="application/json",
            headers={"Resend-Signature": "bad", "svix-timestamp": "123"},
        )
    assert invalid.status_code == 401
    assert invalid.get_json() == {"error": "Invalid signature"}


def test_resend_webhook_ignores_events_without_an_email_id():
    with patch.dict("os.environ", {"RESEND_WEBHOOK_SECRET": ""}), patch.object(
        backend, "supabase_request"
    ) as request:
        response = backend.app.test_client().post(
            "/api/webhooks/resend",
            json={"type": "email.delivered", "data": {}},
        )
    assert response.status_code == 200
    assert response.get_json() == {"ok": True}
    request.assert_not_called()
