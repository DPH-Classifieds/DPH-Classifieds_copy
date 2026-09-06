#!/usr/bin/env python3
import io
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from PIL import Image
from werkzeug.datastructures import FileStorage

import app as backend
from routes import ocr as ocr_route
from routes import admin as admin_route
from services import registration_ocr


VALID_VIN = "1HGCM82633A004352"


class FakeOCRProvider:
    def __init__(self, text, conf=0.95):
        self.text = text
        # Emulate the real service returning per-line recognition confidence:
        # one line per whitespace-run at a uniform confidence.
        self.lines = [{"text": tok, "conf": conf} for tok in text.split()]

    def extract(self, image):
        return self.text, self.lines

    def extract_text(self, image):
        return self.text


class FakeVINDecoder:
    def __init__(self, result):
        self.result = result

    def validate_and_decode(self, vin):
        decoded = dict(self.result)
        decoded["vin"] = vin
        return decoded


def _jpeg_bytes(size=(8, 8)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(255, 255, 255)).save(buffer, format="JPEG")
    buffer.seek(0)
    return buffer


def _pdf_bytes():
    buffer = io.BytesIO()
    buffer.write(
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n"
        b"4 0 obj<</Length 44>>stream\n"
        b"BT /F1 12 Tf 20 100 Td (VIN 1HGCM82633A004352) Tj ET\n"
        b"endstream endobj\n"
        b"xref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n0000000110 00000 n \n0000000193 00000 n \n"
        b"trailer<</Root 1 0 R/Size 5>>\nstartxref\n287\n%%EOF\n"
    )
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
            training_upload_func=lambda *args, **kwargs: None,
        )

        self.assertEqual(result["fields"]["make"], "Honda")
        self.assertEqual(result["fields"]["model"], "Accord")
        self.assertEqual(result["fields"]["year"], "2003")
        self.assertEqual(result["fields"]["vin"], VALID_VIN)
        self.assertTrue(result["vin_validation"]["valid"])
        self.assertEqual(result["vin_validation"]["decoded"]["model_year"], "2003")
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
            training_upload_func=lambda *args, **kwargs: None,
        )

        self.assertTrue(result["needs_review"])
        self.assertIn("decoder_mismatch", result["review_reasons"])
        self.assertIn("make", result["vin_validation"]["mismatches"])
        self.assertIn("model", result["vin_validation"]["mismatches"])
        self.assertIn("year", result["vin_validation"]["mismatches"])

    def test_marks_review_when_confidence_is_low(self):
        result = registration_ocr.scan_registration_image(
            _jpeg_bytes(),
            ocr_provider=FakeOCRProvider(f"Chassis: {VALID_VIN}", conf=0.5),
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
            training_upload_func=lambda *args, **kwargs: None,
        )

        self.assertTrue(result["needs_review"])
        self.assertIn("low_confidence", result["review_reasons"])
        self.assertLess(result["confidence"]["overall"], 0.75)

    def test_extract_registration_fields_repairs_common_vin_ocr_confusions(self):
        fields, confidence = registration_ocr.extract_registration_fields(
            "Chassis: 1HGCM82633AOO4352"
        )

        self.assertEqual(fields["vin"], VALID_VIN)
        self.assertGreaterEqual(confidence["vin"], 0.8)

    def test_extract_trade_license_expiry_prefers_expiry_label(self):
        result = registration_ocr.extract_trade_license_expiry(
            "Issue Date: 01/03/2025\nLicense valid until: 31/12/2027",
            [{"text": "31/12/2027", "conf": 0.97}],
        )
        self.assertEqual(result["expires_at"], "2027-12-31")
        self.assertTrue(result["label_matched"])
        self.assertGreaterEqual(result["confidence"], 0.97)

    def test_extract_trade_license_expiry_returns_no_value_for_unreadable_text(self):
        result = registration_ocr.extract_trade_license_expiry("Trade License\nNo readable date")
        self.assertIsNone(result["expires_at"])

    def test_vin_repair_skips_speculative_guessing_for_non_na_vins(self):
        # Non-NA WMI prefix (starts with a letter, not 1-5): the checksum
        # can't verify anything for these (real UAE/GCC vehicles), so
        # speculative D/L substitution must never run — only the required
        # I/O/Q fix is applied, and the result is returned as best-effort
        # without inventing further changes. Regression test for a bug
        # where the old code trusted is_checksum_valid()'s unconditional
        # True for non-NA VINs as if it meant "confirmed correct" — it let
        # a garbled read repair into a *different*, wrong, but
        # checksum-passing VIN.
        garbled = "LOWDD7O51QJ614961"
        self.assertFalse(registration_ocr.VINDecoder.is_checksum_applicable(garbled))
        # Only the O's and Q (required, unconditional) get fixed; the D's
        # are left untouched since speculative substitution never runs.
        self.assertEqual(registration_ocr._repair_vin_candidate(garbled), "L0WDD70510J614961")

    def test_vin_repair_caps_speculative_substitutions_for_na_vins(self):
        # NA WMI prefix (starts with 1-5): checksum is real here, so
        # speculative guessing is allowed but must stay bounded — mock the
        # checksum to accept only a candidate that needs 5 simultaneous
        # D/L substitutions (over MAX_VIN_SUBSTITUTIONS=2) and confirm
        # _repair_vin_candidate refuses to find it.
        garbled = "1DGCLD2633ADD4352"  # NA prefix, 5 D/L-substitutable chars
        target = "10GC102633A004352"  # every D/L flipped -> 5 substitutions away

        def fake_checksum_valid(vin):
            return vin == target

        with patch.object(registration_ocr.VINDecoder, "is_checksum_valid", staticmethod(fake_checksum_valid)):
            self.assertIsNone(registration_ocr._repair_vin_candidate(garbled))

    def test_paddle_service_provider_returns_text(self):
        provider = registration_ocr.PaddleOCRServiceProvider(
            base_url="http://ocr.internal:8000", service_key="k", timeout=5
        )
        resp = Mock(status_code=200)
        resp.json.return_value = {"text": "Chassis No. " + VALID_VIN}
        with patch("requests.post", return_value=resp) as mock_post:
            text = provider.extract_text(Image.new("RGB", (4, 4)))
        self.assertIn(VALID_VIN, text)
        # sends the shared-secret header and hits /scan
        _, kwargs = mock_post.call_args
        self.assertEqual(kwargs["headers"]["X-OCR-Service-Key"], "k")
        self.assertTrue(mock_post.call_args[0][0].endswith("/scan"))

    def test_paddle_service_provider_retries_once_on_503(self):
        provider = registration_ocr.PaddleOCRServiceProvider(base_url="http://x", timeout=1)
        busy = Mock(status_code=503, text="busy")
        ok = Mock(status_code=200)
        ok.json.return_value = {"text": "hello"}
        with patch("requests.post", side_effect=[busy, ok]) as mock_post:
            text = provider.extract_text(Image.new("RGB", (4, 4)))
        self.assertEqual(text, "hello")
        self.assertEqual(mock_post.call_count, 2)

    def test_paddle_service_provider_raises_when_unavailable(self):
        import requests as _requests

        provider = registration_ocr.PaddleOCRServiceProvider(base_url="http://x", timeout=1)
        with patch("requests.post", side_effect=_requests.ConnectionError("down")):
            with self.assertRaises(RuntimeError):
                provider.extract_text(Image.new("RGB", (4, 4)))

    def test_default_provider_prefers_service_when_configured(self):
        with patch.dict(os.environ, {"OCR_SERVICE_URL": "http://ocr.internal:8000"}, clear=False):
            self.assertIsInstance(
                registration_ocr.get_default_ocr_provider(),
                registration_ocr.PaddleOCRServiceProvider,
            )

    def test_default_provider_caps_legacy_service_timeout_per_attempt(self):
        with patch.dict(
            os.environ,
            {
                "OCR_SERVICE_URL": "http://ocr.internal:8000",
                "OCR_SERVICE_TIMEOUT_SECONDS": "40",
                "OCR_SERVICE_ATTEMPT_TIMEOUT_SECONDS": "8",
            },
            clear=False,
        ):
            provider = registration_ocr.get_default_ocr_provider()
        self.assertEqual(provider.timeout, 8)

    def test_extract_plate_fields_from_real_mulkiya_text(self):
        # Both the accurate PDF read and the actual garbled EasyOCR read of
        # the same UAE mulkiya must yield plate number 66182. The JPG text
        # is verbatim from a real EasyOCR run and contains Arabic-Indic
        # digits (٥٠) that must NOT be mistaken for the plate number.
        pdf_text = "CC/66182 خصوصي 12307760 2025 5 GREAT WALL TANK 300 LGWFF7A51SJ614961"
        jpg_text = (
            "Vehicle License Tnffic Fliic No. 0C /66182 رقم اللوحة "
            "Placc of Issue Dubai اللرخبص ، ٥٠ N٥٠ 1230775٥ االرمز"
        )
        self.assertEqual(registration_ocr.extract_plate_fields(pdf_text)["plate_number"], "66182")
        self.assertEqual(registration_ocr.extract_plate_fields(jpg_text)["plate_number"], "66182")

    def test_extract_plate_fields_ignores_arabic_indic_digits(self):
        # Only Arabic-Indic digits present, no ASCII plate — must return
        # None rather than leaking "٥٠" into a Western-digit form field.
        self.assertIsNone(
            registration_ocr.extract_plate_fields("رقم اللوحة ٥٠ N٥٠ خصوصي")["plate_number"]
        )

    def test_extract_plate_fields_does_not_split_years_or_bare_numbers(self):
        # A 4-digit year must never be split into code+number.
        self.assertIsNone(registration_ocr.extract_plate_fields("Model 2025 Origin China")["plate_number"])
        # A bare 5-digit plate near a label stays whole (not split 44+321).
        self.assertEqual(
            registration_ocr.extract_plate_fields("رقم اللوحة 44321 خصوصي")["plate_number"],
            "44321",
        )

    def test_extract_plate_fields_requires_separator_for_numeric_code(self):
        # Numeric region code needs an explicit separator ("50 / 4321").
        self.assertEqual(
            registration_ocr.extract_plate_fields("Traffic Plate No 50 / 4321 Dubai")["plate_number"],
            "4321",
        )

    def test_vin_repair_finds_within_cap_substitutions_for_na_vins(self):
        garbled = "1HGCM82633ADD4352"  # NA prefix, 2 D chars (within cap)
        target = VALID_VIN  # "1HGCM82633A004352" -- both D's -> 0

        def fake_checksum_valid(vin):
            return vin == target

        with patch.object(registration_ocr.VINDecoder, "is_checksum_valid", staticmethod(fake_checksum_valid)):
            self.assertEqual(registration_ocr._repair_vin_candidate(garbled), target)

    @patch.dict(os.environ, {"OCR_CONFIDENCE_THRESHOLD": "0.90"}, clear=False)
    def test_marks_review_when_confidence_is_below_acceptance_threshold(self):
        result = registration_ocr.scan_registration_image(
            _jpeg_bytes(),
            ocr_provider=FakeOCRProvider(
                f"Make: Honda\nModel: Accord\nVIN: {VALID_VIN}\nRegistered in 2003",
                conf=0.85,
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
            training_upload_func=lambda *args, **kwargs: None,
        )

        # Real OCR confidence (0.85) is below the 0.90 acceptance threshold.
        self.assertEqual(result["confidence"]["overall"], 0.85)
        self.assertTrue(result["needs_review"])
        self.assertIn("low_confidence", result["review_reasons"])

    def test_attribute_confidence_uses_real_line_scores_and_ignores_floored(self):
        lines = [
            {"text": "LGWFF7A51SJ614961", "conf": 0.985},
            {"text": "GREAT WALL TANK3", "conf": 0.936},
            {"text": "2025", "conf": 0.998},
        ]
        fields = {
            "vin": "LGWFF7A51SJ614961",
            "make": "GREAT WALL",
            "year": "2025",
            "model": "3GARBAGE WALLTANK3 G",  # assembled/garbled -> no line match
        }
        conf = registration_ocr.attribute_confidence(fields, lines)
        self.assertEqual(conf["vin"], 0.985)
        self.assertEqual(conf["year"], 0.998)
        self.assertEqual(conf["model"], registration_ocr.FLOOR_CONFIDENCE)
        # overall excludes the floored model -> stays 90%+
        self.assertGreaterEqual(conf["overall"], 0.90)

    def test_attribute_confidence_overall_zero_when_nothing_present(self):
        conf = registration_ocr.attribute_confidence(
            {"vin": None, "make": None, "model": None, "year": None}, []
        )
        self.assertEqual(conf["overall"], 0.0)

    def test_default_ocr_provider_is_paddle_service(self):
        provider = registration_ocr.get_default_ocr_provider()
        self.assertIsInstance(provider, registration_ocr.PaddleOCRServiceProvider)

    def test_extract_registration_fields_handles_registration_card_noise(self):
        raw_text = "\n".join(
            [
                "Vehicle Information",
                "| Model 2025 quiseall 2.14] Num. of Pass. 5 cls I! sae",
                "Veh. Type} GREAT WALL TANK 300 GREAT WALL TANK 300}4u5 511 fas)",
                "Chassis No. LGWFF7A51SJ614961 3.4clal @ yy",
            ]
        )

        fields, confidence = registration_ocr.extract_registration_fields(raw_text)

        self.assertEqual(fields["year"], "2025")
        self.assertEqual(fields["vin"], "LGWFF7A51SJ614961")
        self.assertGreaterEqual(confidence["year"], 0.65)
        self.assertGreaterEqual(confidence["vin"], 0.8)

    def test_rejects_resize_that_would_exceed_output_pixel_guardrail(self):
        with self.assertRaises(ValueError) as context:
            registration_ocr.preprocess_image(
                _jpeg_bytes(size=(1, 20)),
                max_pixels=1000,
                max_resize_pixels=10000,
            )

        self.assertIn("resized image dimensions are too large", str(context.exception))

    def test_upload_training_image_uses_injected_upload_func(self):
        calls = []

        def fake_upload(raw_bytes, metadata):
            calls.append((raw_bytes, metadata))
            return "user-123/fake.jpg"

        path = registration_ocr.upload_training_image(
            b"fake-bytes", metadata={"user_id": "user-123"}, upload_func=fake_upload
        )

        self.assertEqual(path, "user-123/fake.jpg")
        self.assertEqual(calls, [(b"fake-bytes", {"user_id": "user-123"})])

    def test_upload_training_image_swallows_errors_and_returns_none(self):
        def broken_upload(raw_bytes, metadata):
            raise RuntimeError("storage is down")

        path = registration_ocr.upload_training_image(
            b"fake-bytes", metadata={}, upload_func=broken_upload
        )

        self.assertIsNone(path)

    def test_sniff_extension_detects_pdf_and_image(self):
        self.assertEqual(registration_ocr._sniff_extension(b"%PDF-1.4 ..."), ("pdf", "application/pdf"))

        ext, content_type = registration_ocr._sniff_extension(_jpeg_bytes().read())
        self.assertEqual(ext, "jpg")
        self.assertEqual(content_type, "image/jpeg")


class RegistrationOCRRouteTests(unittest.TestCase):
    def setUp(self):
        backend.app.config["TESTING"] = True
        self.client = backend.app.test_client()

    @patch("routes.ocr._authenticate_bearer_token")
    @patch.object(registration_ocr, "upload_training_image")
    @patch.object(registration_ocr, "persist_scan")
    @patch.object(registration_ocr, "get_default_vin_decoder")
    @patch.object(registration_ocr, "get_default_ocr_provider")
    def test_scan_registration_route_accepts_multipart_upload(
        self,
        mock_provider_factory,
        mock_decoder_factory,
        mock_persist_scan,
        mock_upload_training_image,
        mock_authenticate,
    ):
        mock_upload_training_image.return_value = None
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})
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

        with patch("routes.ocr.verify_listing_ownership", return_value=True):
            response = self.client.post(
                "/api/ocr/scan-registration",
                data={
                    "image": (_jpeg_bytes(), "mulkiya.jpg"),
                    "document_type": "hayaza",
                    "listing_type": "car",
                    "listing_id": "listing-456",
                    "user_id": "spoofed-user",
                },
                headers={"Authorization": "Bearer test-token"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["scan_id"], "scan-route-1")
        self.assertEqual(payload["document_type"], "hayaza")
        self.assertFalse(payload["needs_review"])
        self.assertEqual(payload["fields"]["vin"], VALID_VIN)
        self.assertTrue(payload["vin_validation"]["valid"])
        self.assertEqual(payload["vin_validation"]["decoded"]["model_year"], "2003")
        persisted_payload = mock_persist_scan.call_args.args[0]
        self.assertEqual(persisted_payload["listing_type"], "car")
        self.assertEqual(persisted_payload["listing_id"], "listing-456")
        self.assertEqual(persisted_payload["user_id"], "auth-user-123")

    @patch("routes.ocr._authenticate_bearer_token")
    def test_scan_registration_route_rejects_foreign_listing_linkage(self, mock_authenticate):
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})

        with patch("routes.ocr.verify_listing_ownership", return_value=False):
            response = self.client.post(
                "/api/ocr/scan-registration",
                data={
                    "image": (_jpeg_bytes(), "mulkiya.jpg"),
                    "listing_type": "car",
                    "listing_id": "foreign-listing",
                },
                headers={"Authorization": "Bearer test-token"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "listing ownership could not be verified")

    @patch("routes.ocr._authenticate_bearer_token")
    def test_scan_registration_route_rejects_unknown_listing_type(self, mock_authenticate):
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})

        response = self.client.post(
            "/api/ocr/scan-registration",
            data={
                "image": (_jpeg_bytes(), "mulkiya.jpg"),
                "listing_type": "unknown",
                "listing_id": "listing-456",
            },
            headers={"Authorization": "Bearer test-token"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "unsupported listing_type")

    def test_scan_registration_route_requires_auth(self):
        response = self.client.post(
            "/api/ocr/scan-registration",
            data={"image": (_jpeg_bytes(), "mulkiya.jpg")},
        )

        self.assertEqual(response.status_code, 401)

    @patch("routes.ocr._authenticate_bearer_token")
    def test_scan_registration_route_rejects_non_image_upload(self, mock_authenticate):
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})

        response = self.client.post(
            "/api/ocr/scan-registration",
            data={"image": (io.BytesIO(b"not an image"), "document.txt")},
            headers={"Authorization": "Bearer test-token"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.get_json()["error"],
            "image upload must be an image or PDF",
        )

    @patch("routes.ocr._authenticate_bearer_token")
    def test_scan_registration_route_rejects_invalid_image_content(self, mock_authenticate):
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})

        response = self.client.post(
            "/api/ocr/scan-registration",
            data={
                "image": (
                    io.BytesIO(b"not really a jpeg"),
                    "spoofed.jpg",
                    "image/jpeg",
                )
            },
            headers={"Authorization": "Bearer test-token"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.get_json()["error"],
            "image upload must be a valid image",
        )

    @patch("routes.ocr._authenticate_bearer_token")
    @patch("routes.ocr.scan_registration_image")
    def test_scan_registration_route_accepts_pdf_upload(
        self,
        mock_scan_registration_image,
        mock_authenticate,
    ):
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})
        mock_scan_registration_image.return_value = {
            "fields": {"vin": VALID_VIN},
            "confidence": {"overall": 0.95},
            "vin_validation": {"valid": True, "decoded": {}},
            "needs_review": False,
            "review_reasons": [],
            "document_type": "mulkiya",
            "raw_text": "",
            "scan_id": "scan-pdf-1",
        }

        response = self.client.post(
            "/api/ocr/scan-registration",
            data={
                "image": (_pdf_bytes(), "mulkiya.pdf", "application/pdf"),
                "document_type": "mulkiya",
            },
            headers={"Authorization": "Bearer test-token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["scan_id"], "scan-pdf-1")

    @patch("routes.ocr._authenticate_bearer_token")
    def test_scan_registration_route_rejects_oversized_request(self, mock_authenticate):
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})

        with patch.object(backend.app, "config", {**backend.app.config, "MAX_CONTENT_LENGTH": 32}):
            response = self.client.post(
                "/api/ocr/scan-registration",
                data={"image": (_jpeg_bytes(), "large.jpg")},
                headers={"Authorization": "Bearer test-token"},
            )

        self.assertEqual(response.status_code, 413)

    @patch("routes.ocr._authenticate_bearer_token")
    def test_scan_registration_route_rejects_when_worker_bound_is_full(self, mock_authenticate):
        mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})
        with patch.object(ocr_route._OCR_SLOTS, "acquire", return_value=False):
            response = self.client.post(
                "/api/ocr/scan-registration",
                data={"image": (_jpeg_bytes(), "mulkiya.jpg")},
                headers={"Authorization": "Bearer test-token"},
            )
        self.assertEqual(response.status_code, 503)

    def test_upload_validation_checks_actual_file_size(self):
        with backend.app.test_request_context(
            "/api/ocr/scan-registration",
            method="POST",
            environ_base={"CONTENT_LENGTH": "1"},
        ):
            upload = FileStorage(
                stream=io.BytesIO(b"x" * 128),
                filename="tiny-header.jpg",
                content_type="image/jpeg",
            )
            with patch("routes.ocr._max_upload_bytes", return_value=32):
                response, status = ocr_route._validate_registration_upload(upload)

        self.assertEqual(status, 413)
        self.assertEqual(response.get_json()["error"], "image upload is too large")

    def test_scan_registration_route_returns_fallback_when_ocr_fails(self):
        with patch("routes.ocr._authenticate_bearer_token") as mock_authenticate:
            mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})
            with patch("routes.ocr.scan_registration_image") as mock_scan:
                mock_scan.side_effect = RuntimeError("secret backend detail")
                response = self.client.post(
                    "/api/ocr/scan-registration",
                    data={"image": (_jpeg_bytes(), "mulkiya.jpg")},
                    headers={"Authorization": "Bearer test-token"},
                )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["error"], "registration OCR unavailable")
        self.assertTrue(payload["needs_review"])
        self.assertIn("ocr_unavailable", payload["review_reasons"])

    def test_scan_registration_route_requires_image(self):
        with patch("routes.ocr._authenticate_bearer_token") as mock_authenticate:
            mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})
            response = self.client.post(
                "/api/ocr/scan-registration",
                data={"document_type": "mulkiya"},
                headers={"Authorization": "Bearer test-token"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "image is required")

    def test_rejects_image_above_pixel_guardrail(self):
        with self.assertRaises(ValueError) as context:
            registration_ocr.preprocess_image(_jpeg_bytes(size=(32, 32)), max_pixels=100)

        self.assertIn("image dimensions are too large", str(context.exception))

    def test_sample_fixtures_are_valid_jpegs(self):
        testdata_dir = os.path.join(os.path.dirname(__file__), "testdata")
        for filename in ("mulkiya-sample.jpg", "hayaza-sample.jpg"):
            path = os.path.join(testdata_dir, filename)
            with Image.open(path) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertGreaterEqual(image.width, 1)
                self.assertGreaterEqual(image.height, 1)

    def test_scan_migration_enables_rls_without_public_policy(self):
        migration_path = os.path.join(
            os.path.dirname(__file__),
            "migrations",
            "add_listing_verification_scans.sql",
        )
        with open(migration_path, "r", encoding="utf-8") as migration:
            source = migration.read().lower()

        self.assertIn(
            "alter table public.listing_verification_scans enable row level security",
            source,
        )
        self.assertNotIn("using (true)", source)


class RegistrationScanAdminTests(unittest.TestCase):
    @patch.object(admin_route.requests, "get")
    @patch.object(backend, "_admin_attach_latest_verification_scan")
    @patch.object(backend, "_admin_listing_display_status", return_value="approved")
    @patch.object(backend, "_sync_listing_lifecycle", side_effect=lambda _table, row, **_kwargs: row)
    def test_admin_listing_overview_includes_latest_verification_scan(
        self, _sync_lifecycle, _display_status, mock_attach_scan, mock_get
    ):
        scan = {
            "id": "scan-1",
            "listing_type": "car",
            "listing_id": "car-1",
            "fields": {"make": "Toyota", "model": "Camry", "year": "2021"},
            "vin_validation": {"valid": True},
            "confidence": {"overall": 0.98},
            "needs_review": False,
        }
        listing = {"id": "car-1", "user_id": "user-1", "status": "approved"}

        def attach_scan(row):
            row["latest_verification_scan"] = scan
            row["verification_status"] = {"vin_valid": True, "confidence": 0.98}

        mock_attach_scan.side_effect = attach_scan

        def upstream(payload, status_code=200):
            response = Mock()
            response.status_code = status_code
            response.json.return_value = payload
            return response

        mock_get.side_effect = [
            upstream({"id": "admin-user", "role": "authenticated"}),
            upstream([{"is_admin": True}]),
            upstream([listing]),
            upstream([{"id": "user-1", "email": "owner@example.com", "email_verified": True}]),
            upstream([]),
            upstream([]),
            upstream([]),
            upstream([]),
            upstream([]),
        ]

        response = backend.app.test_client().get(
            "/api/admin/listings/cars/car-1/overview",
            headers={"Authorization": "Bearer test-admin-token"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIn("latest_verification_scan", payload)
        self.assertFalse(payload["latest_verification_scan"]["needs_review"])
        self.assertTrue(payload["verification_status"]["vin_valid"])
        self.assertEqual(payload["verification_status"]["confidence"], 0.98)


if __name__ == "__main__":
    unittest.main()
