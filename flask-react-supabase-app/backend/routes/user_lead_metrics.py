"""Authenticated lead metrics for listings owned by the current user."""

from collections import defaultdict
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


@_token_required
def get_user_lead_metrics(current_user):
    backend = _backend()
    """Lead metrics scoped to listings owned by the authenticated user."""
    try:
        days = max(min(int(request.args.get("days", 30)), 365), 1)
        cutoff = (backend._utc_now() - backend.datetime.timedelta(days=days)).isoformat()

        owned_listing_ids = defaultdict(set)
        for listing_type, config in backend.LISTING_TABLE_CONFIG.items():
            listing_rows, listing_status = backend.supabase_request(
                "get",
                f"/rest/v1/{config['table']}",
                params={
                    "select": "id",
                    "user_id": f"eq.{current_user}",
                    "limit": "1000",
                },
                use_service_role=True,
            )
            if listing_status >= 400:
                backend.logger.warning(
                    f"Failed loading {listing_type} listings for user {current_user}: {listing_rows}"
                )
                continue

            for row in listing_rows or []:
                listing_id = row.get("id")
                if listing_id is not None:
                    owned_listing_ids[listing_type].add(str(listing_id))

        if not any(owned_listing_ids.values()):
            return jsonify(
                {
                    "window_days": days,
                    "totals": {
                        "call_click": 0,
                        "whatsapp_click": 0,
                        "vin_open": 0,
                        "vin_reveal": 0,
                        "qualified_leads": 0,
                    },
                    "recent_events": [],
                }
            ), 200

        leads_resp, leads_status = backend.supabase_request(
            "get",
            "/rest/v1/lead_events",
            params={
                "select": "*",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "2000",
            },
            use_service_role=True,
        )
        if leads_status >= 400:
            return jsonify({"error": "Failed to fetch lead metrics"}), leads_status

        user_events = []
        totals = defaultdict(int)
        for event in leads_resp or []:
            listing_type = (event.get("listing_type") or "").rstrip("s")
            listing_id = str(event.get("listing_id"))
            if listing_id in owned_listing_ids.get(listing_type, set()):
                user_events.append(event)
                totals[event.get("action") or "unknown"] += 1

        return jsonify(
            {
                "window_days": days,
                "totals": {
                    "call_click": totals["call_click"],
                    "whatsapp_click": totals["whatsapp_click"],
                    "vin_open": totals["vin_open"],
                    "vin_reveal": totals["vin_reveal"],
                    "qualified_leads": totals["call_click"] + totals["whatsapp_click"],
                },
                "recent_events": user_events[:100],
            }
        ), 200
    except Exception as e:
        backend.logger.error(f"Error fetching user lead metrics: {str(e)}")
        return jsonify({"error": "Failed to fetch lead metrics"}), 500



def register_user_lead_metrics_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/user/lead-metrics",
        endpoint="get_user_lead_metrics",
        view_func=get_user_lead_metrics,
        methods=["GET"],
    )
