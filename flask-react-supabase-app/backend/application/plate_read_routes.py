"""Public plate collection read route with root-supplied dependencies."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from flask import Flask, request


@dataclass(frozen=True, slots=True)
class PlateReadDependencies:
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
    supabase_url: Callable[[], str]
    service_role_key: Callable[[], str]
    direct_get: Callable[..., Any]
    filter_public_listing_records: Callable[[str, Any], list[dict[str, Any]]]
    fetch_plate_image_map: Callable[..., dict[str, list[dict[str, Any]]]]
    batch_fetch_seller_map: Callable[..., dict[Any, dict[str, Any]]]
    apply_seller_to_listing: Callable[[dict[str, Any], Any], Any]
    attach_page_headers: Callable[[Any, list[dict[str, Any]], int], Any]
    logger: logging.Logger


_PLATE_FILTER_FIELDS = {
    "city": "city",
    "digits": "digits",
    "code": "code",
    "area": "area",
}
_PLATE_RANGE_FIELDS = {"price": "price"}
_PLATE_SEARCH_FIELDS = ["code", "number", "city", "description"]
_PLATE_SELECT = (
    "id,user_id,city,code,digits,price,number,plate_format,description,"
    "contact_phone,contact_name,country_code,source_platform,source_url,status,"
    "is_approved,created_at,updated_at,expires_at,retention_expires_at,"
    "expired_at,is_archived,deleted_at,sold_status,sold_status_set_at,"
    "sold_response_deadline,last_extended_at"
)


def register_plate_read_route(
    app: Flask,
    *,
    dependencies: Callable[[], PlateReadDependencies],
) -> Callable[..., Any]:
    """Register ``GET /api/plates`` without importing the Flask root."""

    def get_plates():
        deps = None
        try:
            deps = dependencies()
            cache_key = deps.build_cache_key()
            cached_payload = deps.cache_get(cache_key)
            if cached_payload is not None:
                return deps.cached_json_response(cached_payload)

            limit, offset = deps.parse_pagination_args()
            deps.logger.info(
                "Fetching plates with limit: %s, offset: %s", limit, offset
            )

            service_role_key = deps.service_role_key()
            headers = {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
            }
            order = request.args.get("order", "created_at.desc")

            exclude_reddit = request.args.get(
                "exclude_reddit", ""
            ).strip().lower() in ("1", "true", "yes", "on")
            reddit_or_group = None
            if request.args.get("source_platform") == "reddit":
                approved_clause = "status=eq.approved"
                if deps.getenv("LOCAL_SHOW_HIDDEN_REDDIT") != "1":
                    approved_clause += "&is_approved=eq.true"
                source_clause = "&source_platform=eq.reddit"
            else:
                approved_clause = "status=eq.approved&is_approved=eq.true"
                source_clause = ""
                if deps.should_hide_reddit(
                    False, exclude_reddit, deps.reddit_on_explore()
                ):
                    reddit_or_group = (
                        "source_platform.is.null,source_platform.neq.reddit"
                    )

            or_and_group = deps.combine_or_groups(
                reddit_or_group,
                deps.search_or_group(_PLATE_SEARCH_FIELDS, url_encode=True),
            )
            for key, value in or_and_group.items():
                source_clause += f"&{key}={value}"

            cursor_pair = deps.cursor_filter()
            cursor_clause = (
                f"&{cursor_pair[0]}={cursor_pair[1]}" if cursor_pair else ""
            )
            filter_pairs = deps.collect_listing_filter_pairs(
                _PLATE_FILTER_FIELDS, _PLATE_RANGE_FIELDS
            )
            filter_clause = "".join(f"&{key}={value}" for key, value in filter_pairs)
            url = (
                f"{deps.supabase_url()}/rest/v1/license_plates?{approved_clause}"
                f"&order={order}{source_clause}{cursor_clause}{filter_clause}"
                f"&limit={limit}&offset={offset}&select={_PLATE_SELECT}"
            )

            deps.logger.info("Fetching plates from: %s", url)
            response = deps.direct_get(url, headers=headers, timeout=10)

            if response.status_code == 200:
                plates = deps.filter_public_listing_records(
                    "license_plates", response.json()
                )
                deps.logger.info("Found %s plates", len(plates))
                plate_images_by_id = deps.fetch_plate_image_map(
                    [plate.get("id") for plate in plates], headers
                )
                seller_map = deps.batch_fetch_seller_map(
                    [plate.get("user_id") for plate in plates], headers=headers
                )
                for plate in plates:
                    plate["images"] = plate_images_by_id.get(
                        str(plate.get("id")), []
                    )
                    if not plate["images"]:
                        if plate.get("image_url") or plate.get("url"):
                            main_url = plate.get("image_url") or plate.get("url")
                            plate["images"] = [
                                {
                                    "id": "main",
                                    "url": main_url,
                                    "image_url": main_url,
                                    "display_url": plate.get("display_url"),
                                    "focal_x": plate.get("focal_x"),
                                    "focal_y": plate.get("focal_y"),
                                    "crop_meta": plate.get("crop_meta"),
                                }
                            ]

                    plate["primary_image_url"] = (
                        plate["images"][0].get("image_url")
                        if plate["images"]
                        else None
                    )
                    deps.apply_seller_to_listing(
                        plate, seller_map.get(plate.get("user_id"))
                    )

                deps.cache_set(cache_key, plates)
                return deps.attach_page_headers(
                    deps.cached_json_response(plates), plates, limit
                )

            deps.logger.error(
                "Failed to fetch plates: %s - %s",
                response.status_code,
                response.text,
            )
            empty_payload = []
            deps.cache_set(cache_key, empty_payload)
            return deps.cached_json_response(empty_payload)
        except Exception as error:
            logger = deps.logger if deps is not None else logging.getLogger(__name__)
            logger.error("Error fetching plates: %s", error, exc_info=True)
            empty_payload = []
            if "cache_key" in locals():
                deps.cache_set(cache_key, empty_payload)
            return deps.cached_json_response(empty_payload)

    app.add_url_rule(
        "/api/plates",
        endpoint="get_plates",
        view_func=get_plates,
        methods=["GET"],
    )
    return get_plates
