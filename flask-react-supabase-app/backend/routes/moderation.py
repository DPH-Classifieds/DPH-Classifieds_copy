"""Generic listing moderation API routes.

The admin blueprint owns its canonical reject route.  This module owns the
legacy generic moderation API and resolves application services through the
Flask runtime registry so the compatibility root can keep patchable exports.
"""

from collections import defaultdict
from functools import wraps
import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request


logger = logging.getLogger(__name__)
moderation_bp = Blueprint("moderation", __name__)

_APPROVAL_TABLE_BY_ITEM_TYPE = {
    "cars": "cars",
    "bikes": "bikes",
    "parts": "car_parts",
    "plates": "license_plates",
    "buying_requests": "buying_requests",
    "buying_request": "buying_requests",
}

_REJECTION_TABLE_BY_ITEM_TYPE = dict(_APPROVAL_TABLE_BY_ITEM_TYPE)


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve live application helpers at call time for patch compatibility."""
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


def _perform_approval(
    item_type,
    item_id,
    *,
    actor,
    actor_id,
    origin_header=None,
    signals=None,
    dry_run=False,
):
    """Approve one item for the admin API or auto-review worker.

    Returns ``(ok, payload, http_status)``.  ``signals`` remains part of the
    callable contract for the auto-review worker even though approval itself
    does not persist those signals.
    """
    table_name = _APPROVAL_TABLE_BY_ITEM_TYPE.get(item_type)
    if not table_name:
        return False, {"error": f"Invalid item type: {item_type}"}, 400

    backend = _backend()
    patch_data = {"status": "approved", "is_approved": True}
    # Reset lifecycle state for inventory listings, not buying requests.
    if item_type in {"cars", "bikes", "parts", "plates"}:
        now = datetime.now(timezone.utc)
        new_expires = now + timedelta(days=backend.LISTING_EXPIRY_DAYS)
        new_retention = new_expires + timedelta(
            days=backend.LISTING_RETENTION_DAYS
        )
        patch_data.update(
            {
                "expires_at": new_expires.isoformat(),
                "retention_expires_at": new_retention.isoformat(),
                "deleted_at": None,
                "expired_at": None,
                "is_archived": False,
                "sold_status": None,
                "sold_status_set_at": None,
                "auto_removed_at": None,
                "sold_response_deadline": None,
                "expiry_reminder_sent_at": None,
                "expired_email_sent_at": None,
            }
        )
    if actor == "auto":
        patch_data["auto_review_state"] = "auto_approved"
        patch_data["auto_review_decided_at"] = backend._utc_now().isoformat()

    if dry_run:
        backend.logger.info(
            "dry-run approval: actor=%s actor_id=%s type=%s id=%s",
            actor,
            actor_id,
            item_type,
            item_id,
        )
        return True, {"success": True, "dry_run": True}, 200

    response, status_code = backend.supabase_request(
        "patch",
        f"/rest/v1/{table_name}?id=eq.{item_id}",
        data=patch_data,
        use_service_role=True,
    )

    if not (200 <= status_code < 300):
        backend.logger.error(
            "Error approving %s %s: %s - %s",
            item_type,
            item_id,
            status_code,
            response,
        )
        return False, {"error": f"Failed to approve {item_type}"}, status_code

    listing = None
    if isinstance(response, list) and response:
        listing = response[0]
    elif isinstance(response, dict) and response.get("id"):
        listing = response
    if not listing:
        listing_response, listing_status = backend.supabase_request(
            "get",
            f"/rest/v1/{table_name}?id=eq.{item_id}&select=*",
            use_service_role=True,
        )
        if listing_status < 400 and listing_response:
            listing = listing_response[0]

    # Native DPH cars take priority over Reddit imports with the same VIN.
    if (
        table_name == "cars"
        and listing
        and (listing.get("source_platform") or "") != "reddit"
    ):
        backend._expire_reddit_dupes_for_vin(listing.get("vin_number"))

    email_sent = False
    email_error = None
    if listing:
        user_email = listing.get("user_email") or listing.get("contact_email")
        if not user_email:
            user_id = listing.get("user_id")
            if user_id:
                user_email = backend.get_user_email(user_id)
        if user_email and backend.EMAIL_REGEX.match(user_email):
            _, email_error = backend._send_listing_status_email(
                user_email,
                item_type,
                listing,
                "approved",
                origin_header,
            )
            if email_error:
                backend.logger.error(
                    "Approval email failed for %s %s: %s",
                    item_type,
                    item_id,
                    email_error,
                )
            else:
                email_sent = True
        else:
            email_error = "Missing or invalid recipient email"
            backend.logger.warning(
                "Approval email skipped for %s %s: %s",
                item_type,
                item_id,
                email_error,
            )
    else:
        email_error = "Listing not found for email notification"
        backend.logger.warning(
            "Approval email skipped for %s %s: %s",
            item_type,
            item_id,
            email_error,
        )

    if actor == "auto" and listing:
        try:
            admin_user_email = listing.get("user_email") or listing.get(
                "contact_email"
            )
            if not admin_user_email:
                user_id = listing.get("user_id")
                if user_id:
                    admin_user_email = backend.get_user_email(user_id)
            backend._send_auto_approved_admin_notification(
                item_type, listing, admin_user_email
            )
        except Exception as exc:
            backend.logger.warning(
                "Auto-approved admin notification failed: %s", exc
            )

    backend.logger.info(
        "%s %s approved %s %s",
        actor.capitalize(),
        actor_id,
        item_type,
        item_id,
    )
    backend._invalidate_public_inventory_cache(item_type)
    payload = {
        "success": True,
        "message": f"{item_type} approved successfully",
        "email_sent": email_sent,
    }
    if email_error:
        payload["email_error"] = "Approval email was not sent"
    return True, payload, 200


@moderation_bp.route("/api/<item_type>/<item_id>/approve", methods=["POST"])
@_token_required
def api_approve_item(current_user, item_type, item_id):
    try:
        user_details = _backend()._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        _ok, payload, status_code = _backend()._perform_approval(
            item_type,
            item_id,
            actor="admin",
            actor_id=current_user,
            origin_header=request.headers.get("Origin"),
        )
        return jsonify(payload), status_code
    except Exception as exc:
        _backend().logger.error("Exception in api_approve_item: %s", exc)
        return jsonify({"error": str(exc)}), 500


@moderation_bp.route("/api/<item_type>/<item_id>/reject", methods=["POST"])
@_token_required
def api_reject_item(current_user, item_type, item_id):
    try:
        backend = _backend()
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        if item_type not in _REJECTION_TABLE_BY_ITEM_TYPE:
            return jsonify({"error": f"Invalid item type: {item_type}"}), 400

        table_name = _REJECTION_TABLE_BY_ITEM_TYPE[item_type]
        rejection_note = ""
        rejection_fix = ""
        if request.is_json and request.json:
            rejection_note = request.json.get("rejection_note", "")
            rejection_fix = request.json.get("rejection_fix", "")
        rejection_note = str(rejection_note or "").strip()
        if not rejection_note:
            return jsonify({"error": "Rejection reason is required"}), 400

        response, status_code = backend.supabase_request(
            "patch",
            f"/rest/v1/{table_name}?id=eq.{item_id}",
            data={"status": "rejected", "rejection_note": rejection_note},
            use_service_role=True,
        )

        if 200 <= status_code < 300:
            listing = None
            if isinstance(response, list) and response:
                listing = response[0]
            elif isinstance(response, dict) and response.get("id"):
                listing = response
            if not listing:
                listing_response, listing_status = backend.supabase_request(
                    "get",
                    f"/rest/v1/{table_name}?id=eq.{item_id}&select=*",
                    use_service_role=True,
                )
                if listing_status < 400 and listing_response:
                    listing = listing_response[0]

            email_sent = False
            email_error = None
            if listing:
                user_email = listing.get("user_email") or listing.get(
                    "contact_email"
                )
                if not user_email:
                    user_id = listing.get("user_id")
                    if user_id:
                        user_email = backend.get_user_email(user_id)
                if user_email and backend.EMAIL_REGEX.match(user_email):
                    _, email_error = backend._send_listing_status_email(
                        user_email,
                        item_type,
                        listing,
                        "rejected",
                        request.headers.get("Origin"),
                        rejection_fix=rejection_fix,
                    )
                    if email_error:
                        backend.logger.error(
                            "Rejection email failed for %s %s: %s",
                            item_type,
                            item_id,
                            email_error,
                        )
                    else:
                        email_sent = True
                else:
                    email_error = "Missing or invalid recipient email"
                    backend.logger.warning(
                        "Rejection email skipped for %s %s: %s",
                        item_type,
                        item_id,
                        email_error,
                    )
            else:
                email_error = "Listing not found for email notification"
                backend.logger.warning(
                    "Rejection email skipped for %s %s: %s",
                    item_type,
                    item_id,
                    email_error,
                )

            backend.logger.info(
                "Admin %s rejected %s %s with note: %s",
                current_user,
                item_type,
                item_id,
                rejection_note,
            )
            payload = {
                "success": True,
                "message": f"{item_type} rejected successfully",
                "email_sent": email_sent,
            }
            if email_error:
                payload["email_error"] = "Rejection email was not sent"
            return jsonify(payload), 200

        backend.logger.error(
            "Error rejecting %s %s: %s - %s",
            item_type,
            item_id,
            status_code,
            response,
        )
        return jsonify({"error": f"Failed to reject {item_type}"}), status_code
    except Exception as exc:
        _backend().logger.error("Exception in api_reject_item: %s", exc)
        return jsonify({"error": str(exc)}), 500


@moderation_bp.route("/api/admin/approve/<item_type>", methods=["GET"])
@_token_required
def api_admin_list_items(current_user, item_type):
    """Token-authenticated admin listing endpoint used by React screens."""
    try:
        backend = _backend()
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        table_name = backend.ADMIN_ITEM_TYPE_TO_TABLE.get(item_type)
        if not table_name:
            return jsonify({"error": "Invalid item type"}), 400

        status = request.args.get("status", "pending")
        query_params = {"select": "*", "order": "created_at.desc"}
        if status:
            query_params["status"] = f"eq.{status}"

        response, status_code = backend.supabase_request(
            "get",
            f"/rest/v1/{table_name}",
            params=query_params,
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch listings"}), status_code

        listings = response or []
        listing_ids = {
            str(item.get("id"))
            for item in listings
            if isinstance(item, dict) and item.get("id") is not None
        }

        lead_counts_by_listing = defaultdict(lambda: defaultdict(int))
        if listing_ids:
            normalized_listing_type = item_type.rstrip("s")
            lead_events, lead_status = backend.supabase_request(
                "get",
                "/rest/v1/lead_events",
                params={
                    "select": "listing_id,action,created_at",
                    "listing_type": f"eq.{normalized_listing_type}",
                    "order": "created_at.desc",
                    "limit": "10000",
                },
                use_service_role=True,
            )
            if lead_status < 400:
                for event in lead_events or []:
                    listing_id = str(event.get("listing_id"))
                    if listing_id not in listing_ids:
                        continue
                    action = event.get("action") or "unknown"
                    lead_counts_by_listing[listing_id][action] += 1
            else:
                backend.logger.warning(
                    "Failed loading lead events for admin listing view: %s",
                    lead_events,
                )

        enriched_listings = []
        for item in listings:
            item_copy = dict(item) if isinstance(item, dict) else item
            if not isinstance(item_copy, dict):
                enriched_listings.append(item_copy)
                continue

            listing_id = str(item_copy.get("id"))
            counts = lead_counts_by_listing.get(listing_id, {})
            call_click = int(counts.get("call_click", 0))
            whatsapp_click = int(counts.get("whatsapp_click", 0))
            vin_open = int(counts.get("vin_open", 0))
            vin_reveal = int(counts.get("vin_reveal", 0))
            item_copy["lead_metrics"] = {
                "call_click": call_click,
                "whatsapp_click": whatsapp_click,
                "vin_open": vin_open,
                "vin_reveal": vin_reveal,
                "qualified_leads": call_click + whatsapp_click,
            }
            item_copy.setdefault("listing_type", item_type)
            enriched_listings.append(item_copy)

        return jsonify(enriched_listings), 200
    except Exception as exc:
        _backend().logger.error("Exception in api_admin_list_items: %s", exc)
        return jsonify({"error": "Failed to fetch listings"}), 500


@moderation_bp.route(
    "/api/admin/approve/<item_type>/<item_id>/approve", methods=["POST"]
)
@_token_required
def api_admin_approve_item(current_user, item_type, item_id):
    return api_approve_item.__wrapped__(current_user, item_type, item_id)


@_token_required
def api_admin_reject_item(current_user, item_type, item_id):
    """Compatibility callable; the live rule remains ``routes.admin``."""
    return api_reject_item.__wrapped__(current_user, item_type, item_id)


def register_moderation_routes(app, backend_symbols=None):
    """Register generic moderation rules after the runtime registry is ready."""
    app.register_blueprint(moderation_bp)
