import logging
from urllib.parse import quote

import pytest
from flask import Flask, jsonify, make_response, request

from application.bike_read_routes import (
    BikeReadDependencies,
    register_bike_read_routes,
)


IMAGE_SELECT = (
    "id,bike_id,image_url,url,display_url,focal_x,focal_y,crop_meta,"
    "uploaded_at,is_primary"
)
BIKE_SELECT = (
    "id,user_id,bike_brand,bike_model,year,bike_type,engine_size,mileage,"
    "color,price,location,area,emirate,description,contact_number,country_code,"
    "source_platform,source_url,status,is_approved,created_at,updated_at,"
    "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
    "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
    f"bike_images({IMAGE_SELECT})"
)
FALLBACK_BIKE_SELECT = BIKE_SELECT.replace("source_platform,source_url,", "")


class DirectResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self._payload


def _combine_or_groups(*groups):
    groups = [group for group in groups if group]
    if not groups:
        return {}
    if len(groups) == 1:
        return {"or": f"({groups[0]})"}
    return {"and": "(" + ",".join(f"or({group})" for group in groups) + ")"}


def _search_or_group(fields, url_encode=False):
    term = request.args.get("q", "").strip()
    if not term:
        return None
    if url_encode:
        term = quote(term, safe="")
    return ",".join(f"{field}.ilike.*{term}*" for field in fields)


def _collect_listing_filter_pairs(eq_fields, range_fields):
    pairs = []
    for url_param, db_column in eq_fields.items():
        value = request.args.get(url_param)
        if value:
            pairs.append((db_column, f"eq.{value}"))
    for prefix, db_column in range_fields.items():
        from_value = request.args.get(f"{prefix}_from")
        to_value = request.args.get(f"{prefix}_to")
        if from_value:
            pairs.append((db_column, f"gte.{from_value}"))
        if to_value:
            pairs.append((db_column, f"lte.{to_value}"))
    return pairs


def _normalize_bike_record(bike):
    bike["make"] = bike.get("make") or bike.get("bike_brand")
    bike["model"] = bike.get("model") or bike.get("bike_model")
    bike["year"] = bike.get("year") or bike.get("make_year")
    bike["bike_type"] = bike.get("bike_type") or bike.get("bike_category")
    bike["engine_size"] = bike.get("engine_size") or bike.get("engine_capacity")
    bike["price"] = (
        bike.get("price")
        if bike.get("price") is not None
        else bike.get("expected_selling_price")
    )
    bike["mileage"] = (
        bike.get("mileage")
        if bike.get("mileage") is not None
        else bike.get("kilometer_driven")
    )
    return bike


def _register_app(**overrides):
    app = Flask(__name__)
    state = {
        "direct_calls": [],
        "supabase_calls": [],
        "cache_sets": [],
        "seller_calls": [],
    }

    def direct_get(url, **kwargs):
        state["direct_calls"].append((url, kwargs))
        return DirectResponse([])

    def supabase_request(method, path, **kwargs):
        state["supabase_calls"].append((method, path, kwargs))
        return [], 200

    def cached_json_response(payload, status_code=200, **_kwargs):
        response = make_response(jsonify(payload), status_code)
        response.headers["Cache-Control"] = "no-store"
        return response

    def cache_set(*args, **kwargs):
        state["cache_sets"].append((*args, kwargs))

    def filter_public_listing_records(_table, records):
        return [dict(row) for row in records or [] if isinstance(row, dict)]

    def batch_fetch_seller_map(user_ids, headers=None):
        state["seller_calls"].append((user_ids, headers))
        return {}

    defaults = {
        "build_cache_key": lambda: f"api-cache:{request.full_path}",
        "cache_get": lambda _key: None,
        "cache_set": cache_set,
        "cached_json_response": cached_json_response,
        "parse_pagination_args": lambda: (50, 0),
        "getenv": lambda _name: None,
        "reddit_on_explore": lambda: False,
        "should_hide_reddit": lambda requesting, excluded, explore: (
            not requesting and (excluded or not explore)
        ),
        "search_or_group": _search_or_group,
        "combine_or_groups": _combine_or_groups,
        "cursor_filter": lambda: None,
        "collect_listing_filter_pairs": _collect_listing_filter_pairs,
        "supabase_url": "https://supabase.test",
        "service_role_key": "service-role-key",
        "listing_image_select": IMAGE_SELECT,
        "direct_get": direct_get,
        "supabase_request": supabase_request,
        "filter_public_listing_records": filter_public_listing_records,
        "normalize_bike_record": _normalize_bike_record,
        "sort_listing_images": lambda images: sorted(
            images, key=lambda image: not image.get("is_primary", False)
        ),
        "batch_fetch_seller_map": batch_fetch_seller_map,
        "apply_seller_to_listing": lambda item, _seller: item,
        "attach_page_headers": lambda response, items, limit: _page_headers(
            response, items, limit
        ),
        "optional_user_id": lambda: None,
        "sync_listing_lifecycle": lambda _table, item, **_kwargs: item,
        "listing_visible_to_requester": lambda _item, _user: (True, True),
        "public_strip_fields": frozenset(
            {"registration_document_url", "registration_doc_url", "proof_document_url"}
        ),
        "logger": logging.getLogger("bike-read-parity"),
    }
    defaults.update(overrides)
    dependencies = BikeReadDependencies(**defaults)
    views = register_bike_read_routes(app, dependencies=lambda: dependencies)
    return app, views, state


def _page_headers(response, items, limit):
    response.headers["X-Has-More"] = "true" if len(items) >= limit else "false"
    if items:
        response.headers["X-Next-Cursor"] = str(items[-1].get("created_at") or "")
    return response


def test_routes_preserve_public_paths_methods_and_endpoint_names():
    app, views, _state = _register_app()

    rules = {
        rule.endpoint: (rule.rule, rule.methods)
        for rule in app.url_map.iter_rules()
        if rule.endpoint != "static"
    }

    assert views == (app.view_functions["get_bikes"], app.view_functions["get_bike_by_id"])
    assert rules["get_bikes"][0] == "/api/bikes"
    assert rules["get_bikes"][1] == {"GET", "HEAD", "OPTIONS"}
    assert rules["get_bike_by_id"][0] == "/api/bikes/<string:bike_id>"
    assert rules["get_bike_by_id"][1] == {"GET", "HEAD", "OPTIONS"}


def test_list_cache_hit_returns_cached_payload_without_provider_calls():
    cached = [{"id": "cached-bike"}]
    app, _views, state = _register_app(cache_get=lambda _key: cached)

    response = app.test_client().get("/api/bikes?limit=1")

    assert response.status_code == 200
    assert response.get_json() == cached
    assert response.headers["Cache-Control"] == "no-store"
    assert "X-Has-More" not in response.headers
    assert state["direct_calls"] == []
    assert state["supabase_calls"] == []
    assert state["cache_sets"] == []


def test_list_defaults_preserve_direct_query_visibility_headers_and_cache():
    app, _views, state = _register_app()

    response = app.test_client().get("/api/bikes")

    assert response.status_code == 200
    assert response.get_json() == []
    assert response.headers["X-Has-More"] == "false"
    assert state["supabase_calls"] == []
    url, kwargs = state["direct_calls"][0]
    assert url == (
        "https://supabase.test/rest/v1/bikes?limit=50&offset=0&order=created_at"
        "&status=eq.approved&is_approved=eq.true"
        "&or=(source_platform.is.null,source_platform.neq.reddit)"
        f"&select={BIKE_SELECT}"
    )
    assert kwargs == {
        "headers": {
            "apikey": "service-role-key",
            "Authorization": "Bearer service-role-key",
            "Content-Type": "application/json",
        }
    }
    assert state["cache_sets"] == [("api-cache:/api/bikes?", [], {})]


def test_list_filters_search_and_cursor_preserve_direct_postgrest_mapping():
    app, _views, state = _register_app(
        cursor_filter=lambda: ("created_at", "lt.2026-09-01T12:00:00Z")
    )
    query = (
        "?q=sport%20bike&bike_brand=Honda&bike_type=Sport&area=Dubai"
        "&engine_size=600cc&condition=Used&price_from=10000&price_to=30000"
        "&year_from=2020&year_to=2025&cursor=2026-09-01T12:00:00Z"
    )

    response = app.test_client().get(f"/api/bikes{query}")

    assert response.status_code == 200
    url = state["direct_calls"][0][0]
    assert "and=(or(source_platform.is.null,source_platform.neq.reddit),or(" in url
    assert "bike_brand.ilike.*sport%20bike*" in url
    assert "bike_model.ilike.*sport%20bike*" in url
    assert "description.ilike.*sport%20bike*" in url
    assert "created_at=lt.2026-09-01T12:00:00Z" in url
    for expected in (
        "bike_brand=eq.Honda",
        "bike_type=eq.Sport",
        "area=eq.Dubai",
        "engine_size=eq.600cc",
        "condition=eq.Used",
        "price=gte.10000",
        "price=lte.30000",
        "year=gte.2020",
        "year=lte.2025",
    ):
        assert expected in url


def test_list_reddit_preview_preserves_source_and_local_hidden_behavior():
    app, _views, state = _register_app(
        getenv=lambda name: "1" if name == "LOCAL_SHOW_HIDDEN_REDDIT" else None
    )

    response = app.test_client().get("/api/bikes?source_platform=reddit")

    assert response.status_code == 200
    url = state["direct_calls"][0][0]
    assert "source_platform=eq.reddit" in url
    assert "is_approved=eq.true" not in url
    assert "source_platform.is.null" not in url


@pytest.mark.parametrize("payload", [None, {}, "unexpected"])
def test_list_malformed_direct_payloads_preserve_empty_success(payload):
    app, _views, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(payload)
    )

    response = app.test_client().get("/api/bikes")

    assert response.status_code == 200
    assert response.get_json() == []
    assert state["cache_sets"] == [("api-cache:/api/bikes?", [], {})]


def test_list_direct_failure_preserves_fallback_query_and_response():
    row = {
        "id": "bike-1",
        "user_id": None,
        "bike_brand": "Honda",
        "bike_model": "CBR",
        "bike_images": [],
    }
    app, _views, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(
            {"message": "unavailable"}, 503, "unavailable"
        ),
        supabase_request=lambda method, path, **kwargs: (
            state["supabase_calls"].append((method, path, kwargs)) or ([row], 200)
        ),
    )

    response = app.test_client().get(
        "/api/bikes?q=sport%20bike&price_from=10000&price_to=30000"
    )

    assert response.status_code == 200
    assert response.get_json()[0]["make"] == "Honda"
    method, path, kwargs = state["supabase_calls"][0]
    assert (method, path, kwargs["use_service_role"]) == (
        "get",
        "/rest/v1/bikes",
        True,
    )
    assert kwargs["params"].count(("price", "gte.10000")) == 1
    assert kwargs["params"].count(("price", "lte.30000")) == 1
    assert (
        "and",
        "(or(source_platform.is.null,source_platform.neq.reddit),"
        "or(bike_brand.ilike.*sport bike*,bike_model.ilike.*sport bike*,"
        "description.ilike.*sport bike*))",
    ) in kwargs["params"]
    assert ("select", FALLBACK_BIKE_SELECT) in kwargs["params"]


@pytest.mark.parametrize(
    ("payload", "status"),
    [(None, 200), ({}, 200), ("unexpected", 200), ({"error": "down"}, 503)],
)
def test_list_fallback_empty_malformed_and_error_payloads_preserve_empty_success(
    payload, status
):
    app, _views, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(None, 503),
        supabase_request=lambda *_args, **_kwargs: (payload, status),
    )

    response = app.test_client().get("/api/bikes")

    assert response.status_code == 200
    assert response.get_json() == []
    assert state["cache_sets"] == [("api-cache:/api/bikes?", [], {})]


def test_list_image_normalization_preserves_aliases_sorting_and_main_fallback():
    rows = [
        {
            "id": "joined-images",
            "bike_images": [
                {"id": "secondary", "url": "https://img/secondary.jpg"},
                {
                    "id": "primary",
                    "image_url": "https://img/primary.jpg",
                    "is_primary": True,
                },
                {"id": "missing-url"},
            ],
        },
        {
            "id": "main-fallback",
            "bike_images": [],
            "image_url": "https://img/main.jpg",
            "display_url": "https://img/display.jpg",
        },
    ]
    app, _views, _state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(rows)
    )

    response = app.test_client().get("/api/bikes")

    joined, fallback = response.get_json()
    assert "bike_images" not in joined
    assert [image["id"] for image in joined["images"]] == ["primary", "secondary"]
    assert joined["images"][0]["url"] == "https://img/primary.jpg"
    assert joined["images"][1]["image_url"] == "https://img/secondary.jpg"
    assert joined["primary_image_url"] == "https://img/primary.jpg"
    assert fallback["images"] == [
        {
            "crop_meta": None,
            "display_url": "https://img/display.jpg",
            "focal_x": None,
            "focal_y": None,
            "id": "main",
            "image_url": "https://img/main.jpg",
            "url": "https://img/main.jpg",
        }
    ]


def test_list_seller_enrichment_preserves_batched_headers_and_response_fields():
    rows = [{"id": "bike-1", "user_id": "seller-1", "bike_images": []}]
    seller = {"id": "seller-1", "username": "seller_name"}

    def fetch_sellers(user_ids, headers=None):
        if headers and user_ids == ["seller-1"]:
            return {"seller-1": seller}
        return {}

    def apply_seller(bike, seller_row):
        bike["seller_name"] = seller_row["username"]
        bike["seller_id"] = seller_row["id"]
        return bike

    app, _views, _state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(rows),
        batch_fetch_seller_map=fetch_sellers,
        apply_seller_to_listing=apply_seller,
    )

    response = app.test_client().get("/api/bikes")

    assert response.get_json()[0]["seller_name"] == "seller_name"
    assert response.get_json()[0]["seller_id"] == "seller-1"


def test_list_unexpected_errors_preserve_empty_500_envelope():
    app, _views, state = _register_app(
        build_cache_key=lambda: (_ for _ in ()).throw(RuntimeError("cache failed"))
    )

    response = app.test_client().get("/api/bikes")

    assert response.status_code == 500
    assert response.get_json() == []
    assert state["direct_calls"] == []


def test_detail_cache_hit_returns_cached_public_payload_without_provider_calls():
    cached = {"id": "bike-cached", "make": "Yamaha"}
    app, _views, state = _register_app(
        cache_get=lambda key: cached if key == "api-cache:/api/bikes/bike-cached" else None
    )

    response = app.test_client().get("/api/bikes/bike-cached")

    assert response.status_code == 200
    assert response.get_json() == cached
    assert state["supabase_calls"] == []
    assert state["cache_sets"] == []


@pytest.mark.parametrize("payload", [None, []])
def test_detail_missing_payload_preserves_not_found_envelope(payload):
    app, _views, _state = _register_app(
        supabase_request=lambda *_args, **_kwargs: (payload, 200)
    )

    response = app.test_client().get("/api/bikes/missing")

    assert response.status_code == 404
    assert response.get_json() == {"error": "Bike not found"}


def test_detail_hidden_record_preserves_not_found_envelope():
    app, _views, state = _register_app(
        supabase_request=lambda method, path, **kwargs: (
            state["supabase_calls"].append((method, path, kwargs))
            or ([{"id": "hidden", "user_id": "seller-1"}], 200)
        ),
        listing_visible_to_requester=lambda _bike, _user: (False, False),
    )

    response = app.test_client().get("/api/bikes/hidden")

    assert response.status_code == 404
    assert response.get_json() == {"error": "Bike not found"}
    assert len(state["supabase_calls"]) == 1


def test_detail_success_preserves_normalization_images_seller_stripping_and_cache():
    bike = {
        "id": "bike-1",
        "user_id": "seller-1",
        "bike_brand": "Ducati",
        "bike_model": "Monster",
        "make_year": 2024,
        "expected_selling_price": 50000,
        "kilometer_driven": 1200,
        "registration_document_url": "private-registration",
        "proof_document_url": "private-proof",
    }
    images = [
        {"id": "url-only", "url": "https://img/url.jpg"},
        {"id": "image-only", "image_url": "https://img/image.jpg"},
        {"id": "no-url"},
    ]

    def supabase_request(method, path, **kwargs):
        if path == "/rest/v1/bikes?id=eq.bike-1&select=*":
            return [bike], 200
        if path == "/rest/v1/bike_images?bike_id=eq.bike-1&select=*":
            return images, 200
        if path == "/rest/v1/users?id=eq.seller-1&select=profile_photo_url":
            assert kwargs == {"use_service_role": True}
            return [{"profile_photo_url": "https://img/seller.jpg"}], 200
        raise AssertionError(f"unexpected Supabase call: {method} {path} {kwargs}")

    app, _views, state = _register_app(supabase_request=supabase_request)

    response = app.test_client().get("/api/bikes/bike-1")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["make"] == "Ducati"
    assert payload["model"] == "Monster"
    assert payload["year"] == 2024
    assert payload["price"] == 50000
    assert payload["mileage"] == 1200
    assert payload["images"][0]["image_url"] == "https://img/url.jpg"
    assert payload["images"][1]["url"] == "https://img/image.jpg"
    assert payload["images"][2] == {"id": "no-url"}
    assert payload["seller_profile_photo"] == "https://img/seller.jpg"
    assert "registration_document_url" not in payload
    assert "proof_document_url" not in payload
    assert state["cache_sets"] == [
        ("api-cache:/api/bikes/bike-1", payload, {})
    ]


def test_detail_owner_visible_record_is_not_read_from_or_written_to_public_cache():
    bike = {"id": "draft-bike", "user_id": "owner-1"}
    cache_reads = []

    def cache_get(key):
        cache_reads.append(key)
        return {"id": "wrong-public-record"}

    def supabase_request(_method, path, **_kwargs):
        if "/rest/v1/bikes?" in path:
            return [bike], 200
        if "/rest/v1/bike_images?" in path:
            return [], 200
        if "/rest/v1/users?" in path:
            return [], 200
        raise AssertionError(path)

    app, _views, state = _register_app(
        optional_user_id=lambda: "owner-1",
        cache_get=cache_get,
        supabase_request=supabase_request,
        listing_visible_to_requester=lambda _bike, _user: (True, False),
    )

    response = app.test_client().get("/api/bikes/draft-bike")

    assert response.status_code == 200
    assert response.get_json()["id"] == "draft-bike"
    assert cache_reads == []
    assert state["cache_sets"] == []


def test_detail_image_provider_error_preserves_empty_images_success():
    def supabase_request(_method, path, **_kwargs):
        if "/rest/v1/bikes?" in path:
            return [{"id": "bike-1", "user_id": None}], 200
        if "/rest/v1/bike_images?" in path:
            return {"message": "failed"}, 503
        raise AssertionError(path)

    app, _views, _state = _register_app(supabase_request=supabase_request)

    response = app.test_client().get("/api/bikes/bike-1")

    assert response.status_code == 200
    assert response.get_json()["images"] == []


def test_detail_unexpected_errors_preserve_public_500_envelope():
    app, _views, _state = _register_app(
        optional_user_id=lambda: (_ for _ in ()).throw(RuntimeError("auth failed"))
    )

    response = app.test_client().get("/api/bikes/bike-1")

    assert response.status_code == 500
    assert response.get_json() == {"error": "auth failed"}
