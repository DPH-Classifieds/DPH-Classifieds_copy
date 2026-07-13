import unittest
from unittest.mock import patch

import app as backend


class DealerGateRuntimeTests(unittest.TestCase):
    def test_dealer_gate_uses_supabase_client_and_fails_open_on_missing_user(self):
        with patch.object(backend, "supabase_request", return_value=([], 200)) as query:
            with patch.object(backend.requests, "get", side_effect=AssertionError("network call")):
                self.assertIsNone(backend._require_dealer_verified("user-123"))
        query.assert_called_once()


if __name__ == "__main__":
    unittest.main()
