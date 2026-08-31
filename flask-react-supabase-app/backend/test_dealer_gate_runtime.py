import unittest
from unittest.mock import patch

import app as backend


class DealerGateRuntimeTests(unittest.TestCase):
    def test_dealer_gate_uses_supabase_client_and_fails_closed_on_missing_user(self):
        with patch.object(backend, "supabase_request", return_value=([], 200)) as query:
            with patch.object(backend.requests, "get", side_effect=AssertionError("network call")):
                with backend.app.app_context():
                    response, status = backend._require_dealer_verified("user-123")
        self.assertEqual(status, 503)
        self.assertEqual(response.get_json()["code"], "dealer_verification_unavailable")
        query.assert_called_once()


if __name__ == "__main__":
    unittest.main()
