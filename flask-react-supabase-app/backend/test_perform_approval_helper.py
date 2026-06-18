import unittest
from unittest.mock import patch

import app as backend


class PerformApprovalTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def _fake_supabase(self, payload=None, status=200, follow_up=None):
        payload = payload or [{"id": "abc", "user_id": "u1", "user_email": "u@example.com"}]
        follow_up = follow_up or payload

        def _impl(method, path, data=None, **kw):
            self.calls.append({"method": method, "path": path, "data": data, "kw": kw})
            if method == "patch":
                return payload, status
            if method == "get":
                return follow_up, 200
            return None, 500

        return _impl

    def test_invalid_item_type_returns_400(self):
        with backend.app.app_context():
            ok, payload, status = backend._perform_approval(
                "ufos", "abc", actor="admin", actor_id="me"
            )
        self.assertFalse(ok)
        self.assertEqual(status, 400)
        self.assertIn("Invalid item type", payload["error"])

    def test_auto_actor_sets_auto_review_columns(self):
        with patch.object(backend, "supabase_request", side_effect=self._fake_supabase()), \
             patch.object(backend, "_invalidate_public_inventory_cache") as inv, \
             patch.object(backend, "_send_listing_status_email", return_value=(True, None)):
            with backend.app.app_context():
                ok, payload, status = backend._perform_approval(
                    "cars", "abc", actor="auto", actor_id="auto_review_worker"
                )
        self.assertTrue(ok)
        self.assertEqual(status, 200)
        inv.assert_called_once_with("cars")
        patch_call = next(c for c in self.calls if c["method"] == "patch")
        self.assertEqual(patch_call["data"]["status"], "approved")
        self.assertTrue(patch_call["data"]["is_approved"])
        self.assertEqual(patch_call["data"]["auto_review_state"], "auto_approved")
        self.assertIn("auto_review_decided_at", patch_call["data"])

    def test_admin_actor_does_not_touch_auto_review_columns(self):
        with patch.object(backend, "supabase_request", side_effect=self._fake_supabase()), \
             patch.object(backend, "_invalidate_public_inventory_cache"), \
             patch.object(backend, "_send_listing_status_email", return_value=(True, None)):
            with backend.app.app_context():
                backend._perform_approval(
                    "cars", "abc", actor="admin", actor_id="admin-1",
                    origin_header="https://example.com",
                )
        patch_call = next(c for c in self.calls if c["method"] == "patch")
        self.assertNotIn("auto_review_state", patch_call["data"])
        self.assertNotIn("auto_review_decided_at", patch_call["data"])

    def test_supabase_error_propagates(self):
        with patch.object(
            backend, "supabase_request",
            side_effect=self._fake_supabase(payload={"message": "boom"}, status=500),
        ), patch.object(backend, "_invalidate_public_inventory_cache") as inv:
            with backend.app.app_context():
                ok, payload, status = backend._perform_approval(
                    "bikes", "xyz", actor="admin", actor_id="admin-1"
                )
        self.assertFalse(ok)
        self.assertEqual(status, 500)
        inv.assert_not_called()

    def test_dry_run_skips_supabase_and_email(self):
        send_email = unittest.mock.MagicMock()
        with patch.object(backend, "supabase_request") as sb, \
             patch.object(backend, "_invalidate_public_inventory_cache") as inv, \
             patch.object(backend, "_send_listing_status_email", send_email):
            with backend.app.app_context():
                ok, payload, status = backend._perform_approval(
                    "cars", "abc", actor="auto", actor_id="auto_review_worker",
                    dry_run=True,
                )
        self.assertTrue(ok)
        self.assertTrue(payload["dry_run"])
        sb.assert_not_called()
        send_email.assert_not_called()
        inv.assert_not_called()

    def test_existing_admin_wrapper_still_works(self):
        # Sanity: api_admin_approve_item still delegates correctly.
        with patch.object(backend, "supabase_request", side_effect=self._fake_supabase()), \
             patch.object(backend, "_invalidate_public_inventory_cache"), \
             patch.object(backend, "_send_listing_status_email", return_value=(True, None)), \
             patch.object(backend, "_get_user_details_with_admin_status",
                          return_value={"is_admin": True}):
            with backend.app.test_request_context("/api/admin/cars/abc/approve"):
                response, status = backend.api_admin_approve_item.__wrapped__(
                    "admin-user", "cars", "abc"
                )
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
