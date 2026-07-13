import pytest
from unittest.mock import patch, MagicMock
from flask import request as flask_request


# Patch app.token_required BEFORE routes.dealer.leads is imported so the
# @_token_required shim in leads.py captures a no-op. Then register the
# blueprint on the app. Module-scoped so we only do it once.
def _noop_token_required(fn):
    """No-op replacement for token_required that injects current_user=request.user_id."""
    from functools import wraps
    from flask import request as _req

    @wraps(fn)
    def wrapper(*args, **kwargs):
        return fn(getattr(_req, "user_id", None), *args, **kwargs)

    return wrapper


@pytest.fixture(scope="module")
def app_with_leads():
    patcher = patch("app.token_required", _noop_token_required)
    patcher.start()
    try:
        import app as flask_app_module
        from routes.dealer.leads import leads_bp
        if "dealer_leads" not in flask_app_module.app.blueprints:
            # This module can run after tests that have already served a request.
            # Flask then rejects late blueprint registration unless the test app
            # is explicitly reset for this isolated route fixture.
            flask_app_module.app._got_first_request = False
            flask_app_module.app.register_blueprint(leads_bp)
        flask_app_module.app.config["TESTING"] = True
        yield flask_app_module.app
    finally:
        patcher.stop()


@pytest.fixture
def client(app_with_leads):
    """A test client that sets request.user_id on every request."""
    def _inject_user():
        flask_request.user_id = "test-user-id"
    app_with_leads.before_request_funcs.setdefault(None, []).append(_inject_user)
    try:
        yield app_with_leads.test_client()
    finally:
        app_with_leads.before_request_funcs[None].remove(_inject_user)


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    return r


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_list_leads_returns_dealership_scope(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(
        200,
        [{"id": "lead-1", "status": "new", "last_event_at": "2026-06-05T10:00:00Z"}],
        headers={"content-range": "0-0/1"},
    )

    rv = client.get("/api/dealer/leads")
    assert rv.status_code == 200
    data = rv.get_json()
    assert "leads" in data
    assert data["leads"][0]["id"] == "lead-1"
    assert data["total"] == 1
    called_url = mock_requests.get.call_args.args[0]
    called_params = mock_requests.get.call_args.kwargs["params"]
    assert "dealer_leads" in called_url
    assert called_params["dealership_id"] == "eq.d1"


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_list_leads_applies_status_filter(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [], headers={"content-range": "*/0"})
    client.get("/api/dealer/leads?status=new&assigned_to=u-7&source=call")
    params = mock_requests.get.call_args.kwargs["params"]
    assert params["status"] == "eq.new"
    assert params["assigned_to"] == "eq.u-7"
    assert params["source"] == "eq.call"


@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_list_leads_rejects_non_dealer(mock_is_admin, mock_lookup, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = None
    rv = client.get("/api/dealer/leads")
    assert rv.status_code == 403


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_list_leads_ignores_invalid_status(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [], headers={"content-range": "*/0"})
    client.get("/api/dealer/leads?status=BOGUS")
    params = mock_requests.get.call_args.kwargs["params"]
    # Bogus status is silently dropped (not echoed to Supabase as a filter).
    assert "status" not in params


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_get_lead_detail_returns_timeline_listing_and_session(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    # The view makes 4 GETs in this order: lead row, timeline, listing, session.
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "lead-1", "dealership_id": "d1",
            "listing_type": "car", "listing_id": "L1",
            "source": "call", "status": "new",
            "visitor_id": "v1",
            "first_event_at": "2026-06-05T10:00:00+00:00",
            "last_event_at": "2026-06-05T11:00:00+00:00",
            "event_count": 2,
        }]),
        _resp(200, [{
            "id": "dle-1", "kind": "inbound_contact",
            "payload": {"source": "call"},
            "created_at": "2026-06-05T10:00:00+00:00",
        }]),
        _resp(200, [{
            "id": "L1", "expected_selling_price": 50000,
            "make": "Toyota", "car_model": "Camry", "make_year": 2022,
        }]),
        _resp(200, [{
            "id": "pe-1", "page_path": "/cars/L1", "event_name": "page_view",
            "created_at": "2026-06-05T09:55:00+00:00",
            "metadata": {"referrer": "/cars"},
        }]),
    ]

    rv = client.get("/api/dealer/leads/lead-1")
    assert rv.status_code == 200
    data = rv.get_json()
    assert data["lead"]["id"] == "lead-1"
    assert isinstance(data["timeline"], list) and data["timeline"][0]["id"] == "dle-1"
    assert data["listing"]["title"].startswith("2022 Toyota")
    assert data["listing"]["price"] == 50000
    assert data["listing"]["type"] == "car"
    assert isinstance(data["session"], list) and data["session"][0]["page_path"] == "/cars/L1"


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_get_lead_detail_returns_404_when_lead_belongs_to_other_dealership(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    # PostgREST returns empty because the dealership_id filter excludes it.
    mock_requests.get.return_value = _resp(200, [])
    rv = client.get("/api/dealer/leads/lead-other")
    assert rv.status_code == 404


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_get_lead_detail_no_session_when_visitor_id_missing(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "lead-2", "dealership_id": "d1",
            "listing_type": "car", "listing_id": "L1",
            "source": "call", "status": "new",
            "visitor_id": None,
            "first_event_at": "2026-06-05T10:00:00+00:00",
            "last_event_at": "2026-06-05T10:00:00+00:00",
            "event_count": 1,
        }]),
        _resp(200, []),  # timeline empty
        _resp(200, [{"id": "L1", "expected_selling_price": 12000,
                     "make": "Honda", "car_model": "Civic", "make_year": 2018}]),
        # NOTE: no 4th call expected — view should skip platform_events when visitor_id is None.
    ]
    rv = client.get("/api/dealer/leads/lead-2")
    assert rv.status_code == 200
    data = rv.get_json()
    assert data["session"] == []
    # Confirm we made exactly 3 GETs (not 4).
    assert mock_requests.get.call_count == 3


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_lead_updates_status_and_emits_timeline_event(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [
        {"id": "lead-1", "status": "new", "assigned_to": None}
    ])
    mock_requests.patch.return_value = _resp(200, [{"id": "lead-1", "status": "contacted"}])
    mock_requests.post.return_value = _resp(201, [{"id": "dle-99"}])

    rv = client.patch("/api/dealer/leads/lead-1", json={"status": "contacted"})
    assert rv.status_code == 200
    # status_change event was emitted
    post_calls = [c for c in mock_requests.post.call_args_list
                  if "dealer_lead_events" in c.args[0]]
    assert post_calls
    assert post_calls[0].kwargs["json"]["kind"] == "status_change"
    assert post_calls[0].kwargs["json"]["payload"]["from"] == "new"
    assert post_calls[0].kwargs["json"]["payload"]["to"] == "contacted"


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_lead_rejects_invalid_status(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "lead-1", "status": "new", "assigned_to": None}])
    rv = client.patch("/api/dealer/leads/lead-1", json={"status": "invalid"})
    assert rv.status_code == 400


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_lead_rejects_invalid_lost_reason(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "lead-1", "status": "lost", "assigned_to": None}])
    rv = client.patch("/api/dealer/leads/lead-1", json={"lost_reason": "nope"})
    assert rv.status_code == 400


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_lead_rejects_empty_body(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "lead-1", "status": "new", "assigned_to": None}])
    rv = client.patch("/api/dealer/leads/lead-1", json={})
    assert rv.status_code == 400


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_lead_returns_404_for_wrong_dealership(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [])
    rv = client.patch("/api/dealer/leads/lead-other", json={"status": "contacted"})
    assert rv.status_code == 404


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_lead_sales_rep_blocked_on_unassigned_lead(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "sales_rep", "status": "active"}
    # The lead is assigned to someone else; sales_rep should 403.
    mock_requests.get.return_value = _resp(200, [
        {"id": "lead-1", "status": "new", "assigned_to": "someone-else"}
    ])
    rv = client.patch("/api/dealer/leads/lead-1", json={"status": "contacted"})
    assert rv.status_code == 403


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_lead_emits_assignment_event_on_assignment_change(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "manager", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "lead-1", "status": "new", "assigned_to": None}])
    mock_requests.patch.return_value = _resp(200, [{"id": "lead-1", "assigned_to": "rep-7"}])
    mock_requests.post.return_value = _resp(201, [{"id": "dle-x"}])
    rv = client.patch("/api/dealer/leads/lead-1", json={"assigned_to": "rep-7"})
    assert rv.status_code == 200
    assignment_calls = [c for c in mock_requests.post.call_args_list
                        if "dealer_lead_events" in c.args[0]
                        and c.kwargs["json"]["kind"] == "assignment"]
    assert assignment_calls
    assert assignment_calls[0].kwargs["json"]["payload"]["to"] == "rep-7"


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_note_creates_lead_event(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "manager", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "lead-1"}])
    mock_requests.post.return_value = _resp(201, [{"id": "dle-9"}])

    rv = client.post("/api/dealer/leads/lead-1/note",
                     json={"body": "Customer wants finance options"})
    assert rv.status_code == 201
    post_call = mock_requests.post.call_args
    assert "dealer_lead_events" in post_call.args[0]
    assert post_call.kwargs["json"]["kind"] == "note"
    assert post_call.kwargs["json"]["payload"]["body"] == "Customer wants finance options"


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_note_rejects_empty_body(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "manager", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "lead-1"}])
    rv = client.post("/api/dealer/leads/lead-1/note", json={"body": "   "})
    assert rv.status_code == 400


@patch("routes.dealer.leads.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_note_returns_404_for_wrong_dealership(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "manager", "status": "active"}
    mock_requests.get.return_value = _resp(200, [])
    rv = client.post("/api/dealer/leads/lead-other/note", json={"body": "hi"})
    assert rv.status_code == 404
