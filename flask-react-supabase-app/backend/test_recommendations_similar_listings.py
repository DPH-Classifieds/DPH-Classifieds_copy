"""Regression check for /api/recommendations: it used to ignore the
listing_type/listing_id contract that both mobile and web call it with,
silently falling back to a cross-category "newest" feed with blank images
and every title reading literally "Listing". This exercises the real
listing_type + listing_id path end to end against a mocked Supabase layer.
"""
from unittest.mock import patch

import app as app_module

CAR_SOURCE = {
    "id": "car-1", "car_manufacturer": "Toyota", "car_model": "Camry",
    "make_year": 2021, "expected_selling_price": 100000,
}
CAR_SIMILAR = {
    "id": "car-2", "car_manufacturer": "Toyota", "car_model": "Corolla",
    "make_year": 2020, "expected_selling_price": 90000, "car_city": "Dubai",
    "created_at": "2026-01-02T00:00:00+00:00",
}
CAR_IMAGES = [{"car_id": "car-2", "display_url": "http://example.com/car-2.jpg", "is_primary": True}]


def _fake_supabase_request(method, path, params=None, **kwargs):
    if path == "/rest/v1/cars":
        param_keys = [p[0] for p in params] if isinstance(params, list) else list(params or {})
        if "is_approved" not in param_keys:
            return [CAR_SOURCE], 200  # source-listing price lookup
        return [CAR_SIMILAR], 200
    if path == "/rest/v1/car_images":
        return CAR_IMAGES, 200
    return [], 200


def test_recommendations_returns_similar_listing_card_for_listing_type_and_id():
    with app_module.app.test_request_context(
        "/api/recommendations",
        method="POST",
        json={"listing_type": "car", "listing_id": "car-1", "limit": 6},
    ), patch.object(app_module, "supabase_request", side_effect=_fake_supabase_request):
        resp = app_module.get_recommendations()
        cards = resp.get_json()["recommendations"]

    assert len(cards) == 1
    card = cards[0]
    assert card["id"] == "car-2"
    assert card["title"] == "2020 Toyota Corolla"
    assert card["priceLabel"] == "AED 90,000"
    assert card["image"] == "http://example.com/car-2.jpg"
    assert card["route"] == "/cars/car-2"


def test_recommendations_unknown_listing_type_returns_empty_list():
    with app_module.app.test_request_context(
        "/api/recommendations",
        method="POST",
        json={"listing_type": "spaceship", "listing_id": "x-1", "limit": 6},
    ), patch.object(app_module, "supabase_request", side_effect=_fake_supabase_request):
        resp = app_module.get_recommendations()
        assert resp.get_json()["recommendations"] == []
