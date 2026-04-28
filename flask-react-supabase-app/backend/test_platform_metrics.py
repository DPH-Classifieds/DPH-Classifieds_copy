#!/usr/bin/env python3
import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from analytics_metrics import build_platform_metrics, classify_platform_path


class PlatformAnalyticsHelperTests(unittest.TestCase):
    def test_classify_platform_path_detects_listing_details(self):
        self.assertEqual(
            classify_platform_path("/cars/abc-123"),
            {"listing_type": "car", "listing_id": "abc-123"},
        )
        self.assertEqual(
            classify_platform_path("/plates/plate-99"),
            {"listing_type": "plate", "listing_id": "plate-99"},
        )

    def test_build_platform_metrics_rolls_up_sessions_and_demand(self):
        platform_events = [
            {
                "event_name": "page_view",
                "page_path": "/cars/abc-123",
                "listing_type": "car",
                "listing_id": "abc-123",
                "session_id": "session-a",
                "visitor_id": "visitor-1",
                "created_at": "2026-04-29T10:00:00Z",
            },
            {
                "event_name": "click",
                "page_path": "/cars/abc-123",
                "listing_type": "car",
                "listing_id": "abc-123",
                "session_id": "session-a",
                "visitor_id": "visitor-1",
                "created_at": "2026-04-29T10:00:10Z",
            },
            {
                "event_name": "page_exit",
                "page_path": "/cars/abc-123",
                "listing_type": "car",
                "listing_id": "abc-123",
                "session_id": "session-a",
                "visitor_id": "visitor-1",
                "duration_ms": 90000,
                "created_at": "2026-04-29T10:01:30Z",
            },
            {
                "event_name": "page_view",
                "page_path": "/",
                "session_id": "session-b",
                "visitor_id": "visitor-2",
                "created_at": "2026-04-29T11:00:00Z",
            },
            {
                "event_name": "page_exit",
                "page_path": "/",
                "session_id": "session-b",
                "visitor_id": "visitor-2",
                "duration_ms": 5000,
                "created_at": "2026-04-29T11:00:05Z",
            },
            {
                "event_name": "page_view",
                "page_path": "/plates/p-1",
                "listing_type": "plate",
                "listing_id": "p-1",
                "session_id": "session-c",
                "visitor_id": "visitor-3",
                "created_at": "2026-04-29T11:30:00Z",
            },
        ]

        car_rows = [
            {
                "id": "abc-123",
                "body_type": "SUV",
                "vehicle_type": "Used",
                "expected_selling_price": 100000,
                "view_count": 9,
                "user_id": "seller-1",
                "status": "approved",
            },
            {
                "id": "def-456",
                "body_type": "Sedan",
                "vehicle_type": "Luxury",
                "expected_selling_price": 250000,
                "view_count": 2,
                "user_id": "seller-2",
                "status": "approved",
            },
        ]

        plate_rows = [
            {
                "id": "p-1",
                "city": "Dubai",
                "code": "A",
                "number": "7",
                "digits": 1,
                "price": 700000,
                "plate_format": "Any format",
                "view_count": 5,
                "user_id": "seller-3",
                "status": "approved",
            }
        ]

        metrics = build_platform_metrics(
            platform_events,
            car_rows=car_rows,
            plate_rows=plate_rows,
            days=30,
        )

        self.assertEqual(metrics["user_metrics"]["sessions"], 3)
        self.assertEqual(metrics["user_metrics"]["page_views"], 3)
        self.assertEqual(metrics["user_metrics"]["bounce_rate_percent"], 66.67)
        self.assertAlmostEqual(metrics["user_metrics"]["avg_pages_per_session"], 1.0)
        self.assertEqual(metrics["user_metrics"]["conversion_sessions"], 1)

        self.assertEqual(metrics["car_metrics"]["total_listings"], 2)
        self.assertEqual(metrics["car_metrics"]["most_viewed_segment"]["segment"], "SUV")
        self.assertEqual(metrics["car_metrics"]["most_viewed_segment"]["views"], 1)

        self.assertEqual(metrics["plate_metrics"]["total_listings"], 1)
        self.assertEqual(metrics["plate_metrics"]["most_in_demand"]["segment"], "Dubai")
        self.assertEqual(metrics["plate_metrics"]["most_in_demand"]["views"], 1)


if __name__ == "__main__":
    unittest.main()
