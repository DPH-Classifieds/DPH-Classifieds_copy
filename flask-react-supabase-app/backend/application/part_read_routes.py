"""Public car-part collection read route with root-supplied dependencies."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, request


@dataclass(frozen=True, slots=True)
class PartReadDependencies:
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
    listing_image_select: str
    direct_get: Callable[..., Any]
    supabase_request: Callable[..., tuple[Any, int]]
    filter_public_listing_records: Callable[[str, Any], list[dict[str, Any]]]
    batch_fetch_seller_map: Callable[..., dict[Any, dict[str, Any]]]
    apply_seller_to_listing: Callable[[dict[str, Any], Any], Any]
    attach_page_headers: Callable[[Any, list[dict[str, Any]], int], Any]
    logger: logging.Logger


_PART_FILTER_FIELDS = {
    "condition": "condition",
    "part_type": "part_type",
    "area": "area",
}
_PART_RANGE_FIELDS = {"price": "price"}
_PART_SEARCH_FIELDS = ["name", "part_type", "description"]
_PART_SELECT_PREFIX = (
    "id,user_id,name,part_type,condition,price,location,area,emirate,"
    "description,contact_number,country_code,"
)
_PART_SELECT_SUFFIX = (
    "status,is_approved,created_at,updated_at,compatible_makes,compatible_models,"
    "compatible_years,expires_at,retention_expires_at,expired_at,is_archived,"
    "deleted_at,sold_status,sold_status_set_at,sold_response_deadline,"
    "last_extended_at,"
)


def _part_select(deps: PartReadDependencies, *, include_source: bool) -> str:
    source_select = "source_platform,source_url," if include_source else ""
    return (
        _PART_SELECT_PREFIX
        + source_select
        + _PART_SELECT_SUFFIX
        + f"part_images({deps.listing_image_select})"
    )


def _enrich_collection_rows(
    deps: PartReadDependencies,
    parts: list[dict[str, Any]],
    headers: dict[str, str],
    *,
    coerce_null_images: bool,
) -> None:
    seller_map = deps.batch_fetch_seller_map(
        [part.get("user_id") for part in parts], headers=headers
    )
    for part in parts:
        part_images = part.pop("part_images", [])
        if coerce_null_images:
            part_images = part_images or []
        part["images"] = [
            {
                "id": image.get("id"),
                "url": image.get("url") or image.get("image_url"),
                "image_url": image.get("image_url") or image.get("url"),
                "display_url": image.get("display_url"),
                "focal_x": image.get("focal_x"),
                "focal_y": image.get("focal_y"),
                "crop_meta": image.get("crop_meta"),
            }
            for image in part_images
            if image.get("url") or image.get("image_url")
        ]
        if not part["images"] and (part.get("image_url") or part.get("url")):
            main_url = part.get("image_url") or part.get("url")
            part["images"] = [
                {
                    "id": "main",
                    "url": main_url,
                    "image_url": main_url,
                    "display_url": part.get("display_url"),
                    "focal_x": part.get("focal_x"),
                    "focal_y": part.get("focal_y"),
                    "crop_meta": part.get("crop_meta"),
                }
            ]

        part["primary_image_url"] = (
            part["images"][0].get("image_url") if part["images"] else None
        )
        deps.apply_seller_to_listing(part, seller_map.get(part.get("user_id")))


def register_part_read_route(
    app: Flask,
    *,
    dependencies: Callable[[], PartReadDependencies],
) -> Callable[..., Any]:
    """Register ``GET /api/parts`` without importing the Flask root."""

    def get_parts():
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
                    deps.search_or_group(_PART_SEARCH_FIELDS, url_encode=True),
                )
            )
            fallback_or_and = deps.combine_or_groups(
                reddit_or_group, deps.search_or_group(_PART_SEARCH_FIELDS)
            )

            cursor_pair = deps.cursor_filter()
            if cursor_pair:
                params[cursor_pair[0]] = cursor_pair[1]

            filter_pairs = deps.collect_listing_filter_pairs(
                _PART_FILTER_FIELDS, _PART_RANGE_FIELDS
            )
            deps.logger.info(
                "Fetching parts with params: %s filters: %s", params, filter_pairs
            )

            try:
                service_role_key = deps.service_role_key()
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
                query_params.extend(
                    f"{key}={value}" for key, value in filter_pairs
                )
                query_string = "&".join(query_params)
                url = (
                    f"{deps.supabase_url()}/rest/v1/car_parts?{query_string}"
                    f"&select={_part_select(deps, include_source=True)}"
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

                parts = deps.filter_public_listing_records(
                    "car_parts", direct_response.json()
                )
                _enrich_collection_rows(
                    deps, parts, headers, coerce_null_images=False
                )
                deps.cache_set(cache_key, parts)
                return deps.attach_page_headers(
                    deps.cached_json_response(parts), parts, limit
                )
            except Exception as direct_error:
                deps.logger.error("Error in direct request: %s", direct_error)
                fallback_params = {
                    **params,
                    **fallback_or_and,
                    **dict(filter_pairs),
                    "select": _part_select(deps, include_source=False),
                }
                response, status_code = deps.supabase_request(
                    "get",
                    "/rest/v1/car_parts",
                    params=fallback_params,
                    use_service_role=True,
                )
                if status_code < 400 and response:
                    parts = deps.filter_public_listing_records(
                        "car_parts", response
                    )
                    _enrich_collection_rows(
                        deps, parts, headers, coerce_null_images=True
                    )
                    deps.cache_set(cache_key, parts)
                    return deps.attach_page_headers(
                        deps.cached_json_response(parts), parts, limit
                    )

                empty_payload = []
                deps.cache_set(cache_key, empty_payload)
                return deps.cached_json_response(empty_payload)
        except Exception as error:
            logger = deps.logger if deps is not None else logging.getLogger(__name__)
            logger.error("Error fetching parts: %s", error)
            return jsonify({"error": str(error)}), 500

    app.add_url_rule(
        "/api/parts",
        endpoint="get_parts",
        view_func=get_parts,
        methods=["GET"],
    )
    return get_parts
