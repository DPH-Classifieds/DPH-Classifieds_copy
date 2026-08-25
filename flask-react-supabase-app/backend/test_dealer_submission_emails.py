#!/usr/bin/env python3
"""Guard test: dealer signup must NOT email admins.

PaddleOCR + the minute-tick worker are the only approval authority now.
Regression coverage for the spec at
docs/superpowers/specs/2026-08-25-dealer-ocr-auto-approval-copy-and-admin-override.md
"""

import importlib
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))


class TestNoAdminEmailOnDealerSignup(unittest.TestCase):
    def test_dealer_signup_does_not_email_admins(self):
        backend = importlib.import_module("app")

        sent = []
        with (
            backend.app.test_request_context("/api/auth/dealer-submit-application"),
            patch.object(
                backend,
                "_send_dealer_signup_admin_notification",
                side_effect=lambda *_a, **_kw: sent.append(("called", _a, _kw))
                or ("ok", None),
            ),
            patch.object(backend, "supabase_request") as mock_req,
            patch.object(
                backend,
                "_get_dealer_application_readiness",
                return_value=(
                    {
                        "ready_to_submit": True,
                        "missing_uploads": [],
                        "expired_documents": [],
                        "denied_documents": [],
                        "pending_documents": [],
                    },
                    None,
                ),
            ),
        ):

            def fake_request(method, path, *args, **kwargs):
                if method == "get" and path.startswith("/rest/v1/users?id=eq."):
                    return (
                        [
                            {
                                "id": "dealer-x",
                                "email": "dealer@example.com",
                                "first_name": "Jane",
                                "last_name": "Dealer",
                                "legal_business_name": "Jane Cars FZ-LLC",
                                "company_name": "Jane Cars",
                                "trn": "123456789012345",
                                "is_dealer": True,
                                "dealer_verified": False,
                                "dealer_application_status": "draft",
                            }
                        ],
                        200,
                    )
                if method == "patch" and path.startswith("/rest/v1/users?id=eq."):
                    return ({"ok": True}, 200)
                return ([], 200)

            mock_req.side_effect = fake_request

            resp, status = backend.dealer_submit_application.__wrapped__("dealer-x")

        self.assertEqual(status, 200)
        self.assertEqual(
            sent,
            [],
            "dealer_submit_application must NOT call _send_dealer_signup_admin_notification",
        )
