"""Focused contract tests for the dealer verification lifecycle.

The application module has heavyweight runtime dependencies, so these tests load
the pure readiness helper directly from its source AST and exercise the exact
function used by submit, admin approval, and listing access.
"""

import ast
import datetime
import re
import unittest
from pathlib import Path


APP_PATH = Path(__file__).with_name("app.py")


def load_readiness_helper():
    tree = ast.parse(APP_PATH.read_text())
    wanted = {
        "_DEALER_REQUIRED_DOCS",
        "_DEALER_DOCUMENT_LABELS",
        "_evaluate_dealer_application",
        "_dealer_document_type_from_label",
    }
    nodes = [
        node for node in tree.body
        if (isinstance(node, ast.Assign) and any(getattr(target, "id", None) in wanted for target in node.targets))
        or (isinstance(node, ast.FunctionDef) and node.name in {"_evaluate_dealer_application", "_dealer_document_type_from_label"})
    ]
    module = ast.Module(body=nodes, type_ignores=[])
    namespace = {"datetime": datetime, "re": re}
    exec(compile(module, str(APP_PATH), "exec"), namespace)
    return (
        namespace["_evaluate_dealer_application"],
        namespace["_dealer_document_type_from_label"],
        namespace["_DEALER_REQUIRED_DOCS"],
    )


evaluate, document_type_from_label, REQUIRED_DOCS = load_readiness_helper()
VALID_USER = {
    "company_name": "Carology",
    "legal_business_name": "Carology L.L.C-FZ",
    "trn": "100385799000003",
}


def document(doc_type, status="pending", expires_at=None, replaced_at=None):
    return {
        "document_type": doc_type,
        "status": status,
        "expires_at": expires_at,
        "replaced_at": replaced_at,
    }


class DealerApplicationLifecycleTests(unittest.TestCase):
    def test_missing_documents_cannot_submit(self):
        readiness = evaluate(VALID_USER, [document("trade_license", expires_at="2099-01-01")])
        self.assertFalse(readiness["ready_to_submit"])
        self.assertEqual(set(readiness["missing_uploads"]), {"tax_registration"})

    def test_two_uploads_can_submit_but_not_be_approved_while_pending(self):
        docs = [
            document("trade_license", expires_at="2099-01-01"),
            document("tax_registration"),
        ]
        readiness = evaluate(VALID_USER, docs)
        self.assertTrue(readiness["ready_to_submit"])
        self.assertFalse(readiness["ready_to_approve"])

    def test_all_approved_active_documents_can_be_approved(self):
        docs = [
            document("trade_license", "approved", "2099-01-01"),
            document("tax_registration", "approved"),
        ]
        readiness = evaluate(VALID_USER, docs)
        self.assertTrue(readiness["ready_to_submit"])
        self.assertTrue(readiness["ready_to_approve"])

    def test_denied_or_expired_document_blocks_approval(self):
        docs = [
            document("trade_license", "approved", "2000-01-01"),
            document("tax_registration", "denied"),
        ]
        readiness = evaluate(VALID_USER, docs)
        self.assertFalse(readiness["ready_to_submit"])
        self.assertFalse(readiness["ready_to_approve"])
        self.assertIn("trade_license", readiness["expired_documents"])
        self.assertIn("tax_registration", readiness["denied_documents"])

    def test_replaced_approved_document_does_not_satisfy_review(self):
        docs = [
            document("trade_license", "approved", "2099-01-01", "2026-08-13T00:00:00Z"),
            document("trade_license", "pending", "2099-01-01"),
            document("tax_registration", "approved"),
        ]
        readiness = evaluate(VALID_USER, docs)
        self.assertFalse(readiness["ready_to_approve"])
        self.assertIn("trade_license", readiness["pending_documents"])

    def test_request_more_info_labels_return_to_the_canonical_review_queue(self):
        self.assertEqual(document_type_from_label("Trade License - clear scan"), "trade_license")
        self.assertEqual(document_type_from_label("Company registration certificate"), "company_registration")
        self.assertEqual(document_type_from_label("Updated TRN certificate"), "tax_registration")
        self.assertIsNone(document_type_from_label("Shareholder passport"))

    def test_source_contracts_cover_upload_privacy_and_admin_guard(self):
        source = APP_PATH.read_text() + Path(APP_PATH.parent / "routes" / "dealer_verification.py").read_text()
        self.assertIn('@dealer_verification_bp.route("/api/auth/upload-dealer-document", methods=["POST"])', source)
        self.assertIn('"public": False', source)
        self.assertIn('"dealer_application_status": "action_required"', source)
        approve_section = source[source.index("def api_verify_dealer"):source.index("def api_reject_dealer")]
        self.assertIn('readiness["ready_to_approve"]', approve_section)
        review_section = source[source.index("def review_dealer_document"):source.index("# ─── Admin \"request more info\"")]
        self.assertIn('("approve", "deny", "pending")', review_section)

    def test_info_request_contracts_keep_documents_private_and_reviewable(self):
        source = APP_PATH.read_text() + Path(
            APP_PATH.parent / "routes" / "dealer_info_requests.py"
        ).read_text() + Path(
            APP_PATH.parent / "routes" / "public_info_request.py"
        ).read_text()
        public_section = source[source.index("def get_public_info_request"):source.index("def upload_public_info_request")]
        admin_list_section = source[source.index("def list_dealer_info_requests"):source.index("def cancel_dealer_info_request")]
        upload_section = source[source.index("def upload_public_info_request"):]
        create_section = source[source.index("def create_dealer_info_request"):source.index("def list_dealer_info_requests")]
        self.assertNotIn("storage_path", public_section)
        self.assertNotIn("file_type,url", public_section)
        self.assertIn("_with_private_dealer_attachment_url", admin_list_section)
        self.assertIn('data={"status": "cancelled"}', create_section)
        self.assertIn('"email_sent": email_sent', create_section)
        self.assertLess(
            upload_section.index('if document_type == "trade_license"'),
            upload_section.index('upload_response = requests.post'),
        )
        self.assertIn("extension_to_mime", upload_section)

    def test_two_document_policy_and_trade_license_ocr_contract(self):
        source = Path(APP_PATH.parent / "routes" / "dealer_verification.py").read_text()
        self.assertEqual(set(REQUIRED_DOCS), {"trade_license", "tax_registration"})
        upload_section = source[source.index("def upload_dealer_document"):source.index("def dealer_submit_application")]
        self.assertIn("scan_trade_license_expiry", upload_section)
        self.assertIn('"ocr_expires_at"', upload_section)


if __name__ == "__main__":
    unittest.main()
