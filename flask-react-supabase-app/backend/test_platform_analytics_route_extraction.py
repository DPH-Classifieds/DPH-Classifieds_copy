import uuid
from unittest.mock import patch

import app as backend
from application.route_manifest import build_route_manifest


EVENT_ID = "d2719c04-9e3a-4e95-a2f2-1498259f5aea"


def test_platform_analytics_route_keeps_its_legacy_endpoint_and_methods():
    contracts = [
        contract
        for contract in build_route_manifest(backend.app)
        if contract.rule == "/api/analytics/events"
    ]

    assert len(contracts) == 1
    assert contracts[0].endpoint == "track_platform_event"
    assert contracts[0].methods == ("OPTIONS", "POST")


def test_platform_analytics_success_preserves_normalized_and_classified_fields():
    payload = {
        "event_id": EVENT_ID,
        "event_name": "page_view",
        "page_path": "/car-parts/part-123",
        "visitor_id": "visitor-1",
        "session_id": "session-1",
        "metadata": {
            "source": "detail",
            "session_id": "metadata-session",
            "duration_ms": 44,
            "phone": "+9710000000",
        },
    }

    with patch.object(backend, "supabase_request", return_value=({}, 201)) as insert:
        response = backend.app.test_client().post(
            "/api/analytics/events",
            json=payload,
        )

    assert response.status_code == 201
    assert response.get_json() == {"success": True}
    assert insert.call_count == 1
    assert insert.call_args.args == (
        "post",
        "/rest/v1/platform_events",
    )
    row = insert.call_args.kwargs["data"]
    assert row["event_id"] == EVENT_ID
    assert row["event_name"] == "page_view"
    assert row["listing_type"] == "part"
    assert row["listing_id"] == "part-123"
    assert row["page_kind"] == "listing_detail"
    assert row["visitor_id"] == "visitor-1"
    assert row["session_id"] == "session-1"
    assert row["duration_ms"] == 44
    assert row["metadata"] == {"source": "detail"}
    assert uuid.UUID(row["id"])


def test_platform_analytics_preserves_optional_bearer_user_id():
    payload = {
        "event_id": EVENT_ID,
        "event_name": "button_click",
        "page_path": "/",
        "visitor_id": "visitor-1",
        "session_id": "session-1",
    }

    with (
        patch.object(
            backend,
            "_get_optional_user_id_from_auth_header",
            return_value="user-42",
        ),
        patch.object(backend, "supabase_request", return_value=({}, 201)) as insert,
    ):
        response = backend.app.test_client().post(
            "/api/analytics/events",
            json=payload,
            headers={"Authorization": "Bearer token"},
        )

    assert response.status_code == 201
    assert insert.call_args.kwargs["data"]["user_id"] == "user-42"


def test_platform_analytics_invalid_event_returns_400_without_writing():
    with (
        patch.object(backend, "supabase_request") as insert,
        patch.object(backend, "ensure_platform_events_table") as ensure_table,
    ):
        response = backend.app.test_client().post(
            "/api/analytics/events",
            json={
                "event_name": "unsupported-event",
                "visitor_id": "visitor-1",
                "session_id": "session-1",
            },
        )

    assert response.status_code == 400
    assert response.get_json() == {"error": "unsupported event_name"}
    insert.assert_not_called()
    ensure_table.assert_not_called()


def test_platform_analytics_missing_table_returns_503_after_one_insert_attempt():
    with (
        patch.object(
            backend,
            "supabase_request",
            return_value=(
                {"error": 'relation "platform_events" does not exist'},
                404,
            ),
        ) as insert,
        patch.object(backend, "ensure_platform_events_table", return_value=False) as ensure_table,
    ):
        response = backend.app.test_client().post(
            "/api/analytics/events",
            json={
                "event_name": "page_view",
                "page_path": "/",
                "visitor_id": "visitor-1",
                "session_id": "session-1",
            },
        )

    assert response.status_code == 503
    assert response.get_json() == {
        "error": "Analytics table missing. Apply backend/migrations/add_platform_analytics_tracking.sql to the live Supabase project."
    }
    assert insert.call_count == 1
    ensure_table.assert_called_once_with()


def test_platform_analytics_duplicate_insert_returns_200_duplicate_envelope():
    duplicate = {
        "code": "23505",
        "message": 'duplicate key value violates unique constraint "platform_events_pkey"',
        "details": "Key (id)=(same-row-id) already exists.",
    }

    with patch.object(backend, "supabase_request", return_value=(duplicate, 409)) as insert:
        response = backend.app.test_client().post(
            "/api/analytics/events",
            json={
                "event_name": "page_view",
                "page_path": "/",
                "visitor_id": "visitor-1",
                "session_id": "session-1",
            },
        )

    assert response.status_code == 200
    assert response.get_json() == {"success": True, "duplicate": True}
    assert insert.call_count == 1


def test_platform_analytics_retries_without_event_id_for_legacy_schema():
    missing_event_id = {
        "code": "42703",
        "message": 'column "event_id" of relation "platform_events" does not exist',
    }

    with patch.object(
        backend,
        "supabase_request",
        side_effect=[(missing_event_id, 400), ({}, 201)],
    ) as insert:
        response = backend.app.test_client().post(
            "/api/analytics/events",
            json={
                "event_id": EVENT_ID,
                "event_name": "page_view",
                "page_path": "/",
                "visitor_id": "visitor-1",
                "session_id": "session-1",
            },
        )

    assert response.status_code == 201
    assert response.get_json() == {"success": True}
    assert insert.call_count == 2
    legacy_row = insert.call_args.kwargs["data"]
    assert all(field not in legacy_row for field in ("event_id", "platform", "occurred_at", "received_at"))
