import ast
import os
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest
from routes import diagnostics


BACKEND_DIR = Path(__file__).parent
DIAGNOSTICS_PATH = BACKEND_DIR / "routes" / "diagnostics.py"
DIAGNOSTIC_ROUTE = "/api/diagnostics/config"


def _diagnostic_contracts():
    return [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == DIAGNOSTIC_ROUTE
    ]


def _call_unwrapped(current_user="admin-1"):
    return diagnostics.check_config.__wrapped__(current_user)


def test_diagnostics_module_uses_runtime_boundary_without_app_import():
    source = DIAGNOSTICS_PATH.read_text()
    tree = ast.parse(source)

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")

    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source


def test_diagnostics_route_has_one_legacy_contract_and_automatic_options():
    contracts = _diagnostic_contracts()

    assert len(contracts) == 1
    assert contracts[0].endpoint == "check_config"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")

    response = backend.app.test_client().options(DIAGNOSTIC_ROUTE)

    assert response.status_code == 200
    assert "GET" in response.headers["Allow"]
    assert "OPTIONS" in response.headers["Allow"]


def test_diagnostics_feature_flag_returns_not_found_before_admin_check():
    with (
        patch.dict(os.environ, {"ENABLE_DIAGNOSTICS": "false"}),
        patch.object(backend, "get_user_admin_status") as admin_check,
        backend.app.test_request_context(DIAGNOSTIC_ROUTE),
    ):
        response, status_code = _call_unwrapped()

    assert status_code == 404
    assert response.get_json() == {"error": "Not found"}
    admin_check.assert_not_called()


def test_diagnostics_non_admin_returns_unauthorized():
    with (
        patch.dict(os.environ, {"ENABLE_DIAGNOSTICS": "true"}),
        patch.object(backend, "get_user_admin_status", return_value=False),
        backend.app.test_request_context(DIAGNOSTIC_ROUTE),
    ):
        response, status_code = _call_unwrapped(current_user="user-1")

    assert status_code == 403
    assert response.get_json() == {"error": "Unauthorized"}


def test_diagnostics_success_preserves_fields_and_masks_full_secrets():
    service_key = "service-role-secret-value"
    regular_key = "regular-anon-secret-value"

    with (
        patch.dict(
            os.environ,
            {
                "ENABLE_DIAGNOSTICS": "true",
                "SUPABASE_SERVICE_ROLE_KEY": service_key,
            },
        ),
        patch.object(backend, "SUPABASE_KEY", regular_key),
        patch.object(backend, "get_user_admin_status", return_value=True),
        backend.app.test_request_context(DIAGNOSTIC_ROUTE),
    ):
        response, status_code = _call_unwrapped()

    payload = response.get_json()
    assert status_code == 200
    assert set(payload) == {
        "service_key_available",
        "service_key_preview",
        "regular_key_preview",
        "using_same_key",
        "postgres_role_header_present",
    }
    assert payload == {
        "service_key_available": True,
        "service_key_preview": "servi...value",
        "regular_key_preview": "regul...value",
        "using_same_key": False,
        "postgres_role_header_present": True,
    }
    assert service_key not in response.get_data(as_text=True)
    assert regular_key not in response.get_data(as_text=True)


def test_diagnostics_short_or_missing_keys_keep_invalid_preview_contract():
    with (
        patch.dict(
            os.environ,
            {
                "ENABLE_DIAGNOSTICS": "true",
                "SUPABASE_SERVICE_ROLE_KEY": "short",
            },
        ),
        patch.object(backend, "SUPABASE_KEY", ""),
        patch.object(backend, "get_user_admin_status", return_value=True),
        backend.app.test_request_context(DIAGNOSTIC_ROUTE),
    ):
        response, status_code = _call_unwrapped()

    assert status_code == 200
    assert response.get_json() == {
        "service_key_available": True,
        "service_key_preview": "invalid-key-format",
        "regular_key_preview": "invalid-key-format",
        "using_same_key": False,
        "postgres_role_header_present": True,
    }


def test_diagnostics_exception_keeps_json_error_envelope():
    with (
        patch.dict(os.environ, {"ENABLE_DIAGNOSTICS": "true"}),
        patch.object(
            backend,
            "get_user_admin_status",
            side_effect=RuntimeError("diagnostic failure"),
        ),
        backend.app.test_request_context(DIAGNOSTIC_ROUTE),
    ):
        response, status_code = _call_unwrapped()

    assert status_code == 500
    assert response.get_json() == {"error": "diagnostic failure"}


def test_diagnostics_route_requires_token_authentication():
    response = backend.app.test_client().get(DIAGNOSTIC_ROUTE)

    assert response.status_code == 401
