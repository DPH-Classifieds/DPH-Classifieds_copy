"""Admin-only diagnostics configuration route."""

import os
from functools import wraps

from flask import Flask, current_app, jsonify


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve application helpers at request time for patch compatibility."""
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


def _mask_key(key):
    if not key or len(key) < 20:
        return "invalid-key-format"
    return key[:5] + "..." + key[-5:]


@_token_required
def check_config(current_user):
    """Report masked Supabase key configuration to an authenticated admin."""
    backend = _backend()
    try:
        if os.getenv("ENABLE_DIAGNOSTICS", "false").lower() != "true":
            return jsonify({"error": "Not found"}), 404

        if not backend.get_user_admin_status(current_user):
            return jsonify({"error": "Unauthorized"}), 403

        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "not-set")
        regular_key = backend.SUPABASE_KEY

        return jsonify(
            {
                "service_key_available": service_key != "not-set",
                "service_key_preview": _mask_key(service_key),
                "regular_key_preview": _mask_key(regular_key),
                "using_same_key": service_key == regular_key,
                "postgres_role_header_present": True,
            }
        ), 200
    except Exception as exc:
        backend.logger.error(f"Error in diagnostics endpoint: {str(exc)}")
        return jsonify({"error": str(exc)}), 500


def register_diagnostics_routes(app: Flask) -> None:
    """Register the diagnostics route after the runtime registry exists."""
    app.add_url_rule(
        "/api/diagnostics/config",
        endpoint="check_config",
        view_func=check_config,
        methods=["GET"],
    )
