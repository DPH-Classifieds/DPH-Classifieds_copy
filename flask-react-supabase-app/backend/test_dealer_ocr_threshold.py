"""Pure-logic tests for the dealer OCR auto-approval decision."""
from unittest.mock import patch

from services.registration_ocr import (
    dealer_document_ocr_status,
    dealer_document_reupload_prompt,
    should_auto_approve_dealer,
)


def _doc(doc_type, conf, status="approved", replaced_at=None):
    return {"document_type": doc_type, "ocr_confidence": conf,
            "status": status, "replaced_at": replaced_at}


def test_both_above_threshold_approves():
    docs = [_doc("trade_license", 0.95), _doc("tax_registration", 0.92)]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is True
    assert decision["min_confidence"] == 0.92
    assert decision["blocking_field"] is None


def test_one_below_threshold_blocks():
    docs = [_doc("trade_license", 0.95), _doc("tax_registration", 0.89)]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is False
    assert decision["min_confidence"] == 0.89
    assert decision["blocking_field"] == "tax_registration"


def test_missing_doc_blocks():
    decision = should_auto_approve_dealer([_doc("trade_license", 0.95)], threshold=0.90)
    assert decision["approve"] is False
    assert decision["missing"] == ["tax_registration"]


def test_replaced_doc_does_not_count():
    old = _doc("trade_license", 0.95, status="approved")
    old["replaced_at"] = "2026-08-18T12:00:00Z"
    decision = should_auto_approve_dealer(
        [old, _doc("tax_registration", 0.95)], threshold=0.90,
    )
    assert decision["approve"] is False
    assert decision["missing"] == ["trade_license"]


def test_custom_threshold():
    docs = [_doc("trade_license", 0.80), _doc("tax_registration", 0.80)]
    assert should_auto_approve_dealer(docs, threshold=0.90)["approve"] is False
    assert should_auto_approve_dealer(docs, threshold=0.75)["approve"] is True


def test_zero_confidence_blocks():
    docs = [_doc("trade_license", 0.0), _doc("tax_registration", 0.95)]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is False
    assert decision["blocking_field"] == "trade_license"


def test_missing_confidence_field_blocks():
    docs = [{"document_type": "trade_license", "replaced_at": None},
            _doc("tax_registration", 0.95)]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    # Missing confidence is treated as 0.0 confidence → blocks
    assert decision["approve"] is False


def test_explicitly_rejected_doc_blocks():
    docs = [_doc("trade_license", 0.95, status="rejected"),
            _doc("tax_registration", 0.95, status="approved")]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is False
    assert decision["missing"] == ["trade_license"]


def test_explicitly_denied_doc_blocks():
    docs = [_doc("trade_license", 0.95, status="denied"),
            _doc("tax_registration", 0.95, status="approved")]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is False
    assert decision["missing"] == ["trade_license"]


def test_extra_docs_ignored():
    docs = [_doc("trade_license", 0.95),
            _doc("tax_registration", 0.92),
            _doc("national_id", 0.99)]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is True


def test_document_ocr_status_explains_low_confidence_next_step():
    result = dealer_document_ocr_status({
        "document_type": "tax_registration",
        "ocr_confidence": 0.8645,
        "ocr_scanned_at": "2026-09-16T10:00:00Z",
    }, threshold=0.90)
    assert result["status"] == "needs_clearer_scan"
    assert "sharper" in result["message"]
    assert result["confidence"] == 0.8645


def test_document_ocr_status_explains_provider_delay_without_calling_it_a_bad_scan():
    result = dealer_document_ocr_status({
        "document_type": "trade_license",
        "ocr_confidence": 0.0,
        "ocr_scanned_at": None,
    }, threshold=0.90)
    assert result["status"] == "not_scanned"
    assert "uploaded" in result["message"]
    assert "still pending" in result["message"]


def test_trade_license_ocr_status_identifies_unread_expiry():
    result = dealer_document_ocr_status({
        "document_type": "trade_license",
        "ocr_confidence": 0.0,
        "ocr_scanned_at": "2026-09-16T10:00:00Z",
        "ocr_expires_at": None,
    })
    assert result["status"] == "needs_manual_expiry"
    assert "expiry date" in result["message"]


def test_low_quality_document_builds_safe_reupload_prompt():
    result = dealer_document_reupload_prompt({
        "document_type": "tax_registration",
        "ocr_confidence": 0.8645,
        "ocr_scanned_at": "2026-09-16T10:00:00Z",
    }, threshold=0.90)
    assert result["document_label"] == "TRN Certificate"
    assert result["confidence"] == 0.8645
    assert result["threshold"] == 0.90
    assert result["status"] == "needs_clearer_scan"
    assert "re-upload" in result["message"]
    assert "ocr_raw_text" not in result


def test_passed_document_does_not_build_reupload_prompt():
    assert dealer_document_reupload_prompt({
        "document_type": "tax_registration",
        "ocr_confidence": 0.95,
        "ocr_scanned_at": "2026-09-16T10:00:00Z",
    }, threshold=0.90) is None


def test_low_quality_alert_sends_email_and_push_once():
    import app as backend

    with patch.object(
        backend,
        "supabase_request",
        return_value=([{"email": "dealer@example.test"}], 200),
    ), patch.object(
        backend,
        "_send_dealer_document_quality_email",
        return_value=({}, None),
    ) as send_email, patch.object(
        backend,
        "_notify_user_push",
        return_value=True,
    ) as send_push:
        result = backend._notify_dealer_document_quality_alert(
            "dealer-1",
            {
                "document_type": "tax_registration",
                "ocr_confidence": 0.8645,
                "ocr_scanned_at": "2026-09-16T10:00:00Z",
            },
            threshold=0.90,
        )

    assert result == {"needed": True, "email_sent": True, "push_sent": True}
    send_email.assert_called_once()
    send_push.assert_called_once()
    assert send_push.call_args.args[0] == "dealer-1"
    assert send_push.call_args.kwargs["data"]["type"] == "dealer_document_quality"


def test_passed_document_does_not_send_quality_alert():
    import app as backend

    with patch.object(backend, "supabase_request") as supabase, patch.object(
        backend, "_send_dealer_document_quality_email"
    ) as send_email, patch.object(backend, "_notify_user_push") as send_push:
        result = backend._notify_dealer_document_quality_alert(
            "dealer-1",
            {
                "document_type": "tax_registration",
                "ocr_confidence": 0.95,
                "ocr_scanned_at": "2026-09-16T10:00:00Z",
            },
            threshold=0.90,
        )

    assert result == {"needed": False, "email_sent": False, "push_sent": False}
    supabase.assert_not_called()
    send_email.assert_not_called()
    send_push.assert_not_called()
