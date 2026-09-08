import ast
from pathlib import Path
from unittest.mock import Mock, patch

import app as backend
from application.route_manifest import build_route_manifest


MODULE_PATH = Path(__file__).parent / "routes" / "lead_events.py"
ROUTE = "/api/listings/<item_type>/<item_id>/lead-events"


def test_lead_events_module_has_no_static_app_import():
    tree = ast.parse(MODULE_PATH.read_text())
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.append(node.module or "")
    assert all(name != "app" and not name.endswith(".app") for name in imports)
    assert "current_app" in MODULE_PATH.read_text()


def test_lead_events_keeps_single_public_route_and_legacy_export():
    from routes import lead_events

    contracts = [c for c in build_route_manifest(backend.app) if c.rule == ROUTE]
    assert len(contracts) == 1
    assert contracts[0].endpoint == "track_listing_lead_event"
    assert contracts[0].methods == ("OPTIONS", "POST")
    assert backend.track_listing_lead_event is lead_events.track_listing_lead_event


def test_lead_events_rejects_invalid_listing_type_and_action():
    with backend.app.test_request_context("/api/listings/boats/item-1/lead-events", json={}):
        response, status = backend.track_listing_lead_event("boats", "item-1")
    assert status == 400
    assert response.get_json() == {"error": "Invalid listing type"}

    with backend.app.test_request_context("/api/listings/cars/item-1/lead-events", json={"action": "scrape"}), patch.object(
        backend, "_resolve_listing_table", return_value="cars"
    ):
        response, status = backend.track_listing_lead_event("cars", "item-1")
    assert status == 400
    assert response.get_json() == {"error": "Invalid action"}


def test_lead_events_preserves_canonical_and_legacy_writes():
    canonical = {
        "event_id": "event-1",
        "event_name": "call_click",
        "listing_type": "car",
        "listing_id": "car-1",
        "visitor_id": "visitor-1",
        "session_id": "session-1",
        "user_id": None,
        "platform": "web",
        "occurred_at": "2026-09-08T08:00:00+00:00",
        "metadata": {},
    }

    def supabase_request(method, path, **kwargs):
        if method == "get":
            return ([{"id": "car-1", "user_id": "seller-1"}], 200)
        if path.endswith("record_analytics_event"):
            return ([], 200)
        if path.endswith("lead_events"):
            return ([], 201)
        raise AssertionError((method, path, kwargs))

    with backend.app.test_request_context(
        "/api/listings/cars/car-1/lead-events",
        json={"action": "call_click", "visitor_id": "visitor-1"},
    ), patch.object(backend, "_resolve_listing_table", return_value="cars"), patch.object(
        backend, "_contact_lead_rate_limited", return_value=False
    ), patch.object(backend, "_get_optional_user_id_from_auth_header", return_value=None), patch.object(
        backend, "_probable_bot_user_agent", return_value=False
    ), patch.object(backend, "_request_client_ip", return_value="127.0.0.1"), patch.object(
        backend, "normalize_analytics_event", return_value=canonical
    ) as normalize, patch.object(
        backend, "supabase_request", side_effect=supabase_request
    ) as supabase, patch.object(backend, "capture_posthog_event"), patch(
        "routes.lead_events.threading.Thread", Mock()
    ):
        response, status = backend.track_listing_lead_event("cars", "car-1")

    assert status == 201
    assert response.get_json() == {"message": "Lead event tracked"}
    normalize.assert_called_once()
    paths = [call.args[1] for call in supabase.call_args_list]
    assert "/rest/v1/rpc/record_analytics_event" in paths
    assert "/rest/v1/lead_events" in paths
