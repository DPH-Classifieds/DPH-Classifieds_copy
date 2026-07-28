import unittest
from unittest.mock import patch

import app as backend


class DraftReminderPushTests(unittest.TestCase):
    """Draft reminders must fire a push notification alongside the email, the
    same way the saved-car reminder does. Deep-links to the Sell tab because a
    draft isn't public (no detail screen to open)."""

    def test_status_draft_listing_reminder_sends_push(self):
        listing = {"id": "car-1", "listing_title": "BMW M3", "draft_reminder_count": 0}
        with patch.object(backend, "get_user_email", return_value="u@example.com"), \
             patch.object(backend, "_send_listing_draft_reminder_email", return_value=(None, None)), \
             patch.object(backend, "supabase_request", return_value=({}, 200)), \
             patch.object(backend, "_notify_user_push") as push:
            ok = backend._send_draft_listing_reminder(
                "user-1", "car", listing, "cars", "2026-07-28T00:00:00+00:00",
            )

        self.assertTrue(ok)
        push.assert_called_once()
        args, kwargs = push.call_args
        self.assertEqual(args[0], "user-1")                       # user_id
        self.assertIn("Finish", args[1])                          # title
        self.assertIn("car", args[2])                             # body mentions type
        self.assertEqual(kwargs["data"], {"path": "/(tabs)/(post)"})

    def test_no_push_when_draft_email_fails(self):
        listing = {"id": "car-2", "listing_title": "Audi", "draft_reminder_count": 0}
        with patch.object(backend, "get_user_email", return_value="u@example.com"), \
             patch.object(backend, "_send_listing_draft_reminder_email", return_value=(None, "smtp down")), \
             patch.object(backend, "supabase_request", return_value=({}, 200)), \
             patch.object(backend, "_notify_user_push") as push:
            ok = backend._send_draft_listing_reminder(
                "user-1", "car", listing, "cars", "2026-07-28T00:00:00+00:00",
            )

        self.assertFalse(ok)
        push.assert_not_called()


if __name__ == "__main__":
    unittest.main()
