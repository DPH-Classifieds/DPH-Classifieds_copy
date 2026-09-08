"""Admin decisions for dealer listing-limit upgrade requests."""

import os
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
def dealer_create_listing_upgrade_request(current_user):
    """Create one dealer listing-limit upgrade request."""
    backend = _backend()
    body = request.get_json(silent=True) or {}
    policy = backend._fetch_dealer_listing_policy(current_user)
    if not policy:
        return jsonify({"error": "Not a dealer"}), 403
    if not policy.get("verified"):
        return jsonify({
            "error": "Your dealer account must be verified before requesting more listings"
        }), 403

    error = backend.validate_upgrade_request(
        policy["limit"], body.get("requested_limit"), body.get("reason", "")
    )
    if error:
        status = 422 if error["code"] in (
            "reason_too_short",
            "reason_too_long",
            "invalid_requested_limit",
            "reason_required",
        ) else 400
        return jsonify(error), status

    insert, status_code = backend.supabase_request(
        "post",
        "/rest/v1/dealer_listing_upgrade_requests",
        data={
            "dealer_id": current_user,
            "current_limit": policy["limit"],
            "requested_limit": int(body["requested_limit"]),
            "reason": body["reason"].strip(),
        },
        use_service_role=True,
    )
    if status_code >= 400 or not insert:
        if isinstance(insert, dict):
            message = str(insert.get("message", "")).lower()
            provider_code = str(insert.get("code", "")).lower()
            if (
                "dealer_listing_upgrade_requests_one_pending" in message
                or "duplicate" in message
                or "duplicate" in provider_code
            ):
                return jsonify({
                    "error": "You already have a pending upgrade request",
                    "code": "pending_request_exists",
                }), 409
        backend.logger.error(
            "dealer_create_listing_upgrade_request: supabase returned %s body=%s",
            status_code,
            str(insert)[:300],
        )
        hint = ""
        if isinstance(insert, dict) and insert.get("code") == "42P01":
            hint = " — table dealer_listing_upgrade_requests is missing. Run migrations/2026_08_18_dealer_listing_upgrade_requests.sql"
        return jsonify({"error": f"Failed to create upgrade request{hint}"}), 500

    row = insert[0] if isinstance(insert, list) else insert
    try:
        dealer_rows, _ = backend.supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{current_user}&select=email,company_name,legal_business_name",
            use_service_role=True,
        )
        dealer = dealer_rows[0] if isinstance(dealer_rows, list) and dealer_rows else {}
        backend._send_dealer_listing_upgrade_admin_notification(row, dealer)
    except Exception as exc:
        backend.logger.warning(
            "Dealer upgrade request admin notification failed: %s", exc
        )
    return jsonify(row), 201


@_token_required
def admin_list_listing_upgrade_requests(current_user):
    """List pending or resolved dealer listing-limit upgrade requests."""
    backend = _backend()
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Admin only"}), 403

    status_filter = (request.args.get("status") or "pending").strip()
    if status_filter not in ("pending", "approved", "rejected", "cancelled"):
        status_filter = "pending"
    rows, code = backend.supabase_request(
        "get",
        "/rest/v1/dealer_listing_upgrade_requests",
        params={
            "select": "id,dealer_id,current_limit,requested_limit,reason,status,created_at,resolved_at,resolution_note",
            "status": f"eq.{status_filter}",
            "order": "created_at.desc",
            "limit": "100",
        },
        use_service_role=True,
    )
    if code >= 400:
        backend.logger.error(
            "admin_list_listing_upgrade_requests: supabase returned %s body=%s",
            code,
            str(rows)[:300],
        )
        hint = ""
        if isinstance(rows, dict) and rows.get("code") == "42P01":
            hint = " — table dealer_listing_upgrade_requests is missing. Run migrations/2026_08_18_dealer_listing_upgrade_requests.sql"
        return jsonify({"error": f"Failed to fetch upgrade requests{hint}"}), 500

    rows = rows or []
    dealer_ids = list({row["dealer_id"] for row in rows})
    dealers = {}
    if dealer_ids:
        in_filter = ",".join(dealer_ids)
        dealer_rows, dealer_code = backend.supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "id": f"in.({in_filter})",
                "select": "id,email,company_name,legal_business_name,dealer_listing_limit,is_dealer,dealer_verified",
            },
            use_service_role=True,
        )
        if dealer_code < 400 and isinstance(dealer_rows, list):
            for dealer in dealer_rows:
                dealers[dealer["id"]] = dealer
    for row in rows:
        row["dealer"] = dealers.get(row["dealer_id"], {"id": row["dealer_id"]})
    return jsonify(rows), 200


@_token_required
def admin_decide_listing_upgrade_request(current_user, request_id):
    """Approve or reject one pending dealer listing-limit request."""
    backend = _backend()
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Admin only"}), 403

    body = request.get_json(silent=True) or {}
    existing, code = backend.supabase_request(
        "get",
        f"/rest/v1/dealer_listing_upgrade_requests?id=eq.{request_id}&limit=1",
        use_service_role=True,
    )
    if code >= 400 or not existing:
        return jsonify({"error": "Upgrade request not found"}), 404
    req = existing[0]
    if req["status"] != "pending":
        return jsonify({"error": "Request already resolved", "status": req["status"]}), 409

    new_limit, history, error = backend.decide_upgrade_request(
        req["current_limit"],
        req["requested_limit"],
        body.get("decision"),
        body.get("new_limit"),
        current_user,
    )
    if error:
        status = (
            400
            if error["code"] in ("new_limit_required", "invalid_decision", "invalid_new_limit")
            else 500
        )
        return jsonify(error), status

    now = backend._utc_now().isoformat()
    _, patch_code = backend.supabase_request(
        "patch",
        f"/rest/v1/dealer_listing_upgrade_requests?id=eq.{request_id}",
        data={
            "status": "approved" if new_limit else "rejected",
            "resolved_by": current_user,
            "resolved_at": now,
            "resolution_note": (body.get("note") or "").strip() or None,
        },
        use_service_role=True,
    )
    if patch_code >= 400:
        return jsonify({"error": "Failed to update upgrade request"}), 500

    if new_limit is not None:
        _, user_code = backend.supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{req['dealer_id']}",
            data={"dealer_listing_limit": new_limit},
            use_service_role=True,
        )
        if user_code >= 400:
            return jsonify({"error": "Failed to update dealer limit"}), 500

        history["reason"] = (
            (body.get("note") or "").strip()
            or f"Approved upgrade request {request_id}"
        )
        history["request_id"] = request_id
        backend.supabase_request(
            "post",
            "/rest/v1/dealer_listing_limit_history",
            data={"dealer_id": req["dealer_id"], **history},
            use_service_role=True,
        )
        try:
            dealer_rows, _ = backend.supabase_request(
                "get",
                f"/rest/v1/users?id=eq.{req['dealer_id']}&select=email,first_name",
                use_service_role=True,
            )
            if dealer_rows and dealer_rows[0].get("email"):
                from_email = os.getenv("RESEND_FROM_EMAIL")
                if from_email:
                    backend._send_resend_email(
                        {
                            "from": from_email,
                            "to": [dealer_rows[0]["email"]],
                            "subject": f"Your DPH Classifieds listing limit has been updated to {new_limit}",
                            "html": (
                                f"<p>Hi {dealer_rows[0].get('first_name') or 'there'},</p>"
                                f"<p>Your listing limit has been updated to <strong>{new_limit}</strong> active ads.</p>"
                                f"<p>You can now post more listings in your "
                                f"<a href='{backend.SITE_URL}/dealer/inventory'>Dealer Inventory</a>.</p>"
                            ),
                        },
                        email_type="dealer_listing_limit_updated",
                    )
        except Exception as exc:
            backend.logger.warning("Dealer limit update email failed: %s", exc)

    return jsonify({
        "new_limit": new_limit,
        "request": req,
        "status": "approved" if new_limit else "rejected",
    }), 200


def register_admin_upgrade_decision_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/dealer/listing-upgrade-requests",
        endpoint="dealer_create_listing_upgrade_request",
        view_func=dealer_create_listing_upgrade_request,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/dealer/listing-upgrade-requests",
        endpoint="admin_list_listing_upgrade_requests",
        view_func=admin_list_listing_upgrade_requests,
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/admin/dealer/listing-upgrade-requests/<request_id>/decision",
        endpoint="admin_decide_listing_upgrade_request",
        view_func=admin_decide_listing_upgrade_request,
        methods=["POST"],
    )
