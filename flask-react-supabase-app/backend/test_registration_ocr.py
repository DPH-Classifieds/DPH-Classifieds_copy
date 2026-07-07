#!/usr/bin/env python3
import builtins
import io
import os
import unittest
from unittest.mock import Mock, patch

from PIL import Image
from werkzeug.datastructures import FileStorage

import app as backend
from routes import ocr as ocr_route
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

    def test_extract_registration_fields_repairs_common_vin_ocr_confusions(self):
        fields, confidence = registration_ocr.extract_registration_fields(
            "Chassis: 1HGCM82633AOO4352"
        )

        self.assertEqual(fields["vin"], VALID_VIN)
        self.assertGreaterEqual(confidence["vin"], 0.8)

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

    @patch("subprocess.run")
    def test_tesseract_provider_falls_back_to_cli_when_pytesseract_is_unavailable(self, mock_run):
        mock_run.return_value = __import__("subprocess").CompletedProcess(
            args=["tesseract"],
            returncode=0,
            stdout="Make: Honda\n",
            stderr="",
        )

        original_import = builtins.__import__

        def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "pytesseract":
                raise ImportError("pytesseract is unavailable")
            return original_import(name, globals, locals, fromlist, level)

        with patch("builtins.__import__", side_effect=guarded_import):
            provider = registration_ocr.TesseractOCRProvider()
            text = provider.extract_text(Image.new("L", (32, 32)))

        self.assertEqual(text, "Make: Honda")
        self.assertTrue(mock_run.called)

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


class RegistrationOCRRouteTests(unittest.TestCase):
    def setUp(self):
        backend.app.config["TESTING"] = True
        self.client = backend.app.test_client()

    @patch("routes.ocr._authenticate_bearer_token")
    @patch.object(registration_ocr, "persist_scan")
    @patch.object(registration_ocr, "get_default_vin_decoder")
    @patch.object(registration_ocr, "get_default_ocr_provider")
    def test_scan_registration_route_accepts_multipart_upload(
        self,
        mock_provider_factory,
        mock_decoder_factory,
        mock_persist_scan,
        mock_authenticate,
    ):
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

    def test_scan_registration_route_returns_503_when_both_ocr_fail(self):
        with patch("routes.ocr._authenticate_bearer_token") as mock_authenticate:
            mock_authenticate.return_value = ("auth-user-123", {"id": "auth-user-123"})
            with patch("routes.ocr._local_ocr_scan") as mock_local, \
                 patch("routes.ocr.scan_registration_image") as mock_scan:
                mock_local.return_value = None
                mock_scan.side_effect = RuntimeError("secret backend detail")
                response = self.client.post(
                    "/api/ocr/scan-registration",
                    data={"image": (_jpeg_bytes(), "mulkiya.jpg")},
                    headers={"Authorization": "Bearer test-token"},
                )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {"error": "registration OCR unavailable"})

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
    @patch.object(backend, "_require_admin_api_user", return_value=True)
    @patch.object(
        backend,
        "_admin_fetch_user_rows",
        return_value={"id": "user-1", "email": "owner@example.com"},
    )
    @patch.object(backend, "supabase_request")
    def test_admin_listing_overview_includes_latest_verification_scan(
        self,
        mock_supabase_request,
        _mock_owner,
        _mock_require_admin,
    ):
        def side_effect(method, path, params=None, **kwargs):
            if path == "/rest/v1/cars":
                return ([{"id": "car-1", "user_id": "user-1", "status": "approved"}], 200)
            if path in {
                "/rest/v1/car_images",
                "/rest/v1/lead_events",
                "/rest/v1/reports",
                "/rest/v1/listing_deletion_events",
            }:
                return ([], 200)
            if path == "/rest/v1/listing_verification_scans":
                return (
                    [{
                        "id": "scan-1",
                        "listing_type": "car",
                        "listing_id": "car-1",
                        "fields": {
                            "make": "Toyota",
                            "model": "Camry",
                            "year": "2021",
                            "vin": "JTNB11HK0M1234567",
                        },
                        "vin_validation": {"valid": True},
                        "confidence": {"overall": 0.98},
                        "needs_review": False,
                        "raw_text": "TOYOTA CAMRY 2021",
                        "document_type": "mulkiya",
                        "created_at": "2026-05-26T00:00:00+00:00",
                    }],
                    200,
                )
            raise AssertionError(f"Unexpected Supabase path: {path}")

        mock_supabase_request.side_effect = side_effect

        with backend.app.test_request_context("/api/admin/listings/cars/car-1/overview"):
            response, status_code = backend.get_admin_listing_overview.__wrapped__(
                "admin-user",
                "cars",
                "car-1",
            )

        self.assertEqual(status_code, 200)
        payload = response.get_json()
        self.assertIn("latest_verification_scan", payload)
        self.assertFalse(payload["latest_verification_scan"]["needs_review"])
        self.assertTrue(payload["verification_status"]["vin_valid"])
        self.assertEqual(payload["verification_status"]["confidence"], 0.98)


if __name__ == "__main__":
    unittest.main()
