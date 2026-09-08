"""Admin dealer verification actions.

The document/application policy and provider helpers remain in the compatibility
backend and resolve through the runtime registry.
"""

from datetime import datetime
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
def api_verify_dealer(current_user, dealer_id):
    """Force-approve a dealer (admin OCR override)."""
    backend = _backend()
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        reason = (
            ((request.json or {}).get("reason") if request.is_json else "")
            if request.json
            else ""
        )
        reason = (reason or "").strip() if isinstance(reason, str) else ""
        if not reason:
            return jsonify({
                "error": "A reason is required when force-approving a dealer.",
                "code": "force_approve_reason_required",
            }), 400
        backend.logger.info(
            "Admin force-approved dealer %s (actor=%s, reason=%s)",
            dealer_id,
            current_user,
            reason,
        )

        readiness, readiness_error = backend._get_dealer_application_readiness(dealer_id)
        if readiness_error:
            return jsonify({"error": readiness_error}), 404
        if not readiness["ready_to_approve"]:
            return jsonify({
                "error": "Dealer cannot be approved until all active required documents are approved.",
                "code": "dealer_application_not_ready_for_approval",
                "readiness": readiness,
            }), 409

        update_data = {
            "dealer_verified": True,
            "dealer_verified_at": datetime.utcnow().isoformat(),
            "dealer_application_status": "approved",
        }
        response, status_code = backend.supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{dealer_id}",
            data=update_data,
            use_service_role=True,
        )

        if status_code in [200, 204]:
            dealer_response, dealer_status = backend.supabase_request(
                "get",
                f"/rest/v1/users?id=eq.{dealer_id}&select=email",
                use_service_role=True,
            )
            if dealer_status < 400 and dealer_response:
                dealer_email = dealer_response[0].get("email")
                _, email_error = backend._send_dealer_status_email(
                    dealer_email, "approved", request.headers.get("Origin")
                )
                if email_error:
                    backend.logger.error(
                        f"Dealer approval email failed for {dealer_id}: {email_error}"
                    )

            backend.logger.info(
                f"Admin {current_user} force-approved dealer {dealer_id}: {reason}"
            )
            return jsonify({"success": True, "message": "Dealer force-approved"}), 200

        backend.logger.error(
            f"Error verifying dealer {dealer_id}: {status_code} - {response}"
        )
        return jsonify({"error": "Failed to verify dealer"}), status_code

    except Exception as exc:
        backend.logger.error(f"Exception in api_verify_dealer: {str(exc)}")
        return jsonify({"error": str(exc)}), 500


@_token_required
def api_reject_dealer(current_user, dealer_id):
    """Reject a dealer verification request while preserving its audit trail."""
    backend = _backend()
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        rejection_note = ""
        rejection_fix = ""
        if request.is_json and request.json:
            rejection_note = request.json.get("rejection_note", "")
            rejection_fix = request.json.get("rejection_fix", "")

        update_data = {
            "dealer_verified": False,
            "dealer_application_status": "rejected",
            "rejection_note": rejection_note,
        }
        response, status_code = backend.supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{dealer_id}",
            data=update_data,
            use_service_role=True,
        )

        if status_code in [200, 204]:
            dealer_response, dealer_status = backend.supabase_request(
                "get",
                f"/rest/v1/users?id=eq.{dealer_id}&select=email",
                use_service_role=True,
            )
            if dealer_status < 400 and dealer_response:
                dealer_email = dealer_response[0].get("email")
                _, email_error = backend._send_dealer_status_email(
                    dealer_email,
                    "rejected",
                    request.headers.get("Origin"),
                    rejection_note=rejection_note,
                    rejection_fix=rejection_fix,
                )
                if email_error:
                    backend.logger.error(
                        f"Dealer rejection email failed for {dealer_id}: {email_error}"
                    )

            backend.logger.info(f"Admin {current_user} rejected dealer {dealer_id}")
            return jsonify({
                "success": True,
                "message": "Dealer verification rejected",
            }), 200

        backend.logger.error(
            f"Error rejecting dealer {dealer_id}: {status_code} - {response}"
        )
        return jsonify({"error": "Failed to reject dealer"}), status_code

    except Exception as exc:
        backend.logger.error(f"Exception in api_reject_dealer: {str(exc)}")
        return jsonify({"error": str(exc)}), 500


def register_dealer_admin_action_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/dealers/<dealer_id>/verify",
        endpoint="api_verify_dealer",
        view_func=api_verify_dealer,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/admin/dealers/<dealer_id>/reject",
        endpoint="api_reject_dealer",
        view_func=api_reject_dealer,
        methods=["POST"],
    )
