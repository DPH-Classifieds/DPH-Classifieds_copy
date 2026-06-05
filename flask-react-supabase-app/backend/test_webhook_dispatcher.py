from unittest.mock import patch, MagicMock
from services.webhook_dispatcher import dispatch


def _resp(status, body):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    return r


@patch("services.webhook_dispatcher.requests")
def test_dispatch_creates_one_delivery_per_subscribed_webhook(mock_requests):
    mock_requests.get.return_value = _resp(200, [{"id": "w1"}, {"id": "w2"}])
    mock_requests.post.return_value = _resp(204, [])
    n = dispatch("lead.created", "d1", {"lead_id": "x"})
    assert n == 2
    posted = mock_requests.post.call_args.kwargs["json"]
    assert len(posted) == 2
    assert all(r["dealership_id"] == "d1" and r["event_type"] == "lead.created" for r in posted)


@patch("services.webhook_dispatcher.requests")
def test_dispatch_returns_zero_when_no_matching_webhooks(mock_requests):
    mock_requests.get.return_value = _resp(200, [])
    assert dispatch("lead.created", "d1", {}) == 0
    assert mock_requests.post.called is False


@patch("services.webhook_dispatcher.requests")
def test_dispatch_rejects_unknown_event_type(mock_requests):
    assert dispatch("totally.bogus", "d1", {}) == 0
    assert mock_requests.get.called is False
