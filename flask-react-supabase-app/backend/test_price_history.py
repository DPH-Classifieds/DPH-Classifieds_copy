"""Tests for the price-history endpoint + recorder. Supabase is mocked."""
import pytest
from unittest.mock import patch

import app as backend


@pytest.fixture
def client():
    return backend.app.test_client()


def _router(cars_row, history):
    """Build a supabase_request side_effect: routes GETs by path."""
    def _fn(method, path, *args, **kwargs):
        if path.startswith("/rest/v1/listing_price_history"):
            return history  # (body, status)
        if path.startswith("/rest/v1/cars") or path.startswith("/rest/v1/bikes") \
                or path.startswith("/rest/v1/license_plates") or path.startswith("/rest/v1/car_parts"):
            return cars_row
        return ([], 200)
    return _fn


def test_unknown_type_404(client):
    rv = client.get("/api/spaceships/abc/price-history")
    assert rv.status_code == 404


def test_unapproved_listing_404(client):
    with patch.object(backend, "supabase_request",
                      side_effect=_router(([{"expected_selling_price": 9, "is_approved": False}], 200), ([], 200))):
        rv = client.get("/api/cars/listing-1/price-history")
    assert rv.status_code == 404


def test_history_computes_analysis_and_appends_current(client):
    cars_row = ([{"expected_selling_price": 90000, "is_approved": True}], 200)
    history = ([{"price": 100000, "recorded_at": "t1", "source": "import"},
                {"price": 95000, "recorded_at": "t2", "source": "seller"}], 200)
    with patch.object(backend, "supabase_request", side_effect=_router(cars_row, history)):
        rv = client.get("/api/cars/listing-1/price-history")
    assert rv.status_code == 200
    body = rv.get_json()
    a = body["analysis"]
    assert a["first"] == 100000 and a["current"] == 90000
    assert a["min"] == 90000 and a["max"] == 100000
    assert a["change"] == -10000 and a["change_pct"] == -10.0
    assert a["points"] == 3  # two recorded + current appended
    assert body["points"][-1]["source"] == "current"


def test_missing_history_table_falls_back_to_current(client):
    cars_row = ([{"expected_selling_price": 50000, "is_approved": True}], 200)
    history = ([], 400)  # table absent / migration not applied
    with patch.object(backend, "supabase_request", side_effect=_router(cars_row, history)):
        rv = client.get("/api/cars/listing-1/price-history")
    assert rv.status_code == 200
    a = rv.get_json()["analysis"]
    assert a["points"] == 1 and a["current"] == 50000  # mobile hides single-point cards


def test_record_price_point_inserts_on_change():
    calls = []

    def _fn(method, path, *args, **kwargs):
        calls.append((method, path, kwargs.get("data")))
        if method == "get":
            return ([{"price": 100000}], 200)  # last recorded price
        return (None, 201)

    with patch.object(backend, "supabase_request", side_effect=_fn):
        backend._record_price_point("cars", "id1", 90000)
    posts = [c for c in calls if c[0] == "post" and "listing_price_history" in c[1]]
    assert len(posts) == 1 and posts[0][2]["price"] == 90000


def test_record_price_point_skips_when_unchanged():
    calls = []

    def _fn(method, path, *args, **kwargs):
        calls.append((method, path))
        return ([{"price": 90000}], 200)

    with patch.object(backend, "supabase_request", side_effect=_fn):
        backend._record_price_point("cars", "id1", 90000)
    assert not any(c[0] == "post" for c in calls)


def test_record_price_point_ignores_nonpositive():
    calls = []
    with patch.object(backend, "supabase_request", side_effect=lambda *a, **k: calls.append(a)):
        backend._record_price_point("cars", "id1", 0)
    assert calls == []
