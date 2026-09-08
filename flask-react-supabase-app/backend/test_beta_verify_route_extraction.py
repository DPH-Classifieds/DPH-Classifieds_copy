import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "auth_public.py"


def test_beta_verify_is_owned_by_public_auth_blueprint():
    tree = ast.parse(MODULE_PATH.read_text())
    route_functions = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                if (
                    isinstance(decorator, ast.Call)
                    and isinstance(decorator.func, ast.Attribute)
                    and isinstance(decorator.func.value, ast.Name)
                    and decorator.func.value.id == "auth_public_bp"
                ):
                    route_functions.append(node.name)
    assert "beta_verify" in route_functions

    from routes import auth_public

    contracts = [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == "/api/auth/beta-verify"
    ]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "auth_public.beta_verify"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.beta_verify is auth_public.beta_verify


def test_beta_verify_preserves_disabled_missing_and_matching_password_contracts():
    from routes import auth_public

    client = backend.app.test_client()
    with patch.object(auth_public, "BETA_PASSWORD", None):
        disabled = client.post("/api/auth/beta-verify", json={})
    assert disabled.status_code == 200
    assert disabled.get_json() == {"success": True}

    with patch.object(auth_public, "BETA_PASSWORD", "secret"):
        missing = client.post("/api/auth/beta-verify", json={})
        wrong = client.post("/api/auth/beta-verify", json={"password": "wrong"})
        matching = client.post("/api/auth/beta-verify", json={"password": "secret"})
    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert matching.status_code == 200
    assert missing.get_json() == {"success": False}
    assert wrong.get_json() == {"success": False}
    assert matching.get_json() == {"success": True}
