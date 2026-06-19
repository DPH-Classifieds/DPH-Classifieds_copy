import unittest
from unittest.mock import Mock, patch

import app as backend


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
