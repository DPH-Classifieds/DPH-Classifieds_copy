import ast
from pathlib import Path
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "user_lead_metrics.py"
ROUTE = "/api/user/lead-metrics"


def test_user_lead_metrics_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_user_lead_metrics_keeps_single_route_and_legacy_export():
    from routes import user_lead_metrics

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "get_user_lead_metrics"
    assert contracts[0].methods == ("GET", "HEAD", "OPTIONS")
    assert backend.get_user_lead_metrics is user_lead_metrics.get_user_lead_metrics


def test_user_lead_metrics_requires_authentication():
    assert backend.app.test_client().get(ROUTE).status_code == 401


def test_user_lead_metrics_returns_safe_zero_payload_without_owned_listings():
    with backend.app.test_request_context(f"{ROUTE}?days=999"), patch.object(
        backend,
        "LISTING_TABLE_CONFIG",
        {"car": {"table": "cars"}, "bike": {"table": "bikes"}},
    ), patch.object(backend, "supabase_request", return_value=([], 200)) as request:
        response, status = backend.get_user_lead_metrics.__wrapped__("user-1")

    assert status == 200
    assert response.get_json() == {
        "window_days": 365,
        "totals": {
            "call_click": 0,
            "whatsapp_click": 0,
            "vin_open": 0,
            "vin_reveal": 0,
            "qualified_leads": 0,
        },
        "recent_events": [],
    }
    assert request.call_count == 2
