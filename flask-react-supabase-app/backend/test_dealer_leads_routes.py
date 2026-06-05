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
