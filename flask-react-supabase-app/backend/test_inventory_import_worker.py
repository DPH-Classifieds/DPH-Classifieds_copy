# flask-react-supabase-app/backend/test_inventory_import_worker.py
from unittest.mock import patch, MagicMock
from workers import inventory_import_worker as imp


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    r.content = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
    return r


CSV_BODY = b"external_id,make,model,year,price\nS1,Toyota,Camry,2020,60000\nS2,Honda,Civic,2019,40000\n"


@patch("workers.inventory_import_worker.requests")
def test_run_succeeds_on_csv_with_two_rows(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "job-1", "dealership_id": "d1", "kind": "csv_import",
            "file_path": "dealer-imports/d1/job-1/file.csv",
            "column_mapping": {"external_id": "external_id", "make": "make",
                               "model": "model", "year": "year", "price": "price"},
            "status": "queued",
        }]),  # claim — pick queued
        _resp(200, CSV_BODY),  # storage download
        # listing upserts: lookup-by-external_id returns empty
        _resp(200, []),
        _resp(200, []),
    ]
    mock_requests.patch.return_value = _resp(204, [])
    mock_requests.post.return_value = _resp(201, [{"id": "car-1"}])
    inserted = imp.run()
    assert inserted == 1  # one job processed
    # Job moved through running → succeeded
    statuses = [c.kwargs.get("json", {}).get("status")
                for c in mock_requests.patch.call_args_list
                if "dealer_inventory_jobs" in c.args[0]]
    assert "running" in statuses
    assert "succeeded" in statuses


@patch("workers.inventory_import_worker.requests")
def test_run_marks_partial_when_some_rows_fail(mock_requests):
    bad_csv = b"external_id,make,model,year,price\nS1,Toyota,Camry,2020,60000\nS2,Honda,,2019,nope\n"
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "job-2", "dealership_id": "d1", "kind": "csv_import",
            "file_path": "dealer-imports/d1/job-2/file.csv",
            "column_mapping": {"external_id": "external_id", "make": "make",
                               "model": "model", "year": "year", "price": "price"},
            "status": "queued",
        }]),
        _resp(200, bad_csv),
        _resp(200, []),  # lookup for S1
    ]
    mock_requests.patch.return_value = _resp(204, [])
    mock_requests.post.return_value = _resp(201, [{"id": "car-1"}])
    imp.run()
    final_statuses = [c.kwargs.get("json", {}).get("status")
                      for c in mock_requests.patch.call_args_list
                      if "dealer_inventory_jobs" in c.args[0]]
    assert "partial" in final_statuses
    # An error row was POSTed
    err_calls = [c for c in mock_requests.post.call_args_list
                 if "dealer_inventory_row_errors" in c.args[0]]
    assert err_calls


@patch("workers.inventory_import_worker.requests")
def test_run_skips_when_no_queued_jobs(mock_requests):
    mock_requests.get.return_value = _resp(200, [])
    inserted = imp.run()
    assert inserted == 0
    assert mock_requests.patch.called is False
    assert mock_requests.post.called is False


@patch("workers.inventory_import_worker.requests")
def test_run_marks_failed_when_file_download_fails(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "job-3", "dealership_id": "d1", "kind": "csv_import",
            "file_path": "dealer-imports/d1/job-3/missing.csv",
            "column_mapping": {},
            "status": "queued",
        }]),
        _resp(404, b""),  # storage download 404
    ]
    mock_requests.patch.return_value = _resp(204, [])
    imp.run()
    statuses = [c.kwargs.get("json", {}).get("status")
                for c in mock_requests.patch.call_args_list
                if "dealer_inventory_jobs" in c.args[0]]
    assert "failed" in statuses
