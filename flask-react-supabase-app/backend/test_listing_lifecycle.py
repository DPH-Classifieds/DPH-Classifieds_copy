#!/usr/bin/env python3
import unittest
from unittest.mock import patch

from flask import json

import app as backend


class ListingLifecycleEmailTests(unittest.TestCase):
    @patch.object(backend, "get_user_email", return_value="fallback@example.com")
    def test_resolve_listing_owner_email_falls_back_to_user_id(self, mock_get_user_email):
        record = {"user_id": "11111111-1111-1111-1111-111111111111"}

        self.assertEqual(
            backend._resolve_listing_owner_email(record),
            "fallback@example.com",
        )
        mock_get_user_email.assert_called_once_with("11111111-1111-1111-1111-111111111111")

    @patch.object(backend, "_send_listing_expired_email")
    @patch.object(backend, "get_user_email", return_value="fallback@example.com")
    @patch.object(backend, "supabase_request")
    def test_sync_listing_lifecycle_uses_owner_email_fallback_for_expiry(
        self,
        mock_supabase_request,
        mock_get_user_email,
        mock_send_listing_expired_email,
    ):
        mock_supabase_request.return_value = ([], 200)

        record = {
            "id": "listing-1",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "listing_title": "Test Listing",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-02T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-02T00:00:00+00:00",
            "is_archived": False,
        }

        with patch.object(backend, "_utc_now") as mock_now:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, tzinfo=backend.datetime.timezone.utc)
            backend._sync_listing_lifecycle("cars", record, hard_delete_archived=False)

        mock_get_user_email.assert_called_once_with("11111111-1111-1111-1111-111111111111")
        mock_send_listing_expired_email.assert_called_once()
        self.assertEqual(mock_send_listing_expired_email.call_args.args[0], "fallback@example.com")


class UserListingsFilterTests(unittest.TestCase):
    def test_user_listings_filters_by_expired_status(self):
        def fake_collect(current_user, item_type):
            sample = {
                "car": [
                    {"id": "car-1", "status": "approved", "listing_state": "active", "created_at": "2026-05-01T00:00:00+00:00"},
                    {"id": "car-2", "status": "approved", "listing_state": "expired", "created_at": "2026-05-02T00:00:00+00:00"},
                ],
                "bike": [
                    {"id": "bike-1", "status": "approved", "listing_state": "expired", "created_at": "2026-05-03T00:00:00+00:00"},
                ],
                "part": [],
                "plate": [],
            }
            return sample[item_type], 200

        with patch.object(backend, "_collect_user_listing_records", side_effect=fake_collect), \
            patch.object(backend, "_get_user_listing_count", return_value=(0, None)):
            with backend.app.test_request_context("/api/user/listings?status=expired"):
                response, status_code = backend.get_all_user_listings.__wrapped__(
                    "11111111-1111-1111-1111-111111111111"
                )

        self.assertEqual(status_code, 200)
        payload = json.loads(response.get_data(as_text=True))
        self.assertEqual([item["id"] for item in payload["listings"]], ["bike-1", "car-2"])
        self.assertEqual([item["id"] for item in payload["cars"]], ["car-2"])
        self.assertEqual([item["id"] for item in payload["bikes"]], ["bike-1"])


if __name__ == "__main__":
    unittest.main()
