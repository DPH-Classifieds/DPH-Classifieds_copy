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

    def test_supabase_count_uses_request_token_when_service_key_missing(self):
        with backend.app.test_request_context("/api/admin/stats"):
            backend.request.supabase_token = "jwt-token-123"
            with patch.dict(backend.os.environ, {"SUPABASE_SERVICE_ROLE_KEY": ""}, clear=False):
                with patch("app.requests.head") as mock_head:
                    mock_head.return_value = Mock(
                        status_code=206,
                        headers={"Content-Range": "0-0/11"},
                    )
                    count = backend._supabase_count("users", {})

        self.assertEqual(count, 11)
        headers = mock_head.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], "Bearer jwt-token-123")
        self.assertEqual(headers["apikey"], backend.SUPABASE_KEY)


class AdminStatsTests(unittest.TestCase):
    def test_admin_stats_includes_visitor_counts(self):
        fixed_now = backend._utc_now()
        now_iso = backend._isoformat_utc(fixed_now)

        platform_events = [
            {"visitor_id": "visitor-1", "created_at": now_iso},
            {"visitor_id": "visitor-2", "created_at": now_iso},
            {"visitor_id": "visitor-1", "created_at": now_iso},
            {"event_name": "call_click", "visitor_id": "visitor-1", "session_id": "session-1", "created_at": now_iso},
            {"event_name": "whatsapp_click", "visitor_id": "visitor-2", "session_id": "session-2", "created_at": now_iso},
        ]
        lead_events = [
            {"action": "call_click", "created_at": now_iso},
            {"action": "whatsapp_click", "created_at": now_iso},
        ]
        users = [
            {"id": "u1", "is_dealer": True, "dealer_verified": True},
            {"id": "u2", "is_dealer": False, "dealer_verified": False},
            {"id": "u3", "is_dealer": False, "dealer_verified": False},
        ]
        reports = [
            {"id": "r1", "status": "pending", "created_at": now_iso},
            {"id": "r2", "status": "resolved", "created_at": now_iso},
        ]
        lifecycle_rows = {
            "cars": [
                {"id": "car-pending", "status": "pending", "created_at": now_iso},
                {"id": "car-live", "status": "approved", "created_at": now_iso},
            ],
            "bikes": [],
            "parts": [{"id": "part-pending", "status": "pending", "created_at": now_iso}],
            "plates": [{"id": "plate-pending", "status": "pending", "created_at": now_iso}],
        }

        def fake_supabase_request(method, path, params=None, data=None, user_id=None, use_service_role=False):
            if path == "/rest/v1/platform_events":
                return platform_events, 200
            if path == "/rest/v1/lead_events":
                return lead_events, 200
            return [], 200

        def fake_fetch(path, params):
            if "lead_events" in path:
                return lead_events
            if "users" in path:
                return users
            if "reports" in path:
                return reports
            return []

        # Cloudflare override would clobber the platform_events numbers we're
        # actually testing here. Disable it for the duration of this test so we
        # exercise the in-app aggregator, not the edge.
        from unittest.mock import patch as _patch
        with backend.app.test_request_context("/api/admin/stats?days=30"):
            with patch.object(backend, "_require_admin_api_user", return_value=True):
                with patch.object(backend, "supabase_request", side_effect=fake_supabase_request):
                    with patch.object(backend, "_fetch_rows", side_effect=fake_fetch):
                        with patch.object(backend, "_fetch_listing_lifecycle_rows", return_value=lifecycle_rows):
                            with patch.object(backend, "_cached_cropped_at_pct", return_value=None):
                                with patch.object(backend, "_supabase_count", return_value=3):
                                    with patch.object(backend, "_api_cache_get", return_value=None):
                                        with patch.object(backend, "_api_cache_set"):
                                            with _patch("services.cloudflare_analytics.is_enabled", return_value=False):
                                                response, status = backend.get_admin_stats.__wrapped__("admin-1")

        self.assertEqual(status, 200)
        payload = response.get_json()
        self.assertEqual(payload["unique_visitors"], 2)
        # Cloudflare disabled in this test → data_source must fall back to the
        # in-app tracker so the dashboard badge stays truthful.
        self.assertEqual(payload["data_source"], "platform_events")
        self.assertEqual(payload["live_users"], 2)
        self.assertEqual(payload["cars_pending"], 1)
        self.assertEqual(payload["parts_pending"], 1)
        self.assertEqual(payload["plates_pending"], 1)
        self.assertEqual(payload["total_users"], 3)
        self.assertEqual(payload["total_reports"], 2)
        # Recent legacy rows are compatibility writes; the canonical platform
        # rows above are the source for post-cutover contacts.
        self.assertEqual(payload["total_calls"], 1)
        self.assertEqual(payload["total_call_events"], 1)
        self.assertEqual(payload["total_whatsapp"], 1)
        self.assertEqual(payload["total_whatsapp_events"], 1)
        self.assertEqual(payload["total_dealers"], 1)

    def test_unique_visitors_dedupes_across_sources(self):
        iso = backend._isoformat_utc
        now = backend._utc_now()
        user_a = "user-aaaa-1111"
        old_iso = iso(backend.CANONICAL_ANALYTICS_CUTOVER_AT - backend.datetime.timedelta(days=1))

        platform_events = [
            {"user_id": user_a, "visitor_id": "v-anon-1", "session_id": "s1",
             "page_kind": "home", "created_at": iso(now)},
        ]
        lead_events = [
            {"user_id": user_a, "session_id": "s2", "action": "call_click",
             "created_at": old_iso},
        ]
        users_in_window = [{"id": user_a, "created_at": iso(now)}]

        # Should collapse to ONE unique visitor, not three.
        def fake_supabase_request(method, path, **kwargs):
            if "platform_events" in path:
                return platform_events, 200
            if "lead_events" in path:
                return lead_events, 200
            return [], 200

        def fake_fetch(path, params):
            if "lead_events" in path:
                return lead_events
            if "users" in path:
                return users_in_window
            if "reports" in path:
                return []
            return []

        with patch("app.supabase_request", side_effect=fake_supabase_request), \
             patch("app._fetch_rows", side_effect=fake_fetch), \
             patch("app._fetch_listing_lifecycle_rows", return_value={"cars": [], "bikes": [], "parts": [], "plates": []}), \
             patch("app._cached_cropped_at_pct", return_value=None), \
             patch("app._supabase_count", return_value=1), \
             patch("app._api_cache_get", return_value=None), \
             patch("app._api_cache_set"), \
             patch("app._require_admin_api_user", return_value=True), \
             patch("services.cloudflare_analytics.is_enabled", return_value=False):
            with backend.app.test_request_context("/api/admin/stats?days=30"):
                payload, status_code = backend.get_admin_stats.__wrapped__("admin-1")
                self.assertEqual(status_code, 200)
                data = payload.get_json()
                self.assertEqual(data["unique_visitors"], 1)
                sources = data["data_health"]["unique_visitor_sources"]
                self.assertIn("platform_events", sources)
                self.assertIn("lead_events", sources)
                self.assertIn("new_signups", sources)

    def test_total_calls_dedupes_per_actor(self):
        iso = backend._isoformat_utc
        now = backend.CANONICAL_ANALYTICS_CUTOVER_AT - backend.datetime.timedelta(days=1)

        lead_events = [
            {"user_id": "u1", "action": "call_click", "created_at": iso(now)},
            {"user_id": "u1", "action": "call_click", "created_at": iso(now)},  # same user, repeat
            {"user_id": "u2", "action": "call_click", "created_at": iso(now)},
            {"user_id": "u3", "action": "whatsapp_click", "created_at": iso(now)},
        ]

        def fake_supabase_request(method, path, **kwargs):
            if "lead_events" in path:
                return lead_events, 200
            return [], 200  # no platform_events

        def fake_fetch(path, params):
            if "lead_events" in path:
                return lead_events
            if "reports" in path:
                return []
            return []

        with patch("app.supabase_request", side_effect=fake_supabase_request), \
             patch("app._fetch_rows", side_effect=fake_fetch), \
             patch("app._fetch_listing_lifecycle_rows", return_value={"cars": [], "bikes": [], "parts": [], "plates": []}), \
             patch("app._cached_cropped_at_pct", return_value=None), \
             patch("app._supabase_count", return_value=0), \
             patch("app._api_cache_get", return_value=None), \
             patch("app._api_cache_set"), \
             patch("app._require_admin_api_user", return_value=True):
            with backend.app.test_request_context("/api/admin/stats?days=30"):
                payload, status_code = backend.get_admin_stats.__wrapped__("admin-1")
                self.assertEqual(status_code, 200)
                data = payload.get_json()
                self.assertEqual(data["total_calls"], 2)            # unique callers
                self.assertEqual(data["total_call_events"], 3)      # raw event count
                self.assertEqual(data["total_whatsapp"], 1)         # unique whatsappers
                self.assertEqual(data["total_whatsapp_events"], 1)  # raw whatsapp count

    def test_recent_legacy_contact_rows_do_not_double_count_canonical_events(self):
        now_iso = backend._isoformat_utc(backend._utc_now())
        platform_events = [
            {"event_name": "call_click", "visitor_id": "buyer-1", "session_id": "session-1", "created_at": now_iso},
        ]
        lead_events = [
            {"action": "call_click", "session_id": "session-1", "created_at": now_iso},
        ]

        def fake_supabase_request(method, path, **kwargs):
            if "platform_events" in path:
                return platform_events, 200
            if "lead_events" in path:
                return lead_events, 200
            return [], 200

        with patch("app.supabase_request", side_effect=fake_supabase_request), \
             patch("app._fetch_listing_lifecycle_rows", return_value={"cars": [], "bikes": [], "parts": [], "plates": []}), \
             patch("app._cached_cropped_at_pct", return_value=None), \
             patch("app._supabase_count", return_value=1), \
             patch("app._api_cache_get", return_value=None), \
             patch("app._api_cache_set"), \
             patch("app._require_admin_api_user", return_value=True), \
             patch("services.cloudflare_analytics.is_enabled", return_value=False):
            with backend.app.test_request_context("/api/admin/stats?days=30"):
                payload, status_code = backend.get_admin_stats.__wrapped__("admin-1")

        self.assertEqual(status_code, 200)
        data = payload.get_json()
        self.assertEqual(data["total_call_events"], 1)
        self.assertEqual(data["total_calls"], 1)

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
             patch("app._fetch_listing_lifecycle_rows", return_value={"cars": [], "bikes": [], "parts": [], "plates": []}), \
             patch("app._cached_cropped_at_pct", return_value=None), \
             patch("app._supabase_count", return_value=0), \
             patch("app._api_cache_get", return_value=None), \
             patch("app._api_cache_set"), \
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


class AdminStatsRoutingTests(unittest.TestCase):
    def test_only_one_admin_stats_route_registered(self):
        rules = [r for r in backend.app.url_map.iter_rules()
                 if r.rule == "/api/admin/stats"]
        self.assertEqual(len(rules), 1,
                         f"Expected one /api/admin/stats route, got {len(rules)}: "
                         f"{[r.endpoint for r in rules]}")
        self.assertEqual(rules[0].endpoint, "get_admin_stats")


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
        self.verified_user_patch = patch.object(backend, "_require_verified_user_for_listing", return_value=None)
        self.whatsapp_patch = patch.object(backend, "_require_whatsapp_prefill_and_phone_alignment", return_value=None)
        self.validation_patch = patch.object(backend, "_validate_description_word_count", return_value=None)
        self.profanity_patch = patch.object(backend, "_validate_no_profanity", return_value=None)

        self.supabase_request = self.supabase_patch.start()
        self.get_email_patch.start()
        self.email_by_id_patch.start()
        self.notify_admin_patch.start()
        self.notify_user_patch.start()
        self.dealer_patch.start()
        self.verified_user_patch.start()
        self.whatsapp_patch.start()
        self.validation_patch.start()
        self.profanity_patch.start()

        self.addCleanup(self.supabase_patch.stop)
        self.addCleanup(self.get_email_patch.stop)
        self.addCleanup(self.email_by_id_patch.stop)
        self.addCleanup(self.notify_admin_patch.stop)
        self.addCleanup(self.notify_user_patch.stop)
        self.addCleanup(self.dealer_patch.stop)
        self.addCleanup(self.verified_user_patch.stop)
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
            "images": [
                "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/partfront123.jpg",
                "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/partback123.jpg",
            ],
        }

        backend.SUPABASE_URL = "https://project-ref.supabase.co"
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
            "engine_size": 900,
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
            "vin_number": "JYARN58E0MA000001",
            "cylinders": 2,
            "wheels": 2,
            "is_dealer": False,
            "images": [
                "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/bike-1.jpg",
                "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/bike-2.jpg",
                "https://project-ref.supabase.co/storage/v1/object/public/listing-images/user-123/bike-3.jpg",
            ],
        }

        with patch.object(backend, "SUPABASE_URL", "https://project-ref.supabase.co"):
            with backend.app.test_request_context("/api/bikes", method="POST", json=payload):
                response, status = backend.create_bike.__wrapped__("user-123")

        self.assertEqual(status, 201)
        self.assertEqual(response.get_json()["id"], "bike-1")


if __name__ == "__main__":
    unittest.main()
