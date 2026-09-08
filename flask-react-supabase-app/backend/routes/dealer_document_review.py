"""Admin dealer-document review route.

Shared KYC policy, storage, and email helpers remain in the compatibility
backend and resolve through the runtime registry.
"""

from datetime import datetime
from functools import wraps

import requests
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
def review_dealer_document(current_user, doc_id):
    backend = _backend()
    """Approve or deny a specific dealer document"""
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        data = request.json
        action = data.get("action")
        if action not in ("approve", "deny", "pending"):
            return jsonify({"error": "action must be 'approve', 'deny', or 'pending'"}), 400

        denial_reason = data.get("denial_reason", "")
        denial_fix = data.get("denial_fix", "")

        headers = {
            "apikey": backend.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {backend.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        doc_resp = requests.get(
            f"{backend.SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{doc_id}&select=*,users:user_id(email,first_name,last_name,company_name)",
            headers=headers,
            timeout=10,
        )
        if doc_resp.status_code != 200 or not doc_resp.json():
            return jsonify({"error": "Document not found"}), 404

        doc = doc_resp.json()[0]
        from datetime import datetime

        update_fields = {
            "status": {"approve": "approved", "deny": "denied", "pending": "pending"}[action],
            "reviewed_at": datetime.utcnow().isoformat(),
            "reviewed_by": current_user,
        }
        if action == "deny":
            update_fields["denial_reason"] = denial_reason
            update_fields["denial_fix"] = denial_fix
        elif action == "pending":
            update_fields["denial_reason"] = None
            update_fields["denial_fix"] = None

        update_resp = requests.patch(
            f"{backend.SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{doc_id}",
            headers={**headers, "Prefer": "return=representation"},
            json=update_fields,
            timeout=10,
        )

        if update_resp.status_code not in [200, 204]:
            backend.logger.error(f"Failed to update document: {update_resp.text}")
            return jsonify({"error": "Failed to update document"}), 500

        if action == "deny":
            backend.supabase_request(
                "patch",
                f"/rest/v1/users?id=eq.{doc['user_id']}",
                data={"dealer_application_status": "action_required", "dealer_verified": False},
                use_service_role=True,
            )

        if action == "deny":
            user_data = doc.get("users", {})
            dealer_email = (
                user_data.get("email") if isinstance(user_data, dict) else None
            )
            if dealer_email:
                doc_type_nice = {
                    "trade_license": "Trade License",
                    "company_registration": "Company Registration",
                    "tax_registration": "Tax Registration (TRN)",
                }.get(doc.get("document_type", ""), doc.get("document_type", ""))

                try:
                    backend._send_document_denial_email(
                        dealer_email,
                        doc_type_nice,
                        denial_reason,
                        denial_fix,
                        request.headers.get("Origin"),
                    )
                except Exception as email_err:
                    backend.logger.error(f"Document denial email failed: {email_err}")

        backend.logger.info(f"Admin {current_user} {action}d document {doc_id}")
        return jsonify(
            {"success": True, "message": f"Document {action}d successfully"}
        ), 200

    except Exception as e:
        backend.logger.error(f"Error reviewing document: {str(e)}")
        return jsonify({"error": "Failed to review document"}), 500



def register_dealer_document_review_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/dealer-documents/<doc_id>/review",
        endpoint="review_dealer_document",
        view_func=review_dealer_document,
        methods=["POST"],
    )
