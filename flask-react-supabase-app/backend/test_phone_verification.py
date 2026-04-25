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
    def test_send_sms_strips_formatting_from_destination(self, mock_post):
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
            "971501234567",
        )


if __name__ == "__main__":
    unittest.main()
