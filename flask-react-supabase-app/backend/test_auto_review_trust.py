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
        phone_verified=False,
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

    def test_email_and_phone_verified(self):
        r = evaluate_trust(_ctx(email_verified=True, phone_verified=True))
        self.assertTrue(r.matched)
        self.assertEqual(r.tier, "verified_user")

    def test_email_only_not_enough(self):
        r = evaluate_trust(_ctx(email_verified=True))
        self.assertFalse(r.matched)

    def test_phone_only_not_enough(self):
        r = evaluate_trust(_ctx(phone_verified=True))
        self.assertFalse(r.matched)

    def test_no_match_for_unverified(self):
        r = evaluate_trust(_ctx())
        self.assertFalse(r.matched)
        self.assertIsNone(r.tier)


if __name__ == "__main__":
    unittest.main()
