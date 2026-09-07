import ast
from pathlib import Path

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "car_detail.py"


def test_car_detail_module_uses_runtime_boundary_without_app_import():
    source = MODULE_PATH.read_text()
    tree = ast.parse(source)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in source


def test_car_detail_keeps_single_get_route_and_compatibility_export():
    from routes import car_detail

    contracts = [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == "/api/cars/<string:car_id>"
        and contract.endpoint == "get_car_by_id"
    ]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_car_by_id"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_car_by_id is car_detail.get_car_by_id
