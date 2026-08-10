"""Anti-scraper guard for anonymous phone/WhatsApp click tracking.

Exercises the pure limiter + bot-UA heuristic (no Flask context needed). Forces
the in-memory path so it's deterministic regardless of Redis availability.
"""
import unittest

import app


class ContactLeadRateLimitTests(unittest.TestCase):
    def setUp(self):
        self._orig = app._redis_fixed_window_rate_limited
        app._redis_fixed_window_rate_limited = lambda *a, **k: None  # force in-memory
        app.CONTACT_LEAD_RATE_LIMIT.clear()

    def tearDown(self):
        app._redis_fixed_window_rate_limited = self._orig
        app.CONTACT_LEAD_RATE_LIMIT.clear()

    def test_allows_up_to_max_then_blocks(self):
        max_n = app.CONTACT_LEAD_RATE_LIMIT_MAX
        for i in range(max_n):
            self.assertFalse(
                app._contact_lead_rate_limited("vid:alice"), f"call {i} should pass"
            )
        self.assertTrue(app._contact_lead_rate_limited("vid:alice"), "max+1 must block")

    def test_keys_are_independent(self):
        for _ in range(app.CONTACT_LEAD_RATE_LIMIT_MAX):
            app._contact_lead_rate_limited("vid:alice")
        self.assertTrue(app._contact_lead_rate_limited("vid:alice"))
        # A different visitor and a different namespace are unaffected.
        self.assertFalse(app._contact_lead_rate_limited("vid:bob"))
        self.assertFalse(app._contact_lead_rate_limited("ip:1.2.3.4"))

    def test_empty_key_never_limits(self):
        self.assertFalse(app._contact_lead_rate_limited(""))


class ProbableBotUserAgentTests(unittest.TestCase):
    def test_flags_scripts_and_headless(self):
        for ua in (
            "python-requests/2.31.0",
            "curl/8.1.2",
            "Scrapy/2.11 (+https://scrapy.org)",
            "Mozilla/5.0 (X11) HeadlessChrome/120.0",
            "node-fetch/1.0",
            "",  # no UA at all
            None,
        ):
            self.assertTrue(app._probable_bot_user_agent(ua), f"should flag {ua!r}")

    def test_passes_real_browsers(self):
        for ua in (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ):
            self.assertFalse(app._probable_bot_user_agent(ua), f"should pass {ua!r}")


if __name__ == "__main__":
    unittest.main()
