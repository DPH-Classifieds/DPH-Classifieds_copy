"""Admin dealer information-request control routes.

Only the authenticated admin create/list/cancel controls live here. Public
token lookup/upload and shared document helpers remain in the compatibility
root and are resolved at request time through Flask's runtime registry.
"""

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
def create_dealer_info_request(current_user, dealer_id):
    """Admin creates a request asking a dealer to upload additional documents."""
    backend = _backend()
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        body = request.get_json(silent=True) or {}
        documents_raw = body.get("documents") or []
        if not isinstance(documents_raw, list):
            return jsonify({"error": "documents must be a list of strings"}), 400
        documents = []
        for raw_document in documents_raw:
            label = str(raw_document).strip()
            if label and label not in documents:
                documents.append(label)
        documents = documents[:20]
        if not documents:
            return jsonify({"error": "At least one document label is required"}), 400
        message = (body.get("message") or "").strip()[:2000] or None

        # Resolve dealer email
        dealer_resp, dealer_status = backend.supabase_request(
            "get",
            f"/rest/v1/users",
            params={"select": "email,first_name,last_name,company_name", "id": f"eq.{dealer_id}", "limit": 1},
            use_service_role=True,
        )
        if dealer_status >= 400 or not dealer_resp:
            return jsonify({"error": "Dealer not found"}), 404
        dealer = dealer_resp[0]
        dealer_email = dealer.get("email")
        dealer_name = (
            dealer.get("company_name")
            or " ".join(filter(None, [dealer.get("first_name"), dealer.get("last_name")])).strip()
            or None
        )

        # Only one active recovery task should exist. Older pending links are
        # cancelled so the dealer and reviewer never work against different
        # requirements.
        backend.supabase_request(
            "patch",
            "/rest/v1/dealer_info_requests",
            params={"dealer_user_id": f"eq.{dealer_id}", "status": "eq.pending"},
            data={"status": "cancelled"},
            use_service_role=True,
        )

        token = backend.secrets.token_urlsafe(32)
        expires_at = backend.datetime.datetime.now(backend.datetime.timezone.utc) + backend.datetime.timedelta(days=backend.DEALER_INFO_REQUEST_TTL_DAYS)
        insert_payload = {
            "dealer_user_id": dealer_id,
            "requested_by": current_user,
            "requested_documents": documents,
            "message": message,
            "token": token,
            "status": "pending",
            "expires_at": backend._isoformat_utc(expires_at),
        }
        created_resp, created_status = backend.supabase_request(
            "post",
            "/rest/v1/dealer_info_requests",
            data=insert_payload,
            use_service_role=True,
        )
        if created_status >= 400 or not created_resp:
            backend.logger.error(f"Failed to create info request: {created_status} - {created_resp}")
            return jsonify({"error": "Failed to create info request"}), 500
        created = created_resp[0] if isinstance(created_resp, list) else created_resp

        # A request is a concrete recovery state, not merely an email side-channel.
        backend.supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{dealer_id}",
            data={"dealer_application_status": "action_required", "dealer_verified": False},
            use_service_role=True,
        )

        base_url = backend._get_safe_frontend_origin(request.headers.get("Origin")).rstrip("/")
        link_url = f"{base_url}/dealer-info-request/{token}"

        email_sent = False
        email_error = None
        if dealer_email:
            _, email_error = backend._send_info_request_email(
                dealer_email, dealer_name, documents, message, link_url
            )
            if email_error:
                backend.logger.error(f"Info-request email failed for dealer {dealer_id}: {email_error}")
            else:
                email_sent = True
        else:
            email_error = "Dealer has no email address"

        backend.logger.info(f"Admin {current_user} created info request {created.get('id')} for dealer {dealer_id}")
        return jsonify({
            "id": created.get("id"),
            "token": token,
            "link_url": link_url,
            "documents": documents,
            "message": message,
            "expires_at": created.get("expires_at"),
            "status": created.get("status"),
            "created_at": created.get("created_at"),
            "email_sent": email_sent,
            # Safe operational feedback for an admin; the actual link remains
            # available in the dashboard for manual delivery.
            "email_error": email_error,
        }), 201
    except Exception as e:
        backend.logger.exception("Error creating dealer info request")
        return jsonify({"error": str(e)}), 500


@_token_required
def list_dealer_info_requests(current_user, dealer_id):
    """List all info requests for a dealer (admin only)."""
    backend = _backend()
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        reqs_resp, reqs_status = backend.supabase_request(
            "get",
            "/rest/v1/dealer_info_requests",
            params={
                "select": "*,dealer_info_request_uploads(*)",
                "dealer_user_id": f"eq.{dealer_id}",
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
        if reqs_status >= 400:
            return jsonify({"error": "Failed to fetch info requests"}), 500
        requests_with_private_urls = []
        for info_request in reqs_resp or []:
            item = dict(info_request)
            item["dealer_info_request_uploads"] = [
                backend._with_private_dealer_attachment_url(upload)
                for upload in (item.get("dealer_info_request_uploads") or [])
            ]
            requests_with_private_urls.append(item)
        return jsonify({"requests": requests_with_private_urls}), 200
    except Exception as e:
        backend.logger.exception("Error listing dealer info requests")
        return jsonify({"error": str(e)}), 500


@_token_required
def cancel_dealer_info_request(current_user, request_id):
    """Admin cancels a pending info request."""
    backend = _backend()
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        update_resp, update_status = backend.supabase_request(
            "patch",
            "/rest/v1/dealer_info_requests",
            params={"id": f"eq.{request_id}", "status": "eq.pending"},
            data={"status": "cancelled"},
            use_service_role=True,
        )
        if update_status >= 400:
            return jsonify({"error": "Failed to cancel info request"}), 500
        return jsonify({"success": True}), 200
    except Exception as e:
        backend.logger.exception("Error cancelling info request")
        return jsonify({"error": str(e)}), 500

def register_dealer_info_request_routes(app: Flask) -> None:
    # Both methods intentionally share the legacy path. Flask dispatches by
    # method and keeps the historical route-manifest collision.
    app.add_url_rule(
        "/api/admin/dealers/<dealer_id>/info-requests",
        endpoint="create_dealer_info_request",
        view_func=create_dealer_info_request,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/dealers/<dealer_id>/info-requests",
        endpoint="list_dealer_info_requests",
        view_func=list_dealer_info_requests,
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/admin/info-requests/<request_id>/cancel",
        endpoint="cancel_dealer_info_request",
        view_func=cancel_dealer_info_request,
        methods=["POST"],
    )
