from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
import json
from workers import dealer_api_source_poller as poll


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    r.content = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
    r.iter_content.return_value = [r.content]
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
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
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
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    poll.run()
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    assert patches[-1].kwargs["json"]["last_status"] == "auth_failed"


@patch("workers.dealer_api_source_poller.decrypt_credentials")
@patch("workers.dealer_api_source_poller.requests")
def test_malformed_json_marks_parse_failed(mock_requests, mock_decrypt):
    mock_decrypt.return_value = {"token": "abc"}
    bad = _resp(200, b"{not-json")
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
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    poll.run()
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    assert patches[-1].kwargs["json"]["last_status"] == "parse_failed"
    assert mock_requests.get.call_count == 2  # source lookup + one DMS attempt; no hot retry


@patch("workers.dealer_api_source_poller.assert_safe_outbound", side_effect=lambda url: url)
@patch("workers.dealer_api_source_poller.requests.get")
def test_generic_fetch_rejects_response_over_cap(mock_get, _safe):
    mock_get.return_value = _resp(
        200, b"[]", headers={"Content-Length": str(poll._MAX_RESPONSE_BYTES + 1)}
    )
    rows, error = poll._generic_json_fetch("https://dms.test/x", "none", None)
    assert rows is None
    assert error == "response_too_large"
    mock_get.return_value.close.assert_called_once()


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
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    poll.run()
    # No fetch beyond the source list
    assert mock_requests.get.call_count == 1
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    assert patches[-1].kwargs["json"]["last_status"] == "credentials_unreadable"


@patch("workers.dealer_api_source_poller.decrypt_credentials")
@patch("workers.dealer_api_source_poller.requests")
def test_repeated_full_row_failure_auto_disables_source(mock_requests, mock_decrypt):
    """A feed whose rows are 100% unparseable two ticks in a row won't
    self-heal by retrying forever on the normal poll cadence — disable it."""
    mock_decrypt.return_value = None
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "s7", "dealership_id": "d1", "adapter": "generic_json",
            "endpoint_url": "https://dms.test/x",
            "auth_type": "none", "credentials_enc": None,
            "field_mapping": {}, "poll_interval_min": 60,
            "last_pulled_at": "2026-08-29T09:00:00+00:00",
            "last_status": "failed",  # already failed last tick
            "enabled": True,
        }]),
        _resp(200, [{"make": "Toyota"}]),  # missing required fields -> validate_row fails
    ]
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    poll.run()
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    final_patch = patches[-1]
    assert final_patch.kwargs["json"]["last_status"] == "failed"
    assert final_patch.kwargs["json"]["enabled"] is False


@patch("workers.dealer_api_source_poller.decrypt_credentials")
@patch("workers.dealer_api_source_poller.requests")
def test_first_full_row_failure_does_not_disable_source(mock_requests, mock_decrypt):
    mock_decrypt.return_value = None
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "s8", "dealership_id": "d1", "adapter": "generic_json",
            "endpoint_url": "https://dms.test/x",
            "auth_type": "none", "credentials_enc": None,
            "field_mapping": {}, "poll_interval_min": 60,
            "last_pulled_at": None, "last_status": None, "enabled": True,
        }]),
        _resp(200, [{"make": "Toyota"}]),
    ]
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    poll.run()
    patches = [c for c in mock_requests.patch.call_args_list
               if "dealer_api_sources" in c.args[0]]
    final_patch = patches[-1]
    assert final_patch.kwargs["json"]["last_status"] == "failed"
    assert "enabled" not in final_patch.kwargs["json"]


def test_claim_source_is_conditional_and_schema_compatible():
    source = {"id": "s5", "last_pulled_at": "2026-08-29T10:00:00+00:00"}
    with patch.object(poll.requests, "patch", return_value=_resp(200, [{"id": "s5"}])) as patch_call:
        claimed_at = poll._claim_source(source)
    assert claimed_at
    assert patch_call.call_args.kwargs["params"]["last_pulled_at"] == "eq.2026-08-29T10:00:00+00:00"
    assert patch_call.call_args.kwargs["json"]["last_status"] == "polling"


def test_stale_polling_claim_becomes_due():
    stale = (datetime.now(timezone.utc) - timedelta(seconds=poll._CLAIM_STALE_SECONDS + 1)).isoformat()
    response = _resp(200, [{
        "id": "s6", "last_pulled_at": stale, "last_status": "polling",
        "poll_interval_min": 10080,
    }])
    with patch.object(poll.requests, "get", return_value=response):
        assert [row["id"] for row in poll._fetch_due_sources()] == ["s6"]
