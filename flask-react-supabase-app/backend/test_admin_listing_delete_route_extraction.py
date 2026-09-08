import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest
from routes import admin_listing_delete


MODULE_PATH = Path(__file__).parent / "routes" / "admin_listing_delete.py"
ROUTE = "/api/<item_type>/<item_id>/delete"


def test_admin_listing_delete_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_admin_listing_delete_keeps_single_route_and_legacy_export():
    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "delete_listing"
    assert contracts[0].methods == ("DELETE", "OPTIONS")
    assert backend.delete_listing is admin_listing_delete.delete_listing


def test_admin_listing_delete_requires_authentication():
    response = backend.app.test_client().delete("/api/car/car-1/delete")
    assert response.status_code == 401


def test_admin_listing_delete_preserves_admin_and_type_guards():
    with backend.app.test_request_context("/api/car/car-1/delete", method="DELETE"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": False}
    ):
        response, status = backend.delete_listing.__wrapped__("user-1", "car", "car-1")
    assert status == 403
    assert response.get_json() == {"error": "Admin access required"}

    with backend.app.test_request_context("/api/truck/truck-1/delete", method="DELETE"), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ):
        response, status = backend.delete_listing.__wrapped__("admin-1", "truck", "truck-1")
    assert status == 400
    assert response.get_json() == {"error": "Invalid item type"}


def test_admin_listing_delete_soft_deletes_and_notifies_owner():
    listing_response = type(
        "Response", (), {"status_code": 200, "json": lambda self: [{
            "user_id": "owner-1",
            "user_email": "owner@example.com",
            "car_manufacturer": "Toyota",
            "car_model": "Camry",
            "car_trim": "SE",
        }]}
    )()
    with backend.app.test_request_context(
        "/api/car/car-1/delete", method="DELETE", json={"reason": "Policy violation"}
    ), patch.object(
        backend, "_get_user_details_with_admin_status", return_value={"is_admin": True}
    ), patch.object(
        admin_listing_delete.requests, "get", return_value=listing_response
    ), patch.object(
        backend,
        "_soft_delete_listing",
        return_value=({}, 204),
    ) as soft_delete, patch.object(
        backend, "_send_listing_deleted_email"
    ) as send_email:
        response, status = backend.delete_listing.__wrapped__("admin-1", "car", "car-1")

    assert status == 200
    assert response.get_json() == {"message": "Car deleted successfully"}
    soft_delete.assert_called_once_with(
        "cars",
        "car-1",
        deleted_by_role="admin",
        deleted_by="admin-1",
        reason="Policy violation",
        metadata={"endpoint": "admin_delete"},
    )
    send_email.assert_called_once_with(
        user_email="owner@example.com",
        item_type="car",
        listing_title="Toyota Camry SE",
        listing_id="car-1",
        reason="Policy violation",
    )

