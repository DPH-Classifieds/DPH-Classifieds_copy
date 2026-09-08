"""Authenticated read routes for a user's listing inventory."""

from functools import wraps

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve compatibility helpers only while handling a request."""
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def get_user_cars(current_user):
    backend = _backend()
    data, status_code = backend._collect_user_listing_records(current_user, "car")
    if status_code >= 400:
        return jsonify(data), status_code

    for car in data:
        for image in car.get("images", []):
            if "url" in image and "image_url" not in image:
                image["image_url"] = image["url"]

    return jsonify(data), 200


@_token_required
def get_user_bikes(current_user):
    backend = _backend()
    data, status_code = backend._collect_user_listing_records(current_user, "bike")
    if status_code >= 400:
        return jsonify(data), status_code

    for bike in data:
        backend._normalize_bike_record(bike)

    return jsonify(data), 200


@_token_required
def get_user_plates(current_user):
    backend = _backend()
    data, status_code = backend._collect_user_listing_records(current_user, "plate")
    if status_code >= 400:
        return jsonify(data), status_code
    return jsonify(data), 200


@_token_required
def get_user_parts(current_user):
    backend = _backend()
    data, status_code = backend._collect_user_listing_records(current_user, "part")
    if status_code >= 400:
        return jsonify(data), status_code
    return jsonify(data), 200


@_token_required
def get_all_user_listings(current_user):
    backend = _backend()
    status_filter = (request.args.get("status") or "").strip().lower()
    categories = {}
    flattened = []

    for item_type in ["car", "bike", "part", "plate"]:
        try:
            category_items, status_code = backend._collect_user_listing_records(
                current_user, item_type
            )
            if status_code >= 400:
                backend.logger.warning(
                    "[user/listings] %s query failed (%s): %s",
                    item_type,
                    status_code,
                    category_items,
                )
                category_items = []
        except Exception as exc:
            backend.logger.error(
                "[user/listings] unhandled exception collecting %s records: %s",
                item_type,
                exc,
                exc_info=True,
            )
            category_items = []

        for item in category_items:
            item["listing_type"] = item_type
        filtered_items = backend._filter_user_listing_records(
            category_items, status_filter
        )
        categories[f"{item_type}s" if item_type != "part" else "parts"] = filtered_items
        flattened.extend(filtered_items)

    flattened.sort(
        key=lambda item: backend._parse_datetime(item.get("created_at"))
        or backend._utc_now(),
        reverse=True,
    )

    listing_count, count_error = backend._get_user_listing_count(current_user)
    if count_error is not None:
        listing_count = 0

    return jsonify(
        {
            "listings": flattened,
            **categories,
            "listing_limit": backend._user_listing_limit_info(
                current_user, listing_count
            ),
        }
    ), 200


def register_user_listing_index_routes(app: Flask) -> None:
    """Register listing inventory routes after the runtime registry exists."""
    routes = (
        ("/api/user/cars", "get_user_cars", get_user_cars),
        ("/api/user/bikes", "get_user_bikes", get_user_bikes),
        ("/api/user/plates", "get_user_plates", get_user_plates),
        ("/api/user/parts", "get_user_parts", get_user_parts),
        ("/api/user/listings", "get_all_user_listings", get_all_user_listings),
    )
    for rule, endpoint, view_func in routes:
        app.add_url_rule(rule, endpoint=endpoint, view_func=view_func, methods=["GET"])
