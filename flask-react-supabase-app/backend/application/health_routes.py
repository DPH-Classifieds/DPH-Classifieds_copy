"""Health and liveness endpoints registered without importing the Flask root."""

from collections.abc import Callable
import logging
import uuid
from typing import Any

from flask import Flask, jsonify, request


def register_health_routes(
    app: Flask,
    *,
    check_redis_health: Callable[[], dict[str, Any]],
    get_worker_heartbeat: Callable[[], dict[str, Any]],
    utc_now: Callable[[], Any],
    isoformat_utc: Callable[[Any], str],
    build_health_snapshot: Callable[..., dict[str, Any]],
    fetch_latest_health_snapshot: Callable[[], tuple[Any, Any]],
    send_health_alert: Callable[[dict[str, Any]], Any],
    token_required: Callable[[Callable[..., Any]], Callable[..., Any]],
    require_admin: Callable[[str], bool],
    logger: logging.Logger,
) -> None:
    """Register the legacy health URLs and endpoint names exactly once."""

    def api_health():
        try:
            redis_health = check_redis_health()
            worker_health = get_worker_heartbeat()
            backend_health = {
                "ok": True,
                "status": "healthy",
                "message": "Backend API responding",
                "latency_ms": None,
                "checked_url": request.base_url,
            }
            snapshot = {
                "id": str(uuid.uuid4()),
                "checked_at": isoformat_utc(utc_now()),
                "source": "backend",
                "overall_status": "healthy"
                if redis_health.get("ok") and worker_health.get("ok")
                else "degraded",
                "frontend_status": "skipped",
                "backend_status": backend_health["status"],
                "redis_status": redis_health["status"],
                "worker_status": worker_health["status"],
                "frontend_latency_ms": None,
                "backend_latency_ms": None,
                "redis_latency_ms": redis_health.get("latency_ms"),
                "worker_latency_ms": None,
                "details": {
                    "frontend": None,
                    "backend": backend_health,
                    "redis": redis_health,
                    "worker": worker_health,
                },
            }
            return jsonify(snapshot), 200
        except Exception as exc:
            logger.error("Health check failed: %s", exc)
            return jsonify({"status": "down", "error": str(exc)}), 503

    def api_health_live():
        try:
            return jsonify(
                {
                    "status": "healthy",
                    "service": "backend",
                    "timestamp": isoformat_utc(utc_now()),
                }
            ), 200
        except Exception as exc:
            logger.error("Live health check failed: %s", exc)
            return jsonify({"status": "down", "error": str(exc)}), 503

    def admin_health(current_user):
        try:
            if not require_admin(current_user):
                return jsonify({"error": "Unauthorized - Admin access required"}), 403

            live_snapshot = build_health_snapshot(include_frontend=True)
            latest_snapshot, snapshot_error = fetch_latest_health_snapshot()
            response_payload = {
                "current": live_snapshot,
                "latest": latest_snapshot,
                "latest_error": snapshot_error,
            }
            if live_snapshot.get("overall_status") != "healthy":
                send_health_alert(live_snapshot)
            return jsonify(response_payload), 200
        except Exception as exc:
            logger.error("Failed to build admin health payload: %s", exc)
            return jsonify(
                {"error": "Failed to fetch health status", "details": str(exc)}
            ), 500

    app.add_url_rule("/api/health", endpoint="api_health", view_func=api_health, methods=["GET"])
    app.add_url_rule("/healthz", endpoint="api_health", view_func=api_health, methods=["GET"])
    app.add_url_rule(
        "/api/health/live", endpoint="api_health_live", view_func=api_health_live, methods=["GET"]
    )
    app.add_url_rule(
        "/healthz/live", endpoint="api_health_live", view_func=api_health_live, methods=["GET"]
    )
    app.add_url_rule(
        "/api/admin/health",
        endpoint="admin_health",
        view_func=token_required(admin_health),
        methods=["GET"],
    )
