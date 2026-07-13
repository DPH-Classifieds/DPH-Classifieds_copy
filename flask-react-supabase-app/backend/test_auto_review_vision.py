import unittest

from services.auto_review.vision import (
    GoogleVisionProvider,
    NullVisionProvider,
    VisionResult,
    select_vision_provider,
)


class NullVisionProviderTests(unittest.TestCase):
    def test_analyze_returns_safe_pass_through_result(self):
        provider = NullVisionProvider()
        result = provider.analyze(b"\x89PNG_fake")
        self.assertTrue(result.available)
        self.assertEqual(result.face_count, 0)
        self.assertFalse(result.nsfw_likely)
        self.assertFalse(result.contains_vehicle)
        self.assertEqual(result.contact_text, [])


class SelectProviderTests(unittest.TestCase):
    def test_default_is_null(self):
        self.assertIsInstance(select_vision_provider(env={}), NullVisionProvider)

    def test_empty_string_is_null(self):
        self.assertIsInstance(
            select_vision_provider(env={"AUTO_REVIEW_VISION_PROVIDER": ""}),
            NullVisionProvider,
        )

    def test_explicit_null_keyword(self):
        for keyword in ("null", "none", "NULL"):
            with self.subTest(keyword=keyword):
                self.assertIsInstance(
                    select_vision_provider(
                        env={"AUTO_REVIEW_VISION_PROVIDER": keyword}
                    ),
                    NullVisionProvider,
                )

    def test_unknown_provider_raises(self):
        with self.assertRaises(ValueError):
            select_vision_provider(env={"AUTO_REVIEW_VISION_PROVIDER": "bogus"})

    def test_google_requires_api_key(self):
        with self.assertRaises(ValueError):
            select_vision_provider(env={"AUTO_REVIEW_VISION_PROVIDER": "google"})

    def test_google_builds_with_key(self):
        provider = select_vision_provider(
            env={
                "AUTO_REVIEW_VISION_PROVIDER": "google",
                "GOOGLE_VISION_API_KEY": "key_x",
            }
        )
        self.assertIsInstance(provider, GoogleVisionProvider)


class GoogleVisionProviderTests(unittest.TestCase):
    def test_analyze_not_implemented(self):
        provider = GoogleVisionProvider(api_key="abc")
        with self.assertRaises(NotImplementedError):
            provider.analyze(b"bytes")


class VisionResultTests(unittest.TestCase):
    def test_default_contact_text_is_empty_list_not_shared(self):
        a = VisionResult(available=True)
        b = VisionResult(available=True)
        self.assertEqual(a.contact_text, [])
        self.assertIsNot(a.contact_text, b.contact_text)


if __name__ == "__main__":
    unittest.main()
