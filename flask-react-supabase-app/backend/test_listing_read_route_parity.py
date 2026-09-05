import logging

import pytest
from flask import Flask, jsonify, make_response

from application.car_read_routes import (
    CarReadDependencies,
    register_car_read_route,
)


PREVIEW_SELECT = "id,user_id,created_at,car_images(id,url,image_url,is_primary)"


def _cached_json_response(payload, status_code=200, ttl_seconds=None):
    del ttl_seconds
    response = make_response(jsonify(payload), status_code)
    response.headers["Cache-Control"] = "no-store"
    return response


def _attach_page_headers(response, items, limit):
    response.headers["X-Has-More"] = "true" if len(items) >= limit else "false"
    if items:
        response.headers["X-Next-Cursor"] = str(items[-1].get("created_at") or "")
    return response


def _combine_or_groups(*groups):
    present = [group for group in groups if group]
    if not present:
        return {}
    if len(present) == 1:
        return {"or": f"({present[0]})"}
    return {"and": "(" + ",".join(f"or({group})" for group in present) + ")"}


def _to_int(value, field_name, *, minimum=None, maximum=None, allow_empty=True):
    del allow_empty
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a valid number")
    if minimum is not None and parsed < minimum:
        raise ValueError(f"{field_name} must be at least {minimum}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"{field_name} must be at most {maximum}")
    return parsed


def _register_app(**overrides):
    app = Flask(__name__)
    state = {"cache_sets": [], "supabase_calls": [], "seller_user_ids": []}

    def supabase_request(method, path, **kwargs):
        state["supabase_calls"].append((method, path, kwargs))
        return [], 200

    def cache_set(key, payload, **kwargs):
        state["cache_sets"].append((key, payload, kwargs))

    def fetch_seller_map(user_ids):
        state["seller_user_ids"].append(user_ids)
        return {}

    defaults = {
        "build_cache_key": lambda: "api-cache:/api/cars?",
        "cache_get": lambda _key: None,
        "cache_set": cache_set,
        "cached_json_response": _cached_json_response,
        "parse_pagination_args": lambda: (50, 0),
        "getenv": lambda _name: None,
        "reddit_on_explore": lambda: False,
        "should_hide_reddit": (
            lambda requesting_reddit, exclude_reddit, reddit_on_explore:
            not requesting_reddit and (exclude_reddit or not reddit_on_explore)
        ),
        "search_or_group": lambda _fields: None,
        "combine_or_groups": _combine_or_groups,
        "cursor_filter": lambda: None,
        "to_int": _to_int,
        "current_year": lambda: 2026,
        "minimum_year": 1886,
        "public_car_preview_select": PREVIEW_SELECT,
        "supabase_request": supabase_request,
        "filter_public_listing_records": lambda _table, rows: rows,
        "sort_listing_images": lambda images: sorted(
            images, key=lambda image: not image.get("is_primary", False)
        ),
        "batch_fetch_seller_map": fetch_seller_map,
        "apply_seller_to_listing": lambda item, _seller: item,
        "attach_page_headers": _attach_page_headers,
        "logger": logging.getLogger("car-read-parity"),
    }
    defaults.update(overrides)
    dependencies = CarReadDependencies(**defaults)
    view = register_car_read_route(app, dependencies=lambda: dependencies)
    return app, view, state


def test_cache_hit_returns_cached_payload_without_querying_supabase():
    cached_payload = [{"id": "cached-car"}]

    def unexpected_supabase_call(*_args, **_kwargs):
        raise AssertionError("cache hit must not query Supabase")

    app, view, state = _register_app(
        build_cache_key=lambda: "api-cache:/api/cars?limit=1",
        cache_get=lambda key: cached_payload
        if key == "api-cache:/api/cars?limit=1"
        else None,
        supabase_request=unexpected_supabase_call,
    )

    response = app.test_client().get("/api/cars?limit=1")

    assert app.view_functions["get_cars"] is view
    assert response.status_code == 200
    assert response.get_json() == cached_payload
    assert response.headers["Cache-Control"] == "no-store"
    assert "X-Has-More" not in response.headers
    assert state["cache_sets"] == []


def test_default_query_preserves_public_visibility_and_service_role_contract():
    app, _view, state = _register_app()

    response = app.test_client().get("/api/cars")

    assert response.status_code == 200
    assert response.get_json() == []
    assert state["supabase_calls"] == [
        (
            "get",
            "/rest/v1/cars",
            {
                "params": {
                    "select": PREVIEW_SELECT,
                    "limit": "50",
                    "offset": "0",
                    "order": "created_at.desc",
                    "status": "eq.approved",
                    "is_approved": "eq.true",
                    "or": "(source_platform.is.null,source_platform.neq.reddit)",
                },
                "use_service_role": True,
            },
        )
    ]
    assert state["cache_sets"] == [("api-cache:/api/cars?", [], {})]


def test_filters_search_cursor_and_extras_preserve_postgrest_mapping():
    app, _view, state = _register_app(
        search_or_group=lambda fields: (
            "listing_title.ilike.*coupe*,car_manufacturer.ilike.*coupe*,"
            "car_model.ilike.*coupe*,car_description.ilike.*coupe*"
            if fields
            == [
                "listing_title",
                "car_manufacturer",
                "car_model",
                "car_description",
            ]
            else None
        ),
        cursor_filter=lambda: ("created_at", "lt.2026-08-31T12:00:00Z"),
    )
    query = (
        "?q=coupe&car_manufacturer=BMW&price_from=10000&price_to=90000"
        "&make_year_from=2020&kilometer_to=40000"
        "&extras=Keyless%20Entry&extras=Rear%20View%20Camera"
        "&cursor=2026-08-31T12:00:00Z&_t=ignored&unknown=ignored"
    )

    response = app.test_client().get(f"/api/cars{query}")

    assert response.status_code == 200
    params = state["supabase_calls"][0][2]["params"]
    assert params == {
        "select": PREVIEW_SELECT,
        "limit": "50",
        "offset": "0",
        "order": "created_at.desc",
        "status": "eq.approved",
        "is_approved": "eq.true",
        "and": (
            "(or(source_platform.is.null,source_platform.neq.reddit),"
            "or(listing_title.ilike.*coupe*,car_manufacturer.ilike.*coupe*,"
            "car_model.ilike.*coupe*,car_description.ilike.*coupe*))"
        ),
        "created_at": "lt.2026-08-31T12:00:00Z",
        "car_manufacturer": "eq.BMW",
        "expected_selling_price": "lte.90000",
        "make_year": "gte.2020",
        "kilometer_driven": "lte.40000",
        "keyless_entry": "eq.true",
        "rear_view_camera": "eq.true",
    }


def test_reddit_preview_preserves_dedicated_feed_and_local_hidden_behavior():
    hide_calls = []

    def should_hide(requesting_reddit, exclude_reddit, reddit_on_explore):
        hide_calls.append((requesting_reddit, exclude_reddit, reddit_on_explore))
        return False

    app, _view, state = _register_app(
        getenv=lambda name: "1" if name == "LOCAL_SHOW_HIDDEN_REDDIT" else None,
        reddit_on_explore=lambda: True,
        should_hide_reddit=should_hide,
    )

    response = app.test_client().get("/api/cars?source_platform=reddit")

    assert response.status_code == 200
    params = state["supabase_calls"][0][2]["params"]
    assert params["source_platform"] == "eq.reddit"
    assert "is_approved" not in params
    assert "or" not in params
    assert "and" not in params
    assert hide_calls == [(True, False, True)]


@pytest.mark.parametrize("field", ["price_from", "kilometer_to", "make_year_from"])
def test_invalid_numeric_filters_preserve_400_error_envelope(field):
    app, _view, state = _register_app()

    response = app.test_client().get(f"/api/cars?{field}=not-a-number")

    assert response.status_code == 400
    assert response.get_json() == {
        "error": f"{field} must be a valid number",
        "data": [],
    }
    assert state["supabase_calls"] == []
    assert state["cache_sets"] == []


def test_supabase_errors_preserve_status_and_public_error_envelope():
    app, _view, state = _register_app(
        supabase_request=lambda *_args, **_kwargs: (
            {"message": "query rejected", "code": "PGRST100"},
            422,
        )
    )

    response = app.test_client().get("/api/cars")

    assert response.status_code == 422
    assert response.get_json() == {"error": "query rejected", "data": []}
    assert state["cache_sets"] == []


@pytest.mark.parametrize("supabase_payload", [None, {}, "unexpected"])
def test_empty_and_non_list_supabase_payloads_preserve_empty_list_response(
    supabase_payload,
):
    app, _view, state = _register_app(
        supabase_request=lambda *_args, **_kwargs: (supabase_payload, 200)
    )

    response = app.test_client().get("/api/cars")

    assert response.status_code == 200
    assert response.get_json() == []
    assert state["cache_sets"] == [("api-cache:/api/cars?", [], {})]


def test_image_normalization_preserves_aliases_sorting_and_primary_image():
    rows = [
        {
            "id": "car-1",
            "user_id": None,
            "created_at": "2026-09-01T12:00:00Z",
            "car_images": [
                {"id": "secondary", "url": "https://img/secondary.jpg"},
                {
                    "id": "primary",
                    "image_url": "https://img/primary.jpg",
                    "is_primary": True,
                },
            ],
        }
    ]
    app, _view, _state = _register_app(
        supabase_request=lambda *_args, **_kwargs: (rows, 200)
    )

    response = app.test_client().get("/api/cars")

    car = response.get_json()[0]
    assert "car_images" not in car
    assert car["images"] == [
        {
            "id": "primary",
            "image_url": "https://img/primary.jpg",
            "is_primary": True,
            "url": "https://img/primary.jpg",
        },
        {
            "id": "secondary",
            "image_url": "https://img/secondary.jpg",
            "url": "https://img/secondary.jpg",
        },
    ]
    assert car["primary_image_url"] == "https://img/primary.jpg"


def test_seller_enrichment_preserves_batched_lookup_and_response_fields():
    rows = [{"id": "car-1", "user_id": "seller-1", "car_images": []}]
    seller = {"id": "seller-1", "username": "seller_name"}
    seller_calls = []

    def fetch_sellers(user_ids):
        seller_calls.append(user_ids)
        return {"seller-1": seller}

    def apply_seller(car, seller_row):
        car["seller_name"] = seller_row["username"]
        car["seller_id"] = seller_row["id"]
        return car

    app, _view, _state = _register_app(
        supabase_request=lambda *_args, **_kwargs: (rows, 200),
        batch_fetch_seller_map=fetch_sellers,
        apply_seller_to_listing=apply_seller,
    )

    response = app.test_client().get("/api/cars")

    assert response.get_json()[0]["seller_name"] == "seller_name"
    assert response.get_json()[0]["seller_id"] == "seller-1"
    assert seller_calls == [["seller-1"]]


def test_page_headers_preserve_has_more_and_next_cursor_contract():
    rows = [
        {"id": "car-1", "created_at": "2026-09-01T12:00:00Z", "car_images": []},
        {"id": "car-2", "created_at": "2026-08-31T12:00:00Z", "car_images": []},
    ]
    app, _view, _state = _register_app(
        parse_pagination_args=lambda: (2, 0),
        supabase_request=lambda *_args, **_kwargs: (rows, 200),
    )

    response = app.test_client().get("/api/cars?limit=2")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "2026-08-31T12:00:00Z"


def test_unexpected_exceptions_preserve_500_error_envelope():
    def fail_cache_key():
        raise RuntimeError("unexpected failure")

    app, _view, _state = _register_app(build_cache_key=fail_cache_key)

    response = app.test_client().get("/api/cars")

    assert response.status_code == 500
    assert response.get_json() == {"error": "unexpected failure", "data": []}
