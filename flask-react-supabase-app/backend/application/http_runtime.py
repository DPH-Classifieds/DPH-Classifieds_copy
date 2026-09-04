"""Framework-level request instrumentation and API error responses."""

from collections.abc import Callable
from contextvars import ContextVar
import logging
import time
from typing import Any

from flask import Flask, jsonify, request


def register_http_runtime(
    app: Flask,
    *,
    logger: logging.Logger,
    posthog_client: Any,
    build_content_security_policy: Callable[[], str],
    request_start_time: ContextVar[float | None],
    request_supabase_durations_ms: ContextVar[list[dict[str, Any]]],
) -> None:
    """Register process-wide HTTP instrumentation without importing the app module."""

    @app.before_request
    def start_request_timer():
        request_start_time.set(time.perf_counter())
        request_supabase_durations_ms.set([])

    @app.errorhandler(500)
    def handle_internal_error(error):
        if request.path.startswith("/api/"):
            logger.error(
                "Unhandled internal error on %s: %s", request.path, error, exc_info=True
            )
            if posthog_client is not None:
                try:
                    posthog_client.capture_exception(error)
                except Exception:
                    logger.exception("PostHog exception capture failed")
            return jsonify({"message": "Internal server error"}), 500
        return error

    @app.errorhandler(404)
    def handle_not_found(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Not found", "message": "The requested API route does not exist"}), 404
        return error

    @app.errorhandler(405)
    def handle_method_not_allowed(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Method not allowed", "message": "The requested HTTP method is not supported"}), 405
        return error

    @app.errorhandler(413)
    def handle_request_too_large(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Request too large", "message": "The uploaded payload exceeds the request limit"}), 413
        return error

    @app.after_request
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"
        )
        response.headers.setdefault("Content-Security-Policy", build_content_security_policy())
        started_at = request_start_time.get()
        if started_at is not None:
            total_ms = (time.perf_counter() - started_at) * 1000
            supabase_timings = request_supabase_durations_ms.get() or []
            supabase_total_ms = sum(item.get("duration_ms", 0) for item in supabase_timings)
            response_size = response.calculate_content_length() or 0
            logger.info(
                "REQ_PERF method=%s path=%s status=%s total_ms=%.2f supabase_ms=%.2f supabase_calls=%s response_bytes=%s",
                request.method,
                request.path,
                response.status_code,
                total_ms,
                supabase_total_ms,
                len(supabase_timings),
                response_size,
            )
        return response
