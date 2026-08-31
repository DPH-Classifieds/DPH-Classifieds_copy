import io
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from routes import admin
from routes.dealer import analytics, core
from services import registration_ocr


def test_member_session_logout_uses_global_backend_revocation():
    with patch("app.revoke_user_sessions", return_value=True) as revoke:
        assert core._logout_user_sessions("user-7") is True
    revoke.assert_called_once_with("user-7")


def test_analytics_rejects_rows_above_sync_cap():
    response = MagicMock(status_code=200)
    response.json.return_value = [{"id": i} for i in range(3)]
    with pytest.raises(analytics.AnalyticsVolumeExceeded):
        analytics._bounded_rows(response, 2)


def test_admin_internal_error_does_not_expose_exception_message():
    app = Flask(__name__)
    with app.test_request_context("/"):
        with patch.object(admin.logger, "exception"):
            response, status = admin._internal_error(
                "test failure", RuntimeError("service-key=secret")
            )
    assert status == 500
    assert response.get_json() == {"error": "Internal server error"}


def test_admin_source_has_no_raw_exception_json_responses():
    source = Path(admin.__file__).read_text(encoding="utf-8")
    assert 'jsonify({"error": str(e)})' not in source
    assert 'jsonify({"error": str(exc)})' not in source


def test_registration_ocr_rejects_direct_oversized_upload():
    with patch.object(registration_ocr, "_max_upload_bytes", return_value=4):
        with pytest.raises(ValueError, match="upload is too large"):
            registration_ocr.preprocess_image(io.BytesIO(b"12345"))


def test_registration_ocr_rejects_pdf_page_bomb_before_render():
    page = MagicMock()
    document = MagicMock()
    document.__len__.return_value = 11
    document.__getitem__.return_value = page
    pdfium = MagicMock()
    pdfium.PdfDocument.return_value = document

    with patch.dict(sys.modules, {"pypdfium2": pdfium}), patch.dict(
        "os.environ", {"OCR_MAX_PDF_PAGES": "10"}
    ):
        with pytest.raises(ValueError, match="at most 10 pages"):
            registration_ocr._render_pdf_first_page(io.BytesIO(b"%PDF-small"))
    page.render.assert_not_called()


def test_registration_ocr_rejects_oversized_pdf_page_before_render():
    page = MagicMock()
    page.get_size.return_value = (50_000, 50_000)
    document = MagicMock()
    document.__len__.return_value = 1
    document.__getitem__.return_value = page
    pdfium = MagicMock()
    pdfium.PdfDocument.return_value = document
    with patch.dict(sys.modules, {"pypdfium2": pdfium}):
        with pytest.raises(ValueError, match="PDF page dimensions are too large"):
            registration_ocr._render_pdf_first_page(io.BytesIO(b"%PDF-small"))
    page.render.assert_not_called()
