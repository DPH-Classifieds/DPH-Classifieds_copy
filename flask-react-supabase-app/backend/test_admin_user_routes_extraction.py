"""Contract tests for the extracted admin user maintenance routes."""

import re
from pathlib import Path
from unittest.mock import patch

import app as backend


REPO = Path(__file__).resolve().parent
ADMIN_USERS_MODULE = REPO / "routes" / "admin_users.py"


def _route_result(result):
    response, status = result
    return response.get_json(), status


def test_admin_user_routes_have_one_live_owner_and_legacy_endpoints():
    expected = {
        "/api/admin/users/<user_id>/profile": (
            "PATCH",
            "update_admin_user_profile",
        ),
        "/api/admin/cleanup-unverified-accounts": (
            "POST",
            "admin_cleanup_unverified_accounts",
        ),
    }

    for path, (method, endpoint) in expected.items():
        rules = [rule for rule in backend.app.url_map.iter_rules() if rule.rule == path]
        assert len(rules) == 1
        assert method in rules[0].methods
        assert "OPTIONS" in rules[0].methods
        assert rules[0].endpoint == endpoint


def test_admin_user_route_module_uses_runtime_registry_without_app_import():
    source = ADMIN_USERS_MODULE.read_text(encoding="utf-8")

    assert not re.search(r"^\s*(?:from\s+app\s+|import\s+app(?:\s|$))", source, re.M)
    assert 'current_app.extensions["dph_user_backend"]' in source
    assert "def register_admin_user_routes" in source


def test_admin_user_handlers_remain_compatibility_exports_with_wrapped_callers():
    assert backend.update_admin_user_profile.__module__ == "routes.admin_users"
    assert backend.admin_cleanup_unverified_accounts.__module__ == "routes.admin_users"
    assert hasattr(backend.update_admin_user_profile, "__wrapped__")
    assert hasattr(backend.admin_cleanup_unverified_accounts, "__wrapped__")


def test_registered_admin_user_routes_retain_token_required_gate():
    client = backend.app.test_client()

    profile_response = client.patch(
        "/api/admin/users/user-2/profile", json={"first_name": "New"}
    )
    cleanup_response = client.post("/api/admin/cleanup-unverified-accounts", json={})

    assert profile_response.status_code == 401
    assert profile_response.get_json() == {"message": "Authorization header is required"}
    assert cleanup_response.status_code == 401
    assert cleanup_response.get_json() == {"message": "Authorization header is required"}


def test_profile_patch_requires_admin_access():
    with backend.app.test_request_context(
        "/api/admin/users/user-2/profile", method="PATCH", json={"first_name": "New"}
    ), patch.object(backend, "_require_admin_api_user", return_value=None):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("member-1", "user-2")
        )

    assert status == 403
    assert payload == {"error": "Unauthorized - Admin access required"}


def test_profile_patch_rejects_self_and_protected_super_admin_targets():
    with backend.app.test_request_context(
        "/api/admin/users/admin-1/profile", method="PATCH", json={"first_name": "New"}
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("admin-1", "admin-1")
        )

    assert status == 400
    assert payload["error"] == "You cannot modify your own admin profile from this panel"

    with backend.app.test_request_context(
        "/api/admin/users/super-admin/profile", method="PATCH", json={"first_name": "New"}
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}):
        protected_response = backend.jsonify(
            {"error": "protected", "code": "super_admin_protected"}
        )
        with patch.object(
            backend, "_protect_super_admin_target", return_value=(protected_response, 403)
        ):
            payload, status = _route_result(
                backend.update_admin_user_profile.__wrapped__("admin-1", "super-admin")
            )

    assert status == 403
    assert payload == {"error": "protected", "code": "super_admin_protected"}


def test_profile_patch_filters_unsupported_fields_and_preserves_phone_verification():
    calls = []
    refreshed = {
        "id": "user-2",
        "first_name": "New",
        "phone": "+971501234567",
        "phone_verified": True,
    }

    def fake_supabase(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if method == "patch":
            return [], 204
        return [refreshed], 200

    request_data = {
        "first_name": " New ",
        "phone": "050 123 4567",
        "phone_verified": True,
        "password": "must-not-pass",
        "role": "superadmin",
        "is_super_admin": True,
    }
    with backend.app.test_request_context(
        "/api/admin/users/user-2/profile", method="PATCH", json=request_data
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch.object(
        backend,
        "_protect_super_admin_target",
        return_value=None,
    ), patch.object(
        backend,
        "_get_user_profile_for_verification",
        return_value={"phone": "050 111 2222", "country_code": "+971"},
    ), patch.object(backend, "supabase_request", side_effect=fake_supabase):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("admin-1", "user-2")
        )

    assert status == 200
    assert payload == {
        "message": "User profile updated successfully",
        "user": refreshed,
    }
    assert len(calls) == 2
    patch_call = calls[0]
    assert patch_call[0] == "patch"
    assert patch_call[1] == "/rest/v1/users?id=eq.user-2"
    assert patch_call[2]["use_service_role"] is True
    assert patch_call[2]["data"]["first_name"] == "New"
    assert patch_call[2]["data"]["phone"] == "+971501234567"
    assert patch_call[2]["data"]["country_code"] == "+971"
    assert "password" not in patch_call[2]["data"]
    assert "role" not in patch_call[2]["data"]
    assert "is_super_admin" not in patch_call[2]["data"]
    assert patch_call[2]["data"]["phone_verified_at"]


def test_profile_patch_rejects_phone_verification_without_a_valid_number():
    with backend.app.test_request_context(
        "/api/admin/users/user-2/profile",
        method="PATCH",
        json={"phone_verified": True},
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch.object(
        backend, "_protect_super_admin_target", return_value=None
    ), patch.object(backend, "_get_user_profile_for_verification", return_value={}):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("admin-1", "user-2")
        )

    assert status == 400
    assert payload == {
        "error": "Cannot mark a user as phone verified without a valid phone number."
    }


def test_profile_patch_preserves_validation_and_upstream_error_envelopes():
    with backend.app.test_request_context(
        "/api/admin/users/user-2/profile", method="PATCH", json={"account_status": "unknown"}
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch.object(
        backend, "_protect_super_admin_target", return_value=None
    ):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("admin-1", "user-2")
        )

    assert status == 400
    assert payload["error"] == "account_status must be one of: active, banned, suspended"

    with backend.app.test_request_context(
        "/api/admin/users/user-2/profile", method="PATCH", json={"unsupported": "value"}
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch.object(
        backend, "_protect_super_admin_target", return_value=None
    ):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("admin-1", "user-2")
        )

    assert status == 400
    assert payload == {"error": "No supported profile fields were provided"}

    with backend.app.test_request_context(
        "/api/admin/users/user-2/profile", method="PATCH", json={"first_name": "New"}
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch.object(
        backend, "_protect_super_admin_target", return_value=None
    ), patch.object(backend, "supabase_request", return_value=("upstream failure", 503)):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("admin-1", "user-2")
        )

    assert status == 503
    assert payload == {"error": "Failed to update user profile"}


def test_profile_patch_preserves_dealer_notifications_for_approval():
    refreshed = {"id": "dealer-1", "dealer_verified": True}

    def fake_supabase(method, path, **kwargs):
        if method == "patch":
            return [], 200
        if "select=email,first_name,last_name,company_name" in path:
            return [
                {
                    "email": "dealer@example.com",
                    "first_name": "Dealer",
                    "last_name": "One",
                    "company_name": "Dealer Motors",
                }
            ], 200
        return [refreshed], 200

    with backend.app.test_request_context(
        "/api/admin/users/dealer-1/profile",
        method="PATCH",
        json={"dealer_verified": True},
        headers={"Origin": "https://example.com"},
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch.object(
        backend, "_protect_super_admin_target", return_value=None
    ), patch.object(backend, "supabase_request", side_effect=fake_supabase), patch.object(
        backend, "_send_dealer_status_email"
    ) as send_dealer, patch.object(
        backend, "_send_dealer_approved_admin_notification"
    ) as send_admin, patch.object(backend, "_send_resend_email") as send_resend, patch.dict(
        "os.environ",
        {"RESEND_TO_EMAIL": "ops@example.com", "RESEND_FROM_EMAIL": "noreply@example.com"},
        clear=False,
    ):
        payload, status = _route_result(
            backend.update_admin_user_profile.__wrapped__("admin-1", "dealer-1")
        )

    assert status == 200
    assert payload["user"] == refreshed
    send_dealer.assert_called_once_with(
        "dealer@example.com", "approved", "https://example.com"
    )
    send_admin.assert_called_once()
    send_resend.assert_called_once()
    assert send_resend.call_args.args[0]["to"] == "ops@example.com"
    assert "DPH Admin: Dealer profile updated" in send_resend.call_args.args[0]["subject"]


def test_cleanup_route_passes_options_and_preserves_result_envelope():
    cleanup_result = {
        "dry_run": True,
        "cutoff": "2026-09-05T00:00:00+00:00",
        "candidates": [{"id": "user-2"}],
        "deleted_auth": 0,
        "deleted_user_rows": 0,
    }
    with backend.app.test_request_context(
        "/api/admin/cleanup-unverified-accounts",
        method="POST",
        json={"dryRun": True, "limit": 3, "maxAgeHours": 12.5},
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch(
        "auth_cleanup.cleanup_unverified_accounts", return_value=cleanup_result
    ) as cleanup:
        payload, status = _route_result(
            backend.admin_cleanup_unverified_accounts.__wrapped__("admin-1")
        )

    assert status == 200
    assert payload == cleanup_result
    cleanup.assert_called_once_with(max_age_hours=12.5, limit=3, dry_run=True)


def test_cleanup_route_preserves_admin_gate_and_failure_envelopes():
    with backend.app.test_request_context(
        "/api/admin/cleanup-unverified-accounts", method="POST", json={}
    ), patch.object(backend, "_require_admin_api_user", return_value=None):
        payload, status = _route_result(
            backend.admin_cleanup_unverified_accounts.__wrapped__("member-1")
        )

    assert status == 403
    assert payload == {"error": "Unauthorized - Admin access required"}

    with backend.app.test_request_context(
        "/api/admin/cleanup-unverified-accounts", method="POST", json={}
    ), patch.object(backend, "_require_admin_api_user", return_value={"is_admin": True}), patch(
        "auth_cleanup.cleanup_unverified_accounts", side_effect=RuntimeError("provider down")
    ):
        payload, status = _route_result(
            backend.admin_cleanup_unverified_accounts.__wrapped__("admin-1")
        )

    assert status == 500
    assert payload == {"error": "Failed to run cleanup"}
