"""Contract coverage for admin VIN unlock route ownership and authorization."""

from unittest.mock import patch

import app as backend


def test_admin_vin_unlock_requires_admin():
    with (
        backend.app.test_request_context("/api/admin/listings/cars/car-1/vin-unlock"),
        patch.object(backend, "_get_user_details_with_admin_status", return_value={"is_admin": False}),
    ):
        response, status = backend.admin_vin_unlock.__wrapped__("user-1", "cars", "car-1")

    assert status == 403
    assert response.get_json() == {"error": "Unauthorized - Admin access required"}


def test_admin_vin_unlock_marks_listing_owner_verified_after_phone_check():
    with (
        backend.app.test_request_context("/api/admin/listings/cars/car-1/vin-unlock"),
        patch.object(backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}),
        patch.object(backend, "_admin_get_listing_meta", return_value={"table": "cars"}),
        patch.object(backend, "supabase_request", return_value=([{"id": "car-1", "user_id": "owner-1", "vin_number": "VIN"}], 200)),
        patch.object(backend, "_get_user_profile_for_verification", return_value={"phone": "+971501234567", "country_code": "971"}),
        patch.object(backend, "_sync_user_verification_flags") as sync_flags,
    ):
        response, status = backend.admin_vin_unlock.__wrapped__("admin-1", "cars", "car-1")

    assert status == 200
    assert response.get_json() == {
        "success": True,
        "message": "VIN unlocked for listing owner",
        "listing_id": "car-1",
        "owner_id": "owner-1",
    }
    sync_flags.assert_called_once()
    assert sync_flags.call_args.kwargs["phone_verified"] is True


def test_vin_admin_module_does_not_import_compatibility_root():
    source = open(
        backend.__file__.replace("app.py", "routes/vin_admin.py"), encoding="utf-8"
    ).read()
    assert "from app import" not in source
