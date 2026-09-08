"""Compatibility CORS preflight handlers for legacy car routes."""

from flask import Flask, current_app, make_response, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _preflight_response():
    response = make_response()
    origin = request.headers.get("Origin")
    if origin in _BACKEND._get_cors_origins():
        response.headers.add("Access-Control-Allow-Origin", origin)
        response.headers.add("Access-Control-Allow-Credentials", "true")
    response.headers.add(
        "Access-Control-Allow-Headers", "Content-Type, Authorization, Origin"
    )
    response.headers.add(
        "Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    )
    return response


def cars_options():
    return _preflight_response()


def update_car_options(car_id):
    return _preflight_response()


def register_legacy_cors_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/cars",
        endpoint="cars_options",
        view_func=cars_options,
        methods=["OPTIONS"],
    )
    app.add_url_rule(
        "/api/cars/<string:car_id>/update",
        endpoint="update_car_options",
        view_func=update_car_options,
        methods=["OPTIONS"],
    )
    app.add_url_rule(
        "/api/cars/<string:car_id>",
        endpoint="update_car_options",
        view_func=update_car_options,
        methods=["OPTIONS"],
    )
