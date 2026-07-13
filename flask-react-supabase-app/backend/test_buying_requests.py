import importlib
from unittest.mock import patch

import app as backend
from flask import Flask


def _passthrough_token_required(fn):
    def wrapped(*args, **kwargs):
        return fn("user-123", *args, **kwargs)

    wrapped.__name__ = getattr(fn, "__name__", "wrapped")
    return wrapped


def test_buying_requests_limit_5(monkeypatch):
    with patch.object(backend, "token_required", new=lambda f: _passthrough_token_required(f)):
        mod = importlib.import_module("routes.buying_requests")
        importlib.reload(mod)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(mod.buying_requests_bp)

    def fake_supabase_request(method, path, params=None, data=None, user_id=None, **kwargs):
        if method == "get" and path == "/rest/v1/buying_requests" and params and str(
            params.get("user_id") or ""
        ).startswith("eq."):
            return ([{"id": "req"}] * 5, 200)
        return ([], 200)

    monkeypatch.setattr(mod, "supabase_request", fake_supabase_request)
    monkeypatch.setattr(
        mod,
        "_create_listing_with_lifecycle_fallback",
        lambda *a, **k: ([{"id": "new"}], 201),
    )
    monkeypatch.setattr(mod, "get_user_email", lambda *_: "user@example.com")

    payload = {
        "item_type": "car",
        "item_name": "BMW M3 wanted",
        "mileage_preference": "< 80,000 km",
        "regional_spec": "GCC",
        "images": [
            "https://example.com/ref-1.jpg",
            "https://example.com/ref-2.jpg",
            "https://example.com/ref-3.jpg",
        ],
    }

    with app.test_client() as client:
        resp = client.post("/api/buying-requests", json=payload)

    assert resp.status_code == 400
    assert "up to 5" in (resp.get_json() or {}).get("error", "")


def test_buying_requests_list_includes_preview_image(monkeypatch):
    with patch.object(backend, "token_required", new=lambda f: _passthrough_token_required(f)):
        mod = importlib.import_module("routes.buying_requests")
        importlib.reload(mod)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(mod.buying_requests_bp)

    def fake_supabase_request(method, path, params=None, data=None, user_id=None, **kwargs):
        if method == "get" and path == "/rest/v1/buying_requests":
            return ([{"id": "req-1", "item_name": "BMW X5 wanted"}], 200)
        if method == "get" and path == "/rest/v1/buying_request_images":
            return (
                [
                    {
                        "id": "img-1",
                        "buying_request_id": "req-1",
                        "display_url": "https://example.com/ref.jpg",
                        "image_url": "https://example.com/ref.jpg",
                        "url": "https://example.com/ref.jpg",
                    }
                ],
                200,
            )
        return ([], 200)

    monkeypatch.setattr(mod, "supabase_request", fake_supabase_request)

    with app.test_client() as client:
        resp = client.get("/api/buying-requests")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload[0]["images"][0]["display_url"] == "https://example.com/ref.jpg"


def test_buying_requests_require_three_images(monkeypatch):
    with patch.object(backend, "token_required", new=lambda f: _passthrough_token_required(f)):
        mod = importlib.import_module("routes.buying_requests")
        importlib.reload(mod)

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(mod.buying_requests_bp)

    with app.test_client() as client:
        resp = client.post(
            "/api/buying-requests",
            json={
                "item_type": "car",
                "item_name": "BMW X5 wanted",
                "mileage_preference": "under 80,000 km",
                "regional_spec": "GCC",
                "images": ["https://example.com/ref-1.jpg", "https://example.com/ref-2.jpg"],
            },
        )

    assert resp.status_code == 400
    assert "3 reference images" in (resp.get_json() or {}).get("error", "")
