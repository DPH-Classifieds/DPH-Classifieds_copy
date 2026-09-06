from requests import Timeout
from unittest.mock import patch, MagicMock
from workers import webhook_delivery_worker as wdw


def _resp(status, body=None, text=""):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body if body is not None else []
    r.text = text
    r.headers = {}
    r.content = text.encode()
    r.iter_content.return_value = [text.encode()] if text else []
    return r


@patch("workers.webhook_delivery_worker.decrypt_secret")
@patch("workers.webhook_delivery_worker.requests")
def test_2xx_marks_succeeded(mock_requests, mock_decrypt):
    mock_decrypt.return_value = "shh"
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "del-1", "webhook_id": "w1", "dealership_id": "d1",
                     "event_type": "lead.created", "payload": {"x": 1}, "attempt_count": 0,
                     "next_retry_at": "2026-08-29T10:00:00+00:00"}]),
        _resp(200, [{"id": "w1", "dealership_id": "d1", "url": "https://example.test", "secret_enc": "enc"}]),
    ]
    mock_requests.post.return_value = _resp(200, None, "ok")
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    n = wdw.run()
    assert n == 1
    final = mock_requests.patch.call_args.kwargs["json"]
    assert final["status"] == "succeeded"
    assert final["last_response_code"] == 200


@patch("workers.webhook_delivery_worker.decrypt_secret")
@patch("workers.webhook_delivery_worker.requests")
def test_500_increments_attempt_and_schedules_retry(mock_requests, mock_decrypt):
    mock_decrypt.return_value = "shh"
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "del-2", "webhook_id": "w1", "dealership_id": "d1",
                     "event_type": "lead.created", "payload": {}, "attempt_count": 2,
                     "next_retry_at": "2026-08-29T10:00:00+00:00"}]),
        _resp(200, [{"id": "w1", "dealership_id": "d1", "url": "https://example.test", "secret_enc": "enc"}]),
    ]
    mock_requests.post.return_value = _resp(500, None, "boom")
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    wdw.run()
    final = mock_requests.patch.call_args.kwargs["json"]
    assert final["status"] == "pending"
    assert final["attempt_count"] == 3
    assert "next_retry_at" in final


@patch("workers.webhook_delivery_worker.decrypt_secret")
@patch("workers.webhook_delivery_worker.requests")
def test_fifth_failure_dead_letters(mock_requests, mock_decrypt):
    mock_decrypt.return_value = "shh"
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "del-3", "webhook_id": "w1", "dealership_id": "d1",
                     "event_type": "lead.created", "payload": {}, "attempt_count": 4,
                     "next_retry_at": "2026-08-29T10:00:00+00:00"}]),
        _resp(200, [{"id": "w1", "dealership_id": "d1", "url": "https://example.test", "secret_enc": "enc"}]),
    ]
    mock_requests.post.return_value = _resp(503, None, "still down")
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    wdw.run()
    final = mock_requests.patch.call_args.kwargs["json"]
    assert final["status"] == "dead_letter"
    assert final["attempt_count"] == 5


@patch("workers.webhook_delivery_worker.decrypt_secret")
@patch("workers.webhook_delivery_worker.requests")
def test_tampered_secret_dead_letters_immediately(mock_requests, mock_decrypt):
    mock_decrypt.return_value = None
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "del-4", "webhook_id": "w1", "dealership_id": "d1",
                     "event_type": "lead.created", "payload": {}, "attempt_count": 0,
                     "next_retry_at": "2026-08-29T10:00:00+00:00"}]),
        _resp(200, [{"id": "w1", "dealership_id": "d1", "url": "https://example.test", "secret_enc": "tampered"}]),
    ]
    mock_requests.patch.return_value = _resp(200, [{"id": "claimed"}])
    wdw.run()
    final = mock_requests.patch.call_args.kwargs["json"]
    assert final["status"] == "dead_letter"
    assert final["last_error"] == "secret_unreadable"
    assert mock_requests.post.called is False


@patch("workers.webhook_delivery_worker.requests")
def test_no_due_deliveries_returns_zero(mock_requests):
    mock_requests.get.return_value = _resp(200, [])
    assert wdw.run() == 0
    assert mock_requests.post.called is False
    assert mock_requests.patch.called is False


def test_response_reader_stops_before_full_body_is_buffered():
    response = _resp(200)
    response.iter_content.return_value = [b"a" * 600, b"b" * 9000]
    text = wdw._bounded_response_text(response)
    assert len(text.encode()) <= 500
    assert response.iter_content.call_count == 1


def test_claim_uses_pending_lease_and_tenant_filter():
    delivery = {
        "id": "d7", "dealership_id": "tenant-7",
        "next_retry_at": "2026-08-29T10:00:00+00:00",
    }
    with patch.object(wdw.requests, "patch", return_value=_resp(200, [{"id": "d7"}])) as patch_call:
        assert wdw._claim(delivery)
    params = patch_call.call_args.kwargs["params"]
    assert params["dealership_id"] == "eq.tenant-7"
    assert params["status"] == "eq.pending"
    assert patch_call.call_args.kwargs["json"].keys() == {"next_retry_at"}


def test_duplicate_webhook_claim_gets_no_lease_from_empty_conditional_response():
    delivery = {
        "id": "d8", "dealership_id": "tenant-8",
        "next_retry_at": "2026-08-29T10:00:00+00:00",
    }
    responses = [_resp(200, [{"id": "d8"}]), _resp(200, [])]
    with patch.object(wdw.requests, "patch", side_effect=responses):
        first_lease = wdw._claim(delivery)
        duplicate_lease = wdw._claim(delivery)

    assert first_lease is not None
    assert duplicate_lease is None


def test_run_does_not_count_due_delivery_that_lost_claim():
    delivery = {
        "id": "d8-lost", "webhook_id": "w8", "dealership_id": "tenant-8",
        "event_type": "lead.created", "payload": {}, "attempt_count": 0,
        "next_retry_at": "2026-08-29T10:00:00+00:00",
    }
    with patch.object(wdw, "_due_deliveries", return_value=[delivery]), \
         patch.object(wdw, "_claim", return_value=None), \
         patch.object(wdw, "_fetch_webhook") as fetch_webhook:
        processed = wdw.run()

    assert processed == 0
    fetch_webhook.assert_not_called()


def test_finalize_requires_the_owned_pending_lease_and_reports_noop():
    with patch.object(
        wdw.requests, "patch", return_value=_resp(200, [])
    ) as patch_call:
        finalized = wdw._mark(
            "d9",
            {"status": "succeeded"},
            dealership_id="tenant-9",
            lease_until="2026-08-29T10:01:00+00:00",
        )

    params = patch_call.call_args.kwargs["params"]
    assert params == {
        "id": "eq.d9",
        "dealership_id": "eq.tenant-9",
        "status": "eq.pending",
        "next_retry_at": "eq.2026-08-29T10:01:00+00:00",
    }
    assert finalized is False


def test_finalize_reports_success_only_when_conditional_update_returns_row():
    with patch.object(
        wdw.requests, "patch", return_value=_resp(200, [{"id": "d10"}])
    ) as patch_call:
        finalized = wdw._mark(
            "d10",
            {"status": "dead_letter"},
            dealership_id="tenant-10",
            lease_until="2026-08-29T10:01:00+00:00",
        )

    assert finalized is True
    assert patch_call.call_args.kwargs["headers"]["Prefer"] == "return=representation"


def test_unowned_finalize_is_a_safe_noop():
    with patch.object(wdw.requests, "patch") as patch_call:
        finalized = wdw._mark(
            "d11", {"status": "dead_letter"}, dealership_id="tenant-11"
        )

    assert finalized is False
    patch_call.assert_not_called()


@patch("workers.webhook_delivery_worker.requests")
def test_claim_timeout_does_not_trigger_unowned_exception_finalize(mock_requests):
    mock_requests.get.return_value = _resp(200, [{
        "id": "d12", "webhook_id": "w12", "dealership_id": "tenant-12",
        "event_type": "lead.created", "payload": {}, "attempt_count": 0,
        "next_retry_at": "2026-08-29T10:00:00+00:00",
    }])
    claim_response = _resp(200, [{"id": "d12"}])
    claim_response.json.side_effect = Timeout("lease response body timed out")
    mock_requests.patch.return_value = claim_response

    with patch.object(wdw, "_mark") as mark:
        assert wdw.run() == 0

    mark.assert_not_called()
