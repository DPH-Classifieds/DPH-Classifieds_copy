from unittest.mock import Mock, patch

import app as backend
import routes.admin as admin_routes


def _upstream_response(payload, status_code=200, headers=None):
    response = Mock()
    response.status_code = status_code
    response.headers = headers or {}
    response.json.return_value = payload
    return response


def test_admin_cars_requires_token():
    response = backend.app.test_client().get("/api/admin/cars")

    assert response.status_code == 401
    assert response.get_json() == {"error": "Authentication required"}


def test_admin_cars_client_dispatches_to_canonical_blueprint_view():
    auth_response = _upstream_response({"id": "admin-1", "role": "authenticated"})
    admin_response = _upstream_response([{"is_admin": True}])
    with backend.app.app_context():
        canonical_response = backend.jsonify(
            {"source": "routes.admin", "listings": []}
        )

    with patch.object(
        admin_routes.requests,
        "get",
        side_effect=[auth_response, admin_response],
    ), patch.object(
        admin_routes,
        "_admin_serve_listings",
        return_value=(canonical_response, 200),
    ) as serve_listings:
        response = backend.app.test_client().get(
            "/api/admin/cars",
            headers={"Authorization": "Bearer test-admin-token"},
        )

    assert response.status_code == 200
    assert response.get_json() == {"source": "routes.admin", "listings": []}
    serve_listings.assert_called_once_with("cars")


def test_admin_inventory_routes_have_one_canonical_rule_each():
    expected_endpoints = {
        "/api/admin/cars": "admin.get_cars",
        "/api/admin/bikes": "admin.get_bikes",
        "/api/admin/parts": "admin.get_parts",
        "/api/admin/plates": "admin.get_plates",
    }

    for path, endpoint in expected_endpoints.items():
        rules = [
            rule
            for rule in backend.app.url_map.iter_rules()
            if rule.rule == path and "GET" in rule.methods
        ]
        assert [rule.endpoint for rule in rules] == [endpoint]
