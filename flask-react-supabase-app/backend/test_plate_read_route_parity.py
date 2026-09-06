import logging
from unittest.mock import patch
from urllib.parse import quote

import pytest
from flask import Flask, jsonify, make_response, request

import app as backend
from application.plate_read_routes import (
    PlateReadDependencies,
    register_plate_read_route,
)


PLATE_SELECT = (
    "id,user_id,city,code,digits,price,number,plate_format,description,"
    "contact_phone,contact_name,country_code,source_platform,source_url,status,"
    "is_approved,created_at,updated_at,expires_at,retention_expires_at,"
    "expired_at,is_archived,deleted_at,sold_status,sold_status_set_at,"
    "sold_response_deadline,last_extended_at"
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


def _register_app(**overrides):
    app = Flask(__name__)
    state = {
        "direct_calls": [],
        "cache_sets": [],
        "image_calls": [],
        "seller_calls": [],
    }

    def direct_get(url, **kwargs):
        state["direct_calls"].append((url, kwargs))
        return DirectResponse([])

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

    def fetch_plate_image_map(plate_ids, headers):
        state["image_calls"].append((plate_ids, headers))
        return {}

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
        "direct_get": direct_get,
        "filter_public_listing_records": filter_public_listing_records,
        "fetch_plate_image_map": fetch_plate_image_map,
        "batch_fetch_seller_map": batch_fetch_seller_map,
        "apply_seller_to_listing": lambda item, _seller: item,
        "attach_page_headers": lambda response, items, limit: _page_headers(
            response, items, limit
        ),
        "logger": logging.getLogger("plate-read-parity"),
    }
    defaults.update(overrides)
    dependencies = PlateReadDependencies(**defaults)
    view = register_plate_read_route(app, dependencies=lambda: dependencies)
    return app, view, state


def _page_headers(response, items, limit):
    response.headers["X-Has-More"] = "true" if len(items) >= limit else "false"
    if items:
        response.headers["X-Next-Cursor"] = str(items[-1].get("created_at") or "")
    return response


def test_route_preserves_public_path_methods_and_endpoint_name():
    app, view, _state = _register_app()

    rule = next(rule for rule in app.url_map.iter_rules() if rule.endpoint == "get_plates")

    assert app.view_functions["get_plates"] is view
    assert rule.rule == "/api/plates"
    assert rule.methods == {"GET", "HEAD", "OPTIONS"}


def test_cache_hit_returns_cached_payload_without_config_or_provider_calls():
    cached = [{"id": "cached-plate"}]
    app, _view, state = _register_app(
        cache_get=lambda _key: cached,
        supabase_url=lambda: (_ for _ in ()).throw(AssertionError("config accessed")),
        service_role_key=lambda: (_ for _ in ()).throw(
            AssertionError("config accessed")
        ),
    )

    response = app.test_client().get("/api/plates?limit=1")

    assert response.status_code == 200
    assert response.get_json() == cached
    assert response.headers["Cache-Control"] == "no-store"
    assert "X-Has-More" not in response.headers
    assert state["direct_calls"] == []
    assert state["cache_sets"] == []


def test_root_adapter_cache_hit_does_not_require_supabase_config(monkeypatch):
    cached = [{"id": "root-cached-plate"}]
    monkeypatch.delitem(backend.app.config, "SUPABASE_URL", raising=False)
    monkeypatch.delitem(
        backend.app.config, "SUPABASE_SERVICE_ROLE_KEY", raising=False
    )

    with (
        patch.object(backend, "_build_api_cache_key", return_value="plate-cache"),
        patch.object(backend, "_api_cache_get", return_value=cached),
        patch.object(
            backend.requests,
            "get",
            side_effect=AssertionError("cache hit must not call the provider"),
        ),
    ):
        response = backend.app.test_client().get("/api/plates")

    assert response.status_code == 200
    assert response.get_json() == cached


def test_default_query_preserves_visibility_order_select_headers_and_cache():
    app, _view, state = _register_app()

    response = app.test_client().get("/api/plates")

    assert response.status_code == 200
    assert response.get_json() == []
    assert response.headers["X-Has-More"] == "false"
    assert state["direct_calls"] == [
        (
            "https://supabase.test/rest/v1/license_plates?"
            "status=eq.approved&is_approved=eq.true&order=created_at.desc"
            "&or=(source_platform.is.null,source_platform.neq.reddit)"
            f"&limit=50&offset=0&select={PLATE_SELECT}",
            {
                "headers": {
                    "apikey": "service-role-key",
                    "Authorization": "Bearer service-role-key",
                    "Content-Type": "application/json",
                },
                "timeout": 10,
            },
        )
    ]
    assert state["image_calls"] == [([], state["direct_calls"][0][1]["headers"])]
    assert state["seller_calls"] == [([], state["direct_calls"][0][1]["headers"])]
    assert state["cache_sets"] == [("api-cache:/api/plates?", [], {})]


def test_filters_search_and_cursor_preserve_direct_postgrest_query():
    app, _view, state = _register_app(
        cursor_filter=lambda: ("created_at", "lt.2026-09-01T12:00:00Z")
    )
    query = (
        "?q=rare%207&city=Dubai&digits=2&code=A&area=Jumeirah"
        "&price_from=10000&price_to=90000&cursor=2026-09-01T12:00:00Z"
    )

    response = app.test_client().get(f"/api/plates{query}")

    assert response.status_code == 200
    url = state["direct_calls"][0][0]
    assert url == (
        "https://supabase.test/rest/v1/license_plates?"
        "status=eq.approved&is_approved=eq.true&order=created_at.desc"
        "&and=(or(source_platform.is.null,source_platform.neq.reddit),"
        "or(code.ilike.*rare%207*,number.ilike.*rare%207*,"
        "city.ilike.*rare%207*,description.ilike.*rare%207*))"
        "&created_at=lt.2026-09-01T12:00:00Z"
        "&city=eq.Dubai&digits=eq.2&code=eq.A&area=eq.Jumeirah"
        "&price=gte.10000&price=lte.90000"
        f"&limit=50&offset=0&select={PLATE_SELECT}"
    )


@pytest.mark.parametrize(
    ("local_hidden", "expected_approved"),
    [(None, True), ("1", False)],
)
def test_reddit_feed_preserves_source_and_hidden_visibility(local_hidden, expected_approved):
    app, _view, state = _register_app(
        getenv=lambda name: local_hidden
        if name == "LOCAL_SHOW_HIDDEN_REDDIT"
        else None
    )

    response = app.test_client().get("/api/plates?source_platform=reddit")

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

    visible_response = visible_app.test_client().get("/api/plates")
    excluded_response = excluded_app.test_client().get(
        "/api/plates?exclude_reddit=yes"
    )

    assert visible_response.status_code == 200
    assert "source_platform.is.null" not in visible_state["direct_calls"][0][0]
    assert excluded_response.status_code == 200
    assert "source_platform.is.null" in excluded_state["direct_calls"][0][0]


def test_image_map_main_fallback_seller_enrichment_and_response_fields():
    rows = [
        {
            "id": "mapped",
            "user_id": "seller-1",
            "created_at": "2026-09-02T12:00:00Z",
            "code": "A",
            "number": "7",
        },
        {
            "id": "fallback",
            "user_id": None,
            "created_at": "2026-09-01T12:00:00Z",
            "image_url": "https://img/main.jpg",
            "display_url": "https://img/display.jpg",
            "focal_x": 0.4,
            "focal_y": 0.6,
            "crop_meta": {"fit": "cover"},
        },
    ]
    mapped_image = {
        "id": "plate-image",
        "url": "https://img/mapped.jpg",
        "image_url": "https://img/mapped.jpg",
    }
    seller = {"id": "seller-1", "username": "plate_seller"}

    def apply_seller(plate, seller_row):
        if seller_row:
            plate["seller_name"] = seller_row["username"]
            plate["seller_id"] = seller_row["id"]
        return plate

    app, _view, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(rows),
        fetch_plate_image_map=lambda plate_ids, headers: (
            state["image_calls"].append((plate_ids, headers))
            or {"mapped": [mapped_image]}
        ),
        batch_fetch_seller_map=lambda user_ids, headers=None: (
            state["seller_calls"].append((user_ids, headers))
            or {"seller-1": seller}
        ),
        apply_seller_to_listing=apply_seller,
    )

    response = app.test_client().get("/api/plates?limit=2")

    assert response.status_code == 200
    mapped, fallback = response.get_json()
    assert mapped["images"] == [mapped_image]
    assert mapped["primary_image_url"] == "https://img/mapped.jpg"
    assert mapped["seller_name"] == "plate_seller"
    assert mapped["seller_id"] == "seller-1"
    assert fallback["images"] == [
        {
            "crop_meta": {"fit": "cover"},
            "display_url": "https://img/display.jpg",
            "focal_x": 0.4,
            "focal_y": 0.6,
            "id": "main",
            "image_url": "https://img/main.jpg",
            "url": "https://img/main.jpg",
        }
    ]
    assert fallback["primary_image_url"] == "https://img/main.jpg"
    assert state["image_calls"][0][0] == ["mapped", "fallback"]
    assert state["seller_calls"][0][0] == ["seller-1", None]


@pytest.mark.parametrize("payload", [None, {}, "unexpected"])
def test_malformed_provider_payload_preserves_empty_success_and_page_headers(payload):
    app, _view, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(payload)
    )

    response = app.test_client().get("/api/plates")

    assert response.status_code == 200
    assert response.get_json() == []
    assert response.headers["X-Has-More"] == "false"
    assert state["cache_sets"] == [("api-cache:/api/plates?", [], {})]


def test_provider_failure_preserves_cached_empty_success_without_page_headers():
    app, _view, state = _register_app(
        direct_get=lambda *_args, **_kwargs: DirectResponse(
            {"message": "unavailable"}, 503, "unavailable"
        )
    )

    response = app.test_client().get("/api/plates")

    assert response.status_code == 200
    assert response.get_json() == []
    assert response.headers["Cache-Control"] == "no-store"
    assert "X-Has-More" not in response.headers
    assert state["cache_sets"] == [("api-cache:/api/plates?", [], {})]
    assert state["image_calls"] == []
    assert state["seller_calls"] == []


def test_provider_exception_preserves_cached_empty_success():
    app, _view, state = _register_app(
        direct_get=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("provider unavailable")
        )
    )

    response = app.test_client().get("/api/plates")

    assert response.status_code == 200
    assert response.get_json() == []
    assert state["cache_sets"] == [("api-cache:/api/plates?", [], {})]


def test_page_headers_preserve_has_more_and_next_cursor_contract():
    rows = [
        {"id": "plate-1", "created_at": "2026-09-02T12:00:00Z"},
        {"id": "plate-2", "created_at": "2026-09-01T12:00:00Z"},
    ]
    app, _view, _state = _register_app(
        parse_pagination_args=lambda: (2, 0),
        direct_get=lambda *_args, **_kwargs: DirectResponse(rows),
    )

    response = app.test_client().get("/api/plates?limit=2")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Has-More"] == "true"
    assert response.headers["X-Next-Cursor"] == "2026-09-01T12:00:00Z"


def test_existing_plate_detail_keeps_fetch_plate_image_map_seam(monkeypatch):
    plate = {
        "id": "detail-plate",
        "user_id": None,
        "status": "approved",
        "is_approved": True,
    }
    image = {"id": "detail-image", "image_url": "https://img/detail.jpg"}
    provider_response = DirectResponse([plate])
    monkeypatch.setitem(backend.app.config, "SUPABASE_URL", "https://supabase.test")
    monkeypatch.setitem(
        backend.app.config, "SUPABASE_SERVICE_ROLE_KEY", "service-role-key"
    )

    with (
        backend.app.test_request_context("/api/plates/detail-plate"),
        patch.object(backend, "_api_cache_get", return_value=None),
        patch.object(backend.requests, "get", return_value=provider_response),
        patch.object(
            backend,
            "_fetch_plate_image_map",
            return_value={"detail-plate": [image]},
        ) as image_map,
    ):
        response = backend.get_plate_details("detail-plate")

    assert response.status_code == 200
    assert response.get_json()["images"] == [image]
    image_map.assert_called_once_with(
        ["detail-plate"],
        {
            "apikey": "service-role-key",
            "Authorization": "Bearer service-role-key",
        },
    )
