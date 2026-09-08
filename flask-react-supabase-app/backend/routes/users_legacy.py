"""Authenticated legacy user-list route kept for compatibility."""

import os
from functools import wraps

from flask import Flask, current_app, jsonify


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def get_users(current_user):
    backend = _backend()
    try:
        user_data, status_code = backend.supabase_request(
            "get", f"/rest/v1/users?id=eq.{current_user}", user_id=current_user
        )
        if (
            status_code >= 400
            or not user_data
            or not (
                user_data[0].get("is_admin")
                or backend._is_super_admin_record(user_data[0], user_id=current_user)
            )
        ):
            return jsonify({"error": "Unauthorized. Only admins can view users."}), 403

        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", backend.SUPABASE_KEY)
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "X-Client-Info": "backend-api",
            "X-Postgres-Role": "service_role",
        }
        response = backend.requests.get(
            f"{backend.SUPABASE_URL}/rest/v1/users?select=*", headers=headers
        )
        if response.status_code not in (200, 206):
            backend.logger.error("Failed to get users: %s", response.text)
            return jsonify({"error": "Failed to fetch users"}), response.status_code

        payload = response.json()
        if response.status_code == 206:
            return jsonify({"users": payload, "partial_content": True}), 200
        return jsonify(payload), 200
    except Exception as exc:
        backend.logger.error("Error getting users: %s", exc)
        return jsonify({"error": str(exc)}), 500


def register_legacy_user_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/users", endpoint="get_users", view_func=get_users, methods=["GET"]
    )
