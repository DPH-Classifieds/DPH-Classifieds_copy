"""Resend webhook endpoint for outbound email lifecycle updates."""

import hashlib
import hmac
import os

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def resend_webhook():
    """Receive Resend email lifecycle events and update outbound_emails."""
    backend = _BACKEND
    webhook_secret = os.getenv("RESEND_WEBHOOK_SECRET", "")
    if webhook_secret:
        sig_header = request.headers.get("Resend-Signature") or request.headers.get(
            "svix-signature", ""
        )
        ts_header = request.headers.get("svix-timestamp", "")
        raw_body = request.get_data()
        expected = hmac.new(
            webhook_secret.encode(),
            f"{ts_header}.{raw_body.decode()}".encode(),
            hashlib.sha256,
        ).hexdigest()
        if not any(
            part.split(",", 1)[-1] == expected for part in sig_header.split(" ")
        ):
            backend.logger.warning("Resend webhook signature mismatch")
            return jsonify({"error": "Invalid signature"}), 401

    try:
        event = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    event_type = str(event.get("type") or "").lower()
    data = event.get("data") or {}
    resend_email_id = str(data.get("email_id") or data.get("id") or "")
    created_at = data.get("created_at") or backend._isoformat_utc(backend._utc_now())

    if not resend_email_id:
        return jsonify({"ok": True}), 200

    update = {}
    if event_type == "email.delivered":
        update["delivered_at"] = created_at
    elif event_type == "email.opened":
        update["opened_at"] = created_at
        existing, _ = backend.supabase_request(
            "get",
            "/rest/v1/outbound_emails",
            params={
                "resend_email_id": f"eq.{resend_email_id}",
                "select": "id,open_count",
                "limit": "1",
            },
            use_service_role=True,
        )
        if existing:
            update["open_count"] = int((existing[0].get("open_count") or 0)) + 1
    elif event_type == "email.clicked":
        update["clicked_at"] = created_at
        existing, _ = backend.supabase_request(
            "get",
            "/rest/v1/outbound_emails",
            params={
                "resend_email_id": f"eq.{resend_email_id}",
                "select": "id,click_count",
                "limit": "1",
            },
            use_service_role=True,
        )
        if existing:
            update["click_count"] = int((existing[0].get("click_count") or 0)) + 1
    elif event_type in ("email.bounced", "email.delivery_delayed"):
        update["bounced_at"] = created_at
    elif event_type == "email.complained":
        update["spam_at"] = created_at
    elif event_type == "email.unsubscribed":
        update["unsubscribed_at"] = created_at

    if update:
        backend.supabase_request(
            "patch",
            f"/rest/v1/outbound_emails?resend_email_id=eq.{resend_email_id}",
            data=update,
            use_service_role=True,
        )
        backend.logger.info(
            "Resend webhook %s → email %s updated", event_type, resend_email_id
        )

    return jsonify({"ok": True}), 200


def register_resend_webhook_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/webhooks/resend",
        endpoint="resend_webhook",
        view_func=resend_webhook,
        methods=["POST"],
    )
