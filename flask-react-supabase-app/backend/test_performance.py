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


class TestAdminAuthCaching(unittest.TestCase):
    """_require_admin_api_user must use Redis cache on repeat calls."""

    def _make_admin_user(self, user_id="admin-1"):
        return {
            "id": user_id,
            "email": "admin@example.com",
            "is_admin": True,
            "is_super_admin": False,
            "is_dealer": False,
            "dealer_verified": False,
            "email_verified": True,
            "phone_verified": False,
        }

    def test_second_call_uses_cache_and_skips_http(self):
        """On cache hit, _get_user_details_with_admin_status must not be called."""
        user_details = self._make_admin_user()
        redis_mock = MagicMock()
        redis_mock.get.return_value = json.dumps(user_details).encode()

        with patch.object(backend, "_get_redis_cache_client", return_value=redis_mock), \
             patch.object(backend, "_get_user_details_with_admin_status") as mock_details:

            result = backend._require_admin_api_user("admin-1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_admin"])
        mock_details.assert_not_called()

    def test_cache_miss_calls_supabase_then_stores_in_redis(self):
        """On cache miss, must call _get_user_details_with_admin_status and then cache."""
        user_details = self._make_admin_user()
        redis_mock = MagicMock()
        redis_mock.get.return_value = None  # cache miss

        with patch.object(backend, "_get_redis_cache_client", return_value=redis_mock), \
             patch.object(backend, "_get_user_details_with_admin_status", return_value=user_details):

            result = backend._require_admin_api_user("admin-1")

        self.assertIsNotNone(result)
        redis_mock.setex.assert_called_once()
        call_args = redis_mock.setex.call_args
        self.assertEqual(call_args[0][0], "admin-auth-status:admin-1")
        self.assertEqual(call_args[0][1], 300)

    def test_non_admin_user_not_cached(self):
        """Non-admin users must return None and must NOT be cached."""
        redis_mock = MagicMock()
        redis_mock.get.return_value = None

        with patch.object(backend, "_get_redis_cache_client", return_value=redis_mock), \
             patch.object(backend, "_get_user_details_with_admin_status", return_value={"id": "u1", "is_admin": False}):

            result = backend._require_admin_api_user("u1")

        self.assertIsNone(result)
        redis_mock.setex.assert_not_called()


class TestAdminListingsLimit(unittest.TestCase):
    """admin_listings_search must respect the limit param and default to 100."""

    def _admin_user(self):
        return {"id": "admin-1", "email": "a@b.com", "is_admin": True}

    def test_default_limit_is_100(self):
        """When no limit param given, Supabase query uses limit=100."""
        with backend.app.test_request_context("/api/admin/listings-search?types=cars"):
            with patch.object(backend, "_require_admin_api_user", return_value=self._admin_user()), \
                 patch.object(backend, "supabase_request", return_value=([], 200)) as mock_supabase, \
                 patch.object(backend, "_admin_fetch_latest_verification_scans", return_value={}):

                backend.admin_listings_search.__wrapped__("admin-1")

        call_params = mock_supabase.call_args_list[0][1]["params"]
        self.assertEqual(call_params["limit"], "100")

    def test_custom_limit_is_respected(self):
        """limit=25 in query string must be passed to Supabase."""
        with backend.app.test_request_context("/api/admin/listings-search?types=cars&limit=25"):
            with patch.object(backend, "_require_admin_api_user", return_value=self._admin_user()), \
                 patch.object(backend, "supabase_request", return_value=([], 200)) as mock_supabase, \
                 patch.object(backend, "_admin_fetch_latest_verification_scans", return_value={}):

                backend.admin_listings_search.__wrapped__("admin-1")

        call_params = mock_supabase.call_args_list[0][1]["params"]
        self.assertEqual(call_params["limit"], "25")

    def test_limit_capped_at_200(self):
        """limit=9999 must be capped at 200."""
        with backend.app.test_request_context("/api/admin/listings-search?types=cars&limit=9999"):
            with patch.object(backend, "_require_admin_api_user", return_value=self._admin_user()), \
                 patch.object(backend, "supabase_request", return_value=([], 200)) as mock_supabase, \
                 patch.object(backend, "_admin_fetch_latest_verification_scans", return_value={}):

                backend.admin_listings_search.__wrapped__("admin-1")

        call_params = mock_supabase.call_args_list[0][1]["params"]
        self.assertEqual(call_params["limit"], "200")


if __name__ == "__main__":
    unittest.main()
