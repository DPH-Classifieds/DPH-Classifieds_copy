import ast
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


BACKEND_DIR = Path(__file__).parent
PHONE_VERIFICATION_PATH = BACKEND_DIR / "routes" / "phone_verification.py"
PHONE_ROUTES = {
    "/api/phone-verifications/start": "start_phone_verification",
    "/api/phone-verifications/verify": "verify_phone_verification",
    "/api/phone-verifications/verify-token": "verify_phone_verification_token",
}


def _route_contracts(path):
    return [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == path
    ]


def test_phone_verification_module_uses_runtime_boundary_without_app_import():
    source = PHONE_VERIFICATION_PATH.read_text()
    tree = ast.parse(source)

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")

    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source


def test_phone_verification_routes_keep_single_legacy_contracts_and_exports():
    from routes import phone_verification

    for path, endpoint in PHONE_ROUTES.items():
        contracts = _route_contracts(path)
        assert len(contracts) == 1
        assert contracts[0].endpoint == endpoint
        assert contracts[0].methods == ("OPTIONS", "POST")
        assert getattr(backend, endpoint) is getattr(phone_verification, endpoint)


def test_start_preserves_auth_purpose_and_safe_provider_error_envelopes():
    client = backend.app.test_client()

    with patch.object(backend, "_auth_rate_limited", return_value=False), patch.object(
        backend, "_get_optional_user_id_from_auth_header", return_value=None
    ):
        invalid = client.post(
            "/api/phone-verifications/start", json={"purpose": "invalid"}
        )
        unauthenticated = client.post(
            "/api/phone-verifications/start", json={"purpose": "vin_reveal"}
        )

    assert invalid.status_code == 400
    assert invalid.get_json() == {"message": "Invalid verification purpose"}
    assert unauthenticated.status_code == 401
    assert unauthenticated.get_json() == {"message": "Authentication required"}

    with patch.object(backend, "_auth_rate_limited", return_value=False), patch.object(
        backend, "_get_optional_user_id_from_auth_header", return_value="user-1"
    ), patch.object(
        backend,
        "_get_user_profile_for_verification",
        return_value={
            "phone": "+12025550123",
            "country_code": "+1",
            "email_verified": True,
            "phone_verified": False,
        },
    ), patch.object(backend, "_msg91_handles_phone", return_value=False), patch.object(
        backend, "_issue_phone_verification", side_effect=RuntimeError("provider secret")
    ):
        provider_failure = client.post(
            "/api/phone-verifications/start",
            json={"purpose": "phone_change", "listing_id": "car-1"},
        )

    assert provider_failure.status_code == 500
    assert provider_failure.get_json() == {
        "message": "Failed to send verification code"
    }


def test_start_preserves_resend_owner_binding_and_response():
    record = {"id": "verification-1", "user_id": "user-1"}
    refreshed = {
        "verification": {
            "id": "verification-1",
            "phone": "+971501234567",
            "purpose": "vin_reveal",
            "listing_id": "car-1",
            "status": "pending",
            "expires_at": "2026-09-08T12:00:00+00:00",
            "last_sent_at": "2026-09-08T11:55:00+00:00",
            "send_count": 2,
        }
    }

    with patch.object(backend, "_auth_rate_limited", return_value=False), patch.object(
        backend,
        "_get_optional_user_id_from_auth_header",
        return_value="user-1",
    ), patch.object(
        backend, "_lookup_phone_verification", return_value=record
    ) as lookup, patch.object(
        backend, "_resend_phone_verification", return_value=refreshed
    ) as resend:
        response = backend.app.test_client().post(
            "/api/phone-verifications/start",
            json={"verification_id": "verification-1"},
        )

    assert response.status_code == 200
    assert response.get_json()["message"] == "Verification code resent"
    assert response.get_json()["phone_verification"]["verification_id"] == (
        "verification-1"
    )
    lookup.assert_called_once_with(verification_id="verification-1")
    resend.assert_called_once_with(record)


def test_verify_preserves_purpose_listing_lookup_and_value_error_statuses():
    record = {"id": "verification-1", "user_id": "user-1"}

    with patch.object(backend, "_auth_rate_limited", return_value=False), patch.object(
        backend,
        "_get_optional_user_id_from_auth_header",
        return_value="user-1",
    ), patch.object(
        backend, "_lookup_phone_verification", return_value=record
    ) as lookup, patch.object(
        backend,
        "_finalize_phone_verification",
        side_effect=ValueError("Verification code has expired"),
    ) as finalize:
        response = backend.app.test_client().post(
            "/api/phone-verifications/verify",
            json={
                "code": "123456",
                "purpose": "vin_reveal",
                "listing_id": "car-1",
            },
            headers={"User-Agent": "contract-test"},
        )

    assert response.status_code == 410
    assert response.get_json() == {"message": "Verification code has expired"}
    lookup.assert_called_once_with(
        user_id="user-1", purpose="vin_reveal", listing_id="car-1"
    )
    finalize.assert_called_once()
    assert finalize.call_args.args == (record, "123456")
    assert finalize.call_args.kwargs["user_agent"] == "contract-test"


def test_verify_token_preserves_msg91_binding_audit_and_sync_contract():
    now = datetime(2026, 9, 8, 8, 0, tzinfo=timezone.utc)

    with patch.object(backend, "_auth_rate_limited", return_value=False), patch.object(
        backend,
        "_get_optional_user_id_from_auth_header",
        return_value="user-1",
    ), patch.object(
        backend,
        "_verify_msg91_access_token",
        return_value=(True, {"mobile": "971501234567"}),
    ), patch.object(
        backend,
        "_get_user_profile_for_verification",
        return_value={"phone": "+971501234567", "country_code": "+971"},
    ), patch.object(backend, "_utc_now", return_value=now), patch.object(
        backend, "supabase_request", return_value=([{"id": "audit-1"}], 201)
    ) as supabase, patch.object(
        backend, "_sync_user_verification_flags"
    ) as sync_flags, patch.object(backend, "_sync_phone_to_listings") as sync_listings:
        response = backend.app.test_client().post(
            "/api/phone-verifications/verify-token",
            json={
                "access-token": "msg91-token",
                "purpose": "vin_reveal",
                "listing_id": "car-1",
            },
            headers={"User-Agent": "contract-test"},
        )

    assert response.status_code == 200
    assert response.get_json() == {
        "message": "Phone verified successfully",
        "verification": {
            "verification_id": "audit-1",
            "status": "verified",
            "phone": "+971501234567",
            "purpose": "vin_reveal",
            "listing_id": "car-1",
            "verified_at": "2026-09-08T08:00:00+00:00",
        },
    }
    assert supabase.call_args.args == ("post", "/rest/v1/phone_verifications")
    assert supabase.call_args.kwargs["data"]["metadata"] == {
        "provider": "msg91_widget",
        "country_code": "+971",
    }
    sync_flags.assert_called_once_with(
        "user-1",
        phone_verified=True,
        phone_verified_at="2026-09-08T08:00:00+00:00",
        phone="+971501234567",
        country_code=None,
    )
    sync_listings.assert_called_once_with("user-1", "+971501234567")


def test_verify_token_rejects_mismatched_number_without_leaking_provider_body():
    with patch.object(backend, "_auth_rate_limited", return_value=False), patch.object(
        backend,
        "_get_optional_user_id_from_auth_header",
        return_value="user-1",
    ), patch.object(
        backend,
        "_verify_msg91_access_token",
        return_value=(True, {"mobile": "971509999999"}),
    ), patch.object(
        backend,
        "_get_user_profile_for_verification",
        return_value={"phone": "+971501234567", "country_code": "+971"},
    ), patch.object(backend, "_sync_user_verification_flags") as sync_flags:
        response = backend.app.test_client().post(
            "/api/phone-verifications/verify-token",
            json={"access_token": "msg91-token"},
        )

    assert response.status_code == 400
    assert response.get_json() == {
        "message": "Verified number does not match your account phone."
    }
    sync_flags.assert_not_called()
