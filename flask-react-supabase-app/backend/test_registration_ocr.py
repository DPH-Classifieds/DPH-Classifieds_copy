#!/usr/bin/env python3
import io
import os
import unittest
from unittest.mock import Mock, patch

from PIL import Image

import app as backend
from services import registration_ocr


VALID_VIN = "1HGCM82633A004352"


class FakeOCRProvider:
    def __init__(self, text):
        self.text = text

    def extract_text(self, image):
        return self.text


class FakeVINDecoder:
    def __init__(self, result):
        self.result = result

    def validate_and_decode(self, vin):
        decoded = dict(self.result)
        decoded["vin"] = vin
        return decoded


def _jpeg_bytes():
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color=(255, 255, 255)).save(buffer, format="JPEG")
    buffer.seek(0)
    return buffer


class RegistrationOCRServiceTests(unittest.TestCase):
    def test_extracts_label_variants_and_persists_scan(self):
        ocr_text = "\n".join(
            [
                "Manufacturer: Honda",
                "Type: Accord",
                "Model Year: 2003",
                f"Chassis: {VALID_VIN}",
            ]
        )
        decoder = FakeVINDecoder(
            {
                "is_valid": True,
                "checksum_valid": True,
                "decoded": {
                    "make": "Honda",
                    "model": "Accord",
                    "year": "2003",
                },
                "errors": [],
            }
        )

        persisted = []

        result = registration_ocr.scan_registration_image(
            _jpeg_bytes(),
            document_type="mulkiya",
            metadata={
                "listing_type": "car",
                "listing_id": "listing-123",
                "user_id": "user-123",
            },
            ocr_provider=FakeOCRProvider(ocr_text),
            vin_decoder=decoder,
            persist_func=lambda payload: persisted.append(payload) or [{"id": "scan-1"}],
        )

        self.assertEqual(result["fields"]["make"], "Honda")
        self.assertEqual(result["fields"]["model"], "Accord")
        self.assertEqual(result["fields"]["year"], "2003")
        self.assertEqual(result["fields"]["vin"], VALID_VIN)
        self.assertFalse(result["needs_review"])
        self.assertEqual(result["review_reasons"], [])
        self.assertGreaterEqual(result["confidence"]["overall"], 0.85)
        self.assertEqual(result["scan_id"], "scan-1")
        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted[0]["listing_id"], "listing-123")
        self.assertEqual(persisted[0]["document_type"], "mulkiya")
        self.assertEqual(persisted[0]["raw_text"], ocr_text)
        self.assertFalse(persisted[0]["needs_review"])

    def test_marks_review_when_decoder_disagrees(self):
        result = registration_ocr.scan_registration_image(
            _jpeg_bytes(),
            ocr_provider=FakeOCRProvider(
                f"Brand: Toyota\nModel: Camry\nYear: 2018\nFrame Number: {VALID_VIN}"
            ),
            vin_decoder=FakeVINDecoder(
                {
                    "is_valid": True,
                    "checksum_valid": True,
                    "decoded": {
                        "make": "Honda",
                        "model": "Accord",
                        "year": "2003",
                    },
                    "errors": [],
                }
            ),
            persist_func=lambda payload: [],
        )

        self.assertTrue(result["needs_review"])
        self.assertIn("decoder_mismatch", result["review_reasons"])
        self.assertIn("make", result["vin_validation"]["mismatches"])
        self.assertIn("model", result["vin_validation"]["mismatches"])
        self.assertIn("year", result["vin_validation"]["mismatches"])

    def test_marks_review_when_confidence_is_low(self):
        result = registration_ocr.scan_registration_image(
            _jpeg_bytes(),
            ocr_provider=FakeOCRProvider(f"Chassis: {VALID_VIN}"),
            vin_decoder=FakeVINDecoder(
                {
                    "is_valid": True,
                    "checksum_valid": True,
                    "decoded": {
                        "make": "Honda",
                        "model": "Accord",
                        "year": "2003",
                    },
                    "errors": [],
                }
            ),
            persist_func=lambda payload: [],
        )

        self.assertTrue(result["needs_review"])
        self.assertIn("low_confidence", result["review_reasons"])
        self.assertLess(result["confidence"]["overall"], 0.75)

    @patch.dict(os.environ, {"OCR_CONFIDENCE_THRESHOLD": "0.90"}, clear=False)
    def test_marks_review_when_confidence_is_below_acceptance_threshold(self):
        result = registration_ocr.scan_registration_image(
            _jpeg_bytes(),
            ocr_provider=FakeOCRProvider(
                f"Make: Honda\nModel: Accord\nVIN: {VALID_VIN}\nRegistered in 2003"
            ),
            vin_decoder=FakeVINDecoder(
                {
                    "is_valid": True,
                    "checksum_valid": True,
                    "decoded": {
                        "make": "Honda",
                        "model": "Accord",
                        "year": "2003",
                    },
                    "errors": [],
                }
            ),
            persist_func=lambda payload: [],
        )

        self.assertEqual(result["confidence"]["overall"], 0.875)
        self.assertTrue(result["needs_review"])
        self.assertIn("low_confidence", result["review_reasons"])

    @patch.dict(os.environ, {"TESSERACT_CMD": "/custom/bin/tesseract"}, clear=False)
    @patch.dict("sys.modules", clear=False)
    def test_tesseract_provider_honors_configured_command(self):
        import sys

        fake_pytesseract = Mock()
        fake_pytesseract.image_to_string.return_value = "Make: Honda"
        sys.modules["pytesseract"] = fake_pytesseract

        provider = registration_ocr.TesseractOCRProvider()
        text = provider.extract_text(Image.new("L", (1, 1)))

        self.assertEqual(text, "Make: Honda")
        self.assertEqual(
            fake_pytesseract.pytesseract.tesseract_cmd,
            "/custom/bin/tesseract",
        )


class RegistrationOCRRouteTests(unittest.TestCase):
    def setUp(self):
        backend.app.config["TESTING"] = True
        self.client = backend.app.test_client()

    @patch.object(registration_ocr, "persist_scan")
    @patch.object(registration_ocr, "get_default_vin_decoder")
    @patch.object(registration_ocr, "get_default_ocr_provider")
    def test_scan_registration_route_accepts_multipart_upload(
        self,
        mock_provider_factory,
        mock_decoder_factory,
        mock_persist_scan,
    ):
        mock_provider_factory.return_value = FakeOCRProvider(
            f"Make: Honda\nModel: Accord\nYear: 2003\nVIN: {VALID_VIN}"
        )
        mock_decoder_factory.return_value = FakeVINDecoder(
            {
                "is_valid": True,
                "checksum_valid": True,
                "decoded": {
                    "make": "Honda",
                    "model": "Accord",
                    "year": "2003",
                },
                "errors": [],
            }
        )
        mock_persist_scan.return_value = [{"id": "scan-route-1"}]

        response = self.client.post(
            "/api/ocr/scan-registration",
            data={
                "image": (_jpeg_bytes(), "mulkiya.jpg"),
                "document_type": "hayaza",
                "listing_type": "car",
                "listing_id": "listing-456",
                "user_id": "user-456",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["scan_id"], "scan-route-1")
        self.assertEqual(payload["document_type"], "hayaza")
        self.assertFalse(payload["needs_review"])
        self.assertEqual(payload["fields"]["vin"], VALID_VIN)
        persisted_payload = mock_persist_scan.call_args.args[0]
        self.assertEqual(persisted_payload["listing_type"], "car")
        self.assertEqual(persisted_payload["listing_id"], "listing-456")
        self.assertEqual(persisted_payload["user_id"], "user-456")

    def test_scan_registration_route_requires_image(self):
        response = self.client.post(
            "/api/ocr/scan-registration",
            data={"document_type": "mulkiya"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "image is required")

    def test_sample_fixtures_are_valid_jpegs(self):
        testdata_dir = os.path.join(os.path.dirname(__file__), "testdata")
        for filename in ("mulkiya-sample.jpg", "hayaza-sample.jpg"):
            path = os.path.join(testdata_dir, filename)
            with Image.open(path) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertGreaterEqual(image.width, 1)
                self.assertGreaterEqual(image.height, 1)


if __name__ == "__main__":
    unittest.main()
