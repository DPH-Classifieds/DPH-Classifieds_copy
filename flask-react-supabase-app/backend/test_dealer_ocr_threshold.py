"""Pure-logic tests for the dealer OCR auto-approval decision."""
from services.registration_ocr import should_auto_approve_dealer


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
