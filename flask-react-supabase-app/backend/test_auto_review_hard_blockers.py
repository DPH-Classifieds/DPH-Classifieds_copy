import unittest

from services.auto_review.hard_blockers import (
    evaluate_image_blockers,
    evaluate_profanity,
)
from services.auto_review.vision import VisionResult


class FakeProvider:
    def __init__(self, results):
        self._results = list(results)

    def analyze(self, image_bytes):
        return self._results.pop(0)


class ImageBlockerTests(unittest.TestCase):
    def test_clean_passes(self):
        clean = VisionResult(available=True)
        an = evaluate_image_blockers(
            [b"a", b"b"], FakeProvider([clean, clean]), face_confidence_threshold=0.6
        )
        self.assertTrue(an.ok, msg=an.reasons)
        self.assertEqual(len(an.raw), 2)

    def test_unavailable_provider_is_soft_fail(self):
        an = evaluate_image_blockers(
            [b"x"],
            FakeProvider([VisionResult(available=False)]),
            face_confidence_threshold=0.6,
        )
        self.assertFalse(an.ok)
        self.assertIn("vision_unavailable", [r.label for r in an.reasons])

    def test_face_blocks_listing(self):
        with_face = VisionResult(available=True, face_count=1)
        clean = VisionResult(available=True)
        an = evaluate_image_blockers(
            [b"x", b"y"],
            FakeProvider([clean, with_face]),
            face_confidence_threshold=0.6,
        )
        self.assertFalse(an.ok)
        self.assertIn("face_detected_in_image", [r.label for r in an.reasons])

    def test_face_index_recorded(self):
        an = evaluate_image_blockers(
            [b"x", b"y"],
            FakeProvider(
                [
                    VisionResult(available=True),
                    VisionResult(available=True, face_count=2),
                ]
            ),
            face_confidence_threshold=0.6,
        )
        face_reason = next(r for r in an.reasons if r.label == "face_detected_in_image")
        self.assertEqual(face_reason.details["image_index"], 1)
        self.assertEqual(face_reason.details["face_count"], 2)

    def test_nsfw_blocks(self):
        an = evaluate_image_blockers(
            [b"x"],
            FakeProvider([VisionResult(available=True, nsfw_likely=True)]),
            face_confidence_threshold=0.6,
        )
        self.assertIn("nsfw_image", [r.label for r in an.reasons])

    def test_contact_text_phone_blocks(self):
        an = evaluate_image_blockers(
            [b"x"],
            FakeProvider(
                [VisionResult(available=True, contact_text=["+971 50 123 4567"])]
            ),
            face_confidence_threshold=0.6,
        )
        self.assertIn("contact_info_in_image", [r.label for r in an.reasons])

    def test_contact_text_email_blocks(self):
        an = evaluate_image_blockers(
            [b"x"],
            FakeProvider(
                [VisionResult(available=True, contact_text=["call@example.com"])]
            ),
            face_confidence_threshold=0.6,
        )
        self.assertIn("contact_info_in_image", [r.label for r in an.reasons])

    def test_clean_text_does_not_trip(self):
        an = evaluate_image_blockers(
            [b"x"],
            FakeProvider(
                [VisionResult(available=True, contact_text=["white camry"])]
            ),
            face_confidence_threshold=0.6,
        )
        self.assertTrue(an.ok, msg=an.reasons)

    def test_empty_image_list_clean(self):
        an = evaluate_image_blockers(
            [], FakeProvider([]), face_confidence_threshold=0.6
        )
        self.assertTrue(an.ok)


class ProfanityTests(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(
            evaluate_profanity(["Well maintained Camry, no accidents."]), []
        )

    def test_dirty(self):
        r = evaluate_profanity(["this sh*t is broken", None, ""])
        self.assertEqual(r[0].label, "profanity_detected")

    def test_empty_inputs(self):
        self.assertEqual(evaluate_profanity([]), [])
        self.assertEqual(evaluate_profanity([None]), [])


if __name__ == "__main__":
    unittest.main()
