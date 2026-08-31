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
    assert mock_requests.patch.call_count == 1  # stale-claim recovery only


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


def test_stale_in_progress_recovery_is_bounded_by_lease_time():
    with patch.object(wdw.requests, "patch") as patch_call:
        wdw._recover_stale_deliveries()
    assert patch_call.call_args.kwargs["params"]["status"] == "eq.in_progress"
    assert patch_call.call_args.kwargs["params"]["next_retry_at"].startswith("lte.")
    assert patch_call.call_args.kwargs["json"]["status"] == "pending"
