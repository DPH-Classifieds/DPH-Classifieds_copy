from flask import Flask

from application.health_routes import register_health_routes


def test_health_registration_preserves_aliases_and_liveness_contract():
    app = Flask(__name__)
    register_health_routes(
        app,
        check_redis_health=lambda: {"ok": True, "status": "healthy"},
        get_worker_heartbeat=lambda: {"ok": True, "status": "healthy"},
        utc_now=lambda: object(),
        isoformat_utc=lambda _: "2026-09-05T00:00:00Z",
        build_health_snapshot=lambda **_: {"overall_status": "healthy"},
        fetch_latest_health_snapshot=lambda: (None, None),
        send_health_alert=lambda _: (True, None),
        token_required=lambda view: view,
        require_admin=lambda _: True,
    )

    rules = list(app.url_map.iter_rules())
    assert sum(rule.rule == "/api/health" for rule in rules) == 1
    assert sum(rule.rule == "/healthz" for rule in rules) == 1
    assert sum(rule.rule == "/api/health/live" for rule in rules) == 1
    assert sum(rule.rule == "/healthz/live" for rule in rules) == 1
    assert {rule.endpoint for rule in rules if rule.rule == "/healthz"} == {"api_health"}
    assert {rule.endpoint for rule in rules if rule.rule == "/healthz/live"} == {"api_health_live"}

    response = app.test_client().get("/healthz/live")
    assert response.status_code == 200
    assert response.get_json() == {
        "status": "healthy",
        "service": "backend",
        "timestamp": "2026-09-05T00:00:00Z",
    }
