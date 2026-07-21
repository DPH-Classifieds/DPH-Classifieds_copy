import unittest

import app as backend
from services.analytics_events import AnalyticsEventError, normalize_analytics_event


class AnalyticsEventTests(unittest.TestCase):
    def test_listing_view_requires_listing_and_anonymous_identity(self):
        with self.assertRaises(AnalyticsEventError):
            normalize_analytics_event({"event_name": "listing_view"}, None)

    def test_contact_event_strips_sensitive_payload_and_normalizes(self):
        event = normalize_analytics_event({
            "event_id": "d2719c04-9e3a-4e95-a2f2-1498259f5aea",
            "event_name": "call_click",
            "listing_type": "cars",
            "listing_id": "listing-1",
            "visitor_id": "visitor-1",
            "session_id": "session-1",
            "platform": "web",
            "metadata": {"source": "detail", "phone": "+971000", "message": "secret"},
        }, None)
        self.assertEqual(event["listing_type"], "car")
        self.assertEqual(event["event_name"], "call_click")
        self.assertEqual(event["metadata"], {"source": "detail"})

    def test_rejects_unknown_event_and_bad_uuid(self):
        with self.assertRaises(AnalyticsEventError):
            normalize_analytics_event({"event_name": "anything"}, None)
        with self.assertRaises(AnalyticsEventError):
            normalize_analytics_event({
                "event_id": "bad", "event_name": "page_view", "visitor_id": "v", "session_id": "s"
            }, None)

    def test_accepts_non_conversion_tracker_events(self):
        event = normalize_analytics_event({
            "event_name": "button_click", "visitor_id": "visitor-1", "session_id": "session-1"
        })
        self.assertEqual(event["event_name"], "button_click")

    def test_legacy_view_endpoint_does_not_mutate_a_listing_counter(self):
        with backend.app.test_request_context("/api/cars/listing-1/view", method="POST"):
            response, status = backend.track_car_view("listing-1")

        self.assertEqual(status, 202)
        self.assertIn("canonical analytics", response.get_json()["message"])
