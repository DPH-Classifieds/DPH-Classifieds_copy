"""Authenticated profile read and update routes."""

from functools import wraps

from flask import Blueprint, current_app


profile_bp = Blueprint("profile", __name__, url_prefix="/api/user")


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


@profile_bp.route("/profile", methods=["GET"])
@_token_required
def get_user_profile(current_user):
    """Get complete user profile from users table"""
    logger.info(f"=" * 50)
    logger.info(f"GET USER PROFILE REQUEST")
    logger.info(f"User ID: {current_user}")

    try:
        # Fetch user data from the users table (not auth table)
        # This is where profile updates are stored
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get user from users table
        url = (
            f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=*"
        )

        logger.info(f"Fetching user profile from users table: {url}")
        response = requests.get(url, headers=headers, timeout=10)

        logger.info(f"Profile fetch response status: {response.status_code}")

        if response.status_code == 200:
            users = response.json()

            if users and len(users) > 0:
                user_data = users[0]
                logger.info(
                    f"✓ Successfully retrieved profile for: {user_data.get('email')}"
                )
                logger.info(f"Profile fields: {list(user_data.keys())}")
                logger.info(f"=" * 50)

                # Remove sensitive data
                sensitive_fields = ["password", "encrypted_password"]
                for field in sensitive_fields:
                    if field in user_data:
                        del user_data[field]

                return jsonify(user_data), 200
            else:
                logger.error(f"✗ No user found with ID: {current_user}")
                logger.info(f"=" * 50)
                return jsonify({"message": "User not found"}), 404
        else:
            logger.error(f"✗ Failed to get user profile: {response.status_code}")
            logger.error(f"Response: {response.text}")
            logger.info(f"=" * 50)
            return jsonify(
                {"message": "Failed to get user profile"}
            ), response.status_code

    except Exception as e:
        logger.error(f"✗ Exception in get_user_profile: {str(e)}", exc_info=True)
        logger.info(f"=" * 50)
        return jsonify({"error": str(e)}), 500


# Profile management routes
@profile_bp.route("/update-profile", methods=["PUT"])
@_token_required
def update_user_profile(current_user):
    """Update user profile information"""
    try:
        data = request.json
        logger.info(f"=" * 50)
        logger.info(f"PROFILE UPDATE REQUEST")
        logger.info(f"User ID: {current_user}")
        logger.info(f"Received data: {json.dumps(data, indent=2)}")

        if not data:
            return jsonify({"message": "No data provided"}), 400

        if "username" in data and not _normalize_username_value(data.get("username")):
            return jsonify(
                {
                    "message": "Username is required",
                    "code": "username_required",
                    "field": "username",
                }
            ), 400

        # Map frontend field names to database field names
        field_mapping = {
            "email": "email",
            "firstName": "first_name",
            "lastName": "last_name",
            "username": "username",
            "displayName": "display_name",
            "phone": "phone",
            "countryCode": "country_code",
            "whatsappNumber": "whatsapp_number",
            "city": "city",
            "emirate": "emirate",
            "country": "country",
            "postalCode": "postal_code",
            "address": "address",
            "bio": "bio",
            "isDealer": "is_dealer",
            "companyName": "company_name",
            "companyRegistrationNumber": "company_registration_number",
            "tradeLicenseNumber": "trade_license_number",
            "taxRegistrationNumber": "tax_registration_number",
            "websiteUrl": "website_url",
            "facebookUrl": "facebook_url",
            "instagramUrl": "instagram_url",
            "twitterUrl": "twitter_url",
            "emailNotifications": "email_notifications",
            "smsNotifications": "sms_notifications",
            "marketingEmails": "marketing_emails",
            "profilePhotoUrl": "profile_photo_url",
            "showUsernameOnListings": "show_username_on_listings",
        }

        # Prepare update data - only include fields that are provided and not empty
        update_payload = {}
        varchar_limits = {
            "phone": 20,
            "country_code": 10,
            "whatsapp_number": 20,
            "first_name": 100,
            "last_name": 100,
            "username": 100,
            "display_name": 150,
            "city": 100,
            "emirate": 50,
            "country": 100,
            "postal_code": 20,
            "company_name": 255,
            "company_registration_number": 100,
            "trade_license_number": 100,
            "tax_registration_number": 100,
        }
        for frontend_field, db_field in field_mapping.items():
            if frontend_field in data:
                value = data[frontend_field]
                # Include the value if it's not an empty string, or if it's a required field
                if (
                    value or value is False or value == 0
                ):  # Include False and 0 but not empty strings
                    if isinstance(value, str) and db_field in varchar_limits:
                        max_len = varchar_limits[db_field]
                        if len(value) > max_len:
                            logger.warning(
                                f"Truncating {db_field} from {len(value)} to {max_len} chars"
                            )
                            value = value[:max_len]
                    update_payload[db_field] = value

        if not update_payload:
            logger.warning("No valid fields to update")
            return jsonify({"message": "No valid fields to update"}), 400

        logger.info(f"Update payload: {json.dumps(update_payload, indent=2)}")

        # First, verify the user exists
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        # Check if user exists
        check_url = (
            f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=*"
        )
        check_response = requests.get(check_url, headers=headers, timeout=10)

        try:
            existing_rows = check_response.json()
        except Exception:
            logger.error(
                f"Failed to parse user lookup response: {check_response.text}",
                exc_info=True,
            )
            return jsonify({"message": "Failed to load user profile"}), 502

        if (
            check_response.status_code != 200
            or not isinstance(existing_rows, list)
            or not existing_rows
        ):
            logger.error(f"User not found: {current_user}")
            return jsonify({"message": "User not found"}), 404

        existing_user = existing_rows[0]
        requested_username = _normalize_username_value(update_payload.get("username"))
        existing_username = _normalize_username_value(existing_user.get("username"))

        if not existing_username and not requested_username:
            return jsonify(
                {
                    "message": "Username is required",
                    "code": "username_required",
                    "field": "username",
                }
            ), 400

        if requested_username and requested_username != existing_username:
            if _is_username_blocked(requested_username):
                return jsonify(
                    {
                        "message": _username_blocked_message(),
                        "code": "username_blocked",
                        "field": "username",
                    }
                ), 409
            username_check = _check_username_availability(
                requested_username,
                current_user,
            )
            if not username_check.get("available", False):
                return jsonify(
                    {
                        "message": username_check.get("message")
                        or _username_conflict_message(),
                        "code": "username_taken",
                        "field": "username",
                    }
                ), 409

        existing_phone = _normalize_phone_number(
            existing_user.get("phone"),
            existing_user.get("country_code"),
        )
        requested_phone = _normalize_phone_number(
            update_payload.get("phone", existing_user.get("phone")),
            update_payload.get("country_code", existing_user.get("country_code")),
        )
        phone_changed = bool(requested_phone and requested_phone != existing_phone)

        if phone_changed:
            update_payload["phone_verified"] = False
            update_payload["phone_verified_at"] = None

        logger.info(f"User exists, proceeding with update")

        # Update using the REST API with eq filter
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}"

        logger.info(f"Sending PATCH request to: {url}")
        logger.info(
            f"Headers: {json.dumps({k: v for k, v in headers.items() if k != 'Authorization'}, indent=2)}"
        )

        response = requests.patch(url, headers=headers, json=update_payload, timeout=10)

        logger.info(f"PATCH response status: {response.status_code}")
        logger.info(f"PATCH response headers: {dict(response.headers)}")
        logger.info(f"PATCH response body: {response.text}")

        if response.status_code in [200, 204]:
            logger.info("Update successful, fetching updated user data")

            # Always fetch the updated user data
            get_url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=*"
            get_response = requests.get(get_url, headers=headers, timeout=10)

            logger.info(f"GET response status: {get_response.status_code}")

            if get_response.status_code == 200:
                users = get_response.json()
                logger.info(f"Fetched {len(users)} user(s)")

                if users and len(users) > 0:
                    updated_user = users[0]
                    phone_verification = None

                    if phone_changed and requested_phone:
                        pv_country = update_payload.get(
                            "country_code", existing_user.get("country_code")
                        )
                        if _msg91_handles_phone(requested_phone, pv_country):
                            # MSG91 owns send+verify client-side — don't send Infobip.
                            phone_verification = _msg91_pending_verification(
                                requested_phone, pv_country, "phone_change"
                            )
                        else:
                          try:
                            verification_result = _issue_phone_verification(
                                user_id=current_user,
                                phone=requested_phone,
                                country_code=pv_country,
                                purpose="phone_change",
                                metadata={
                                    "source": "account_settings",
                                    "phone_changed": True,
                                },
                            )
                            phone_verification = _phone_verification_response(
                                verification_result["verification"]
                            )
                          except Exception as verification_err:
                            logger.error(
                                f"Failed to start phone verification after profile update: {verification_err}",
                                exc_info=True,
                            )
                            phone_verification = {
                                "status": "failed",
                                "message": str(verification_err),
                            }

                    logger.info(
                        f"✓ Profile updated successfully for: {updated_user.get('email')}"
                    )
                    logger.info(f"Updated fields: {list(update_payload.keys())}")
                    logger.info(f"=" * 50)

                    return jsonify(
                        {
                            "message": "Profile updated successfully",
                            "user": updated_user,
                            "updated_fields": list(update_payload.keys()),
                            "phone_verification": phone_verification,
                            "phone_verification_required": bool(phone_verification),
                        }
                    ), 200
                else:
                    logger.error("No users returned after update")
                    return jsonify(
                        {"message": "Update succeeded but could not fetch user data"}
                    ), 500
            else:
                logger.error(
                    f"Failed to fetch updated user: {get_response.status_code}"
                )
                return jsonify(
                    {"message": "Update succeeded but could not fetch user data"}
                ), 500
        else:
            logger.error(f"✗ Failed to update profile: {response.status_code}")
            logger.error(f"Response: {response.text}")
            logger.info(f"=" * 50)

            error_data = {}
            try:
                error_data = response.json()
            except Exception:
                error_data = {"detail": response.text}

            error_message = "Failed to update profile"
            if isinstance(error_data, dict):
                if _is_username_conflict_error(error_data, response.text):
                    return jsonify(
                        {
                            "message": _username_conflict_message(),
                            "error": error_data,
                            "code": "username_taken",
                            "field": "username",
                            "status": 409,
                        }
                    ), 409
                error_message = (
                    error_data.get("message")
                    or error_data.get("detail")
                    or error_data.get("hint")
                    or str(error_data.get("errors", error_data))
                )

            return jsonify(
                {
                    "message": error_message,
                    "error": error_data,
                    "status": response.status_code,
                }
            ), response.status_code

    except Exception as e:
        logger.error(f"✗ Exception in update_user_profile: {str(e)}", exc_info=True)
        logger.info(f"=" * 50)
        return jsonify(
            {"error": str(e), "message": "Internal server error during profile update"}
        ), 500


def register_profile_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in (
        "supabase_request",
        "_check_username_availability",
        "_normalize_username_value",
        "_is_username_blocked",
        "_username_blocked_message",
        "_username_conflict_message",
        "_normalize_phone_number",
        "_msg91_handles_phone",
        "_msg91_pending_verification",
        "_issue_phone_verification",
        "_phone_verification_response",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(profile_bp)
