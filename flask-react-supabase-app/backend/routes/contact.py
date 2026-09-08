"""Public contact-form submission route."""

import os

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def send_contact_message():
    backend = _backend()
    try:
        data = request.json or {}
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip()
        subject = (data.get("subject") or "").strip()
        message = (data.get("message") or "").strip()

        if not name or not email or not subject or not message:
            return jsonify({"error": "Missing required fields"}), 400

        if not backend.EMAIL_REGEX.match(email):
            return jsonify({"error": "Invalid email address"}), 400

        if len(name) > 100 or len(subject) > 200 or len(message) > 5000:
            return jsonify({"error": "Message is too long"}), 400

        client_ip = backend._request_client_ip()
        if backend._contact_rate_limited(client_ip):
            return jsonify({"error": "Too many requests. Please try again later."}), 429

        from_email = os.getenv("RESEND_FROM_EMAIL")
        to_email = os.getenv("RESEND_TO_EMAIL")
        if not from_email or not to_email:
            return jsonify({"error": "Email service is not configured"}), 500

        payload = {
            "from": from_email,
            "to": [to_email],
            "subject": f"[Contact] {subject}",
            "reply_to": email,
            "text": f"From: {name} <{email}>\nSubject: {subject}\n\n{message}",
        }

        result, error = backend._send_resend_email(payload)
        if error:
            backend.logger.error("Resend email failed: %s", error)
            return jsonify({"error": "Failed to send message"}), 502

        return jsonify({"message": "Message sent successfully"}), 200
    except Exception as exc:
        backend.logger.error("Error sending contact message: %s", exc)
        return jsonify({"error": "Failed to send message"}), 500


def register_contact_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/contact",
        endpoint="send_contact_message",
        view_func=send_contact_message,
        methods=["POST"],
    )
