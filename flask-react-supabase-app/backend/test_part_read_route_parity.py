import logging
from unittest.mock import patch
from urllib.parse import quote

import pytest
from flask import Flask, jsonify, make_response, request

import app as backend
from application.part_read_routes import (
    PartReadDependencies,
    register_part_read_route,
)


IMAGE_SELECT = (
    "id,part_id,image_url,url,display_url,focal_x,focal_y,crop_meta,"
    "uploaded_at,is_primary"
)
PART_SELECT_PREFIX = (
    "id,user_id,name,part_type,condition,price,location,area,emirate,"
    "description,contact_number,country_code,"
)
PART_SELECT_SUFFIX = (
    "status,is_approved,created_at,updated_at,compatible_makes,compatible_models,"
    "compatible_years,expires_at,retention_expires_at,expired_at,is_archived,"
    "deleted_at,sold_status,sold_status_set_at,sold_response_deadline,"
    "last_extended_at,"
)
DIRECT_PART_SELECT = (
    PART_SELECT_PREFIX
    + "source_platform,source_url,"
    + PART_SELECT_SUFFIX
    + f"part_images({IMAGE_SELECT})"
)
FALLBACK_PART_SELECT = (
    PART_SELECT_PREFIX + PART_SELECT_SUFFIX + f"part_images({IMAGE_SELECT})"
)


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


def _page_headers(response, items, limit):
    response.headers["X-Has-More"] = "true" if len(items) >= limit else "false"
    if items:
        response.headers["X-Next-Cursor"] = str(items[-1].get("created_at") or "")
    return response


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
        if not isinstance(records, list):
            return []
        return [dict(row) for row in records if isinstance(row, dict)]

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
        "supabase_url": lambda: "https://supabase.test",
        "service_role_key": lambda: "service-role-key",
        "listing_image_select": IMAGE_SELECT,
        "direct_get": direct_get,
        "supabase_request": supabase_request,
        "filter_public_listing_records": filter_public_listing_records,
        "batch_fetch_seller_map": batch_fetch_seller_map,
        "apply_seller_to_listing": lambda item, _seller: item,
        "attach_page_headers": _page_headers,
        "logger": logging.getLogger("part-read-parity"),
    }
    defaults.update(overrides)
    dependencies = PartReadDependencies(**defaults)
    view = register_part_read_route(app, dependencies=lambda: dependencies)
    return app, view, state


def test_route_preserves_public_path_methods_and_endpoint_name():
    app, view, _state = _register_app()

    rule = next(rule for rule in app.url_map.iter_rules() if rule.endpoint == "get_parts")

    assert app.view_functions["get_parts"] is view
    assert rule.rule == "/api/parts"
    assert rule.methods == {"GET", "HEAD", "OPTIONS"}


def test_root_registration_preserves_duplicate_collection_options_manifest():
    rules = [rule for rule in backend.app.url_map.iter_rules() if rule.rule == "/api/parts"]
    get_rule = next(rule for rule in rules if rule.endpoint == "get_parts")

    assert get_rule.methods == {"GET", "HEAD", "OPTIONS"}
    assert sum("OPTIONS" in rule.methods for rule in rules) == 2


def test_cache_hit_returns_cached_payload_without_config_or_provider_calls():
    cached = [{"id": "cached-part"}]
    app, _view, state = _register_app(
        cache_get=lambda _key: cached,
        supabase_url=lambda: (_ for _ in ()).throw(AssertionError("config accessed")),
        service_role_key=lambda: (_ for _ in ()).throw(
            AssertionError("config accessed")
        ),
    )

    response = app.test_client().get("/api/parts?limit=1")

    assert response.status_code == 200
    assert response.get_json() == cached
    assert response.headers["Cache-Control"] == "no-store"
    assert "X-Has-More" not in response.headers
    assert state["direct_calls"] == []
    assert state["supabase_calls"] == []
    assert state["cache_sets"] == []


def test_root_adapter_cache_hit_does_not_require_supabase_config(monkeypatch):
    cached = [{"id": "root-cached-part"}]
    monkeypatch.delitem(backend.app.config, "SUPABASE_URL", raising=False)
    monkeypatch.delitem(
        backend.app.config, "SUPABASE_SERVICE_ROLE_KEY", raising=False
    )

    with (
        patch.object(backend, "_build_api_cache_key", return_value="part-cache"),
        patch.object(backend, "_api_cache_get", return_value=cached),
        patch.object(
            backend.requests,
            "get",
            side_effect=AssertionError("cache hit must not call the provider"),
        ),
        patch.object(
            backend,
            "supabase_request",
            side_effect=AssertionError("cache hit must not call Supabase"),
        ),
    ):
        response = backend.app.test_client().get("/api/parts")

    assert response.status_code == 200
    assert response.get_json() == cached


def test_default_query_preserves_visibility_order_select_headers_and_cache():
    app, _view, state = _register_app()

    response = app.test_client().get("/api/parts")

    assert response.status_code == 200
    assert response.get_json() == []
    assert response.headers["X-Has-More"] == "false"
    assert state["supabase_calls"] == []
    assert state["direct_calls"] == [
        (
            "https://supabase.test/rest/v1/car_parts?limit=50&offset=0"
            "&order=created_at&status=eq.approved&is_approved=eq.true"
            "&or=(source_platform.is.null,source_platform.neq.reddit)"
            f"&select={DIRECT_PART_SELECT}",
            {
                "headers": {
                    "apikey": "service-role-key",
                    "Authorization": "Bearer service-role-key",
                    "Content-Type": "application/json",
                }
            },
        )
    ]
    assert state["cache_sets"] == [("api-cache:/api/parts?", [], {})]


def test_filters_search_and_cursor_preserve_direct_postgrest_query():
    app, _view, state = _register_app(
        cursor_filter=lambda: ("created_at", "lt.2026-09-01T12:00:00Z")
    )
    query = (
        "?q=rare%20wheel&condition=Used&part_type=Wheels&area=Dubai"
        "&price_from=100&price_to=5000&cursor=2026-09-01T12:00:00Z"
    )

    response = app.test_client().get(f"/api/parts{query}")

    assert response.status_code == 200
    assert state["direct_calls"][0][0] == (
        "https://supabase.test/rest/v1/car_parts?limit=50&offset=0"
        "&order=created_at&status=eq.approved&is_approved=eq.true"
        "&and=(or(source_platform.is.null,source_platform.neq.reddit),"
        "or(name.ilike.*rare%20wheel*,part_type.ilike.*rare%20wheel*,"
        "description.ilike.*rare%20wheel*))"
        "&created_at=lt.2026-09-01T12:00:00Z&condition=eq.Used"
        "&part_type=eq.Wheels&area=eq.Dubai&price=gte.100&price=lte.5000"
        f"&select={DIRECT_PART_SELECT}"
    )


@pytest.mark.parametrize(
    ("local_hidden", "expected_approved"),
    [(None, True), ("1", False)],
)
def test_reddit_feed_preserves_source_and_hidden_visibility(
    local_hidden, expected_approved
):
    app, _view, state = _register_app(
        getenv=lambda name: local_hidden
        if name == "LOCAL_SHOW_HIDDEN_REDDIT"
        else None
    )

    response = app.test_client().get("/api/parts?source_platform=reddit")

    assert response.status_code == 200
    url = state["direct_calls"][0][0]
    assert "source_platform=eq.reddit" in url
    assert ("is_approved=eq.true" in url) is expected_approved
    assert "source_platform.is.null" not in url


def test_explore_reddit_visibility_and_explicit_exclusion_preserve_precedence():
    visible_app, _view, visible_state = _register_app(reddit_on_explore=lambda: True)
    excluded_app, _view, excluded_state = _register_app(
        reddit_on_explore=lambda: True
    )

    visible_response = visible_app.test_client().get("/api/parts")
    excluded_response = excluded_app.test_client().get(
        "/api/parts?exclude_reddit=yes"
    )

    assert visible_response.status_code == 200
    assert "source_platform.is.null" not in visible_state["direct_calls"][0][0]
    assert excluded_response.status_code == 200
    assert "source_platform.is.null" in excluded_state["direct_calls"][0][0]


def test_direct_success_preserves_image_and_seller_normalization():
    rows = [
        {
            "id": "joined-images",
            "user_id": "seller-1",
            "part_images": [
                {"id": "url-only", "url": "https://img/url.jpg"},
                {
                    "id": "image-only",
                    "image_url": "https://img/image.jpg",
                    "display_url": "https://img/display.jpg",
                    "focal_x": 0.4,
                    "focal_y": 0.6,
                    "crop_meta": {"fit": "cover"},
                },
                {"id": "missing-url"},
            ],
        },
        {
            "id": "main-fallback",
            "user_id": None,
            "part_images": [],
            "image_url": "https://img/main.jpg",
            "display_url": "https://img/main-display.jpg",
        },
    ]
    seller = {"id": "seller-1", "username": "seller_name"}

    def fetch_sellers(user_ids, headers=None):
        assert user_ids == ["seller-1", None]
        assert headers["Authorization"] == "Bearer service-role-key"
        return {"seller-1": seller}

    def apply_seller(part, seller_row):
        if seller_row:
            part["seller_name"] = seller_row["username"]
            part["seller_id"] = seller_row["id"]
        return part

    app, _view, _state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(rows),
        batch_fetch_seller_map=fetch_sellers,
        apply_seller_to_listing=apply_seller,
    )

    response = app.test_client().get("/api/parts")

    assert response.status_code == 200
    joined, fallback = response.get_json()
    assert "part_images" not in joined
    assert joined["images"] == [
        {
            "crop_meta": None,
            "display_url": None,
            "focal_x": None,
            "focal_y": None,
            "id": "url-only",
            "image_url": "https://img/url.jpg",
            "url": "https://img/url.jpg",
        },
        {
            "crop_meta": {"fit": "cover"},
            "display_url": "https://img/display.jpg",
            "focal_x": 0.4,
            "focal_y": 0.6,
            "id": "image-only",
            "image_url": "https://img/image.jpg",
            "url": "https://img/image.jpg",
        },
    ]
    assert joined["primary_image_url"] == "https://img/url.jpg"
    assert joined["seller_name"] == "seller_name"
    assert joined["seller_id"] == "seller-1"
    assert fallback["images"] == [
        {
            "crop_meta": None,
            "display_url": "https://img/main-display.jpg",
            "focal_x": None,
            "focal_y": None,
            "id": "main",
            "image_url": "https://img/main.jpg",
            "url": "https://img/main.jpg",
        }
    ]
    assert fallback["primary_image_url"] == "https://img/main.jpg"


def test_null_direct_image_join_preserves_fallback_and_null_coercion():
    direct_row = {"id": "direct-null", "user_id": None, "part_images": None}
    fallback_row = {"id": "fallback-null", "user_id": None, "part_images": None}
    app, _view, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse([direct_row]),
        supabase_request=lambda method, path, **kwargs: (
            state["supabase_calls"].append((method, path, kwargs))
            or ([fallback_row], 200)
        ),
    )

    response = app.test_client().get("/api/parts")

    assert response.status_code == 200
    assert response.get_json() == [
        {
            "id": "fallback-null",
            "images": [],
            "primary_image_url": None,
            "user_id": None,
        }
    ]
    assert len(state["supabase_calls"]) == 1


def test_direct_failure_preserves_fallback_query_encoding_and_existing_range_quirk():
    row = {"id": "fallback-part", "user_id": None, "part_images": []}
    app, _view, state = _register_app(
        cursor_filter=lambda: ("created_at", "lt.2026-09-01T12:00:00Z"),
        direct_get=lambda *_args, **_kwargs: DirectResponse(
            {"message": "unavailable"}, 503, "unavailable"
        ),
        supabase_request=lambda method, path, **kwargs: (
            state["supabase_calls"].append((method, path, kwargs)) or ([row], 200)
        ),
    )

    response = app.test_client().get(
        "/api/parts?q=rare%20wheel&condition=Used&part_type=Wheels&area=Dubai"
        "&price_from=100&price_to=5000&cursor=2026-09-01T12:00:00Z"
    )

    assert response.status_code == 200
    assert response.get_json()[0]["id"] == "fallback-part"
    method, path, kwargs = state["supabase_calls"][0]
    assert (method, path, kwargs["use_service_role"]) == (
        "get",
        "/rest/v1/car_parts",
        True,
    )
    assert kwargs["params"] == {
        "limit": 50,
        "offset": 0,
        "order": "created_at",
        "status": "eq.approved",
        "is_approved": "eq.true",
        "and": (
            "(or(source_platform.is.null,source_platform.neq.reddit),"
            "or(name.ilike.*rare wheel*,part_type.ilike.*rare wheel*,"
            "description.ilike.*rare wheel*))"
        ),
        "created_at": "lt.2026-09-01T12:00:00Z",
        "condition": "eq.Used",
        "part_type": "eq.Wheels",
        "area": "eq.Dubai",
        "price": "lte.5000",
        "select": FALLBACK_PART_SELECT,
    }


@pytest.mark.parametrize(
    ("payload", "status"),
    [(None, 200), ([], 200), ({"error": "down"}, 503)],
)
def test_fallback_empty_and_error_payloads_preserve_cached_empty_success(
    payload, status
):
    app, _view, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(None, 503),
        supabase_request=lambda *_args, **_kwargs: (payload, status),
    )

    response = app.test_client().get("/api/parts")

    assert response.status_code == 200
    assert response.get_json() == []
    assert "X-Has-More" not in response.headers
    assert state["cache_sets"] == [("api-cache:/api/parts?", [], {})]


def test_malformed_fallback_image_join_preserves_public_500_error():
    row = {"id": "malformed", "user_id": None, "part_images": {"id": "bad"}}
    app, _view, _state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(None, 503),
        supabase_request=lambda *_args, **_kwargs: ([row], 200),
    )

    response = app.test_client().get("/api/parts")

    assert response.status_code == 500
    assert response.get_json() == {"error": "'str' object has no attribute 'get'"}


def test_root_adapter_missing_url_preserves_supabase_fallback(monkeypatch):
    fallback_row = {
        "id": "root-fallback-part",
        "user_id": None,
        "status": "approved",
        "is_approved": True,
        "part_images": None,
    }
    monkeypatch.delitem(backend.app.config, "SUPABASE_URL", raising=False)
    monkeypatch.setitem(
        backend.app.config, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key"
    )

    def fallback_request(method, path, **kwargs):
        if (
            method == "get"
            and path == "/rest/v1/car_parts"
            and kwargs.get("use_service_role") is True
        ):
            return [fallback_row], 200
        raise AssertionError(f"unexpected Supabase call: {method} {path} {kwargs}")

    with (
        patch.object(backend, "_api_cache_get", return_value=None),
        patch.object(backend, "_api_cache_set"),
        patch.object(backend, "supabase_request", side_effect=fallback_request),
        patch.object(
            backend.requests,
            "get",
            side_effect=AssertionError("missing URL must fall back before HTTP"),
        ),
    ):
        response = backend.app.test_client().get("/api/parts")

    assert response.status_code == 200
    assert response.get_json()[0]["id"] == "root-fallback-part"
    assert response.get_json()[0]["images"] == []


def test_page_headers_preserve_has_more_and_next_cursor_contract():
    rows = [
        {
            "id": "part-1",
            "created_at": "2026-09-02T12:00:00Z",
            "part_images": [],
        },
        {
            "id": "part-2",
            "created_at": "2026-09-01T12:00:00Z",
            "part_images": [],
        },
    ]
    app, _view, _state = _register_app(
        parse_pagination_args=lambda: (2, 0),
        direct_get=lambda *_args, **_kwargs: DirectResponse(rows),
    )

    response = app.test_client().get("/api/parts?limit=2")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "2026-09-01T12:00:00Z"


def test_unexpected_errors_preserve_error_500_envelope():
    app, _view, state = _register_app(
        build_cache_key=lambda: (_ for _ in ()).throw(RuntimeError("cache failed"))
    )

    response = app.test_client().get("/api/parts")

    assert response.status_code == 500
    assert response.get_json() == {"error": "cache failed"}
    assert state["direct_calls"] == []
