from contextvars import ContextVar
import logging

from flask import Flask

from application.http_runtime import register_http_runtime


def test_registered_runtime_returns_api_error_contract_with_security_headers():
    app = Flask(__name__)
    app.config["PROPAGATE_EXCEPTIONS"] = False
    register_http_runtime(
        app,
        logger=logging.getLogger(__name__),
        posthog_client=None,
        build_content_security_policy=lambda: "default-src 'self'",
        request_start_time=ContextVar("request_start_time", default=None),
        request_supabase_durations_ms=ContextVar("request_supabase_durations_ms", default=[]),
    )

    @app.get("/api/boom")
    def boom():
        raise RuntimeError("not safe to disclose")

    response = app.test_client().get("/api/boom")

    assert response.status_code == 500
    assert response.get_json() == {"message": "Internal server error"}
    assert response.headers["Content-Security-Policy"] == "default-src 'self'"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
