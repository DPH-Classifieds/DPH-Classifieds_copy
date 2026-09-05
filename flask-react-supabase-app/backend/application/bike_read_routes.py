"""Public bike collection and detail reads with root-supplied dependencies."""

import logging
from collections.abc import Callable, Collection
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request


@dataclass(frozen=True, slots=True)
class BikeReadDependencies:
    """Runtime collaborators retained by the compatibility root."""

    build_cache_key: Callable[[], str]
    cache_get: Callable[[str], Any]
    cache_set: Callable[..., Any]
    cached_json_response: Callable[..., Any]
    parse_pagination_args: Callable[[], tuple[int, int]]
    getenv: Callable[[str], str | None]
    reddit_on_explore: Callable[[], bool]
    should_hide_reddit: Callable[[bool, bool, bool], bool]
    search_or_group: Callable[..., str | None]
    combine_or_groups: Callable[..., dict[str, str]]
    cursor_filter: Callable[[], tuple[str, str] | None]
    collect_listing_filter_pairs: Callable[..., list[tuple[str, str]]]
    supabase_url: str
    service_role_key: str
    listing_image_select: str
    direct_get: Callable[..., Any]
    supabase_request: Callable[..., tuple[Any, int]]
    filter_public_listing_records: Callable[[str, Any], list[dict[str, Any]]]
    normalize_bike_record: Callable[[dict[str, Any]], dict[str, Any]]
    sort_listing_images: Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
    batch_fetch_seller_map: Callable[..., dict[Any, dict[str, Any]]]
    apply_seller_to_listing: Callable[[dict[str, Any], Any], Any]
    attach_page_headers: Callable[[Any, list[dict[str, Any]], int], Any]
    optional_user_id: Callable[[], str | None]
    sync_listing_lifecycle: Callable[..., dict[str, Any]]
    listing_visible_to_requester: Callable[
        [dict[str, Any], str | None], tuple[bool, bool]
    ]
    public_strip_fields: Collection[str]
    logger: logging.Logger


_BIKE_FILTER_FIELDS = {
    "bike_brand": "bike_brand",
    "bike_type": "bike_type",
    "area": "area",
    "engine_size": "engine_size",
    "condition": "condition",
}
_BIKE_RANGE_FIELDS = {"price": "price", "year": "year"}
_BIKE_SEARCH_FIELDS = ["bike_brand", "bike_model", "description"]
_BIKE_SELECT_PREFIX = (
    "id,user_id,bike_brand,bike_model,year,bike_type,engine_size,mileage,"
    "color,price,location,area,emirate,description,contact_number,country_code,"
)
_BIKE_LIFECYCLE_SELECT = (
    "status,is_approved,created_at,updated_at,"
    "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
    "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
)


def _bike_select(deps: BikeReadDependencies, *, include_source: bool) -> str:
    source_select = "source_platform,source_url," if include_source else ""
    return (
        _BIKE_SELECT_PREFIX
        + source_select
        + _BIKE_LIFECYCLE_SELECT
        + f"bike_images({deps.listing_image_select})"
    )


def _enrich_collection_rows(
    deps: BikeReadDependencies,
    bikes: list[dict[str, Any]],
    headers: dict[str, str],
    *,
    coerce_null_images: bool,
) -> None:
    seller_map = deps.batch_fetch_seller_map(
        [bike.get("user_id") for bike in bikes], headers=headers
    )
    for bike in bikes:
        deps.normalize_bike_record(bike)
        bike_images = bike.pop("bike_images", [])
        if coerce_null_images:
            bike_images = bike_images or []
        normalized_images = []
        for image in bike_images:
            image_url = image.get("image_url") or image.get("url")
            if not image_url:
                continue
            normalized_images.append(
                {
                    "id": image.get("id"),
                    "image_url": image_url,
                    "url": image_url,
                    "display_url": image.get("display_url"),
                    "focal_x": image.get("focal_x"),
                    "focal_y": image.get("focal_y"),
                    "crop_meta": image.get("crop_meta"),
                    "is_primary": image.get("is_primary", False),
                }
            )
        bike["images"] = deps.sort_listing_images(normalized_images)
        if not bike["images"] and (bike.get("image_url") or bike.get("url")):
            main_url = bike.get("image_url") or bike.get("url")
            bike["images"] = [
                {
                    "id": "main",
                    "url": main_url,
                    "image_url": main_url,
                    "display_url": bike.get("display_url"),
                    "focal_x": bike.get("focal_x"),
                    "focal_y": bike.get("focal_y"),
                    "crop_meta": bike.get("crop_meta"),
                }
            ]

        bike["primary_image_url"] = (
            bike["images"][0].get("image_url") if bike["images"] else None
        )
        deps.apply_seller_to_listing(bike, seller_map.get(bike.get("user_id")))


def register_bike_read_routes(
    app: Flask,
    *,
    dependencies: Callable[[], BikeReadDependencies],
) -> tuple[Callable[..., Any], Callable[..., Any]]:
    """Register the public bike list and detail GET routes."""

    def get_bikes():
        deps = None
        try:
            deps = dependencies()
            cache_key = deps.build_cache_key()
            cached_payload = deps.cache_get(cache_key)
            if cached_payload is not None:
                return deps.cached_json_response(cached_payload)

            limit, offset = deps.parse_pagination_args()
            order = request.args.get("order", "created_at")
            params = {
                "limit": limit,
                "offset": offset,
                "order": order,
                "status": "eq.approved",
                "is_approved": "eq.true",
            }
            params = {
                key: value for key, value in params.items() if not key.startswith("_")
            }

            exclude_reddit = request.args.get(
                "exclude_reddit", ""
            ).strip().lower() in ("1", "true", "yes", "on")
            reddit_or_group = None
            if request.args.get("source_platform") == "reddit":
                params["source_platform"] = "eq.reddit"
                if deps.getenv("LOCAL_SHOW_HIDDEN_REDDIT") == "1":
                    params.pop("is_approved", None)
            elif deps.should_hide_reddit(
                False, exclude_reddit, deps.reddit_on_explore()
            ):
                reddit_or_group = (
                    "source_platform.is.null,source_platform.neq.reddit"
                )

            params.update(
                deps.combine_or_groups(
                    reddit_or_group,
                    deps.search_or_group(_BIKE_SEARCH_FIELDS, url_encode=True),
                )
            )
            fallback_or_and = deps.combine_or_groups(
                reddit_or_group, deps.search_or_group(_BIKE_SEARCH_FIELDS)
            )

            cursor_pair = deps.cursor_filter()
            if cursor_pair:
                params[cursor_pair[0]] = cursor_pair[1]

            filter_pairs = deps.collect_listing_filter_pairs(
                _BIKE_FILTER_FIELDS, _BIKE_RANGE_FIELDS
            )
            deps.logger.info(
                "Fetching bikes with params: %s filters: %s", params, filter_pairs
            )

            try:
                service_role_key = deps.service_role_key
                headers = {
                    "apikey": service_role_key,
                    "Authorization": f"Bearer {service_role_key}",
                    "Content-Type": "application/json",
                }
                query_params = []
                for key, value in params.items():
                    if key == "order":
                        query_params.append(f"order={value}")
                    else:
                        query_params.append(f"{key}={value}")
                query_params.extend(f"{key}={value}" for key, value in filter_pairs)
                query_string = "&".join(query_params)
                url = (
                    f"{deps.supabase_url}/rest/v1/bikes?{query_string}"
                    f"&select={_bike_select(deps, include_source=True)}"
                )

                deps.logger.info("Making direct request to: %s", url)
                direct_response = deps.direct_get(url, headers=headers)
                if direct_response.status_code != 200:
                    deps.logger.error(
                        "Direct request failed: %s - %s",
                        direct_response.status_code,
                        direct_response.text,
                    )
                    raise RuntimeError("Direct request failed")

                bikes = deps.filter_public_listing_records(
                    "bikes", direct_response.json()
                )
                _enrich_collection_rows(
                    deps, bikes, headers, coerce_null_images=False
                )
                deps.cache_set(cache_key, bikes)
                return deps.attach_page_headers(
                    deps.cached_json_response(bikes), bikes, limit
                )
            except Exception as direct_error:
                deps.logger.error("Error in direct request: %s", direct_error)
                fallback_params = (
                    [
                        (key, value)
                        for key, value in params.items()
                        if key not in ("or", "and")
                    ]
                    + list(fallback_or_and.items())
                    + filter_pairs
                    + [("select", _bike_select(deps, include_source=False))]
                )
                response, status_code = deps.supabase_request(
                    "get",
                    "/rest/v1/bikes",
                    params=fallback_params,
                    use_service_role=True,
                )
                if status_code < 400 and response:
                    bikes = deps.filter_public_listing_records("bikes", response)
                    _enrich_collection_rows(
                        deps, bikes, headers, coerce_null_images=True
                    )
                    deps.cache_set(cache_key, bikes)
                    return deps.attach_page_headers(
                        deps.cached_json_response(bikes), bikes, limit
                    )

                empty_payload = []
                deps.cache_set(cache_key, empty_payload)
                return deps.cached_json_response(empty_payload)
        except Exception as error:
            logger = deps.logger if deps is not None else logging.getLogger(__name__)
            logger.error("Error fetching bikes: %s", error)
            return jsonify([]), 500

    def get_bike_by_id(bike_id):
        deps = None
        try:
            deps = dependencies()
            deps.logger.info("Fetching bike details for ID: %s", bike_id)
            requesting_user = deps.optional_user_id()

            cache_key = f"api-cache:{request.path}"
            cached_payload = deps.cache_get(cache_key) if not requesting_user else None
            if cached_payload is not None:
                deps.logger.debug("Redis cache hit for bike detail %s", bike_id)
                return deps.cached_json_response(cached_payload)

            query = f"/rest/v1/bikes?id=eq.{bike_id}&select=*"
            bike_response, _bike_status = deps.supabase_request("get", query)
            if not bike_response or len(bike_response) == 0:
                deps.logger.warning("Bike not found with ID: %s", bike_id)
                return jsonify({"error": "Bike not found"}), 404

            bike = deps.sync_listing_lifecycle(
                "bikes",
                bike_response[0],
                hard_delete_archived=False,
                persist=False,
            )
            visible, is_public = deps.listing_visible_to_requester(
                bike, requesting_user
            )
            if not visible:
                return jsonify({"error": "Bike not found"}), 404
            deps.normalize_bike_record(bike)
            deps.logger.info(
                "Found bike: %s %s (ID: %s)",
                bike.get("make"),
                bike.get("model"),
                bike["id"],
            )

            images_query = f"/rest/v1/bike_images?bike_id=eq.{bike_id}&select=*"
            deps.logger.info("Fetching images with query: %s", images_query)
            images_response, images_status = deps.supabase_request(
                "get", images_query
            )
            if images_status < 400:
                deps.logger.info(
                    "Found %s images for bike %s", len(images_response), bike_id
                )
                for image in images_response:
                    deps.logger.info("Processing image: %s", image)
                    if "url" in image and not image.get("image_url"):
                        image["image_url"] = image["url"]
                        deps.logger.info("Added image_url from url: %s", image["url"])
                    elif "image_url" in image and not image.get("url"):
                        image["url"] = image["image_url"]
                        deps.logger.info("Added url from image_url: %s", image["image_url"])
                    elif not image.get("url") and not image.get("image_url"):
                        deps.logger.warning(
                            "Image %s has no URL fields", image.get("id", "unknown")
                        )
                bike["images"] = images_response
                deps.logger.info("Processed images: %s", bike["images"])
            else:
                deps.logger.warning(
                    "Failed to fetch images for bike %s: status %s",
                    bike_id,
                    images_status,
                )
                bike["images"] = []

            user_id = bike.get("user_id")
            if user_id:
                try:
                    user_response, user_status = deps.supabase_request(
                        "get",
                        f"/rest/v1/users?id=eq.{user_id}&select=profile_photo_url",
                        use_service_role=True,
                    )
                    if user_status < 400 and user_response and len(user_response) > 0:
                        bike["seller_profile_photo"] = user_response[0].get(
                            "profile_photo_url"
                        )
                except Exception as user_error:
                    deps.logger.warning("Failed to fetch seller info: %s", user_error)

            deps.logger.info(
                "Returning bike with %s images", len(bike["images"])
            )
            for field in deps.public_strip_fields:
                bike.pop(field, None)
            if not is_public:
                for field in deps.public_strip_fields:
                    bike.pop(field, None)
            if not requesting_user and is_public:
                deps.cache_set(cache_key, bike)
            return deps.cached_json_response(bike)
        except Exception as error:
            logger = deps.logger if deps is not None else logging.getLogger(__name__)
            logger.error("Error fetching bike details: %s", error)
            return jsonify({"error": str(error)}), 500

    app.add_url_rule(
        "/api/bikes", endpoint="get_bikes", view_func=get_bikes, methods=["GET"]
    )
    app.add_url_rule(
        "/api/bikes/<string:bike_id>",
        endpoint="get_bike_by_id",
        view_func=get_bike_by_id,
        methods=["GET"],
    )
    return get_bikes, get_bike_by_id
