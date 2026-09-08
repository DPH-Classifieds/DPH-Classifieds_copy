"""Compatibility endpoints for deprecated listing-view counter pings."""

from flask import Flask, current_app, jsonify


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _legacy_listing_view_response(listing_type, listing_id):
    backend = _BACKEND
    backend.logger.info(
        "Ignored deprecated %s view counter ping for %s", listing_type, listing_id
    )
    return jsonify(
        {"message": "Listing views are tracked by canonical analytics events"}
    ), 202


def track_car_view(car_id):
    return _legacy_listing_view_response("car", car_id)


def track_bike_view(bike_id):
    return _legacy_listing_view_response("bike", bike_id)


def track_plate_view(plate_id):
    return _legacy_listing_view_response("plate", plate_id)


def track_part_view(part_id):
    return _legacy_listing_view_response("part", part_id)


def register_legacy_view_shim_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/cars/<string:car_id>/view",
        endpoint="track_car_view",
        view_func=track_car_view,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/bikes/<string:bike_id>/view",
        endpoint="track_bike_view",
        view_func=track_bike_view,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/plates/<string:plate_id>/view",
        endpoint="track_plate_view",
        view_func=track_plate_view,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/parts/<string:part_id>/view",
        endpoint="track_part_view",
        view_func=track_part_view,
        methods=["POST"],
    )
