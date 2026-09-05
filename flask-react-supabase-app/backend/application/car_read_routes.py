"""Public car collection read route with root-supplied runtime dependencies."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request


@dataclass(frozen=True, slots=True)
class CarReadDependencies:
    """Runtime collaborators retained by the compatibility root."""

    build_cache_key: Callable[[], str]
    cache_get: Callable[[str], Any]
    cache_set: Callable[..., Any]
    cached_json_response: Callable[..., Any]
    parse_pagination_args: Callable[[], tuple[int, int]]
    getenv: Callable[[str], str | None]
    reddit_on_explore: Callable[[], bool]
    should_hide_reddit: Callable[[bool, bool, bool], bool]
    search_or_group: Callable[[list[str]], str | None]
    combine_or_groups: Callable[..., dict[str, str]]
    cursor_filter: Callable[[], tuple[str, str] | None]
    to_int: Callable[..., int]
    current_year: Callable[[], int]
    minimum_year: int
    public_car_preview_select: str
    supabase_request: Callable[..., tuple[Any, int]]
    filter_public_listing_records: Callable[[str, Any], list[dict[str, Any]]]
    sort_listing_images: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    batch_fetch_seller_map: Callable[[list[Any]], dict[Any, dict[str, Any]]]
    apply_seller_to_listing: Callable[[dict[str, Any], Any], Any]
    attach_page_headers: Callable[[Any, list[dict[str, Any]], int], Any]
    logger: logging.Logger


_ALLOWED_FILTERS = {
    "car_manufacturer",
    "car_model",
    "car_city",
    "make_year_from",
    "make_year_to",
    "price_from",
    "price_to",
    "body_type",
    "fuel_type",
    "transmission_type",
    "regional_spec",
    "kilometer_from",
    "kilometer_to",
    "steering_side",
    "seating_capacity",
    "horsepower",
    "engine_capacity",
    "source_platform",
}

_EXTRAS_MAPPING = {
    "Keyless Entry": "keyless_entry",
    "DVD Player": "dvd_player",
    "Climate Control": "climate_control",
    "Navigation System": "navigation_system",
    "Premium Sound System": "premium_sound_system",
    "Cooled Seats": "cooled_seats",
    "Front Wheel Drive": "front_wheel_drive",
    "Leather Seats": "leather_seats",
    "Parking Sensors": "parking_sensors",
    "Rear View Camera": "rear_view_camera",
}


def register_car_read_route(
    app: Flask,
    *,
    dependencies: Callable[[], CarReadDependencies],
) -> Callable[..., Any]:
    """Register ``GET /api/cars`` without importing the Flask root."""

    def get_cars():
        deps = None
        try:
            deps = dependencies()
            cache_key = deps.build_cache_key()
            cached_payload = deps.cache_get(cache_key)
            if cached_payload is not None:
                return deps.cached_json_response(cached_payload)

            limit, offset = deps.parse_pagination_args()
            order = request.args.get("order", "created_at.desc")
            filtered_params = {
                "select": "*",
                "limit": str(limit),
                "offset": str(offset),
                "order": order,
                "status": "eq.approved",
                "is_approved": "eq.true",
            }

            requesting_reddit = request.args.get("source_platform") == "reddit"
            if (
                requesting_reddit
                and deps.getenv("LOCAL_SHOW_HIDDEN_REDDIT") == "1"
            ):
                filtered_params.pop("is_approved", None)

            filtered_params = {
                key: value
                for key, value in filtered_params.items()
                if not key.startswith("_")
            }

            exclude_reddit = request.args.get("exclude_reddit", "").strip().lower() in (
                "1",
                "true",
                "yes",
                "on",
            )
            reddit_or_group = None
            if deps.should_hide_reddit(
                requesting_reddit, exclude_reddit, deps.reddit_on_explore()
            ):
                reddit_or_group = (
                    "source_platform.is.null,source_platform.neq.reddit"
                )

            search_or_group = deps.search_or_group(
                [
                    "listing_title",
                    "car_manufacturer",
                    "car_model",
                    "car_description",
                ]
            )
            filtered_params.update(
                deps.combine_or_groups(reddit_or_group, search_or_group)
            )

            cursor_pair = deps.cursor_filter()
            if cursor_pair:
                filtered_params[cursor_pair[0]] = cursor_pair[1]

            for key, value in request.args.items():
                if (
                    key.startswith("_")
                    or key in ["limit", "offset", "order", "extras"]
                    or not value
                    or key not in _ALLOWED_FILTERS
                ):
                    continue

                if key in ["price_from", "price_to", "kilometer_from", "kilometer_to"]:
                    try:
                        value = str(
                            deps.to_int(value, key, minimum=0, allow_empty=False)
                        )
                    except ValueError as validation_error:
                        return jsonify(
                            {"error": str(validation_error), "data": []}
                        ), 400

                if key in ["make_year_from", "make_year_to"]:
                    try:
                        value = str(
                            deps.to_int(
                                value,
                                key,
                                minimum=deps.minimum_year,
                                maximum=deps.current_year() + 1,
                                allow_empty=False,
                            )
                        )
                    except ValueError as validation_error:
                        return jsonify(
                            {"error": str(validation_error), "data": []}
                        ), 400

                if key.endswith("_from"):
                    base_field = key.removesuffix("_from")
                    if base_field == "price":
                        filtered_params["expected_selling_price"] = f"gte.{value}"
                    elif base_field == "make_year":
                        filtered_params["make_year"] = f"gte.{value}"
                    elif base_field == "kilometer":
                        filtered_params["kilometer_driven"] = f"gte.{value}"
                elif key.endswith("_to"):
                    base_field = key.removesuffix("_to")
                    if base_field == "price":
                        filtered_params["expected_selling_price"] = f"lte.{value}"
                    elif base_field == "make_year":
                        filtered_params["make_year"] = f"lte.{value}"
                    elif base_field == "kilometer":
                        filtered_params["kilometer_driven"] = f"lte.{value}"
                else:
                    filtered_params[key] = f"eq.{value}"

            if "extras" in request.args:
                for extra in request.args.getlist("extras"):
                    db_field = _EXTRAS_MAPPING.get(extra)
                    if db_field:
                        filtered_params[db_field] = "eq.true"

            deps.logger.info("Fetching cars with params: %s", filtered_params)
            filtered_params["select"] = deps.public_car_preview_select

            response, status_code = deps.supabase_request(
                "get",
                "/rest/v1/cars",
                params=filtered_params,
                use_service_role=True,
            )
            if status_code >= 400:
                err_message = ""
                err_code = ""
                if isinstance(response, dict):
                    err_message = response.get("message") or response.get("error") or ""
                    err_code = response.get("code") or ""
                deps.logger.error(
                    "get_cars_supabase_error status=%s code=%s msg=%s raw=%s",
                    status_code,
                    err_code,
                    err_message,
                    response,
                )
                return jsonify(
                    {"error": err_message or "Unknown error", "data": []}
                ), status_code

            if not response:
                response = []
            elif not isinstance(response, list):
                deps.logger.warning("Unexpected response format: %s", type(response))
                response = []

            response = deps.filter_public_listing_records("cars", response)
            for car in response:
                car_images = car.pop("car_images", [])
                for image in car_images:
                    if "url" in image and "image_url" not in image:
                        image["image_url"] = image["url"]
                    elif "image_url" in image and "url" not in image:
                        image["url"] = image["image_url"]
                car["images"] = deps.sort_listing_images(car_images)
                car["primary_image_url"] = (
                    car["images"][0].get("image_url") if car["images"] else None
                )

            try:
                seller_map = deps.batch_fetch_seller_map(
                    [car.get("user_id") for car in response]
                )
                for car in response:
                    deps.apply_seller_to_listing(
                        car, seller_map.get(car.get("user_id"))
                    )
            except Exception as seller_error:
                deps.logger.warning("Error fetching seller info: %s", seller_error)

            deps.logger.info("Successfully fetched %s cars", len(response))
            deps.cache_set(cache_key, response)
            return (
                deps.attach_page_headers(
                    deps.cached_json_response(response), response, limit
                ),
                200,
            )
        except Exception as error:
            logger = deps.logger if deps is not None else logging.getLogger(__name__)
            logger.error("Error getting cars: %s", error)
            return jsonify({"error": str(error), "data": []}), 500

    app.add_url_rule(
        "/api/cars",
        endpoint="get_cars",
        view_func=get_cars,
        methods=["GET"],
    )
    return get_cars
