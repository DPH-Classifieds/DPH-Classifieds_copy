"""Platform analytics event ingestion route.

The compatibility root owns the shared analytics normalizer and table-check
helper.  This module owns only HTTP request handling and resolves those
helpers, along with Supabase access and optional identity, through the Flask
runtime registry.
"""

import datetime
import logging
import uuid

from flask import Flask, current_app, jsonify, request

from services.analytics_events import AnalyticsEventError


logger = logging.getLogger(__name__)


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve live application helpers at request time for patch compatibility."""
    return _BACKEND


def track_platform_event():
    """Persist a raw platform analytics event."""
    backend = _backend()
    try:
        payload = request.json or {}
        user_id = backend._get_optional_user_id_from_auth_header()
        try:
            canonical = backend.normalize_analytics_event(payload, user_id)
        except AnalyticsEventError as exc:
            return jsonify({"error": str(exc)}), 400
        event_name = (payload.get("event_name") or payload.get("action") or "").strip()
        if not event_name:
            return jsonify({"error": "event_name is required"}), 400

        page_path = (
            payload.get("page_path") or payload.get("path") or "/"
        ).strip() or "/"
        classified = backend.classify_platform_path(page_path)
        metadata = payload.get("metadata") or payload.get("payload") or {}
        if not isinstance(metadata, dict):
            metadata = {"value": metadata}

        session_id = (
            payload.get("session_id")
            or metadata.get("session_id")
            or payload.get("visitor_id")
            or payload.get("user_id")
            or str(uuid.uuid4())
        )
        visitor_id = (
            payload.get("visitor_id") or metadata.get("visitor_id") or session_id
        )
        user_id = canonical["user_id"]

        row = {
            "id": str(uuid.uuid4()),
            "event_id": canonical["event_id"],
            "event_name": event_name,
            "event_category": (
                payload.get("event_category")
                or metadata.get("event_category")
                or event_name
            ).strip(),
            "page_path": page_path,
            "page_title": payload.get("page_title") or metadata.get("page_title"),
            "page_kind": payload.get("page_kind") or metadata.get("page_kind"),
            "element_tag": payload.get("element_tag") or metadata.get("element_tag"),
            "element_text": payload.get("element_text") or metadata.get("element_text"),
            "target_url": payload.get("target_url") or metadata.get("target_url"),
            "listing_type": (
                payload.get("listing_type")
                or classified.get("listing_type")
                or metadata.get("listing_type")
                or ""
            ).rstrip("s")
            or None,
            "listing_id": str(
                payload.get("listing_id")
                or classified.get("listing_id")
                or metadata.get("listing_id")
                or ""
            )
            or None,
            "user_id": user_id,
            "visitor_id": canonical["visitor_id"] or str(visitor_id),
            "session_id": canonical["session_id"] or str(session_id),
            "platform": canonical["platform"],
            "occurred_at": canonical["occurred_at"],
            "received_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "duration_ms": int(
                payload.get("duration_ms") or metadata.get("duration_ms") or 0
            ),
            "metadata": canonical["metadata"],
        }
        if not row["page_kind"]:
            if row["listing_id"]:
                row["page_kind"] = "listing_detail"
            elif page_path.startswith("/admin"):
                row["page_kind"] = "admin"
            elif page_path.startswith("/post-") or page_path.startswith("/create"):
                row["page_kind"] = "post_form"
            elif page_path == "/":
                row["page_kind"] = "home"
            else:
                row["page_kind"] = "other"

        response, status_code = backend.supabase_request(
            "post",
            "/rest/v1/platform_events",
            data=row,
            use_service_role=True,
        )
        # Older staging databases may have the original platform_events
        # schema, which predates the idempotency and timing fields. Retry once
        # without those additive fields while the migration is being applied;
        # all new environments still use the canonical schema.
        if status_code >= 400:
            error_text = str(response).lower()
            legacy_fields = {"event_id", "platform", "occurred_at", "received_at"}
            if "column" in error_text and any(field in error_text for field in legacy_fields):
                legacy_row = {
                    key: value for key, value in row.items() if key not in legacy_fields
                }
                logger.warning(
                    "platform_events is missing event_id; retrying legacy insert until schema migration is applied"
                )
                response, status_code = backend.supabase_request(
                    "post",
                    "/rest/v1/platform_events",
                    data=legacy_row,
                    use_service_role=True,
                )
        if status_code >= 400 and (
            status_code == 404
            or "does not exist" in str(response).lower()
            or "relation" in str(response).lower()
        ):
            if not backend.ensure_platform_events_table():
                return (
                    jsonify(
                        {
                            "error": "Analytics table missing. Apply backend/migrations/add_platform_analytics_tracking.sql to the live Supabase project."
                        }
                    ),
                    503,
                )

        if status_code >= 400:
            # The HTTP client used to retry POST requests.  A request that was
            # committed before a transient response failure can therefore be
            # replayed with the same server-generated row id, tripping either
            # the event_id unique index or the primary key.  Both mean the
            # event is already stored; acknowledge it rather than emitting a
            # misleading 500 to the browser.
            if status_code == 409 and (
                "event_id" in str(response).lower()
                or "platform_events_pkey" in str(response).lower()
                or "key (id)" in str(response).lower()
            ):
                return jsonify({"success": True, "duplicate": True}), 200
            backend.logger.error(f"Failed to store platform event: {response}")
            return jsonify({"error": "Failed to track event"}), 500

        return jsonify({"success": True}), 201
    except Exception as e:
        backend.logger.error(f"Error tracking platform event: {e}")
        return jsonify({"error": "Failed to track event"}), 500


def register_platform_analytics_routes(app: Flask) -> None:
    """Register the analytics ingestion route after the runtime registry exists."""
    app.add_url_rule(
        "/api/analytics/events",
        endpoint="track_platform_event",
        view_func=track_platform_event,
        methods=["POST"],
    )
