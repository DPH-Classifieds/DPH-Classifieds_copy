import unittest

from services.auto_review.decision import FailReason
from services.auto_review.hard_blockers import ImageAnalysis
from services.auto_review.rules import evaluate
from services.auto_review.sync_gate import SyncGateResult
from services.auto_review.trust import TrustResult
from services.auto_review.vin_gate import VinGateResult


def _ok_signals():
        return {
            "trust": TrustResult(True, "dealer_verified"),
            "image_analysis": ImageAnalysis(ok=True, reasons=[], raw=[1, 2, 3]),
            "vin": VinGateResult(ok=True, reasons=[], decoded={"make": "Honda"}),
            "sync_gate": SyncGateResult(ok=True, missing=[]),
            "profanity": [],
            "duplicate": None,
            "price_outlier": None,
            "user_under_review": False,
        }


class RulesTests(unittest.TestCase):
    def test_full_pass_returns_approve(self):
        d = evaluate("car", listing={"make": "Honda"}, signals=_ok_signals())
        self.assertTrue(d.approved)
        self.assertEqual(d.tier_matched, "dealer_verified")
        self.assertIn("raw", d.signals)

    def test_face_fails_queues(self):
        s = _ok_signals()
        s["image_analysis"] = ImageAnalysis(
            ok=False, reasons=[FailReason("face_detected_in_image", {"image_index": 0})]
        )
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("face_detected_in_image", d.as_label_list())

    def test_vin_skipped_for_parts(self):
        s = _ok_signals()
        s["vin"] = VinGateResult(
            ok=False, reasons=[FailReason("vin_format_invalid", {})], decoded={}
        )
        d = evaluate("part", listing={}, signals=s)
        self.assertTrue(d.approved, msg=d.as_label_list())

    def test_vin_skipped_for_plates(self):
        s = _ok_signals()
        s["vin"] = VinGateResult(
            ok=False, reasons=[FailReason("vin_format_invalid", {})], decoded={}
        )
        d = evaluate("plate", listing={}, signals=s)
        self.assertTrue(d.approved)

    def test_missing_vin_signal_for_car_queues(self):
        s = _ok_signals()
        s["vin"] = None
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("vin_missing", d.as_label_list())

    def test_missing_required_fields_queues(self):
        s = _ok_signals()
        s["sync_gate"] = SyncGateResult(ok=False, missing=["vin", "photos"])
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("missing_required_fields", d.as_label_list())

    def test_no_trust_queues(self):
        s = _ok_signals()
        s["trust"] = TrustResult(False, None)
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("no_trust_tier", d.as_label_list())

    def test_user_under_review_queues(self):
        s = _ok_signals()
        s["user_under_review"] = True
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("user_under_review", d.as_label_list())

    def test_profanity_signal_propagates(self):
        s = _ok_signals()
        s["profanity"] = [FailReason("profanity_detected", {})]
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("profanity_detected", d.as_label_list())

    def test_duplicate_signal_propagates(self):
        s = _ok_signals()
        s["duplicate"] = FailReason("duplicate_listing", {"existing_id": "abc"})
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("duplicate_listing", d.as_label_list())

    def test_multiple_reasons_collected(self):
        s = _ok_signals()
        s["trust"] = TrustResult(False, None)
        s["image_analysis"] = ImageAnalysis(
            ok=False, reasons=[FailReason("face_detected_in_image", {})]
        )
        d = evaluate("car", listing={}, signals=s)
        labels = d.as_label_list()
        self.assertIn("no_trust_tier", labels)
        self.assertIn("face_detected_in_image", labels)


if __name__ == "__main__":
    unittest.main()
