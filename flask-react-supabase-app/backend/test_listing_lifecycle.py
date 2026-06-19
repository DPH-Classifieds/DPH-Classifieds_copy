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

    @patch.object(backend, "_send_listing_expired_email", return_value=("ok", None))
    @patch.object(backend, "get_user_email", return_value="fallback@example.com")
    @patch.object(backend, "supabase_request")
    def test_sync_listing_lifecycle_uses_owner_email_fallback_for_expiry(
        self,
        mock_supabase_request,
        mock_get_user_email,
        mock_send_listing_expired_email,
    ):
        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "patch" and path == "/rest/v1/cars":
                return ([{**record, **(data or {})}], 200)
            if method == "patch":
                return ([{**record, **(data or {})}], 200)
            return ([], 200)

        mock_supabase_request.side_effect = fake_supabase_request

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

    def test_expiry_reminders_skip_already_sent_expiry_cycle(self):
        listing = {
            "id": "listing-2",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Test Listing",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-03T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-03T00:00:00+00:00",
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": "2026-04-03T08:00:00+00:00",
            "deleted_at": None,
            "is_archived": False,
        }

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if path == "/rest/v1/cars":
                return ([listing], 200)
            if path == "/rest/v1/listing_deletion_events":
                return (
                    [
                        {
                            "listing_id": "listing-2",
                            "created_at": "2026-04-03T08:00:00+00:00",
                            "metadata": {
                                "state": "expired",
                                "notice_date": "2026-04-03",
                            },
                        }
                    ],
                    200,
                )
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expiry_reminder", return_value=("ok", None)) as mock_send_reminder, \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)) as mock_send_expired, \
            patch.object(backend, "_record_listing_expiry_notice_event") as mock_record:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            result = backend._run_listing_expiry_reminders_once(reminder_days_before=2)

        self.assertEqual(result["reminders_sent"], 0)
        mock_send_reminder.assert_not_called()
        mock_send_expired.assert_not_called()
        mock_record.assert_not_called()

    def test_sync_listing_lifecycle_repairs_stale_renewed_listing(self):
        record = {
            "id": "listing-2b",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Renewed Listing",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-02T00:00:00+00:00",
            "expired_at": "2026-04-02T00:00:00+00:00",
            "retention_expires_at": "2026-05-02T00:00:00+00:00",
            "sold_response_deadline": "2026-04-04T00:00:00+00:00",
            "last_extended_at": "2026-04-03T09:30:00+00:00",
            "auto_removed_at": None,
            "is_archived": False,
        }

        captured = {}

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "patch":
                captured["data"] = data
                return ([record], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)):
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            synced = backend._sync_listing_lifecycle("cars", record, hard_delete_archived=False)

        self.assertIsNotNone(synced)
        self.assertEqual(synced["status"], "approved")
        self.assertEqual(synced["expired_at"], None)
        self.assertEqual(synced["is_archived"], False)
        self.assertIn("expires_at", captured["data"])
        self.assertGreater(
            backend._parse_datetime(captured["data"]["expires_at"]),
            backend.datetime.datetime(2026, 4, 3, tzinfo=backend.datetime.timezone.utc),
        )

    def test_sync_listing_lifecycle_repairs_pre_expiry_renewal_with_old_expiry(self):
        record = {
            "id": "listing-2c",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Renewed Before Expiry",
            "status": "approved",
            "sold_status": "not_sold_renew",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-16T11:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-16T11:00:00+00:00",
            "sold_response_deadline": None,
            "last_extended_at": "2026-04-16T08:00:00+00:00",
            "sold_status_set_at": "2026-04-16T08:00:00+00:00",
            "auto_removed_at": None,
            "is_archived": False,
        }

        captured = {}

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "patch":
                captured["data"] = data
                return ([record], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)):
            mock_now.return_value = backend.datetime.datetime(2026, 4, 16, 8, 5, tzinfo=backend.datetime.timezone.utc)
            synced = backend._sync_listing_lifecycle("cars", record, hard_delete_archived=False)

        self.assertIsNotNone(synced)
        self.assertEqual(synced["status"], "approved")
        self.assertIsNone(synced["expired_at"])
        self.assertIn("expires_at", captured["data"])
        self.assertEqual(
            backend._parse_datetime(captured["data"]["expires_at"]),
            backend.datetime.datetime(2026, 5, 1, 11, 0, tzinfo=backend.datetime.timezone.utc),
        )

    def test_expiry_reminders_send_once_and_record_event(self):
        listing = {
            "id": "listing-3",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Expired Listing",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-02T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-02T00:00:00+00:00",
            "is_archived": False,
        }

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if path == "/rest/v1/cars":
                return ([listing], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expiry_reminder", return_value=("ok", None)) as mock_send_reminder, \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)) as mock_send_expired, \
            patch.object(backend, "_record_listing_expiry_notice_event") as mock_record:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            result = backend._run_listing_expiry_reminders_once(reminder_days_before=2)

        self.assertEqual(result["reminders_sent"], 1)
        mock_send_reminder.assert_not_called()
        mock_send_expired.assert_called_once()
        mock_record.assert_called_once()

    def test_expiry_reminders_send_pre_expiry_notice(self):
        listing = {
            "id": "listing-4",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Expiring Soon",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-04T10:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-04T10:00:00+00:00",
            "is_archived": False,
        }

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if path == "/rest/v1/cars":
                return ([listing], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expiry_reminder", return_value=("ok", None)) as mock_send_reminder, \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)) as mock_send_expired, \
            patch.object(backend, "_record_listing_expiry_notice_event") as mock_record:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            result = backend._run_listing_expiry_reminders_once(reminder_days_before=2)

        self.assertEqual(result["reminders_sent"], 1)
        mock_send_reminder.assert_called_once()
        mock_send_expired.assert_not_called()
        mock_record.assert_called_once()

    def test_expiry_reminder_claims_before_sending(self):
        listing = {
            "id": "listing-claim-reminder",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Expiring Soon",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-04T10:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-04T10:00:00+00:00",
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
            "deleted_at": None,
            "is_archived": False,
        }
        calls = []

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            calls.append((method, path, params, data))
            if method == "get" and path == "/rest/v1/cars":
                return ([listing], 200)
            if method == "patch" and path.startswith("/rest/v1/cars"):
                self.assertIn("expiry_reminder_sent_at", data)
                return ([{**listing, **data}], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expiry_reminder", return_value=("ok", None)) as mock_send_reminder:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            result = backend._run_listing_expiry_reminders_once(reminder_days_before=2)

        self.assertEqual(result["reminders_sent"], 1)
        patch_index = next(i for i, call in enumerate(calls) if call[0] == "patch")
        self.assertLess(patch_index, len(calls))
        mock_send_reminder.assert_called_once()

    def test_expiry_reminder_does_not_send_when_claim_fails(self):
        listing = {
            "id": "listing-claim-lost",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Already Claimed",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-04T10:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-04T10:00:00+00:00",
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
            "deleted_at": None,
            "is_archived": False,
        }

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "get" and path == "/rest/v1/cars":
                return ([listing], 200)
            if method == "patch" and path.startswith("/rest/v1/cars"):
                return ([], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expiry_reminder", return_value=("ok", None)) as mock_send_reminder:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            result = backend._run_listing_expiry_reminders_once(reminder_days_before=2)

        self.assertEqual(result["reminders_sent"], 0)
        mock_send_reminder.assert_not_called()

    def test_expiry_reminder_skips_deleted_listing(self):
        listing = {
            "id": "listing-deleted",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Deleted Listing",
            "status": "deleted",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-04T10:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-04T10:00:00+00:00",
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
            "deleted_at": "2026-04-02T10:00:00+00:00",
            "is_archived": False,
        }

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "get" and path == "/rest/v1/cars":
                return ([listing], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expiry_reminder", return_value=("ok", None)) as mock_send_reminder, \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)) as mock_send_expired:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            result = backend._run_listing_expiry_reminders_once(reminder_days_before=2)

        self.assertEqual(result["reminders_sent"], 0)
        mock_send_reminder.assert_not_called()
        mock_send_expired.assert_not_called()

    def test_lifecycle_sync_claims_expired_email_before_sending(self):
        record = {
            "id": "listing-expired-claim",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Expired Listing",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-02T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-02T00:00:00+00:00",
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
            "deleted_at": None,
            "is_archived": False,
        }
        patch_payloads = []

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "patch" and path.startswith("/rest/v1/cars"):
                patch_payloads.append(data)
                return ([{**record, **data}], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)) as mock_send_expired:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            backend._sync_listing_lifecycle("cars", record, hard_delete_archived=False)

        self.assertTrue(any("expired_email_sent_at" in payload for payload in patch_payloads))
        mock_send_expired.assert_called_once()

    def test_lifecycle_sync_does_not_send_expired_email_when_claim_fails(self):
        record = {
            "id": "listing-expired-claimed",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Expired Listing",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-02T00:00:00+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-05-02T00:00:00+00:00",
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
            "deleted_at": None,
            "is_archived": False,
        }

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "patch" and path.startswith("/rest/v1/cars"):
                if data and "expired_email_sent_at" in data:
                    return ([], 200)
                return ([{**record, **(data or {})}], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([], 200)
            return ([], 200)

        with patch.object(backend, "_utc_now") as mock_now, \
            patch.object(backend, "supabase_request", side_effect=fake_supabase_request), \
            patch.object(backend, "_send_listing_expired_email", return_value=("ok", None)) as mock_send_expired:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            backend._sync_listing_lifecycle("cars", record, hard_delete_archived=False)

        mock_send_expired.assert_not_called()


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

    def test_user_listings_includes_deleted_rows(self):
        def fake_collect(current_user, item_type):
            sample = {
                "car": [
                    {"id": "car-1", "status": "approved", "listing_state": "active", "created_at": "2026-05-01T00:00:00+00:00"},
                    {"id": "car-2", "status": "deleted", "listing_state": "deleted", "deleted_at": "2026-05-02T00:00:00+00:00", "created_at": "2026-05-02T00:00:00+00:00"},
                ],
                "bike": [],
                "part": [],
                "plate": [],
            }
            return sample[item_type], 200

        with patch.object(backend, "_collect_user_listing_records", side_effect=fake_collect), \
            patch.object(backend, "_get_user_listing_count", return_value=(0, None)):
            with backend.app.test_request_context("/api/user/listings"):
                response, status_code = backend.get_all_user_listings.__wrapped__(
                    "11111111-1111-1111-1111-111111111111"
                )

        self.assertEqual(status_code, 200)
        payload = json.loads(response.get_data(as_text=True))
        self.assertEqual([item["id"] for item in payload["listings"]], ["car-2", "car-1"])
        self.assertEqual([item["id"] for item in payload["cars"]], ["car-1", "car-2"])

    def test_user_listings_filters_deleted_status(self):
        def fake_collect(current_user, item_type):
            sample = {
                "car": [
                    {"id": "car-1", "status": "approved", "listing_state": "active", "created_at": "2026-05-01T00:00:00+00:00"},
                    {"id": "car-2", "status": "deleted", "listing_state": "deleted", "deleted_at": "2026-05-02T00:00:00+00:00", "created_at": "2026-05-02T00:00:00+00:00"},
                ],
                "bike": [],
                "part": [],
                "plate": [],
            }
            return sample[item_type], 200

        with patch.object(backend, "_collect_user_listing_records", side_effect=fake_collect), \
            patch.object(backend, "_get_user_listing_count", return_value=(0, None)):
            with backend.app.test_request_context("/api/user/listings?status=deleted"):
                response, status_code = backend.get_all_user_listings.__wrapped__(
                    "11111111-1111-1111-1111-111111111111"
                )

        self.assertEqual(status_code, 200)
        payload = json.loads(response.get_data(as_text=True))
        self.assertEqual([item["id"] for item in payload["listings"]], ["car-2"])
        self.assertEqual([item["id"] for item in payload["cars"]], ["car-2"])


class SavedListingVisibilityTests(unittest.TestCase):
    @patch.object(backend, "_sync_listing_lifecycle", side_effect=lambda table, record, **kwargs: record)
    @patch.object(backend, "supabase_request")
    def test_saved_listings_skip_deleted_and_missing_rows(self, mock_supabase_request, mock_sync):
        saved_rows = [
            {"id": "saved-1", "user_id": "user-1", "listing_id": "car-1", "listing_type": "car", "created_at": "2026-05-01T00:00:00+00:00"},
            {"id": "saved-2", "user_id": "user-1", "listing_id": "car-2", "listing_type": "car", "created_at": "2026-05-02T00:00:00+00:00"},
            {"id": "saved-3", "user_id": "user-1", "listing_id": "car-3", "listing_type": "car", "created_at": "2026-05-03T00:00:00+00:00"},
        ]
        records = [
            {"id": "car-1", "status": "approved", "listing_state": "active", "created_at": "2026-05-01T00:00:00+00:00"},
            {"id": "car-2", "status": "deleted", "listing_state": "deleted", "deleted_at": "2026-05-02T12:00:00+00:00", "created_at": "2026-05-02T00:00:00+00:00"},
        ]

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if path == "/rest/v1/saved_listings":
                return (saved_rows, 200)
            if path == "/rest/v1/cars":
                return (records, 200)
            if path == "/rest/v1/car_images":
                return ([], 200)
            return ([], 200)

        mock_supabase_request.side_effect = fake_supabase_request

        payload, status_code = backend._fetch_saved_listing_cards("user-1")

        self.assertEqual(status_code, 200)
        self.assertEqual([item["id"] for item in payload["items"]], ["car-1"])
        self.assertEqual(payload["saved_ids"], ["car:car-1"])
        self.assertEqual(payload["counts"]["car"], 1)
        self.assertEqual(payload["total"], 1)


class ListingOutcomeTransitionTests(unittest.TestCase):
    def test_renewal_clears_expiry_email_state_and_sets_cycle_job_ids(self):
        now = backend.datetime.datetime(2026, 4, 10, 8, 0, tzinfo=backend.datetime.timezone.utc)
        listing = {
            "id": "listing-renew-cycle",
            "extension_count": 2,
            "expires_at": "2026-04-12T08:00:00+00:00",
            "expiry_reminder_sent_at": "2026-04-10T08:00:00+00:00",
            "expired_email_sent_at": "2026-04-12T08:01:00+00:00",
        }

        updates = backend._build_renewed_listing_updates(listing, now=now)
        new_expires_at = backend._parse_datetime(updates["expires_at"])
        expires_ms = int(new_expires_at.timestamp() * 1000)

        self.assertEqual(updates["status"], "approved")
        self.assertIsNone(updates["expired_at"])
        self.assertIsNone(updates["expiry_reminder_sent_at"])
        self.assertIsNone(updates["expired_email_sent_at"])
        self.assertEqual(updates["renewed_at"], backend._isoformat_utc(now))
        self.assertEqual(
            updates["reminder_job_id"],
            f"listing:listing-renew-cycle:reminder:{expires_ms}",
        )
        self.assertEqual(
            updates["expiration_job_id"],
            f"listing:listing-renew-cycle:expire:{expires_ms}",
        )

    @patch.object(backend, "supabase_request")
    def test_user_delete_marks_listing_deleted_instead_of_hard_delete(self, mock_supabase_request):
        calls = []

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            calls.append((method, path, params, data, use_service_role))
            if method == "get" and path == "/rest/v1/cars":
                return ([{"id": "listing-delete", "user_id": "user-1", "status": "approved", "deleted_at": None}], 200)
            if method == "patch" and path == "/rest/v1/cars":
                return ([{"id": "listing-delete", **(data or {})}], 200)
            if path == "/rest/v1/listing_deletion_events":
                return ([{"id": "event-1"}], 201)
            return ([], 200)

        mock_supabase_request.side_effect = fake_supabase_request

        response, status = backend._delete_user_owned_listing(
            "user-1", "car", "listing-delete"
        )

        self.assertEqual(status, 200)
        self.assertTrue(response)
        self.assertFalse(any(call[0] == "delete" for call in calls))
        patch_call = next(call for call in calls if call[0] == "patch" and call[1] == "/rest/v1/cars")
        self.assertEqual(patch_call[3]["status"], "deleted")
        self.assertIsNotNone(patch_call[3]["deleted_at"])

    @patch.object(backend, "_sync_listing_lifecycle")
    @patch.object(backend, "_send_listing_status_email")
    @patch.object(backend, "supabase_request")
    def test_move_to_draft_resets_expired_listing_into_draft(
        self,
        mock_supabase_request,
        mock_send_listing_status_email,
        mock_sync_listing_lifecycle,
    ):
        listing = {
            "id": "listing-5",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Expired Listing",
            "status": "approved",
            "created_at": "2026-04-01T00:00:00+00:00",
            "expires_at": "2026-04-02T00:00:00+00:00",
            "expired_at": "2026-04-02T00:00:00+00:00",
            "retention_expires_at": "2026-05-02T00:00:00+00:00",
            "sold_response_deadline": "2026-04-04T00:00:00+00:00",
            "is_archived": False,
        }

        captured = {}

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "get" and path.startswith("/rest/v1/cars"):
                return ([listing], 200)
            if method == "patch" and path.startswith("/rest/v1/cars"):
                captured["data"] = data
                return ([listing], 200)
            return ([], 200)

        mock_supabase_request.side_effect = fake_supabase_request
        mock_sync_listing_lifecycle.side_effect = lambda *args, **kwargs: listing

        with patch.object(backend, "_utc_now") as mock_now:
            mock_now.return_value = backend.datetime.datetime(2026, 4, 3, 10, 0, tzinfo=backend.datetime.timezone.utc)
            with backend.app.test_request_context(
                "/api/user/listings/car/listing-5/outcome",
                method="POST",
                json={"outcome": "move_to_draft"},
                headers={"Origin": "https://example.com"},
            ):
                response, status_code = backend.set_listing_outcome.__wrapped__(
                    "11111111-1111-1111-1111-111111111111",
                    "car",
                    "listing-5",
                )

        self.assertEqual(status_code, 200)
        self.assertEqual(response.get_json()["message"], "Listing outcome saved")
        self.assertEqual(captured["data"]["status"], "draft")
        self.assertEqual(captured["data"]["listing_state"], "draft")
        self.assertEqual(captured["data"]["is_approved"], False)
        self.assertIsNone(captured["data"]["expired_at"])
        self.assertGreater(
            backend._parse_datetime(captured["data"]["expires_at"]),
            backend.datetime.datetime(2026, 4, 3, tzinfo=backend.datetime.timezone.utc),
        )
        mock_send_listing_status_email.assert_not_called()

    @patch.object(backend, "_send_listing_status_email")
    @patch.object(backend, "supabase_request")
    def test_extend_listing_repairs_stale_renewal_before_returning(
        self,
        mock_supabase_request,
        mock_send_listing_status_email,
    ):
        listing = {
            "id": "listing-6",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Renew Me",
            "status": "approved",
            "sold_status": None,
            "created_at": "2026-05-11T21:13:14.785710+00:00",
            "expires_at": "2026-05-26T21:13:14.785710+00:00",
            "expired_at": "2026-05-26T21:13:14.785710+00:00",
            "retention_expires_at": "2026-06-25T21:13:14.785710+00:00",
            "sold_response_deadline": "2026-05-28T21:13:14.785710+00:00",
            "last_extended_at": None,
            "sold_status_set_at": None,
            "extension_count": 1,
            "is_archived": False,
            "images": [],
            "listing_type": "car",
        }
        stale_after_patch = {
            **listing,
            "sold_status": "not_sold_renew",
            "last_extended_at": "2026-05-27T16:36:33.639735+00:00",
            "sold_status_set_at": "2026-05-27T16:36:33.639735+00:00",
            "extension_count": 2,
            # Simulate the production failure: the DB row comes back stale.
            "expires_at": "2026-05-26T21:13:14.785710+00:00",
            "expired_at": "2026-05-26T21:13:14.785710+00:00",
            "retention_expires_at": "2026-06-25T21:13:14.785710+00:00",
            "sold_response_deadline": "2026-05-28T21:13:14.785710+00:00",
        }
        repaired_listing = {
            **stale_after_patch,
            "expires_at": "2026-06-11T16:36:33.639735+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-07-11T16:36:33.639735+00:00",
            "sold_response_deadline": None,
            "is_archived": False,
        }

        patch_payloads = []
        get_count = {"cars": 0}

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "get" and path == "/rest/v1/cars":
                get_count["cars"] += 1
                if get_count["cars"] == 1:
                    return ([listing], 200)
                if get_count["cars"] == 2:
                    return ([stale_after_patch], 200)
                return ([repaired_listing], 200)
            if method == "patch" and path.startswith("/rest/v1/cars"):
                patch_payloads.append(data)
                return ([data], 200)
            return ([], 200)

        mock_supabase_request.side_effect = fake_supabase_request

        with patch.object(backend, "_utc_now") as mock_now:
            mock_now.return_value = backend.datetime.datetime(2026, 5, 27, 16, 36, 33, 639735, tzinfo=backend.datetime.timezone.utc)
            with backend.app.test_request_context(
                "/api/user/listings/car/listing-6/extend",
                method="POST",
                headers={"Origin": "https://example.com"},
            ):
                response, status_code = backend.extend_user_listing.__wrapped__(
                    "11111111-1111-1111-1111-111111111111",
                    "car",
                    "listing-6",
                )

        self.assertEqual(status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["message"], "Listing extended successfully")
        self.assertGreaterEqual(len(patch_payloads), 2)
        self.assertEqual(
            backend._parse_datetime(patch_payloads[-1]["expires_at"]),
            backend.datetime.datetime(2026, 6, 11, 16, 36, 33, 639735, tzinfo=backend.datetime.timezone.utc),
        )
        self.assertIsNone(patch_payloads[-1]["expired_at"])
        mock_send_listing_status_email.assert_called_once()

    @patch.object(backend, "_send_listing_status_email")
    @patch.object(backend, "supabase_request")
    def test_outcome_renew_repairs_stale_renewal_before_returning(
        self,
        mock_supabase_request,
        mock_send_listing_status_email,
    ):
        listing = {
            "id": "listing-7",
            "user_id": "11111111-1111-1111-1111-111111111111",
            "user_email": "owner@example.com",
            "listing_title": "Renew Through Outcome",
            "status": "approved",
            "sold_status": None,
            "created_at": "2026-05-12T09:24:37.207017+00:00",
            "expires_at": "2026-05-27T09:24:37.207017+00:00",
            "expired_at": "2026-05-27T09:24:37.207017+00:00",
            "retention_expires_at": "2026-06-26T09:24:37.207017+00:00",
            "sold_response_deadline": "2026-05-29T09:24:37.207017+00:00",
            "last_extended_at": None,
            "sold_status_set_at": None,
            "extension_count": 0,
            "is_archived": False,
        }
        stale_after_patch = {
            **listing,
            "sold_status": "not_sold_renew",
            "last_extended_at": "2026-05-27T14:47:06.253230+00:00",
            "sold_status_set_at": "2026-05-27T14:47:06.253230+00:00",
            "extension_count": 1,
        }
        repaired_listing = {
            **stale_after_patch,
            "expires_at": "2026-06-11T14:47:06.253230+00:00",
            "expired_at": None,
            "retention_expires_at": "2026-07-11T14:47:06.253230+00:00",
            "sold_response_deadline": None,
            "is_archived": False,
        }

        patch_payloads = []
        get_count = {"cars": 0}

        def fake_supabase_request(method, path, params=None, data=None, use_service_role=False, user_id=None):
            if method == "get" and path == "/rest/v1/cars":
                get_count["cars"] += 1
                if get_count["cars"] == 1:
                    return ([listing], 200)
                if get_count["cars"] == 2:
                    return ([stale_after_patch], 200)
                return ([repaired_listing], 200)
            if method == "patch" and path.startswith("/rest/v1/cars"):
                patch_payloads.append(data)
                return ([data], 200)
            return ([], 200)

        mock_supabase_request.side_effect = fake_supabase_request

        with patch.object(backend, "_utc_now") as mock_now:
            mock_now.return_value = backend.datetime.datetime(2026, 5, 27, 14, 47, 6, 253230, tzinfo=backend.datetime.timezone.utc)
            with backend.app.test_request_context(
                "/api/user/listings/car/listing-7/outcome",
                method="POST",
                json={"outcome": "not_sold_renew"},
                headers={"Origin": "https://example.com"},
            ):
                response, status_code = backend.set_listing_outcome.__wrapped__(
                    "11111111-1111-1111-1111-111111111111",
                    "car",
                    "listing-7",
                )

        self.assertEqual(status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["message"], "Listing outcome saved")
        self.assertGreaterEqual(len(patch_payloads), 2)
        self.assertEqual(
            backend._parse_datetime(patch_payloads[-1]["expires_at"]),
            backend.datetime.datetime(2026, 6, 11, 14, 47, 6, 253230, tzinfo=backend.datetime.timezone.utc),
        )
        self.assertIsNone(patch_payloads[-1]["expired_at"])
        mock_send_listing_status_email.assert_called_once()


if __name__ == "__main__":
    unittest.main()
