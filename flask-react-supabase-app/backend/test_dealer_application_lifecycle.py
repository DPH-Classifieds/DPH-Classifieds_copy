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
    }
    nodes = [
        node for node in tree.body
        if (isinstance(node, ast.Assign) and any(getattr(target, "id", None) in wanted for target in node.targets))
        or (isinstance(node, ast.FunctionDef) and node.name == "_evaluate_dealer_application")
    ]
    module = ast.Module(body=nodes, type_ignores=[])
    namespace = {"datetime": datetime, "re": re}
    exec(compile(module, str(APP_PATH), "exec"), namespace)
    return namespace["_evaluate_dealer_application"]


evaluate = load_readiness_helper()
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
        self.assertEqual(set(readiness["missing_uploads"]), {"company_registration", "tax_registration"})

    def test_three_uploads_can_submit_but_not_be_approved_while_pending(self):
        docs = [
            document("trade_license", expires_at="2099-01-01"),
            document("company_registration"),
            document("tax_registration"),
        ]
        readiness = evaluate(VALID_USER, docs)
        self.assertTrue(readiness["ready_to_submit"])
        self.assertFalse(readiness["ready_to_approve"])

    def test_all_approved_active_documents_can_be_approved(self):
        docs = [
            document("trade_license", "approved", "2099-01-01"),
            document("company_registration", "approved"),
            document("tax_registration", "approved"),
        ]
        readiness = evaluate(VALID_USER, docs)
        self.assertTrue(readiness["ready_to_submit"])
        self.assertTrue(readiness["ready_to_approve"])

    def test_denied_or_expired_document_blocks_approval(self):
        docs = [
            document("trade_license", "approved", "2000-01-01"),
            document("company_registration", "approved"),
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
            document("company_registration", "approved"),
            document("tax_registration", "approved"),
        ]
        readiness = evaluate(VALID_USER, docs)
        self.assertFalse(readiness["ready_to_approve"])
        self.assertIn("trade_license", readiness["pending_documents"])

    def test_source_contracts_cover_upload_privacy_and_admin_guard(self):
        source = APP_PATH.read_text()
        self.assertIn('@app.route("/api/auth/upload-dealer-document", methods=["POST"])', source)
        self.assertIn('"public": False', source)
        self.assertIn('"dealer_application_status": "action_required"', source)
        approve_section = source[source.index("def api_verify_dealer"):source.index("def api_reject_dealer")]
        self.assertIn('readiness["ready_to_approve"]', approve_section)


if __name__ == "__main__":
    unittest.main()
