"""Public listing lead-event ingestion route.

Canonical analytics writes, legacy compatibility writes, rate limits, and
seller notifications remain behaviorally unchanged and resolve through the
runtime backend boundary.
"""

import threading
from functools import wraps

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


def track_listing_lead_event(item_type, item_id):
    backend = _backend()
    """Track listing lead interactions (call, WhatsApp, VIN opens)."""
    try:
        normalized_type = item_type.rstrip("s")
        table_name = backend._resolve_listing_table(normalized_type)
        if not table_name:
            return jsonify({"error": "Invalid listing type"}), 400

        payload = request.json or {}
        action = (payload.get("action") or "").strip()
        if action not in backend.LEAD_EVENT_ACTIONS:
            return jsonify({"error": "Invalid action"}), 400

        # Anti-scraper guard on the anonymous contact taps (call/WhatsApp). Rate
        # limit per IP and per visitor_id so bulk number-harvesting trips even if
        # the scraper rotates one dimension. ponytail: 40/hour ceiling; escalate to
        # Turnstile (_verify_turnstile_token) only if abuse survives this.
        if action in backend.CONTACT_LEAD_ACTIONS:
            client_ip = request.remote_addr
            if backend._contact_lead_rate_limited(f"ip:{client_ip}"):
                return jsonify({"error": "Too many requests. Please try again later."}), 429

        listing_resp, listing_status = backend.supabase_request(
            "get",
            f"/rest/v1/{table_name}",
            params={"id": f"eq.{item_id}", "select": "id,user_id", "limit": 1},
            use_service_role=True,
        )
        if listing_status >= 400:
            return jsonify({"error": "Failed to validate listing"}), listing_status
        if not listing_resp:
            return jsonify({"error": "Listing not found"}), 404

        user_id = backend._get_optional_user_id_from_auth_header()
        try:
            client_meta = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            canonical = backend.normalize_analytics_event({
                **payload, "event_name": action, "listing_type": normalized_type,
                "listing_id": item_id, "metadata": {
                    **client_meta,
                    "source": payload.get("source"),
                    "is_probable_bot": backend._probable_bot_user_agent(request.headers.get("User-Agent")),
                },
            }, user_id)
        except AnalyticsEventError as exc:
            return jsonify({"error": str(exc)}), 400
        canonical_response, canonical_status = backend.supabase_request(
            "post", "/rest/v1/rpc/record_analytics_event", data={
                "p_event_id": canonical["event_id"], "p_event_name": canonical["event_name"],
                "p_listing_type": canonical["listing_type"], "p_listing_id": canonical["listing_id"],
                "p_visitor_id": canonical["visitor_id"], "p_session_id": canonical["session_id"],
                "p_user_id": canonical["user_id"], "p_platform": canonical["platform"],
                "p_occurred_at": canonical["occurred_at"], "p_metadata": canonical["metadata"],
            }, use_service_role=True)
        if canonical_status >= 400:
            backend.logger.error("Failed to store canonical lead event: %s", canonical_response)
            return jsonify({"error": "Failed to track lead event"}), 500
        event_payload = {
            "listing_id": str(item_id),
            "listing_type": normalized_type,
            "action": action,
            "user_id": user_id,
            "session_id": canonical["session_id"],
            "source": payload.get("source"),
            "user_agent": request.headers.get("User-Agent"),
            "ip_address": backend._request_client_ip(),
            "payload": payload.get("payload") or {},
        }

        response, status_code = backend.supabase_request(
            "post",
            "/rest/v1/lead_events",
            data=event_payload,
            use_service_role=True,
        )
        if status_code >= 400:
            backend.logger.error(f"Failed to track lead event: {response}")
            return jsonify({"error": "Failed to track lead event"}), status_code

        # Real-time push to the seller only on direct-contact intent (call /
        # WhatsApp), and only when the actor isn't the owner previewing. VIN
        # opens are higher-frequency / lower-intent, so they don't push — keeps
        # sellers from being spammed. Best-effort — never blocks the response.
        # ponytail: no per-listing debounce; add one if a hot listing spams the seller.
        owner_id = (listing_resp[0] or {}).get("user_id")
        if owner_id and owner_id != user_id and action in ("call_click", "whatsapp_click"):
            verb = "called about" if action == "call_click" else "messaged you on WhatsApp about"
            # Background daemon thread so a slow Expo call (up to 10s) never
            # blocks the buyer's request. backend._notify_user_push is self-contained
            # (service-role Supabase + Expo HTTP), no Flask request context needed.
            threading.Thread(
                target=backend._notify_user_push,
                args=(owner_id, "New buyer interest 🚗",
                      f"Someone just {verb} your {normalized_type} listing."),
                kwargs={"data": {"listing_type": normalized_type, "listing_id": str(item_id)}},
                daemon=True,
            ).start()

        if user_id:
            backend.capture_posthog_event(
                "lead_contacted",
                user_id,
                {"listing_type": normalized_type, "contact_method": action},
            )
        return jsonify({"message": "Lead event tracked"}), 201
    except Exception as e:
        backend.logger.error(f"Error tracking lead event: {e}")
        return jsonify({"error": "Failed to track lead event"}), 500



def register_listing_lead_event_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/listings/<item_type>/<item_id>/lead-events",
        endpoint="track_listing_lead_event",
        view_func=track_listing_lead_event,
        methods=["POST"],
    )
