"""Admin user profile maintenance and unverified-account cleanup routes.

The compatibility root still owns the shared admin, phone, Supabase, and email
helpers.  Route handlers resolve them through Flask's runtime registry so this
module does not import ``app.py`` and direct callers keep the legacy exports.
"""

import os

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve live compatibility-root dependencies at request time."""
    return _BACKEND


def _token_required(function):
    """Apply the existing token decorator through the runtime registry."""
    from functools import wraps

    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def update_admin_user_profile(current_user, user_id):
    """Update an admin-managed user's supported profile fields."""
    backend = _backend()
    try:
        if not backend._require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        if user_id == current_user:
            return jsonify(
                {"error": "You cannot modify your own admin profile from this panel"}
            ), 400

        protected = backend._protect_super_admin_target(
            user_id, "modify the main admin account"
        )
        if protected:
            return protected

        data = request.get_json(silent=True) or {}
        allowed_fields = {
            "account_status": {"active", "suspended", "banned"},
            "is_admin": bool,
            "is_dealer": bool,
            "dealer_verified": bool,
            "email_verified": bool,
            "phone_verified": bool,
            "first_name": str,
            "last_name": str,
            "display_name": str,
            "username": str,
            "phone": str,
            "city": str,
            "emirate": str,
            "company_name": str,
            "company_registration_number": str,
            "trade_license_number": str,
            "tax_registration_number": str,
            "profile_photo_url": str,
            "rejection_note": str,
        }

        update_data = {}
        for field, validator in allowed_fields.items():
            if field not in data:
                continue

            value = data.get(field)
            if validator is bool:
                update_data[field] = bool(value)
            elif validator is str:
                if value is None:
                    update_data[field] = None
                else:
                    next_value = str(value).strip()
                    update_data[field] = next_value if next_value else None
            elif isinstance(validator, set):
                next_value = str(value or "").strip().lower()
                if next_value not in validator:
                    return jsonify(
                        {
                            "error": f"{field} must be one of: {', '.join(sorted(validator))}"
                        }
                    ), 400
                update_data[field] = next_value

        if not update_data:
            return jsonify({"error": "No supported profile fields were provided"}), 400

        if "is_dealer" in update_data and not update_data["is_dealer"]:
            update_data["dealer_verified"] = False
            update_data["dealer_verified_at"] = None
        elif update_data.get("dealer_verified") is True:
            from datetime import datetime

            update_data["dealer_verified_at"] = datetime.utcnow().isoformat()

        if update_data.get("phone_verified") is True:
            current_profile = backend._get_user_profile_for_verification(user_id) or {}
            next_phone = update_data.get("phone")
            if next_phone is None:
                next_phone = current_profile.get("phone")
            next_country_code = update_data.get("country_code")
            if next_country_code is None:
                next_country_code = current_profile.get("country_code")
            normalized_phone = backend._normalize_phone_number(
                next_phone, next_country_code
            )
            if not normalized_phone:
                return jsonify(
                    {
                        "error": "Cannot mark a user as phone verified without a valid phone number."
                    }
                ), 400
            update_data["phone"] = normalized_phone
            update_data["country_code"] = (
                next_country_code
                or backend._infer_country_code_from_phone(normalized_phone)
                or "+971"
            )
            update_data["phone_verified_at"] = backend._isoformat_utc(
                backend._utc_now()
            )
        elif update_data.get("phone_verified") is False:
            update_data["phone_verified_at"] = None

        response, status_code = backend.supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{user_id}",
            data=update_data,
            use_service_role=True,
        )

        if status_code not in [200, 204]:
            backend.logger.error(
                f"Failed updating admin profile for {user_id}: {response}"
            )
            return jsonify({"error": "Failed to update user profile"}), status_code

        # Dealer notifications are deliberately best-effort. A provider or
        # admin-email failure must not turn a successful profile write into a
        # failed request.
        try:
            dealer_fields_changed = any(
                f in update_data
                for f in (
                    "is_dealer",
                    "dealer_verified",
                    "company_name",
                    "company_registration_number",
                    "trade_license_number",
                )
            )
            if dealer_fields_changed:
                dealer_resp, dealer_status = backend.supabase_request(
                    "get",
                    f"/rest/v1/users?id=eq.{user_id}&select=email,first_name,last_name,company_name",
                    use_service_role=True,
                )
                if dealer_status < 400 and dealer_resp:
                    dealer_info = dealer_resp[0]
                    dealer_email = dealer_info.get("email")
                    dealer_name = (
                        dealer_info.get("first_name")
                        or dealer_info.get("display_name")
                        or "Dealer"
                    )

                    if dealer_email:
                        if (
                            update_data.get("dealer_verified") is False
                            and "dealer_verified" in update_data
                        ):
                            backend._send_dealer_status_email(
                                dealer_email,
                                "rejected",
                                request.headers.get("Origin"),
                                rejection_note="Your dealer profile was updated by an admin. Please re-submit your verification documents.",
                            )
                        elif update_data.get("dealer_verified") is True:
                            backend._send_dealer_status_email(
                                dealer_email,
                                "approved",
                                request.headers.get("Origin"),
                            )
                            # Keep the team-side approval cadence notification
                            # independent from the dealer-side status email.
                            try:
                                backend._send_dealer_approved_admin_notification(
                                    dealer_info or {"email": dealer_email},
                                )
                            except Exception as admin_email_exc:
                                backend.logger.warning(
                                    "Dealer approved admin notification failed: %s",
                                    admin_email_exc,
                                )

                    admin_email = os.getenv("RESEND_TO_EMAIL") or os.getenv(
                        "ADMIN_EMAIL"
                    )
                    if admin_email:
                        backend._send_resend_email(
                            {
                                "from": os.getenv(
                                    "RESEND_FROM_EMAIL", "noreply@dphclassifieds.com"
                                ),
                                "to": admin_email,
                                "subject": f"DPH Admin: Dealer profile updated - {dealer_info.get('company_name') or dealer_name}",
                                "html": f"""
                            <div style="font-family: sans-serif; padding: 20px;">
                                <h2>Dealer Profile Updated</h2>
                                <p>An admin has updated the dealer profile for <strong>{dealer_info.get("company_name") or dealer_name}</strong>.</p>
                                <p><strong>Email:</strong> {dealer_email}</p>
                                <p><strong>Changes:</strong> {", ".join(update_data.keys())}</p>
                                {'<p style="color: red;"><strong>Dealer verification has been revoked. The dealer will need to re-submit verification documents.</strong></p>' if update_data.get("dealer_verified") is False and "dealer_verified" in update_data else ""}
                            </div>
                            """,
                            }
                        )
        except Exception as notify_err:
            backend.logger.error(f"Error sending admin update notification: {notify_err}")

        refreshed_response, refreshed_status = backend.supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{user_id}&select=id,email,first_name,last_name,display_name,username,phone,city,emirate,profile_photo_url,profile_completion_percentage,email_verified,phone_verified,is_dealer,dealer_verified,dealer_verified_at,is_admin,account_status,created_at,company_name,company_registration_number,trade_license_number",
            use_service_role=True,
        )

        updated_user = (
            refreshed_response[0]
            if refreshed_status < 400 and refreshed_response
            else update_data
        )
        return jsonify(
            {
                "message": "User profile updated successfully",
                "user": updated_user,
            }
        ), 200
    except Exception as exc:
        backend.logger.error(f"Error updating admin user profile: {str(exc)}")
        return jsonify({"error": "An error occurred while updating user profile"}), 500


@_token_required
def admin_cleanup_unverified_accounts(current_user):
    """Run the destructive unverified-account cleanup as an admin action."""
    backend = _backend()
    try:
        if not backend._require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        data = request.get_json(silent=True) or {}
        dry_run = bool(data.get("dryRun", False))
        limit = int(data.get("limit", 500))
        max_age_hours = float(data.get("maxAgeHours", 48))

        from auth_cleanup import cleanup_unverified_accounts

        result = cleanup_unverified_accounts(
            max_age_hours=max_age_hours,
            limit=limit,
            dry_run=dry_run,
        )
        return jsonify(result), 200
    except Exception as exc:
        backend.logger.error(
            f"Error running unverified cleanup: {str(exc)}", exc_info=True
        )
        return jsonify({"error": "Failed to run cleanup"}), 500


def register_admin_user_routes(app: Flask, backend_symbols):
    """Register admin user maintenance routes after runtime setup."""
    # Keep root-level monkeypatches and legacy direct callers working while
    # the handlers themselves resolve the live table through current_app.
    globals().update(backend_symbols)
    for name in (
        "_require_admin_api_user",
        "_protect_super_admin_target",
        "_get_user_profile_for_verification",
        "_normalize_phone_number",
        "_infer_country_code_from_phone",
        "_isoformat_utc",
        "_utc_now",
        "supabase_request",
        "_send_dealer_status_email",
        "_send_dealer_approved_admin_notification",
        "_send_resend_email",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper

    app.add_url_rule(
        "/api/admin/users/<user_id>/profile",
        endpoint="update_admin_user_profile",
        view_func=update_admin_user_profile,
        methods=["PATCH"],
    )
    app.add_url_rule(
        "/api/admin/cleanup-unverified-accounts",
        endpoint="admin_cleanup_unverified_accounts",
        view_func=admin_cleanup_unverified_accounts,
        methods=["POST"],
    )
