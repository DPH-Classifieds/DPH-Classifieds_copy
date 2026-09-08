"""Authenticated admin-status check used by the frontend route guard."""

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
def admin_check(current_user):
    backend = _backend()
    try:
        service_role_key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }
        response = backend.requests.get(
            f"{current_app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=id,email,username,is_admin",
            headers=headers,
            timeout=10,
        )
        backend.logger.info(
            "[admin-check] User %s - Supabase response status: %s",
            current_user,
            response.status_code,
        )

        if response.status_code == 200:
            users = response.json()
            if users and len(users) > 0:
                user_data = users[0]
                is_admin = bool(
                    user_data.get("is_admin", False)
                    or backend._is_super_admin_record(user_data, user_id=current_user)
                )
                return jsonify(
                    {
                        "is_admin": is_admin,
                        "is_super_admin": bool(
                            user_data.get("is_super_admin")
                            or backend._is_super_admin_record(
                                user_data, user_id=current_user
                            )
                        ),
                    }
                ), 200

        backend.logger.warning(
            "[admin-check] User %s not found in users table", current_user
        )
        return jsonify({"is_admin": False}), 200
    except Exception as exc:
        backend.logger.error("Error checking admin status: %s", exc)
        return jsonify({"is_admin": False, "error": str(exc)}), 200


def register_admin_check_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/auth/admin-check",
        endpoint="admin_check",
        view_func=admin_check,
        methods=["GET"],
    )
