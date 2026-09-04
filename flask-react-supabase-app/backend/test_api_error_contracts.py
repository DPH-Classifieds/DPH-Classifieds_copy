import app as backend


def test_unknown_api_route_returns_json_404():
    response = backend.app.test_client().get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.is_json
    assert response.get_json()["error"] == "Not found"


def test_api_method_mismatch_returns_json_405():
    response = backend.app.test_client().post("/api/health")

    assert response.status_code == 405
    assert response.is_json
    assert response.get_json()["error"] == "Method not allowed"


def test_health_route_is_registered_once_per_public_path():
    routes = [rule.rule for rule in backend.app.url_map.iter_rules()]

    assert routes.count("/api/health") == 1
    assert routes.count("/healthz") == 1
    assert routes.count("/api/health/live") == 1
    assert routes.count("/healthz/live") == 1
