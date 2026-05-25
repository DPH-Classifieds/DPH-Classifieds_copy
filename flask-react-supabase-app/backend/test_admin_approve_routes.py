#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import app as backend


class AdminApproveRouteTests(unittest.TestCase):
    def test_admin_approve_wrapper_delegates_without_duplicate_user_arg(self):
        observed = {}

        def fake_impl(current_user, item_type, item_id):
            observed["current_user"] = current_user
            observed["item_type"] = item_type
            observed["item_id"] = item_id
            return backend.jsonify({"message": "ok"}), 200

        with backend.app.app_context():
            with patch.object(backend.api_approve_item, "__wrapped__", fake_impl):
                response, status_code = backend.api_admin_approve_item.__wrapped__(
                    "admin-user",
                    "cars",
                    "listing-123",
                )

        self.assertEqual(status_code, 200)
        self.assertEqual(observed["current_user"], "admin-user")
        self.assertEqual(observed["item_type"], "cars")
        self.assertEqual(observed["item_id"], "listing-123")
        self.assertEqual(response.get_json(), {"message": "ok"})


if __name__ == "__main__":
    unittest.main()
