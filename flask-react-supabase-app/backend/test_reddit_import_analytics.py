"""Admin Reddit import analytics endpoint: aggregation + authorization.

Run: ./.venv/bin/python -m unittest test_reddit_import_analytics -v
"""
import unittest
from unittest.mock import patch

import app as backend


def _fetch_all_rows_router(car_rows, events):
    def _fake(path, params, **kwargs):
        if path == "/rest/v1/cars":
            return car_rows, 200
        if path == "/rest/v1/platform_events":
            return events, 200
        return [], 200
    return _fake


class RedditImportAnalyticsEndpointTests(unittest.TestCase):
    def test_returns_opens_and_import_health(self):
        car_rows = [
            {"id": "car-1", "listing_title": "2018 BMW 120i", "source_url": "https://www.reddit.com/r/x/1/",
             "source_removed_at": None, "view_count": 10},
            {"id": "car-2", "listing_title": "gone", "source_url": "https://www.reddit.com/r/x/2/",
             "source_removed_at": "2026-07-20T00:00:00Z", "view_count": 3},
        ]
        events = [{"listing_id": "car-1", "visitor_id": "v1", "occurred_at": "2026-07-22T10:00:00Z"}]
        run = [{"status": "succeeded", "created_count": 2, "skipped_count": 1, "started_at": "2026-07-23T00:00:00Z"}]

        with patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), \
                patch.object(backend, "_api_cache_get", return_value=None), \
                patch.object(backend, "_api_cache_set"), \
                patch.object(backend, "_fetch_all_rows", side_effect=_fetch_all_rows_router(car_rows, events)), \
                patch.object(backend, "supabase_request", return_value=(run, 200)):
            with backend.app.test_request_context("/api/admin/reddit-import-analytics?days=30"):
                response, status = backend.get_admin_reddit_import_analytics.__wrapped__("admin-1")

        self.assertEqual(status, 200)
        body = response.get_json()
        self.assertEqual(body["opens"]["total"], 1)
        self.assertEqual(body["opens"]["unique_visitors"], 1)
        self.assertEqual(body["listings"]["total"], 2)
        self.assertEqual(body["listings"]["live"], 1)
        self.assertEqual(body["listings"]["removed"], 1)
        self.assertEqual(body["latest_run"]["status"], "succeeded")
        self.assertEqual(body["top_listings"][0]["listing_id"], "car-1")
        self.assertEqual(body["top_listings"][0]["opens"], 1)

    def test_empty_state_is_not_an_error(self):
        with patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), \
                patch.object(backend, "_api_cache_get", return_value=None), \
                patch.object(backend, "_api_cache_set"), \
                patch.object(backend, "_fetch_all_rows", side_effect=_fetch_all_rows_router([], [])), \
                patch.object(backend, "supabase_request", return_value=([], 200)):
            with backend.app.test_request_context("/api/admin/reddit-import-analytics"):
                response, status = backend.get_admin_reddit_import_analytics.__wrapped__("admin-1")
        self.assertEqual(status, 200)
        body = response.get_json()
        self.assertEqual(body["opens"]["total"], 0)
        self.assertIsNone(body["latest_run"])

    def test_non_admin_cannot_read(self):
        with patch.object(backend, "_require_admin_api_user", return_value=None):
            with backend.app.test_request_context("/api/admin/reddit-import-analytics"):
                response, status = backend.get_admin_reddit_import_analytics.__wrapped__("member-1")
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
