import os
import unittest
from unittest.mock import patch

import app as backend


class InitialListingStatusTests(unittest.TestCase):
    def test_default_disabled_returns_pending(self):
        env = {k: v for k, v in os.environ.items() if k != "AUTO_REVIEW_WORKER_ENABLED"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(backend._initial_listing_status(), "pending")

    def test_explicit_false_returns_pending(self):
        with patch.dict(os.environ, {"AUTO_REVIEW_WORKER_ENABLED": "false"}):
            self.assertEqual(backend._initial_listing_status(), "pending")

    def test_enabled_returns_pending_auto_review(self):
        for raw in ("true", "TRUE", "1", "yes", "on"):
            with self.subTest(raw=raw):
                with patch.dict(os.environ, {"AUTO_REVIEW_WORKER_ENABLED": raw}):
                    self.assertEqual(
                        backend._initial_listing_status(), "pending_auto_review"
                    )

    def test_garbage_returns_pending(self):
        with patch.dict(os.environ, {"AUTO_REVIEW_WORKER_ENABLED": "maybe"}):
            self.assertEqual(backend._initial_listing_status(), "pending")


if __name__ == "__main__":
    unittest.main()
