"""Public read-only policy and advertisement endpoints."""

from flask import Flask, current_app, jsonify


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def get_privacy_policy():
    backend = _backend()
    try:
        query = "/rest/v1/privacy_policies?select=*&order=created_at.desc&limit=1"
        response, _response_status = backend.supabase_request("get", query)

        if not response or len(response) == 0:
            return jsonify({"privacy_policy": "Privacy policy not found"}), 404

        return jsonify(response[0])
    except Exception as exc:
        backend.logger.error("Error fetching privacy policy: %s", exc)
        return jsonify({"error": str(exc)}), 500


def get_advertisements():
    backend = _backend()
    try:
        query = "/rest/v1/advertisements?select=*&order=created_at.desc&limit=1"
        response, _response_status = backend.supabase_request(
            "get", query, use_service_role=True
        )

        if not response or len(response) == 0:
            return jsonify({"error": "Advertisements not found"}), 404

        return jsonify(response[0])
    except Exception as exc:
        backend.logger.error("Error fetching advertisements: %s", exc)
        return jsonify({"error": str(exc)}), 500


def register_public_content_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/privacy-policy",
        endpoint="get_privacy_policy",
        view_func=get_privacy_policy,
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/advertisements",
        endpoint="get_advertisements",
        view_func=get_advertisements,
        methods=["GET"],
    )
