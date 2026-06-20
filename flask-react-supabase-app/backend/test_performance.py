import json
import unittest
from unittest.mock import patch, MagicMock

import app as backend


class TestGetCarsSellerJoin(unittest.TestCase):
    """get_cars() must resolve seller info without a second Supabase call."""

    def _make_car_row(self):
        return {
            "id": "car-1",
            "user_id": "user-1",
            "car_manufacturer": "Toyota",
            "car_model": "Camry",
            "trim": "SE",
            "make_year": 2022,
            "car_city": "Dubai",
            "expected_selling_price": 80000,
            "kilometer_driven": 20000,
            "car_description": "Good car",
            "created_at": "2030-01-01T00:00:00Z",
            "updated_at": "2030-01-01T00:00:00Z",
            "expires_at": "2030-12-31T00:00:00Z",
            "status": "approved",
            "is_approved": True,
            "view_count": 5,
            "lady_driven": False,
            "whatsapp_number": "+971501234567",
            "whatsapp_prefill_text": "",
            "vin_number": None,
            "users": {
                "id": "user-1",
                "username": "seller123",
                "first_name": "Ahmed",
                "last_name": "Al Mansoori",
                "profile_photo_url": None,
                "is_dealer": False,
            },
            "car_images": [],
        }

    def test_get_cars_uses_single_supabase_call(self):
        """After the fix, get_cars must not call _batch_fetch_seller_map."""
        car_row = self._make_car_row()

        with backend.app.test_request_context("/api/cars"):
            with patch.object(backend, "supabase_request", return_value=([car_row], 200)) as mock_supabase, \
                 patch.object(backend, "_api_cache_get", return_value=None), \
                 patch.object(backend, "_api_cache_set"), \
                 patch.object(backend, "_batch_fetch_seller_map") as mock_seller_map:

                response, status = backend.get_cars()

        self.assertEqual(status, 200)
        mock_seller_map.assert_not_called()
        data = json.loads(response.data)
        self.assertEqual(data[0]["seller_name"], "seller123")

    def test_get_cars_seller_fields_populated_from_joined_users(self):
        """Seller fields must be populated from the embedded users row."""
        car_row = self._make_car_row()

        with backend.app.test_request_context("/api/cars"):
            with patch.object(backend, "supabase_request", return_value=([car_row], 200)), \
                 patch.object(backend, "_api_cache_get", return_value=None), \
                 patch.object(backend, "_api_cache_set"):

                response, status = backend.get_cars()

        data = json.loads(response.data)
        car = data[0]
        self.assertEqual(car["seller_name"], "seller123")
        self.assertIn("seller_id", car)
        self.assertIn("seller_verified", car)
        self.assertNotIn("users", car)  # must be popped, not left in response


if __name__ == "__main__":
    unittest.main()
