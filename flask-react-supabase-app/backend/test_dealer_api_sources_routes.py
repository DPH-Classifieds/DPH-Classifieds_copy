"""Tests for dealer api_sources CRUD routes (Task 7 — Phase 3)."""
import pytest
from unittest.mock import patch, MagicMock
from flask import request as flask_request


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _noop_token_required(fn):
    """No-op replacement for token_required — injects current_user=request.user_id."""
    from functools import wraps
    from flask import request as _req

    @wraps(fn)
    def wrapper(*args, **kwargs):
        return fn(getattr(_req, "user_id", None), *args, **kwargs)

    return wrapper


@pytest.fixture(scope="module")
def app_with_api_sources():
    patcher = patch("app.token_required", _noop_token_required)
    patcher.start()
    try:
        import app as flask_app_module
        from routes.dealer.api_sources import api_sources_bp
        if "dealer_api_sources" not in flask_app_module.app.blueprints:
            flask_app_module.app.register_blueprint(api_sources_bp)
        flask_app_module.app.config["TESTING"] = True
        yield flask_app_module.app
    finally:
        patcher.stop()


@pytest.fixture
def client(app_with_api_sources):
    """A test client that sets request.user_id on every request."""
    def _inject_user():
        flask_request.user_id = "test-user-id"
    app_with_api_sources.before_request_funcs.setdefault(None, []).append(_inject_user)
    try:
        yield app_with_api_sources.test_client()
    finally:
        app_with_api_sources.before_request_funcs[None].remove(_inject_user)


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    r.content = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
    return r


# ---------------------------------------------------------------------------
# Test 1: GET /api-sources — list scopes by dealership, no credentials_enc
# ---------------------------------------------------------------------------

@patch("routes.dealer.api_sources.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_list_returns_sources_without_credentials_enc(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [
        {
            "id": "src-1",
            "label": "My DMS",
            "adapter": "generic_json",
            "endpoint_url": "https://example.com/feed",
            "auth_type": "bearer",
            "credentials_enc": "should-be-stripped",
            "field_mapping": {},
            "poll_interval_min": 60,
            "last_pulled_at": None,
            "last_status": None,
            "last_error": None,
            "enabled": True,
            "created_at": "2026-06-05T10:00:00Z",
        }
    ])

    rv = client.get("/api/dealer/api-sources")
    assert rv.status_code == 200
    data = rv.get_json()
    assert "sources" in data
    assert len(data["sources"]) == 1
    # credentials_enc must never appear in the response
    assert "credentials_enc" not in data["sources"][0]
    # confirm dealership scope was applied
    params = mock_requests.get.call_args.kwargs["params"]
    assert params["dealership_id"] == "eq.d1"


# ---------------------------------------------------------------------------
# Test 2: POST /api-sources — encrypts credentials, strips from response
# ---------------------------------------------------------------------------

@patch("routes.dealer.api_sources.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_encrypts_credentials_and_strips_in_response(
    mock_is_admin, mock_lookup, mock_requests, client, monkeypatch
):
    monkeypatch.setenv("DEALER_INTEGRATIONS_KEY", "rR-1RrwvLZQ3rWdEzTfBQg2WJ5HhEuJ8gFxqK6vfYbY=")
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}

    inserted_row = {
        "id": "src-new",
        "label": "My DMS",
        "adapter": "generic_json",
        "endpoint_url": "https://example.com/feed",
        "auth_type": "bearer",
        "credentials_enc": "gAAAAAB_enc_token",
        "field_mapping": {},
        "poll_interval_min": 10,
        "last_pulled_at": None,
        "last_status": None,
        "last_error": None,
        "enabled": True,
        "created_at": "2026-06-05T10:00:00Z",
    }
    mock_requests.post.return_value = _resp(201, [inserted_row])

    rv = client.post(
        "/api/dealer/api-sources",
        json={
            "label": "My DMS",
            "adapter": "generic_json",
            "endpoint_url": "https://example.com/feed",
            "auth_type": "bearer",
            "credentials": {"bearer_token": "secret-123"},
            "field_mapping": {},
            "poll_interval_min": 10,
        },
    )
    assert rv.status_code == 201
    data = rv.get_json()
    assert "source" in data
    # Response must NOT contain credentials_enc
    assert "credentials_enc" not in data["source"]
    # But the Supabase POST payload must have contained credentials_enc (not credentials)
    posted_json = mock_requests.post.call_args.kwargs["json"]
    assert "credentials_enc" in posted_json
    assert "credentials" not in posted_json


# ---------------------------------------------------------------------------
# Test 3: POST /api-sources — 503 when DEALER_INTEGRATIONS_KEY unset
# ---------------------------------------------------------------------------

@patch("routes.dealer.api_sources.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_returns_503_when_key_unset(
    mock_is_admin, mock_lookup, mock_requests, client, monkeypatch
):
    monkeypatch.delenv("DEALER_INTEGRATIONS_KEY", raising=False)
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}

    rv = client.post(
        "/api/dealer/api-sources",
        json={
            "label": "My DMS",
            "adapter": "generic_json",
            "endpoint_url": "https://example.com/feed",
            "auth_type": "bearer",
            "credentials": {"bearer_token": "secret"},
            "field_mapping": {},
            "poll_interval_min": 10,
        },
    )
    assert rv.status_code == 503
    data = rv.get_json()
    assert data["error"]["code"] == "encryption_unavailable"
    # Supabase should NOT have been called
    assert not mock_requests.post.called


# ---------------------------------------------------------------------------
# Test 4: PATCH without credentials — does not touch credentials_enc
# ---------------------------------------------------------------------------

@patch("routes.dealer.api_sources.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_patch_without_credentials_does_not_touch_credentials_enc(
    mock_is_admin, mock_lookup, mock_requests, client, monkeypatch
):
    monkeypatch.setenv("DEALER_INTEGRATIONS_KEY", "rR-1RrwvLZQ3rWdEzTfBQg2WJ5HhEuJ8gFxqK6vfYbY=")
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}

    existing_row = {
        "id": "src-1",
        "dealership_id": "d1",
        "label": "Old Label",
        "adapter": "generic_json",
        "endpoint_url": "https://example.com/feed",
        "auth_type": "bearer",
        "credentials_enc": "existing_encrypted_token",
        "field_mapping": {},
        "poll_interval_min": 60,
        "last_pulled_at": None,
        "last_status": None,
        "last_error": None,
        "enabled": True,
        "created_at": "2026-06-05T10:00:00Z",
    }
    updated_row = dict(existing_row, label="New Label")
    # GET to verify ownership, PATCH to update
    mock_requests.get.return_value = _resp(200, [existing_row])
    mock_requests.patch.return_value = _resp(200, [updated_row])

    rv = client.patch(
        "/api/dealer/api-sources/src-1",
        json={"label": "New Label"},
    )
    assert rv.status_code == 200
    # The PATCH json sent to Supabase must NOT contain credentials_enc
    patch_json = mock_requests.patch.call_args.kwargs["json"]
    assert "credentials_enc" not in patch_json
    # Response also strips credentials_enc
    data = rv.get_json()
    assert "credentials_enc" not in data["source"]


# ---------------------------------------------------------------------------
# Test 5: DELETE /api-sources/<id> — returns 204
# ---------------------------------------------------------------------------

@patch("routes.dealer.api_sources.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_delete_returns_204(
    mock_is_admin, mock_lookup, mock_requests, client
):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}

    existing_row = {
        "id": "src-1",
        "dealership_id": "d1",
        "label": "My DMS",
        "adapter": "generic_json",
        "endpoint_url": "https://example.com/feed",
        "auth_type": "bearer",
        "field_mapping": {},
        "poll_interval_min": 60,
        "enabled": True,
        "created_at": "2026-06-05T10:00:00Z",
    }
    mock_requests.get.return_value = _resp(200, [existing_row])
    mock_requests.delete.return_value = _resp(204, [])

    rv = client.delete("/api/dealer/api-sources/src-1")
    assert rv.status_code == 204
