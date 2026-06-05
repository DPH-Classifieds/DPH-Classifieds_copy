from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
from workers import dealer_api_source_poller as poll


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    r.content = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
    return r


@patch("workers.dealer_api_source_poller.decrypt_credentials")
@patch("workers.dealer_api_source_poller.requests")
def test_happy_path_imports_rows_and_marks_ok(mock_requests, mock_decrypt):
    mock_decrypt.return_value = {"token": "abc"}
    mock_requests.get.side_effect = [
        # 1) Source SELECT (due sources list)
        _resp(200, [{
            "id": "s1", "dealership_id": "d1", "adapter": "generic_json",
            "endpoint_url": "https://dms.test/listings",
            "auth_type": "bearer", "credentials_enc": "enc-token",
            "field_mapping": {"sku": "external_id", "make": "make", "model": "model",
                              "year": "year", "price": "price"},
            "poll_interval_min": 60, "last_pulled_at": None, "enabled": True,
        }]),
        # 2) DMS endpoint
        _resp(200, [
            {"sku": "S1", "make": "Toyota", "model": "Camry", "year": "2020", "price": "60000"},
            {"sku": "S2", "make": "Honda",  "model": "Civic", "year": "2019", "price": "40000"},
        ]),
        # 3+4) cars lookup-by-external_id for each (returns empty -> insert)
        _resp(200, []),
        _resp(200, []),
    ]
    mock_requests.post.return_value = _resp(201, [{"id": "car-x"}])
    mock_requests.patch.return_value = _resp(204, [])
    processed = poll.run()
    assert processed == 1
    # Source row patched with ok
    source_patches = [c for c in mock_requests.patch.call_args_list
                      if "dealer_api_sources" in c.args[0]]
    assert source_patches
    assert source_patches[-1].kwargs["json"]["last_status"] == "ok"


@patch("workers.dealer_api_source_poller.decrypt_credentials")
@patch("workers.dealer_api_source_poller.requests")
def test_401_from_endpoint_marks_auth_failed(mock_requests, mock_decrypt):
    mock_decrypt.return_value = {"token": "abc"}
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "s2", "dealership_id": "d1", "adapter": "generic_json",
            "endpoint_url": "https://dms.test/listings",
            "auth_type": "bearer", "credentials_enc": "enc-token",
            "field_mapping": {}, "poll_interval_min": 60,
            "last_pulled_at": None, "enabled": True,
        }]),
        _resp(401, {"error": "nope"}),
    ]
    mock_requests.patch.return_value = _resp(204, [])
    poll.run()
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    assert patches[-1].kwargs["json"]["last_status"] == "auth_failed"


@patch("workers.dealer_api_source_poller.decrypt_credentials")
@patch("workers.dealer_api_source_poller.requests")
def test_malformed_json_marks_parse_failed(mock_requests, mock_decrypt):
    mock_decrypt.return_value = {"token": "abc"}
    bad = _resp(200, {"random": "not-an-array"})
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "s3", "dealership_id": "d1", "adapter": "generic_json",
            "endpoint_url": "https://dms.test/x",
            "auth_type": "none", "credentials_enc": None,
            "field_mapping": {}, "poll_interval_min": 60,
            "last_pulled_at": None, "enabled": True,
        }]),
        bad,
    ]
    mock_requests.patch.return_value = _resp(204, [])
    poll.run()
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    assert patches[-1].kwargs["json"]["last_status"] == "parse_failed"


@patch("workers.dealer_api_source_poller.decrypt_credentials")
@patch("workers.dealer_api_source_poller.requests")
def test_credentials_unreadable_skips_fetch(mock_requests, mock_decrypt):
    mock_decrypt.return_value = None  # tampered/invalid
    mock_requests.get.return_value = _resp(200, [{
        "id": "s4", "dealership_id": "d1", "adapter": "generic_json",
        "endpoint_url": "https://dms.test/x",
        "auth_type": "bearer", "credentials_enc": "tampered",
        "field_mapping": {}, "poll_interval_min": 60,
        "last_pulled_at": None, "enabled": True,
    }])
    mock_requests.patch.return_value = _resp(204, [])
    poll.run()
    # No fetch beyond the source list
    assert mock_requests.get.call_count == 1
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    assert patches[-1].kwargs["json"]["last_status"] == "credentials_unreadable"
