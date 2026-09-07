import ast
from pathlib import Path

import app as backend


MODULE_PATH = Path(__file__).parent / "routes" / "listing_details.py"


def test_listing_detail_helpers_use_runtime_boundary_without_app_import():
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


def test_listing_detail_helpers_remain_compatibility_exports_for_get_dispatchers():
    from routes import listing_details

    assert backend.get_plate_details is listing_details.get_plate_details
    assert backend.get_part_details is listing_details.get_part_details
