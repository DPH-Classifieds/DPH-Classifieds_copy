import unittest
from unittest.mock import Mock, patch

import app as backend


class SupabaseCountTests(unittest.TestCase):
    def test_supabase_count_parses_content_range(self):
        with patch("app.requests.head") as mock_head:
            mock_head.return_value = Mock(
                status_code=206,
                headers={"Content-Range": "0-0/4231"},
            )
            count = backend._supabase_count("users", {"is_dealer": "eq.true"})
            self.assertEqual(count, 4231)

    def test_supabase_count_returns_zero_when_missing(self):
        with patch("app.requests.head") as mock_head:
            mock_head.return_value = Mock(status_code=500, headers={})
            self.assertEqual(backend._supabase_count("users", {}), 0)

    def test_supabase_count_returns_zero_on_4xx(self):
        with patch("app.requests.head") as mock_head, \
             self.assertLogs("app", level="WARNING") as logs:
            mock_head.return_value = Mock(
                status_code=403,
                headers={"Content-Range": "*/0"},
                text="permission denied",
            )
            self.assertEqual(backend._supabase_count("users", {}), 0)
        self.assertTrue(any("status=403" in msg for msg in logs.output))

    def test_supabase_count_handles_unknown_total(self):
        # Content-Range "*/*" means PostgREST couldn't determine count.
        with patch("app.requests.head") as mock_head:
            mock_head.return_value = Mock(
                status_code=206,
                headers={"Content-Range": "*/*"},
                text="",
            )
            self.assertEqual(backend._supabase_count("users", {}), 0)


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
        cars = [{"view_count": 3}]
        bikes = [{"view_count": 4}]
        parts = [{"view_count": 5}]
        plates = [{"view_count": 6}]
        # No created_at on users so they don't pollute the unique_visitors
        # set — the test specifically asserts unique_visitors == 2 (the two
        # platform_events visitors). total_users/total_dealers now come from
        # the _supabase_count mock, not from this fetch.
        users = [
            {"id": "u1"},
            {"id": "u2"},
            {"id": "u3"},
        ]

        def fake_supabase_request(method, path, params=None, data=None, user_id=None, use_service_role=False):
            if path == "/rest/v1/platform_events":
                return platform_events, 200
            if path == "/rest/v1/lead_events":
                return lead_events, 200
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

        count_returns = {
            ("users", None): 3,
            ("users", frozenset({"is_dealer": "eq.true"}.items())): 1,
            ("reports", None): 2,
            ("cars", frozenset({"status": "eq.pending"}.items())): 1,
            ("bikes", frozenset({"status": "eq.pending"}.items())): 0,
            ("car_parts", frozenset({"status": "eq.pending"}.items())): 1,
            ("license_plates", frozenset({"status": "eq.pending"}.items())): 1,
        }

        def fake_count(table, params=None):
            key = (table, frozenset((params or {}).items()) if params else None)
            return count_returns.get(key, 0)

        with backend.app.test_request_context("/api/admin/stats?days=30"):
            with patch.object(backend, "_require_admin_api_user", return_value=True):
                with patch.object(backend, "supabase_request", side_effect=fake_supabase_request):
                    with patch.object(backend, "_supabase_count", side_effect=fake_count):
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

    def test_unique_visitors_dedupes_across_sources(self):
        iso = backend._isoformat_utc
        now = backend._utc_now()
        user_a = "user-aaaa-1111"

        platform_events = [
            {"user_id": user_a, "visitor_id": "v-anon-1", "session_id": "s1",
             "page_kind": "home", "created_at": iso(now)},
        ]
        lead_events = [
            {"user_id": user_a, "session_id": "s2", "action": "call_click",
             "created_at": iso(now)},
        ]
        users_in_window = [{"id": user_a, "created_at": iso(now)}]

        # Should collapse to ONE unique visitor, not three.
        def fake_supabase_request(method, path, **kwargs):
            if "platform_events" in path:
                return platform_events, 200
            return [], 200

        def fake_fetch(path, params):
            if "lead_events" in path:
                return lead_events
            if "users" in path:
                return users_in_window
            return []

        with patch("app.supabase_request", side_effect=fake_supabase_request), \
             patch("app._fetch_rows", side_effect=fake_fetch), \
             patch("app._supabase_count", return_value=1), \
             patch("app._api_cache_get", return_value=None), \
             patch("app._require_admin_api_user", return_value=True):
            with backend.app.test_request_context("/api/admin/stats?days=30"):
                payload, status_code = backend.get_admin_stats.__wrapped__("admin-1")
                self.assertEqual(status_code, 200)
                data = payload.get_json()
                self.assertEqual(data["unique_visitors"], 1)
                sources = data["data_health"]["unique_visitor_sources"]
                self.assertIn("platform_events", sources)
                self.assertIn("lead_events", sources)
                self.assertIn("new_signups", sources)

    def test_total_views_is_window_bounded(self):
        iso = backend._isoformat_utc
        now = backend._utc_now()

        platform_events = [
            {"page_kind": "listing_detail", "listing_type": "car", "visitor_id": "v1", "created_at": iso(now)},
            {"page_kind": "listing_detail", "listing_type": "car", "visitor_id": "v2", "created_at": iso(now)},
            {"page_kind": "listing_detail", "listing_type": "bike", "visitor_id": "v3", "created_at": iso(now)},
            # Not a listing detail page — must not count.
            {"page_kind": "home", "visitor_id": "v4", "created_at": iso(now)},
            # listing_detail but no listing_type — counts toward total but not per-type.
            {"page_kind": "listing_detail", "visitor_id": "v5", "created_at": iso(now)},
        ]

        def fake_supabase_request(method, path, **kwargs):
            if "platform_events" in path:
                return platform_events, 200
            return [], 200

        def fake_fetch(path, params):
            return []  # nothing else needs row data for this test

        with patch("app.supabase_request", side_effect=fake_supabase_request), \
             patch("app._fetch_rows", side_effect=fake_fetch), \
             patch("app._supabase_count", return_value=0), \
             patch("app._api_cache_get", return_value=None), \
             patch("app._require_admin_api_user", return_value=True):
            with backend.app.test_request_context("/api/admin/stats?days=30"):
                resp = backend.get_admin_stats.__wrapped__("admin-1")
                payload, status_code = resp
                self.assertEqual(status_code, 200)
                data = payload.get_json()
                self.assertEqual(data["total_views"], 4)
                self.assertEqual(data["cars_views"], 2)
                self.assertEqual(data["bikes_views"], 1)
                self.assertEqual(data["parts_views"], 0)
                self.assertEqual(data["plates_views"], 0)


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
