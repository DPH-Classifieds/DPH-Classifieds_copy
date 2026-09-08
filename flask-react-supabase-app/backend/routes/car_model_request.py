"""Public fallback request for a missing vehicle model."""

import os

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def send_car_model_request():
    backend = _backend()
    try:
        data = request.json or {}
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip()
        make = (data.get("make") or "").strip()
        model = (data.get("model") or "").strip()
        year = (data.get("year") or "").strip()
        notes = (data.get("notes") or "").strip()
        source = (data.get("source") or "").strip() or "post-car"

        if not email or not make or not model:
            return jsonify({"error": "Name, email, make, and model are required"}), 400
        if not backend.EMAIL_REGEX.match(email):
            return jsonify({"error": "Invalid email address"}), 400
        if any(len(value) > 2000 for value in [name, make, model, year, notes, source]):
            return jsonify({"error": "Request is too long"}), 400

        client_ip = backend._request_client_ip()
        if backend._contact_rate_limited(client_ip):
            return jsonify({"error": "Too many requests. Please try again later."}), 429

        from_email = os.getenv("RESEND_FROM_EMAIL")
        admin_email = os.getenv("PRIMARY_SUPER_ADMIN_EMAIL", "admin@dphclassifieds.com")
        if not from_email:
            return jsonify({"error": "Email service is not configured"}), 500

        title = f"{make} {model}".strip()
        html_content = f"""
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
          <h2 style="margin: 0 0 8px; font-size: 22px; color: #ffffff;">Car model request</h2>
          <p style="margin: 0 0 20px; color: #94a3b8;">A user could not find a model in the listing form.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #64748b; width: 28%;">Name</td><td style="padding: 8px 0; color: #f0fdf4;">{backend.xml_escape(name or 'Unknown')}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Email</td><td style="padding: 8px 0; color: #f0fdf4;">{backend.xml_escape(email)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Make</td><td style="padding: 8px 0; color: #f0fdf4;">{backend.xml_escape(make)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Model</td><td style="padding: 8px 0; color: #f0fdf4;">{backend.xml_escape(model)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Year</td><td style="padding: 8px 0; color: #f0fdf4;">{backend.xml_escape(year or 'Not provided')}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Source</td><td style="padding: 8px 0; color: #f0fdf4;">{backend.xml_escape(source)}</td></tr>
          </table>
          <div style="margin-top: 20px; padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; white-space: pre-wrap; line-height: 1.6; color:#e2e8f0;">{backend.xml_escape(notes or 'No notes provided.')}</div>
        </div>
        """
        payload = {
            "from": from_email,
            "to": [admin_email],
            "subject": f"[Model Request] {title}",
            "reply_to": email,
            "html": html_content,
            "text": (
                f"Name: {name or 'Unknown'}\n"
                f"Email: {email}\n"
                f"Make: {make}\n"
                f"Model: {model}\n"
                f"Year: {year or 'Not provided'}\n"
                f"Source: {source}\n\n"
                f"Notes:\n{notes or 'No notes provided.'}"
            ),
        }

        result, error = backend._send_resend_email(payload)
        if error:
            backend.logger.error("Model request email failed: %s", error)
            return jsonify({"error": "Failed to send request"}), 502

        return jsonify({"message": "Request sent successfully", "result": result}), 200
    except Exception as exc:
        backend.logger.error("Error sending car model request: %s", exc)
        return jsonify({"error": "Failed to send request"}), 500


def register_car_model_request_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/car-model-request",
        endpoint="send_car_model_request",
        view_func=send_car_model_request,
        methods=["POST"],
    )
