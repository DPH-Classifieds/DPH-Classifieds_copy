import ast
from pathlib import Path
from unittest.mock import MagicMock, patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "admin_check.py"
ROUTE = "/api/auth/admin-check"


def test_admin_check_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert 'current_app.extensions["dph_user_backend"]' in MODULE_PATH.read_text()


def test_admin_check_keeps_single_authenticated_get_contract_and_export():
    from routes import admin_check

    contracts = [contract for contract in build_route_manifest(backend.app) if contract.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "admin_check"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.admin_check is admin_check.admin_check


def test_admin_check_returns_admin_and_super_admin_flags():
    response = MagicMock(status_code=200)
    response.json.return_value = [{"id": "user-1", "is_admin": False, "is_super_admin": True}]
    with backend.app.test_request_context(ROUTE), patch.object(
        backend.requests, "get", return_value=response
    ) as get_request, patch.object(backend, "_is_super_admin_record", return_value=True):
        result, status = backend.admin_check.__wrapped__("user-1")

    assert status == 200
    assert result.get_json() == {"is_admin": True, "is_super_admin": True}
    assert "id=eq.user-1" in get_request.call_args.args[0]
    assert get_request.call_args.kwargs["timeout"] == 10


def test_admin_check_is_fail_closed_for_missing_user_and_provider_errors():
    response = MagicMock(status_code=200)
    response.json.return_value = []
    with backend.app.test_request_context(ROUTE), patch.object(
        backend.requests, "get", return_value=response
    ):
        result, status = backend.admin_check.__wrapped__("user-1")
    assert status == 200
    assert result.get_json() == {"is_admin": False}

    with backend.app.test_request_context(ROUTE), patch.object(
        backend.requests, "get", side_effect=RuntimeError("provider unavailable")
    ):
        result, status = backend.admin_check.__wrapped__("user-1")
    assert status == 200
    assert result.get_json() == {
        "is_admin": False,
        "error": "provider unavailable",
    }
