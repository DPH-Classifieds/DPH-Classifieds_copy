import unittest

from services.auto_review.decision import Decision, FailReason


class DecisionTests(unittest.TestCase):
    def test_approve_factory_has_no_reasons(self):
        d = Decision.approve(tier_matched="dealer_verified")
        self.assertTrue(d.approved)
        self.assertEqual(d.reasons, [])
        self.assertEqual(d.tier_matched, "dealer_verified")
        self.assertEqual(d.as_label_list(), [])

    def test_queue_factory_carries_reasons(self):
        d = Decision.queue(
            [FailReason("vin_year_mismatch", {"form": 2024, "decoded": 2020})]
        )
        self.assertFalse(d.approved)
        self.assertEqual(len(d.reasons), 1)
        self.assertEqual(d.reasons[0].label, "vin_year_mismatch")
        self.assertEqual(d.as_label_list(), ["vin_year_mismatch"])
        self.assertIsNone(d.tier_matched)

    def test_signals_passthrough(self):
        d = Decision.approve(tier_matched="admin", signals={"trust": "admin"})
        self.assertEqual(d.signals, {"trust": "admin"})


if __name__ == "__main__":
    unittest.main()
