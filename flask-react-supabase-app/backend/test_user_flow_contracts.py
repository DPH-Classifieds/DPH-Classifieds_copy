import unittest
from unittest.mock import Mock, patch

import app as backend
import routes.admin as admin_routes


class UserFlowContractsTests(unittest.TestCase):
    def test_user_drafts_reads_draft_payload_and_uses_parts_resume_path(self):
        draft_rows = [
            {
                "id": "draft-1",
                "user_id": "user-1",
                "draft_key": "part",
                "draft_payload": {
                    "partsForm": {
                        "title": "OEM Prado headlight",
                    }
                },
                "created_at": "2026-06-17T10:00:00+00:00",
                "updated_at": "2026-06-18T10:00:00+00:00",
            }
        ]

        with backend.app.test_request_context("/api/user/drafts"):
            with patch.object(backend, "supabase_request", return_value=(draft_rows, 200)):
                response, status = backend.list_user_drafts.__wrapped__("user-1")

        payload = response.get_json()
        self.assertEqual(status, 200)
        self.assertEqual(payload["drafts"][0]["display_title"], "OEM Prado headlight")
        self.assertEqual(payload["drafts"][0]["resume_path"], "/post-car-parts")

    @patch.object(backend, "supabase_request")
    def test_saved_search_upsert_persists_normalized_unique_key(self, mock_supabase):
        saved_rows = []

        def side_effect(method, path, params=None, data=None, **kwargs):
            if path == "/rest/v1/saved_searches" and method == "post":
                saved_rows.append(data)
                return ([{"id": "search-1", **data}], 200)
            return ([], 200)

        mock_supabase.side_effect = side_effect

        with backend.app.test_request_context(
            "/api/user/saved-searches",
            method="POST",
            json={
                "category": "cars",
                "route_path": "/cars",
                "query": "land cruiser",
                "filters": {"make": "Toyota", "maxPrice": 200000, "empty": ""},
                "result_count": 12,
            },
        ):
            response, status = backend.save_user_search.__wrapped__("user-1")

        payload = response.get_json()
        self.assertEqual(status, 200)
        self.assertTrue(payload["saved"])
        self.assertEqual(saved_rows[0]["user_id"], "user-1")
        self.assertEqual(saved_rows[0]["category"], "cars")
        self.assertEqual(saved_rows[0]["query_text"], "land cruiser")
        self.assertEqual(saved_rows[0]["filters"], {"make": "Toyota", "maxPrice": 200000})
        self.assertTrue(saved_rows[0]["search_key"])

    @patch.object(backend, "requests")
    def test_auth_me_syncs_email_verification_from_supabase_auth(self, mock_requests):
        auth_response = Mock()
        auth_response.status_code = 200
        auth_response.json.return_value = {
            "user": {
                "id": "user-1",
                "email": "verified@example.com",
                "email_confirmed_at": "2026-06-19T10:00:00+00:00",
            }
        }

        user_response = Mock()
        user_response.status_code = 200
        user_response.json.return_value = [
            {
                "id": "user-1",
                "email": "verified@example.com",
                "email_verified": False,
                "phone_verified": False,
            }
        ]

        patch_response = Mock()
        patch_response.status_code = 200
        patch_response.json.return_value = [{"id": "user-1", "email_verified": True}]

        mock_requests.get.side_effect = [auth_response, user_response]
        mock_requests.patch.return_value = patch_response

        with patch.object(backend, "SUPABASE_URL", "https://example.supabase.co"), patch.object(
            backend, "SUPABASE_KEY", "anon-key"
        ), patch.object(backend, "SUPABASE_SERVICE_ROLE_KEY", "service-key"):
            details = backend._get_user_details_with_admin_status("user-1")

        self.assertTrue(details["email_verified"])
        self.assertEqual(details["phone_verified"], False)
        mock_requests.patch.assert_called()

    @patch.object(admin_routes, "requests")
    def test_admin_user_list_uses_supabase_auth_email_confirmation(self, mock_requests):
        public_users_response = Mock()
        public_users_response.status_code = 200
        public_users_response.headers = {"Content-Range": "0-0/1"}
        public_users_response.json.return_value = [
            {
                "id": "user-1",
                "email": "verified@example.com",
                "email_verified": False,
                "phone_verified": False,
                "is_admin": False,
                "account_status": "active",
                "created_at": "2026-06-19T00:00:00+00:00",
            }
        ]

        auth_user_response = Mock()
        auth_user_response.status_code = 200
        auth_user_response.json.return_value = {
            "user": {
                "id": "user-1",
                "email_confirmed_at": "2026-06-19T10:00:00+00:00",
            }
        }

        mock_requests.get.side_effect = [public_users_response, auth_user_response]

        with backend.app.test_request_context("/api/admin/users?limit=50"):
            with patch.object(admin_routes, "_admin_cache_get", return_value=None), patch.object(
                admin_routes, "_admin_cache_set"
            ):
                response, status = admin_routes.get_users.__wrapped__()

        payload = response.get_json()
        self.assertEqual(status, 200)
        self.assertTrue(payload["users"][0]["email_verified"])
        self.assertEqual(payload["users"][0]["email_verified_at"], "2026-06-19T10:00:00+00:00")

    @patch.object(backend, "_apply_listing_lifecycle_metadata")
    @patch.object(backend, "supabase_request")
    def test_saved_listings_loader_survives_lifecycle_annotation_errors(
        self, mock_supabase, mock_apply_lifecycle
    ):
        mock_apply_lifecycle.side_effect = RuntimeError("stale lifecycle row")

        def side_effect(method, path, params=None, data=None, **kwargs):
            if path == "/rest/v1/saved_listings":
                return (
                    [
                        {
                            "id": "saved-1",
                            "user_id": "user-1",
                            "listing_id": "car-1",
                            "listing_type": "car",
                            "created_at": "2026-06-18T10:00:00+00:00",
                        }
                    ],
                    200,
                )
            if path == "/rest/v1/cars":
                return (
                    [
                        {
                            "id": "car-1",
                            "listing_title": "Toyota Land Cruiser",
                            "status": "approved",
                        }
                    ],
                    200,
                )
            if path == "/rest/v1/car_images":
                return (
                    [
                        {
                            "id": "img-1",
                            "car_id": "car-1",
                            "display_url": "https://example.com/car.jpg",
                        }
                    ],
                    200,
                )
            return ([], 200)

        mock_supabase.side_effect = side_effect

        payload, status = backend._fetch_saved_listing_cards("user-1")

        self.assertEqual(status, 200)
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["items"][0]["title"], "Toyota Land Cruiser")

    @patch.object(backend, "_require_admin_api_user", return_value=True)
    @patch.object(backend, "supabase_request")
    def test_admin_saved_searches_summary_counts_recent_rows(self, mock_supabase, _admin):
        def side_effect(method, path, params=None, **kwargs):
            if path == "/rest/v1/saved_searches":
                return (
                    [
                        {
                            "id": "search-1",
                            "user_id": "user-1",
                            "category": "cars",
                            "query_text": "land cruiser",
                            "filters": {"make": "Toyota"},
                            "created_at": "2026-06-18T10:00:00+00:00",
                        },
                        {
                            "id": "search-2",
                            "user_id": "user-2",
                            "category": "bikes",
                            "query_text": "ducati",
                            "filters": {},
                            "created_at": "2026-06-18T11:00:00+00:00",
                        },
                    ],
                    200,
                )
            if path == "/rest/v1/users":
                return (
                    [
                        {"id": "user-1", "email": "one@example.com"},
                        {"id": "user-2", "email": "two@example.com"},
                    ],
                    200,
                )
            return ([], 200)

        mock_supabase.side_effect = side_effect

        with backend.app.test_request_context("/api/admin/saved-searches?days=7"):
            response, status = backend.get_admin_saved_searches.__wrapped__("admin-1")

        payload = response.get_json()
        self.assertEqual(status, 200)
        self.assertEqual(payload["summary"]["total"], 2)
        self.assertEqual(payload["summary"]["unique_users"], 2)
        self.assertEqual(payload["summary"]["categories"]["cars"], 1)
        self.assertEqual(payload["searches"][0]["owner_email"], "one@example.com")

    def test_production_csp_omits_unsafe_eval(self):
        with patch.dict(
            backend.os.environ,
            {"FLASK_ENV": "production", "CSP_ALLOW_UNSAFE_EVAL": "false"},
            clear=False,
        ):
            policy = backend._build_content_security_policy()

        self.assertNotIn("'unsafe-eval'", policy)

    @patch.object(backend, "_get_redis_cache_client")
    def test_auth_rate_limit_uses_redis_counter(self, mock_get_redis):
        redis_client = Mock()
        redis_client.incr.return_value = backend.AUTH_RATE_LIMIT_MAX + 1
        mock_get_redis.return_value = redis_client

        self.assertTrue(backend._auth_rate_limited("203.0.113.10"))
        redis_client.incr.assert_called()

    @patch.object(backend, "_get_redis_cache_client")
    def test_contact_rate_limit_sets_redis_expiry(self, mock_get_redis):
        redis_client = Mock()
        redis_client.incr.return_value = 1
        mock_get_redis.return_value = redis_client

        self.assertFalse(backend._contact_rate_limited("203.0.113.10"))
        redis_client.expire.assert_called_once()

    @patch.object(backend, "requests")
    @patch.object(backend, "supabase_request")
    def test_delete_account_deactivates_owned_data_and_deletes_auth_user(self, mock_supabase, mock_requests):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.text = "{}"
        mock_response.json.return_value = {}
        mock_requests.delete.return_value = mock_response
        calls = []

        def side_effect(method, path, params=None, data=None, **kwargs):
            calls.append((method, path, params, data))
            return ([], 200)

        mock_supabase.side_effect = side_effect

        with patch.object(backend, "SUPABASE_URL", "https://example.supabase.co"), patch.object(
            backend, "SUPABASE_SERVICE_ROLE_KEY", "service-key"
        ), backend.app.test_request_context("/api/user/delete-account", method="DELETE"):
            response, status = backend.delete_user_account.__wrapped__("user-1")

        self.assertEqual(status, 200)
        self.assertTrue(response.get_json()["deleted"])
        patched_tables = {path.split("?")[0] for method, path, _, _ in calls if method == "patch"}
        self.assertIn("/rest/v1/cars", patched_tables)
        self.assertIn("/rest/v1/bikes", patched_tables)
        self.assertIn("/rest/v1/car_parts", patched_tables)
        self.assertIn("/rest/v1/license_plates", patched_tables)
        mock_requests.delete.assert_called_once()
        self.assertIn("/auth/v1/admin/users/user-1", mock_requests.delete.call_args.args[0])

    @patch.object(backend, "_send_listing_draft_reminder_email", return_value=({"id": "email-1"}, None))
    @patch.object(backend, "get_user_email", return_value="owner@example.com")
    @patch.object(backend, "supabase_request")
    def test_draft_reminder_claims_then_sends_once(self, mock_supabase, _email, mock_send):
        draft_row = {
            "id": "draft-1",
            "user_id": "user-1",
            "draft_key": "car",
            "payload": {"carForm": {"make": "Toyota", "model": "Supra"}},
            "updated_at": "2026-06-17T10:00:00+00:00",
        }

        def side_effect(method, path, params=None, data=None, **kwargs):
            if method == "get" and path == "/rest/v1/listing_drafts":
                return ([draft_row], 200)
            if method == "patch" and path.startswith("/rest/v1/listing_drafts"):
                return ([{**draft_row, **(data or {})}], 200)
            return ([], 200)

        mock_supabase.side_effect = side_effect

        result = backend._run_listing_draft_reminders_once(age_hours=24, limit=5)

        self.assertEqual(result["sent"], 1)
        mock_send.assert_called_once()

    @patch.object(backend, "_send_saved_car_reminder_email", return_value=({"id": "email-1"}, None))
    @patch.object(backend, "get_user_email", return_value="buyer@example.com")
    @patch.object(backend, "supabase_request")
    def test_saved_car_reminder_claims_then_sends_once(self, mock_supabase, _email, mock_send):
        saved_row = {
            "id": "saved-1",
            "user_id": "user-1",
            "listing_id": "car-1",
            "listing_type": "car",
            "created_at": "2026-06-17T10:00:00+00:00",
        }

        def side_effect(method, path, params=None, data=None, **kwargs):
            if method == "get" and path == "/rest/v1/saved_listings":
                return ([saved_row], 200)
            if method == "patch" and path.startswith("/rest/v1/saved_listings"):
                return ([{**saved_row, **(data or {})}], 200)
            if method == "get" and path == "/rest/v1/cars":
                return ([{"id": "car-1", "listing_title": "Toyota Supra"}], 200)
            return ([], 200)

        mock_supabase.side_effect = side_effect

        result = backend._run_saved_car_reminders_once(age_hours=24, limit=5)

        self.assertEqual(result["sent"], 1)
        mock_send.assert_called_once()

    @patch.object(backend, "_supabase_count")
    def test_lifecycle_summary_tracks_sold_expired_draft_and_active(self, mock_count):
        def count(table, params=None):
            params = params or {}
            if params.get("sold_status") == "eq.sold_on_dph":
                return 2
            if params.get("sold_status") == "eq.sold_elsewhere":
                return 3
            if params.get("listing_state") == "eq.expired":
                return 4
            if params.get("listing_state") == "eq.draft":
                return 5
            if params.get("status") == "eq.approved":
                return 6
            return 0

        mock_count.side_effect = count

        summary = backend._build_listing_lifecycle_summary()

        self.assertEqual(summary["totals"]["sold_on_dph"], 8)
        self.assertEqual(summary["totals"]["sold_elsewhere"], 12)
        self.assertEqual(summary["totals"]["expired"], 16)
        self.assertEqual(summary["totals"]["draft"], 20)
        self.assertEqual(summary["totals"]["active"], 24)


if __name__ == "__main__":
    unittest.main()
