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
        "images": ["https://example.com/ref.jpg"],
    }

    with app.test_client() as client:
        resp = client.post("/api/buying-requests", json=payload)

    assert resp.status_code == 400
    assert "up to 5" in (resp.get_json() or {}).get("error", "")
