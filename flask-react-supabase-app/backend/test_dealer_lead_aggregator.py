from unittest.mock import patch, MagicMock
from workers import dealer_lead_aggregator as agg


def _resp(status, json_body):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = json_body
    r.text = str(json_body)
    return r


@patch("workers.dealer_lead_aggregator.requests")
def test_run_no_events_advances_cursor_to_now(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{"last_processed_at": "2026-06-05T10:00:00+00:00"}]),  # cursor
        _resp(200, []),  # lead_events
    ]
    mock_requests.patch.return_value = _resp(204, [])

    inserted, advanced = agg.run()

    assert inserted == 0
    assert advanced is True
    assert any(call for call in mock_requests.patch.call_args_list
               if "dealer_lead_aggregator_cursor" in str(call))


@patch("workers.dealer_lead_aggregator.requests")
def test_run_inserts_new_lead_and_event(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{"last_processed_at": "2026-06-05T09:00:00+00:00"}]),
        _resp(200, [{
            "id": "le-1",
            "dealership_id": "d1",
            "listing_id": "L1",
            "listing_type": "car",
            "action": "call_click",
            "ip_address": "1.2.3.4",
            "user_agent": "ua",
            "payload": {"visitor_id": "v1"},
            "created_at": "2026-06-05T10:00:00+00:00",
        }]),
        _resp(200, []),  # _find_existing_lead returns empty
    ]
    mock_requests.post.side_effect = [
        _resp(201, [{"id": "dl-1"}]),   # dealer_leads insert
        _resp(201, [{"id": "dle-1"}]),  # dealer_lead_events insert
    ]
    mock_requests.patch.return_value = _resp(204, [])

    inserted, advanced = agg.run()

    assert inserted == 1
    assert advanced is True
    first_post = mock_requests.post.call_args_list[0]
    assert "dealer_leads" in first_post.args[0]
    body = first_post.kwargs["json"]
    assert body["dealership_id"] == "d1"
    assert body["source"] == "call"
    assert body["visitor_id"] == "v1"


@patch("workers.dealer_lead_aggregator.requests")
def test_run_folds_repeat_event_into_existing_lead(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{"last_processed_at": "2026-06-05T09:00:00+00:00"}]),
        _resp(200, [{
            "id": "le-2",
            "dealership_id": "d1",
            "listing_id": "L1",
            "listing_type": "car",
            "action": "call_click",
            "ip_address": "1.2.3.4",
            "user_agent": "ua",
            "payload": {"visitor_id": "v1"},
            "created_at": "2026-06-05T11:00:00+00:00",
        }]),
        _resp(200, [{
            "id": "dl-1",
            "first_event_at": "2026-06-05T10:00:00+00:00",
            "event_count": 1,
        }]),
    ]
    mock_requests.patch.return_value = _resp(204, [])
    mock_requests.post.return_value = _resp(201, [{"id": "dle-2"}])

    inserted, _ = agg.run()

    assert inserted == 0
    lead_patches = [c for c in mock_requests.patch.call_args_list
                    if "dealer_leads?id=eq.dl-1" in c.args[0]]
    assert lead_patches, "expected PATCH against dealer_leads existing row"
    patch_body = lead_patches[0].kwargs["json"]
    assert patch_body["event_count"] == 2
    assert patch_body["last_event_at"] == "2026-06-05T11:00:00+00:00"
    post_events = [c for c in mock_requests.post.call_args_list
                   if "dealer_lead_events" in c.args[0]]
    assert post_events, "expected POST against dealer_lead_events"
    assert post_events[0].kwargs["json"]["kind"] == "inbound_contact"


@patch("workers.dealer_lead_aggregator.requests")
def test_run_inserts_new_lead_after_dedupe_window_expires(mock_requests):
    # Same visitor / listing / source, but the previous lead was 2 days ago
    # — outside the 24h visitor window — so a NEW lead row should be created.
    mock_requests.get.side_effect = [
        _resp(200, [{"last_processed_at": "2026-06-07T09:00:00+00:00"}]),
        _resp(200, [{
            "id": "le-3",
            "dealership_id": "d1",
            "listing_id": "L1",
            "listing_type": "car",
            "action": "call_click",
            "ip_address": "1.2.3.4",
            "user_agent": "ua",
            "payload": {"visitor_id": "v1"},
            "created_at": "2026-06-07T10:00:00+00:00",
        }]),
        _resp(200, [{
            "id": "dl-old",
            "first_event_at": "2026-06-05T10:00:00+00:00",  # 2 days earlier
            "event_count": 3,
        }]),
    ]
    mock_requests.post.side_effect = [
        _resp(201, [{"id": "dl-new"}]),
        _resp(201, [{"id": "dle-new"}]),
    ]
    mock_requests.patch.return_value = _resp(204, [])

    inserted, _ = agg.run()
    assert inserted == 1


@patch("workers.dealer_lead_aggregator.requests")
def test_run_skips_event_without_dealership_id(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{"last_processed_at": "2026-06-05T09:00:00+00:00"}]),
        _resp(200, [{
            "id": "le-x",
            "dealership_id": None,
            "listing_id": "L1",
            "listing_type": "car",
            "action": "call_click",
            "ip_address": "1.2.3.4",
            "user_agent": "ua",
            "payload": {},
            "created_at": "2026-06-05T10:00:00+00:00",
        }]),
    ]
    mock_requests.patch.return_value = _resp(204, [])

    inserted, _ = agg.run()
    assert inserted == 0
    assert mock_requests.post.called is False


@patch("workers.dealer_lead_aggregator.requests")
def test_lookup_orders_by_first_event_at_desc(mock_requests):
    # Ensures _find_existing_lead returns the most recent candidate.
    mock_requests.get.side_effect = [
        _resp(200, [{"last_processed_at": "2026-06-05T09:00:00+00:00"}]),
        _resp(200, [{
            "id": "le-z",
            "dealership_id": "d1",
            "listing_id": "L1",
            "listing_type": "car",
            "action": "call_click",
            "ip_address": "1.2.3.4",
            "user_agent": "ua",
            "payload": {"visitor_id": "v1"},
            "created_at": "2026-06-05T10:00:00+00:00",
        }]),
        _resp(200, []),
    ]
    mock_requests.post.side_effect = [
        _resp(201, [{"id": "dl-z"}]),
        _resp(201, [{"id": "dle-z"}]),
    ]
    mock_requests.patch.return_value = _resp(204, [])
    agg.run()

    # The 3rd GET call is the _find_existing_lead lookup against dealer_leads.
    lookup_calls = [c for c in mock_requests.get.call_args_list
                    if c.args[0].endswith("/rest/v1/dealer_leads")]
    assert lookup_calls, "expected at least one GET against /rest/v1/dealer_leads"
    params = lookup_calls[0].kwargs["params"]
    assert params.get("order") == "first_event_at.desc"
