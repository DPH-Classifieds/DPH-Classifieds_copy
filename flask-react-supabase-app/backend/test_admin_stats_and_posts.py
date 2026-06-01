import unittest
from unittest.mock import Mock, patch

import app as backend


class AdminStatsTests(unittest.TestCase):
    def test_admin_stats_includes_visitor_counts(self):
        fixed_now = backend._utc_now()
        now_iso = backend._isoformat_utc(fixed_now)

        platform_events = [
            {"visitor_id": "visitor-1", "created_at": now_iso},
            {"visitor_id": "visitor-2", "created_at": now_iso},
            {"visitor_id": "visitor-1", "created_at": now_iso},
        ]
        lead_events = [
            {"action": "call_click", "created_at": now_iso},
            {"action": "whatsapp_click", "created_at": now_iso},
        ]
        reports = [{"id": "report-1"}, {"id": "report-2"}]
        cars = [{"status": "pending", "view_count": 3}]
        bikes = [{"status": "approved", "view_count": 4}]
        parts = [{"status": "pending", "view_count": 5}]
        plates = [{"status": "pending", "view_count": 6}]
        users = [
            {"id": "u1", "is_dealer": True},
            {"id": "u2", "is_dealer": False},
            {"id": "u3", "is_dealer": False},
        ]

        def fake_supabase_request(method, path, params=None, data=None, user_id=None, use_service_role=False):
            if path == "/rest/v1/platform_events":
                return platform_events, 200
            if path == "/rest/v1/lead_events":
                return lead_events, 200
            if path == "/rest/v1/reports":
                return reports, 200
            if path == "/rest/v1/cars":
                return cars, 200
            if path == "/rest/v1/bikes":
                return bikes, 200
            if path == "/rest/v1/car_parts":
                return parts, 200
            if path == "/rest/v1/license_plates":
                return plates, 200
            if path == "/rest/v1/users":
                return users, 200
            return [], 200

        with backend.app.test_request_context("/api/admin/stats?days=30"):
            with patch.object(backend, "_require_admin_api_user", return_value=True):
                with patch.object(backend, "supabase_request", side_effect=fake_supabase_request):
                    response, status = backend.get_admin_stats.__wrapped__("admin-1")

        self.assertEqual(status, 200)
        payload = response.get_json()
        self.assertEqual(payload["unique_visitors"], 2)
        self.assertEqual(payload["live_users"], 2)
        self.assertEqual(payload["cars_pending"], 1)
        self.assertEqual(payload["parts_pending"], 1)
        self.assertEqual(payload["plates_pending"], 1)
        self.assertEqual(payload["total_users"], 3)
        self.assertEqual(payload["total_reports"], 2)
        self.assertEqual(payload["total_calls"], 1)
        self.assertEqual(payload["total_whatsapp"], 1)
        self.assertEqual(payload["total_dealers"], 1)


class PostListingSmokeTests(unittest.TestCase):
    def setUp(self):
        self.supabase_patch = patch.object(backend, "supabase_request")
        self.get_email_patch = patch.object(backend, "get_user_email", return_value="poster@example.com")
        self.email_by_id_patch = patch.object(
            backend,
            "_get_user_email_by_id",
            return_value={"email": "poster@example.com"},
        )
        self.notify_admin_patch = patch.object(backend, "_send_new_listing_admin_notification", return_value=(None, None))
        self.notify_user_patch = patch.object(backend, "_send_new_listing_user_confirmation", return_value=(None, None))
        self.dealer_patch = patch.object(backend, "_require_dealer_verified", return_value=None)
        self.whatsapp_patch = patch.object(backend, "_require_whatsapp_prefill_and_phone_alignment", return_value=None)
        self.validation_patch = patch.object(backend, "_validate_description_word_count", return_value=None)
        self.profanity_patch = patch.object(backend, "_validate_no_profanity", return_value=None)

        self.supabase_request = self.supabase_patch.start()
        self.get_email_patch.start()
        self.email_by_id_patch.start()
        self.notify_admin_patch.start()
        self.notify_user_patch.start()
        self.dealer_patch.start()
        self.whatsapp_patch.start()
        self.validation_patch.start()
        self.profanity_patch.start()

        self.addCleanup(self.supabase_patch.stop)
        self.addCleanup(self.get_email_patch.stop)
        self.addCleanup(self.email_by_id_patch.stop)
        self.addCleanup(self.notify_admin_patch.stop)
        self.addCleanup(self.notify_user_patch.stop)
        self.addCleanup(self.dealer_patch.stop)
        self.addCleanup(self.whatsapp_patch.stop)
        self.addCleanup(self.validation_patch.stop)
        self.addCleanup(self.profanity_patch.stop)

    def test_post_plate_payload_succeeds(self):
        image_mock = Mock()
        image_mock.save = Mock()
        draw_mock = Mock()
        draw_mock.textlength.return_value = 120

        def fake_supabase_request(method, path, params=None, data=None, user_id=None, use_service_role=False):
            if method == "post" and path == "/rest/v1/license_plates":
                return ([{"id": "plate-1"}], 201)
            if method == "post" and path == "/rest/v1/plate_images":
                return ([{"id": "plate-image-1"}], 201)
            return ([], 200)

        self.supabase_request.side_effect = fake_supabase_request

        payload = {
            "city": "Dubai",
            "code": "A",
            "digits": 3,
            "price": 12000,
            "number": "123",
            "plate_format": "Any format",
            "contact_name": "Tester",
            "contact_phone": "+971501234567",
            "country_code": "+971",
            "whatsapp_number": "+971501234567",
            "whatsapp_prefill_text": "Hello",
            "description": "Nice plate",
            "area": "Downtown",
            "emirate": "Dubai",
            "images": [],
            "is_dealer": False,
        }

        with patch("PIL.Image.new", return_value=image_mock), patch("PIL.ImageDraw.Draw", return_value=draw_mock), patch("PIL.ImageFont.truetype", return_value=Mock()), patch("os.makedirs", return_value=None):
            with backend.app.test_request_context("/api/plates", method="POST", json=payload):
                response, status = backend._create_plate_with_image_impl("user-123")

        self.assertEqual(status, 201)
        self.assertEqual(response.get_json()["id"], "plate-1")

    def test_post_part_payload_succeeds(self):
        def fake_supabase_request(method, path, params=None, data=None, user_id=None, use_service_role=False):
            if method == "post" and path == "/rest/v1/car_parts":
                return ([{"id": "part-1"}], 201)
            if method == "post" and path == "/rest/v1/part_images":
                return ([{"id": "part-image-1"}], 201)
            return ([], 200)

        self.supabase_request.side_effect = fake_supabase_request

        payload = {
            "name": "Brake pads",
            "part_type": "Brakes",
            "condition": "New",
            "compatible_makes": ["Toyota"],
            "compatible_models": ["Land Cruiser"],
            "compatible_years": ["2018-2024"],
            "price": 250,
            "location": "Dubai",
            "area": "Downtown",
            "emirate": "Dubai",
            "contact_number": "+971501234567",
            "country_code": "+971",
            "whatsapp_number": "+971501234567",
            "whatsapp_prefill_text": "Hello",
            "description": "New brake pads",
            "is_negotiable": False,
            "is_dealer": False,
            "images": ["https://example.com/part.jpg"],
        }

        with backend.app.test_request_context("/api/parts", method="POST", json=payload):
            response, status = backend.create_part.__wrapped__("user-123")

        self.assertEqual(status, 201)
        self.assertEqual(response.get_json()["id"], "part-1")

    def test_post_bike_payload_succeeds(self):
        def fake_supabase_request(method, path, params=None, data=None, user_id=None, use_service_role=False):
            if method == "post" and path == "/rest/v1/bikes":
                return ([{"id": "bike-1"}], 201)
            if method == "post" and path == "/rest/v1/bike_images":
                return ([{"id": "bike-image-1"}], 201)
            return ([], 200)

        self.supabase_request.side_effect = fake_supabase_request

        payload = {
            "bike_brand": "Yamaha",
            "bike_model": "MT-09",
            "bike_type": "Naked",
            "year": 2022,
            "engine_size": "900cc",
            "mileage": 12000,
            "color": "Blue",
            "price": 32000,
            "location": "Dubai",
            "area": "Marina",
            "emirate": "Dubai",
            "description": "Clean bike",
            "contact_number": "+971501234567",
            "country_code": "+971",
            "whatsapp_number": "+971501234567",
            "whatsapp_prefill_text": "Hello",
            "features": ["ABS"],
            "condition": "Good",
            "vin_number": "VIN123",
            "cylinders": 2,
            "wheels": 2,
            "is_dealer": False,
            "images": ["https://example.com/bike.jpg"],
        }

        with backend.app.test_request_context("/api/bikes", method="POST", json=payload):
            response, status = backend.create_bike.__wrapped__("user-123")

        self.assertEqual(status, 201)
        self.assertEqual(response.get_json()["id"], "bike-1")


if __name__ == "__main__":
    unittest.main()
