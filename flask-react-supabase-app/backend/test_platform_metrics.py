#!/usr/bin/env python3
import unittest
import os
import sys
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.dirname(__file__))

import app as backend
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

    def test_listing_view_is_counted_as_a_page_view(self):
        metrics = build_platform_metrics([
            {
                "event_name": "listing_view",
                "page_path": "/cars/abc-123",
                "listing_type": "car",
                "listing_id": "abc-123",
                "session_id": "session-a",
                "visitor_id": "visitor-a",
                "created_at": "2026-07-20T10:00:00Z",
            }
        ], days=30)

        self.assertEqual(metrics["user_metrics"]["page_views"], 1)

    def test_listing_value_is_not_reported_as_gmv_or_ltv(self):
        metrics = build_platform_metrics(
            [
                {
                    "event_name": "page_view",
                    "page_path": "/cars/car-1",
                    "visitor_id": "visitor-1",
                    "session_id": "session-1",
                    "created_at": "2026-09-08T10:00:00Z",
                }
            ],
            car_rows=[
                {
                    "id": "car-1",
                    "expected_selling_price": 100000,
                    "user_id": "seller-1",
                }
            ],
            days=30,
        )

        financial = metrics["financial_metrics"]
        self.assertIsNone(financial["gross_merchandise_value"])
        self.assertEqual(financial["listed_inventory_value"], 100000)
        self.assertIsNone(financial["estimated_ltv"])
        self.assertIsNone(financial["ltv_cac_ratio"])


class PlatformAnalyticsRouteTests(unittest.TestCase):
    @patch.object(backend, "ensure_platform_events_table")
    @patch.object(backend, "supabase_request")
    def test_event_route_returns_clear_error_when_table_missing(self, mock_supabase_request, mock_ensure_table):
        first_insert = ({"error": "relation \"platform_events\" does not exist"}, 404)
        mock_supabase_request.side_effect = [
            first_insert,
        ]
        mock_ensure_table.return_value = False

        with backend.app.test_request_context(
            "/api/analytics/events",
            method="POST",
            json={
                "event_name": "page_view",
                "page_path": "/cars/abc-123",
                "session_id": "session-1",
                "visitor_id": "visitor-1",
            },
        ):
            response = backend.track_platform_event()

        self.assertEqual(response[1], 503)
        self.assertTrue(mock_ensure_table.called)
        self.assertEqual(mock_supabase_request.call_count, 1)

    @patch.object(backend, "supabase_request")
    def test_event_route_acknowledges_a_replayed_server_generated_row_id(self, mock_supabase_request):
        mock_supabase_request.return_value = (
            {
                "code": "23505",
                "message": 'duplicate key value violates unique constraint "platform_events_pkey"',
                "details": "Key (id)=(same-row-id) already exists.",
            },
            409,
        )

        with backend.app.test_request_context(
            "/api/analytics/events",
            method="POST",
            json={
                "event_name": "page_view",
                "page_path": "/cars/abc-123",
                "session_id": "session-1",
                "visitor_id": "visitor-1",
            },
        ):
            response, status = backend.track_platform_event()

        self.assertEqual(status, 200)
        self.assertEqual(response.get_json(), {"success": True, "duplicate": True})


class LeadDefinitionTests(unittest.TestCase):
    def test_total_leads_excludes_vin_events(self):
        # A "lead" is a genuine buyer-intent contact action only. VIN opens/reveals
        # are spec reveals and must NOT inflate total_leads.
        self.assertNotIn("vin_open", backend.CONTACT_LEAD_ACTIONS)
        self.assertNotIn("vin_reveal", backend.CONTACT_LEAD_ACTIONS)
        # form_submit is a generic UX event, not a listing contact — not a lead.
        self.assertEqual(
            backend.CONTACT_LEAD_ACTIONS,
            {"call_click", "whatsapp_click"},
        )

        lead_event_counts = {
            "call_click": 26,
            "whatsapp_click": 37,
            "vin_open": 261,
            "vin_reveal": 132,
        }
        total_leads = sum(
            lead_event_counts.get(a, 0) for a in backend.CONTACT_LEAD_ACTIONS
        )
        self.assertEqual(total_leads, 63)  # 26 + 37, not 456


if __name__ == "__main__":
    unittest.main()
