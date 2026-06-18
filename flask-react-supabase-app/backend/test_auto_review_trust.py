import unittest

from services.auto_review.trust import TrustContext, evaluate_trust


def _ctx(**over):
    base = dict(
        is_admin=False,
        dealer_verified=False,
        approved_listings_count=0,
        rejections_last_90d=0,
        reports_last_90d=0,
        email_verified=False,
    )
    base.update(over)
    return TrustContext(**base)


class TrustTests(unittest.TestCase):
    def test_admin_wins(self):
        r = evaluate_trust(_ctx(is_admin=True))
        self.assertTrue(r.matched)
        self.assertEqual(r.tier, "admin")

    def test_dealer_verified(self):
        r = evaluate_trust(_ctx(dealer_verified=True))
        self.assertTrue(r.matched)
        self.assertEqual(r.tier, "dealer_verified")

    def test_clean_individual_beats_email_only(self):
        r = evaluate_trust(_ctx(approved_listings_count=5, email_verified=True))
        self.assertTrue(r.matched)
        self.assertEqual(r.tier, "clean_individual")

    def test_recent_rejection_falls_back_to_email(self):
        r = evaluate_trust(
            _ctx(approved_listings_count=5, rejections_last_90d=1, email_verified=True)
        )
        self.assertTrue(r.matched)
        self.assertEqual(r.tier, "email_verified")

    def test_recent_report_falls_back_to_email(self):
        r = evaluate_trust(
            _ctx(approved_listings_count=5, reports_last_90d=1, email_verified=True)
        )
        self.assertEqual(r.tier, "email_verified")

    def test_email_verified_only(self):
        r = evaluate_trust(_ctx(email_verified=True))
        self.assertTrue(r.matched)
        self.assertEqual(r.tier, "email_verified")

    def test_no_match_for_unverified(self):
        r = evaluate_trust(_ctx())
        self.assertFalse(r.matched)
        self.assertIsNone(r.tier)

    def test_two_priors_not_enough(self):
        r = evaluate_trust(_ctx(approved_listings_count=2, email_verified=False))
        self.assertFalse(r.matched)


if __name__ == "__main__":
    unittest.main()
