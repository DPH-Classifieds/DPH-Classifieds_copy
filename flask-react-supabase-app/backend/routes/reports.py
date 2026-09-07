"""Authenticated report creation and listing routes.

Admin report status updates remain root-owned. Shared auth, notification, and
Supabase helpers resolve through the compatibility runtime registry.
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
def create_report(current_user):
    """Submit a report for a listing"""
    backend = _backend()
    try:
        data = request.json

        # Validate required fields
        if not data:
            return jsonify({"error": "No data provided"}), 400

        listing_id = data.get("listing_id")
        listing_type = data.get("listing_type")
        reason = data.get("reason")
        details = data.get("details", "")

        if not listing_id or not listing_type or not reason:
            return jsonify(
                {
                    "error": "Missing required fields: listing_id, listing_type, or reason"
                }
            ), 400

        # Validate listing_type
        valid_types = ["car", "bike", "plate", "part", "bug"]
        if listing_type not in valid_types:
            return jsonify(
                {
                    "error": f"Invalid listing_type. Must be one of: {', '.join(valid_types)}"
                }
            ), 400

        # Validate reason
        valid_reasons = [
            "spam",
            "fraud",
            "inappropriate",
            "wrong_category",
            "duplicate",
            "sold",
            "incorrect_info",
            "other",
            "bug",
        ]
        if reason not in valid_reasons:
            return jsonify(
                {"error": f"Invalid reason. Must be one of: {', '.join(valid_reasons)}"}
            ), 400

        # Create the report in Supabase
        report_data = {
            "listing_id": listing_id,
            "listing_type": listing_type,
            "reporter_id": current_user,
            "reason": reason,
            "details": details,
            "status": "pending",
        }

        response, status_code = backend.supabase_request(
            "post", "/rest/v1/reports", data=report_data, user_id=current_user
        )

        if status_code >= 400:
            backend.logger.error(f"Failed to create report: {response}")
            return jsonify({"error": "Failed to submit report"}), status_code

        try:
            reporter_details = backend._get_user_email_by_id(current_user)
            reporter_email = reporter_details.get("email") if reporter_details else None
            inserted_report = response[0] if isinstance(response, list) and response else report_data
            backend._send_report_admin_notification(inserted_report, reporter_email=reporter_email)
        except Exception as email_err:
            backend.logger.warning(f"Report admin notification failed: {email_err}")

        backend.logger.info(
            f"Report created successfully by user {current_user} for {listing_type} {listing_id}"
        )
        return jsonify(
            {"message": "Report submitted successfully", "report": response}
        ), 201

    except Exception as e:
        backend.logger.error(f"Error creating report: {str(e)}")
        return jsonify({"error": "An error occurred while submitting the report"}), 500


@_token_required
def get_reports(current_user):
    """Get reports - users see their own, admins see all"""
    backend = _backend()
    try:
        # Check if user is admin
        user_details = backend._get_user_details_with_admin_status(current_user)
        is_admin = user_details and user_details.get("is_admin", False)

        if is_admin:
            # Admins can see all reports
            response, status_code = backend.supabase_request(
                "get", "/rest/v1/reports?order=created_at.desc", user_id=current_user
            )
        else:
            # Regular users can only see their own reports
            response, status_code = backend.supabase_request(
                "get",
                f"/rest/v1/reports?reporter_id=eq.{current_user}&order=created_at.desc",
                user_id=current_user,
            )

        if status_code >= 400:
            backend.logger.error(f"Failed to fetch reports: {response}")
            return jsonify({"error": "Failed to fetch reports"}), status_code

        return jsonify(response), 200

    except Exception as e:
        backend.logger.error(f"Error fetching reports: {str(e)}")
        return jsonify({"error": "An error occurred while fetching reports"}), 500

def register_report_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/reports",
        endpoint="create_report",
        view_func=create_report,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/reports",
        endpoint="get_reports",
        view_func=get_reports,
        methods=["GET"],
    )
