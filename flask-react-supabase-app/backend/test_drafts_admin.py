import unittest
from unittest.mock import patch

import app as backend


class DraftAdminTests(unittest.TestCase):
    def test_user_drafts_endpoint_formats_car_summary(self):
        draft_rows = [
            {
                "id": "draft-1",
                "user_id": "user-1",
                "draft_key": "car",
                "payload": {
                    "make_year": "2024",
                    "make": "Toyota",
                    "model": "Land Cruiser",
                },
                "created_at": "2026-06-17T10:00:00+00:00",
                "updated_at": "2026-06-18T10:00:00+00:00",
            }
        ]

        with backend.app.test_request_context("/api/user/drafts"):
            with patch.object(backend, "supabase_request", return_value=(draft_rows, 200)):
                response, status = backend.list_user_drafts.__wrapped__("user-1")

        self.assertEqual(status, 200)
        payload = response.get_json()
        self.assertEqual(payload["drafts"][0]["display_title"], "2024 Toyota Land Cruiser")
        self.assertEqual(payload["drafts"][0]["resume_path"], "/post-car")

    @patch.object(backend, "_require_admin_api_user", return_value=True)
    @patch.object(backend, "supabase_request")
    def test_admin_listings_search_includes_drafts(self, mock_supabase_request, _mock_admin_gate):
        def side_effect(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if path == "/rest/v1/listing_drafts":
                return (
                    [
                        {
                            "id": "draft-1",
                            "user_id": "user-1",
                            "draft_key": "car",
                            "payload": {
                                "make_year": "2024",
                                "make": "Toyota",
                                "model": "Land Cruiser",
                            },
                            "created_at": "2026-06-17T10:00:00+00:00",
                            "updated_at": "2026-06-18T10:00:00+00:00",
                        }
                    ],
                    200,
                )
            if path == "/rest/v1/users":
                return (
                    [
                        {
                            "id": "user-1",
                            "email": "suhaylindubai@gmail.com",
                            "username": "suhayl",
                            "display_name": "Suhayl",
                        }
                    ],
                    200,
                )
            return ([], 200)

        mock_supabase_request.side_effect = side_effect

        with backend.app.test_request_context("/api/admin/listings-search?types=drafts&statuses=draft"):
            response, status = backend.admin_listings_search.__wrapped__("admin-user")

        self.assertEqual(status, 200)
        payload = response.get_json()
        self.assertEqual(len(payload["listings"]), 1)
        draft = payload["listings"][0]
        self.assertEqual(draft["listing_type"], "drafts")
        self.assertEqual(draft["status"], "draft")
        self.assertEqual(draft["display_title"], "2024 Toyota Land Cruiser")
        self.assertEqual(draft["owner_email"], "suhaylindubai@gmail.com")


if __name__ == "__main__":
    unittest.main()
