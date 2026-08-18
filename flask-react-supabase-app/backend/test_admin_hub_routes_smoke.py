"""Regression check for the 2026-08-18 prod incident: the featured-listings
and dealer listing-upgrade-requests admin routes called a nonexistent
`_user_has_admin_role` helper (should have been `_require_admin_api_user`,
the helper every other admin route uses), causing NameError -> 500 on every
request. Calls the real, undecorated view functions so a future typo of the
same shape fails this test instead of shipping to prod.
"""
from unittest.mock import patch

import app as app_module


def test_admin_list_listing_upgrade_requests_does_not_500():
    with app_module.app.test_request_context(
        "/api/admin/dealer/listing-upgrade-requests?status=pending"
    ), patch.object(
        app_module, "_require_admin_api_user", return_value={"id": "admin-1", "is_admin": True}
    ), patch.object(
        app_module, "supabase_request", return_value=([], 200)
    ):
        resp = app_module.admin_list_listing_upgrade_requests.__wrapped__("admin-1")
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        assert status == 200


def test_admin_list_featured_listings_does_not_500():
    with app_module.app.test_request_context(
        "/api/admin/featured-listings"
    ), patch.object(
        app_module, "_require_admin_api_user", return_value={"id": "admin-1", "is_admin": True}
    ), patch.object(
        app_module, "supabase_request", return_value=([], 200)
    ):
        resp = app_module.admin_list_featured_listings.__wrapped__("admin-1")
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        assert status == 200
