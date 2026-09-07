"""Parity coverage for the extracted user statistics route."""

from types import SimpleNamespace
from unittest.mock import patch

import app as backend


def _response(payload, status=200):
    return SimpleNamespace(status_code=status, json=lambda: payload)


def test_user_statistics_filters_terminal_rows_and_preserves_dashboard_shape():
    def fake_get(url, **_kwargs):
        if "/cars?" in url:
            return _response([
                {"id": "car-1", "status": "approved", "view_count": 10},
                {"id": "car-2", "status": "pending", "view_count": 3},
                {"id": "car-3", "status": "sold", "view_count": 100},
            ])
        if "/bikes?" in url:
            return _response([{"id": "bike-1", "status": "approved", "view_count": 5}])
        if "/license_plates?" in url:
            return _response([{"id": "plate-1", "status": "rejected", "view_count": 99}])
        if "/car_parts?" in url:
            return _response([{"id": "part-1", "status": "draft"}])
        if "/users?" in url:
            return _response([{"created_at": "2026-01-02T00:00:00Z"}])
        raise AssertionError(f"unexpected statistics URL: {url}")

    with (
        backend.app.test_request_context("/api/user/statistics"),
        patch.object(backend.requests, "get", side_effect=fake_get),
        patch.object(backend, "_fetch_saved_listing_cards", return_value=({"total": 2}, 200)),
    ):
        payload, status = backend.get_user_statistics.__wrapped__("user-1")

    assert status == 200
    assert payload.get_json() == {
        "total_listings": 4,
        "active_listings": 2,
        "sold_listings": 0,
        "pending_listings": 1,
        "total_views": 18,
        "saved_count": 2,
        "member_since": "2026-01-02T00:00:00Z",
    }


def test_statistics_module_does_not_import_compatibility_root():
    source = (backend.__file__.replace("app.py", "routes/statistics.py"))
    assert "from app import" not in open(source, encoding="utf-8").read()
