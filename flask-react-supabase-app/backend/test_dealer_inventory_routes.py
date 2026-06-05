# flask-react-supabase-app/backend/test_dealer_inventory_routes.py
import io
import pytest
from unittest.mock import patch, MagicMock
from flask import request as flask_request


@pytest.fixture(scope="module")
def app_with_inventory():
    patcher = patch(
        "app.token_required",
        lambda fn: (lambda *a, **kw: fn(getattr(flask_request, "user_id", None), *a, **kw)),
    )
    patcher.start()
    try:
        import app as flask_app_module
        from routes.dealer.inventory import inventory_bp
        if "dealer_inventory" not in flask_app_module.app.blueprints:
            # Reset _got_first_request so this module can register late even
            # if a prior test module already served a request via the same
            # Flask app instance.
            flask_app_module.app._got_first_request = False
            flask_app_module.app.register_blueprint(inventory_bp)
        flask_app_module.app.config["TESTING"] = True
        yield flask_app_module.app
    finally:
        patcher.stop()


@pytest.fixture
def client(app_with_inventory):
    def _inject_user():
        flask_request.user_id = "test-user-id"
    app_with_inventory.before_request_funcs.setdefault(None, []).append(_inject_user)
    try:
        yield app_with_inventory.test_client()
    finally:
        app_with_inventory.before_request_funcs[None].remove(_inject_user)


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    r.content = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
    return r


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_list_jobs_returns_dealership_scope(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "j1", "status": "succeeded"}],
                                            headers={"content-range": "0-0/1"})
    rv = client.get("/api/dealer/inventory/jobs")
    assert rv.status_code == 200
    assert rv.get_json()["jobs"][0]["id"] == "j1"
    params = mock_requests.get.call_args.kwargs["params"]
    assert params["dealership_id"] == "eq.d1"


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_import_creates_job_and_uploads_file(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    # POST file to storage = 200; insert job row = 201
    mock_requests.post.side_effect = [
        _resp(200, [{"Key": "dealer-imports/d1/<job_id>/file.csv"}]),  # storage upload
        _resp(201, [{"id": "job-99", "status": "queued", "file_path": "x"}]),  # job insert
    ]
    rv = client.post(
        "/api/dealer/inventory/imports",
        data={"mapping": '{"make":"make"}', "kind": "csv_import",
              "file": (io.BytesIO(b"make\nToyota\n"), "file.csv")},
        content_type="multipart/form-data",
    )
    assert rv.status_code == 201
    assert rv.get_json()["job"]["id"] == "job-99"


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_import_rejects_too_large_file(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    # 11 MB
    big = io.BytesIO(b"x" * (11 * 1024 * 1024))
    rv = client.post(
        "/api/dealer/inventory/imports",
        data={"mapping": "{}", "kind": "csv_import", "file": (big, "f.csv")},
        content_type="multipart/form-data",
    )
    assert rv.status_code == 413


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_import_forbidden_for_sales_rep(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "sales_rep", "status": "active"}
    rv = client.post(
        "/api/dealer/inventory/imports",
        data={"mapping": "{}", "kind": "csv_import",
              "file": (io.BytesIO(b"x"), "f.csv")},
        content_type="multipart/form-data",
    )
    assert rv.status_code == 403


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_get_job_detail_returns_errors(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "job-1", "dealership_id": "d1", "status": "partial",
                     "rows_total": 5, "rows_failed": 2}]),
        _resp(200, [{"row_index": 2, "error_code": "missing_fields", "error_message": "x"}]),
    ]
    rv = client.get("/api/dealer/inventory/jobs/job-1")
    assert rv.status_code == 200
    data = rv.get_json()
    assert data["job"]["status"] == "partial"
    assert len(data["errors"]) == 1


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_export_csv_streams_for_dealership(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [
        {"id": "c1", "external_id": "S1", "make": "Toyota", "car_model": "Camry",
         "make_year": 2020, "expected_selling_price": 60000, "kilometers": 45000}
    ])
    rv = client.get("/api/dealer/inventory/export.csv")
    assert rv.status_code == 200
    assert rv.mimetype == "text/csv"
    body = rv.get_data(as_text=True)
    assert "external_id" in body and "Toyota" in body
