from unittest.mock import patch, MagicMock
from workers import webhook_delivery_worker as wdw


def _resp(status, body=None, text=""):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body if body is not None else []
    r.text = text
    return r


@patch("workers.webhook_delivery_worker.decrypt_secret")
@patch("workers.webhook_delivery_worker.requests")
def test_2xx_marks_succeeded(mock_requests, mock_decrypt):
    mock_decrypt.return_value = "shh"
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "del-1", "webhook_id": "w1", "event_type": "lead.created",
                     "payload": {"x": 1}, "attempt_count": 0}]),  # due deliveries
        _resp(200, [{"id": "w1", "url": "https://x", "secret_enc": "enc"}]),  # webhook
    ]
    mock_requests.post.return_value = _resp(200, None, "ok")
    mock_requests.patch.return_value = _resp(204)
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
        _resp(200, [{"id": "del-2", "webhook_id": "w1", "event_type": "lead.created",
                     "payload": {}, "attempt_count": 2}]),
        _resp(200, [{"id": "w1", "url": "https://x", "secret_enc": "enc"}]),
    ]
    mock_requests.post.return_value = _resp(500, None, "boom")
    mock_requests.patch.return_value = _resp(204)
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
        _resp(200, [{"id": "del-3", "webhook_id": "w1", "event_type": "lead.created",
                     "payload": {}, "attempt_count": 4}]),  # 4 prior, this attempt = 5
        _resp(200, [{"id": "w1", "url": "https://x", "secret_enc": "enc"}]),
    ]
    mock_requests.post.return_value = _resp(503, None, "still down")
    mock_requests.patch.return_value = _resp(204)
    wdw.run()
    final = mock_requests.patch.call_args.kwargs["json"]
    assert final["status"] == "dead_letter"
    assert final["attempt_count"] == 5


@patch("workers.webhook_delivery_worker.decrypt_secret")
@patch("workers.webhook_delivery_worker.requests")
def test_tampered_secret_dead_letters_immediately(mock_requests, mock_decrypt):
    mock_decrypt.return_value = None
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "del-4", "webhook_id": "w1", "event_type": "lead.created",
                     "payload": {}, "attempt_count": 0}]),
        _resp(200, [{"id": "w1", "url": "https://x", "secret_enc": "tampered"}]),
    ]
    mock_requests.patch.return_value = _resp(204)
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
