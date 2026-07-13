#!/usr/bin/env python3
import os
import sys
import json
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

import app as backend


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class SeoRouteTests(unittest.TestCase):
    def test_sitemap_xml_includes_public_pages_and_listings(self):
        def fake_get(url, headers=None, params=None, timeout=None):
            if "/rest/v1/cars" in url:
                return FakeResponse(
                    [
                        {
                            "id": "car-1",
                            "created_at": "2026-04-29T10:00:00Z",
                            "status": "approved",
                            "is_approved": True,
                        }
                    ]
                )
            if "/rest/v1/bikes" in url:
                return FakeResponse(
                    [
                        {
                            "id": "bike-1",
                            "created_at": "2026-04-29T11:00:00Z",
                            "status": "approved",
                            "is_approved": True,
                        }
                    ]
                )
            if "/rest/v1/car_parts" in url:
                return FakeResponse(
                    [
                        {
                            "id": "part-1",
                            "created_at": "2026-04-29T12:00:00Z",
                            "status": "approved",
                            "is_approved": True,
                        }
                    ]
                )
            if "/rest/v1/license_plates" in url:
                return FakeResponse(
                    [
                        {
                            "id": "plate-1",
                            "created_at": "2026-04-29T13:00:00Z",
                            "status": "approved",
                            "is_approved": True,
                        }
                    ]
                )
            return FakeResponse([])

        with patch.object(backend.requests, "get", side_effect=fake_get):
            with backend.app.test_request_context("/api/sitemap.xml"):
                response = backend.sitemap_xml()

        body = response.get_data(as_text=True)
        expected_base = backend.SITE_URL.rstrip("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(f"<loc>{expected_base}/</loc>", body)
        self.assertIn(f"<loc>{expected_base}/cars/car-1</loc>", body)
        self.assertIn(f"<loc>{expected_base}/bikes/bike-1</loc>", body)
        self.assertIn(f"<loc>{expected_base}/car-parts/part-1</loc>", body)
        self.assertIn(f"<loc>{expected_base}/plates/plate-1</loc>", body)

    def test_create_car_preserves_extras_array(self):
        captured = {}

        def fake_limit(_current_user):
            return None

        def fake_validate_description(*args, **kwargs):
            return None

        def fake_create_listing(_path, car_data, user_id=None):
            captured["car_data"] = dict(car_data)
            return ([{"id": "car-1"}], 201)

        def fake_supabase_request(method, path, data=None, params=None, user_id=None, use_service_role=False):
            if method == "post" and path == "/rest/v1/car_images":
                return ([{"id": "img-1"}], 201)
            return ([], 200)

        payload = {
            "car_manufacturer": "Toyota",
            "car_model": "Land Cruiser",
            "trim": "GXR",
            "make_year": 2024,
            "kilometer_driven": 5000,
            "body_type": "SUV",
            "is_insured": True,
            "expected_selling_price": 250000,
            "car_owner_phone_number": "501234567",
            "car_city": "Dubai",
            "listing_title": "2024 Toyota Land Cruiser",
            "car_description": "Excellent condition.",
            "fuel_type": "Petrol",
            "transmission_type": "Automatic",
            "seating_capacity": "7",
            "horsepower": "300-399",
            "engine_capacity": "3000cc-3999cc",
            "steering_side": "Left",
            "car_location": "Dubai",
            "area": "Marina",
            "vehicle_type": "Used",
            "country_code": "+971",
            "whatsapp_number": "+971501234567",
            "vin_number": "JTMZU09J0L1234567",
            "latitude": 25.2048,
            "longitude": 55.2708,
            "images": [{"image_url": "https://example.com/car.jpg"}],
            "extras": ["Climate Control", "Leather Seats"],
        }

        with patch.object(backend, "_enforce_listing_limit", side_effect=fake_limit), patch.object(
            backend, "_validate_description_word_count", side_effect=fake_validate_description
        ), patch.object(backend, "_create_listing_with_lifecycle_fallback", side_effect=fake_create_listing), patch.object(
            backend, "supabase_request", side_effect=fake_supabase_request
        ), patch.object(backend, "_require_verified_user_for_listing", return_value=None), patch.object(
            backend, "_sync_gate_error", return_value=None
        ):
            with backend.app.test_request_context("/api/cars", method="POST", json=payload):
                response = backend.create_car.__wrapped__("user-123")

        self.assertEqual(response[1], 201)
        self.assertIn("extras", captured["car_data"])
        self.assertEqual(captured["car_data"]["extras"], ["Climate Control", "Leather Seats"])
        self.assertTrue(captured["car_data"]["climate_control"])
        self.assertTrue(captured["car_data"]["leather_seats"])


if __name__ == "__main__":
    unittest.main()
