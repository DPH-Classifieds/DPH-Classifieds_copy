"""Regression checks for the 2026-08-18 pyflakes audit: four more spots in
the backend referenced names that were never defined/imported in scope,
each a NameError waiting to fire (some swallowed by a broad `except`,
producing silent failures instead of crashes). Each test exercises the
real code path so a future reintroduction of any of these fails loudly
here instead of shipping.
"""
from unittest.mock import patch, MagicMock

from flask import request as flask_request

import app as app_module
from routes import admin as admin_routes


# --- featured_listings: app.py never imported ALLOWED_LISTING_TYPES /
# is_listing_active_featured / validate_featured_input from services/featured_listings.py

def test_admin_create_featured_listing_runs_validate_featured_input():
    with app_module.app.test_request_context(
        "/api/admin/featured-listings", method="POST",
        json={"listing_type": "not-a-real-type", "listing_id": "abc"},
    ), patch.object(
        app_module, "_require_admin_api_user", return_value={"id": "admin-1"}
    ):
        resp = app_module.admin_create_featured_listing.__wrapped__("admin-1")
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        # A clean 400 (bad listing_type) proves validate_featured_input actually
        # ran; before the fix this NameError'd into a 500.
        assert status == 400


def test_public_featured_listings_type_filter_uses_allowed_listing_types():
    with app_module.app.test_request_context("/api/featured-listings?type=bogus"):
        resp = app_module.public_list_featured_listings()
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        assert status == 400


def test_public_featured_listings_filters_via_is_listing_active_featured():
    row = {"id": "f1", "listing_type": "car", "listing_id": "id1", "featured_until": None}
    with app_module.app.test_request_context("/api/featured-listings"), patch.object(
        app_module, "supabase_request", return_value=([row], 200)
    ):
        # Must not raise NameError when evaluating is_listing_active_featured(row).
        resp = app_module.public_list_featured_listings()
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        assert status == 200


# --- app.py never imported parse_qs from urllib.parse

def test_update_password_parses_access_token_out_of_hash_fragment():
    with patch.object(app_module, "requests") as mock_requests:
        mock_requests.put.return_value = MagicMock(status_code=200, json=lambda: {"id": "user-1"})
        mock_requests.post.return_value = MagicMock(status_code=204)
        client = app_module.app.test_client()
        with patch.object(app_module, "revoke_user_sessions", return_value=True):
            resp = client.post("/api/auth/update-password", json={
                "password": "Passw0rd!",
                "hash": "access_token=real-token-abc&type=recovery",
            })
        assert resp.status_code == 200
        _, put_kwargs = mock_requests.put.call_args
        assert put_kwargs["headers"]["Authorization"] == "Bearer real-token-abc"


# --- app.py's /api/recommendations used a `supabase.table(...)` ORM client
# that was never constructed anywhere in the codebase.

def test_recommendations_personalized_path_uses_supabase_request():
    item = {"id": "abc", "created_at": "2026-01-01T00:00:00Z"}
    with patch.object(app_module, "supabase_request", return_value=([item], 200)):
        client = app_module.app.test_client()
        resp = client.post("/api/recommendations", json={
            "viewed": [{"id": "seen-1", "type": "car"}],
            "preferredTypes": ["car"],
            "avgPrice": 50000,
            "limit": 5,
        })
        assert resp.status_code == 200
        assert resp.get_json().get("recommendations") is not None
        assert "error" not in resp.get_json()


def test_recommendations_cold_start_path_uses_supabase_request():
    item = {"id": "abc", "created_at": "2026-01-01T00:00:00Z"}
    with patch.object(app_module, "supabase_request", return_value=([item], 200)):
        client = app_module.app.test_client()
        resp = client.post("/api/recommendations", json={"limit": 4})
        assert resp.status_code == 200
        assert "error" not in resp.get_json()


# --- routes/admin.py approve_listing() referenced item_type/item_id/table_name,
# none of which exist in that function's scope (real names: listing_type,
# listing_id, table). Copy-paste from the sibling reject_item(item_type, item_id).

def test_approve_listing_uses_real_variable_names():
    approve_response = MagicMock(
        status_code=200,
        json=lambda: [{
            "id": "listing-1",
            "registration_document_url": "https://x/storage/v1/object/public/registration-documents/car1.jpg",
        }],
    )
    delete_response = MagicMock(status_code=200)
    patch_response = MagicMock(status_code=200)

    with patch.object(admin_routes, "requests") as mock_requests, \
         app_module.app.test_request_context(json={"type": "cars"}):
        flask_request.user_id = "admin-1"
        mock_requests.patch.side_effect = [approve_response, patch_response]
        mock_requests.delete.return_value = delete_response

        resp = admin_routes.approve_listing.__wrapped__("listing-1")
        status = resp[1] if isinstance(resp, tuple) else resp.status_code
        body = resp[0].get_json() if isinstance(resp, tuple) else resp.get_json()

        assert status == 200
        assert body["success"] is True
        assert "listing-1" in body["message"]

        # Second requests.patch call is the registration-doc cleanup; its URL
        # must use the real table ("cars") and the real listing id, not the
        # undefined table_name/item_id.
        cleanup_call = mock_requests.patch.call_args_list[1]
        cleanup_url = cleanup_call[0][0]
        assert "/rest/v1/cars?id=eq.listing-1" in cleanup_url
