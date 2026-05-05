#!/usr/bin/env python3
import unittest
from unittest.mock import Mock, patch

import app as backend


class PhoneNormalizationTests(unittest.TestCase):
    def test_keeps_international_number_without_plus(self):
        self.assertEqual(
            backend._normalize_phone_number("971567654384", "+971"),
            "+971567654384",
        )

    def test_prefixes_local_number(self):
        self.assertEqual(
            backend._normalize_phone_number("0501234567", "+971"),
            "+971501234567",
        )

    def test_handles_plus_and_spacing(self):
        self.assertEqual(
            backend._normalize_phone_number("+971 50 123 4567", "+971"),
            "+971501234567",
        )


class InfobipPayloadTests(unittest.TestCase):
    @patch.object(backend.requests, "post")
    def test_send_sms_uses_e164_destination(self, mock_post):
        backend.INFOBIP_API_KEY = "test-key"
        backend.INFOBIP_BASE_URL = "https://example.com"
        backend.INFOBIP_SENDER = "ServiceSMS"

        response = Mock()
        response.status_code = 200
        response.json.return_value = {"messages": []}
        mock_post.return_value = response

        sent, result = backend._send_infobip_sms("+971 50 123 4567", "Hello")

        self.assertTrue(sent)
        self.assertEqual(result, {"messages": []})
        self.assertTrue(mock_post.called)
        payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(
            payload["messages"][0]["destinations"][0]["to"],
            "+971501234567",
        )

    @patch.object(backend.requests, "post")
    def test_send_sms_normalizes_missing_url_scheme(self, mock_post):
        backend.INFOBIP_API_KEY = "test-key"
        backend.INFOBIP_BASE_URL = "eedd6r.api.infobip.com"
        backend.INFOBIP_SENDER = "ServiceSMS"

        response = Mock()
        response.status_code = 200
        response.json.return_value = {"messages": []}
        mock_post.return_value = response

        sent, result = backend._send_infobip_sms("+971 50 123 4567", "Hello")

        self.assertTrue(sent)
        self.assertEqual(result, {"messages": []})
        self.assertTrue(mock_post.called)
        self.assertTrue(mock_post.call_args.args[0].startswith("https://eedd6r.api.infobip.com/sms/3/messages"))


class OptionalAuthTests(unittest.TestCase):
    @patch.object(backend.requests, "get")
    def test_optional_auth_falls_back_to_supabase_validation(self, mock_get):
        response = Mock()
        response.status_code = 200
        response.json.return_value = {"id": "user-123"}
        mock_get.return_value = response

        with backend.app.test_request_context(
            "/api/phone-verifications/start",
            headers={"Authorization": "Bearer invalid.jwt.token"},
        ):
            user_id = backend._get_optional_user_id_from_auth_header()

        self.assertEqual(user_id, "user-123")
        self.assertTrue(mock_get.called)


class UAEPhoneValidationTests(unittest.TestCase):
    def test_issue_verification_rejects_non_uae_number(self):
        with self.assertRaises(ValueError) as context:
            backend._issue_phone_verification(
                user_id="user-123",
                phone="+12025550123",
                purpose="vin_reveal",
                country_code="+1",
            )
        self.assertIn("Only UAE phone numbers are supported", str(context.exception))


if __name__ == "__main__":
    unittest.main()
