"""Public authentication routes for login, signup, and username checks."""

from flask import Blueprint


auth_public_bp = Blueprint("auth_public", __name__, url_prefix="/api/auth")


def _record_successful_login(user_id, client_ip):
    """Stamp last_login_at/ip. Both columns existed but nothing ever wrote
    them, so admin user pages showed every account as never logged in."""
    if not user_id:
        return
    from datetime import datetime, timezone

    try:
        supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{user_id}",
            data={
                "last_login_at": datetime.now(timezone.utc).isoformat(),
                "last_login_ip": client_ip or None,
            },
            use_service_role=True,
        )
    except Exception as exc:  # never block a valid login on telemetry
        logger.warning("[Login] Failed to record last_login for %s: %s", user_id, exc)


@auth_public_bp.route("/login", methods=["POST"])
def login():
    client_ip = _request_client_ip()
    if _auth_rate_limited(client_ip):
        logger.warning("[Login] Rate limit exceeded")
        return jsonify(
            {"message": "Too many login attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    identifier = str(data.get("email", "")).strip()  # email or username
    remember_me = bool(data.get("remember_me", False))
    logger.info("[Login] Authentication attempt")

    if not data or not identifier or not data.get("password"):
        logger.warning("[Login] Missing email/username or password in request.")
        return jsonify({"message": "Missing email/username or password"}), 400

    # Note: CAPTCHA is now handled by Supabase's built-in bot protection
    # No need to verify Turnstile token here

    password = data.get("password")
    remember_me = bool(data.get("remember_me", True))

    # Determine if the identifier is an email or username
    email = identifier
    if "@" not in identifier:
        # It's a username, find the corresponding email
        logger.info("[Login] Resolving username identifier")
        email = find_user_email_by_username(identifier)
        if not email:
            logger.warning("[Login] Username identifier was not found")
            return jsonify(
                {"message": "Invalid email or password. Please try again."}
            ), 401
        logger.info("[Login] Username identifier resolved")
        email_exists = True
    else:
        logger.info("[Login] Resolving email identifier")

    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    payload = {"email": email, "password": password}

    try:
        logger.info(f"[Login] Sending login request to Supabase auth: {url}")
        response = requests.post(url, headers=headers, json=payload, timeout=10)

        logger.info(f"[Login] Supabase auth response status: {response.status_code}")
        if response.status_code == 200:
            resp_data = response.json()
            supabase_user_info = resp_data.get("user")
            token = resp_data.get("access_token")
            logger.info(
                f"[Login] Supabase auth successful. Token received. Supabase user info: {supabase_user_info}"
            )

            if supabase_user_info and token:
                user_id = supabase_user_info.get("id")
                logger.info(f"[Login] Extracted user_id from Supabase auth: {user_id}")
                _record_successful_login(user_id, client_ip)
                user_details_for_session = _get_user_details_with_admin_status(user_id)
                logger.info(
                    f"[Login] Details from _get_user_details_with_admin_status: {user_details_for_session}"
                )

                if user_details_for_session:
                    resp_data["user"] = user_details_for_session

                    is_admin_flag = user_details_for_session.get("is_admin")
                    logger.info(
                        f"[Login] Checking 'is_admin' flag from user_details_for_session: {is_admin_flag} (Type: {type(is_admin_flag)})"
                    )

                    if is_admin_flag is True:
                        session["is_admin"] = True
                        session["admin_user_id"] = user_details_for_session.get("id")
                        logger.info(
                            f"[Login] !!! Admin session SET for user {user_details_for_session.get('id')}. Session data: {dict(session)}"
                        )
                    else:
                        session.pop("is_admin", None)
                        session.pop("admin_user_id", None)
                        logger.info(
                            f"[Login] Not an admin or is_admin flag is not True. User: {user_details_for_session.get('id')}. is_admin value: '{is_admin_flag}'. Session data: {dict(session)}"
                        )
                else:
                    logger.warning(
                        f"[Login] Could not fetch full user details for user ID {user_id} from _get_user_details_with_admin_status. Session not fully set."
                    )
                    resp_data["user"] = supabase_user_info

            # Set HttpOnly cookies for token storage
            response = make_response(jsonify(resp_data), 200)
            secure = os.getenv("FLASK_ENV") == "production"
            access_max_age = 3600 * 24 * 7 if remember_me else None
            refresh_max_age = 3600 * 24 * 30 if remember_me else None
            response.set_cookie(
                "access_token",
                token,
                httponly=True,
                secure=secure,
                samesite="Lax",
                max_age=access_max_age,
            )
            refresh_token = resp_data.get("refresh_token")
            if refresh_token:
                response.set_cookie(
                    "refresh_token",
                    refresh_token,
                    httponly=True,
                    secure=secure,
                    samesite="Lax",
                    max_age=refresh_max_age,
                )
            capture_posthog_event(
                "user_logged_in",
                user_id,
                {"login_method": "password", "remember_me": remember_me},
            )
            return response
        else:
            try:
                error_data = response.json()
            except Exception:
                logger.error(
                    "[Login] Supabase auth failed with non-JSON response: %s",
                    response.text,
                )
                return jsonify({"message": "Login failed. Please try again."}), 502
            error_msg = error_data.get("error_description", "Login failed")
            logger.error(
                f"[Login] Supabase auth failed: {error_msg}. Response: {error_data}"
            )
            lowered = str(error_msg).lower()
            if (
                "invalid login credentials" in lowered
                or "invalid credentials" in lowered
            ):
                return jsonify(
                    {"message": "Invalid email or password. Please try again."}
                ), 401
            return jsonify(
                {"message": f"{error_msg}. If needed, use Forgot Password."}
            ), response.status_code

    except Exception as e:
        logger.error(f"[Login] Exception during login: {str(e)}", exc_info=True)
        return jsonify({"message": "An error occurred during login"}), 500


@auth_public_bp.route("/beta-verify", methods=["POST"])
def beta_verify():
    if not BETA_PASSWORD:
        return jsonify({"success": True}), 200

    data = request.json
    if not data or not data.get("password"):
        return jsonify({"success": False}), 401

    if data.get("password") == BETA_PASSWORD:
        return jsonify({"success": True}), 200

    return jsonify({"success": False}), 401

@auth_public_bp.route("/check-username", methods=["GET"])
def check_username_availability():
    username = request.args.get("username", "")
    exclude_user_id = request.args.get("exclude_user_id") or None
    cache_key = _build_api_cache_key()
    cached = _api_cache_get(cache_key)
    if cached is not None:
        return _cached_json_response(
            cached,
            ttl_seconds=USERNAME_AVAILABILITY_CACHE_TTL_SECONDS,
        )

    result = _check_username_availability(username, exclude_user_id)
    status = 200
    if "status" in result and result["status"] >= 400:
        status = result["status"]
    if status < 400:
        _api_cache_set(
            cache_key,
            result,
            ttl_seconds=USERNAME_AVAILABILITY_CACHE_TTL_SECONDS,
        )
    return _cached_json_response(
        result, status, ttl_seconds=USERNAME_AVAILABILITY_CACHE_TTL_SECONDS
    )


@auth_public_bp.route("/signup", methods=["POST"])
def signup():
    client_ip = _request_client_ip()
    if _auth_rate_limited(client_ip):
        logger.warning("[Signup] Rate limit exceeded")
        return jsonify(
            {"message": "Too many signup attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    if not data or not data.get("email") or not data.get("password"):
        return jsonify({"message": "Missing email or password"}), 400

    # Note: CAPTCHA is now handled by Supabase's built-in bot protection
    # No need to verify Turnstile token here

    email = data.get("email")
    password = data.get("password")
    phone_raw = str(data.get("phone", "")).strip()
    phone_digits = re.sub(r"[^\d]", "", phone_raw)

    if not phone_digits:
        return jsonify({"message": "Phone number is required"}), 400
    if len(phone_digits) < 7 or len(phone_digits) > 15:
        return jsonify({"message": "Phone number must be between 7 and 15 digits"}), 400

    password_errors = _get_password_policy_errors(password)
    if password_errors:
        return jsonify(
            {
                "message": "Password does not meet requirements",
                "details": password_errors,
            }
        ), 400

    # Validate dealer-specific fields when isDealer is true. The form will
    # collect TRN + legal business name + trade license file; the file is
    # uploaded in a second request after this one returns a session token.
    is_dealer_signup = bool(data.get("isDealer"))
    trn_raw = (data.get("trn") or "").strip()
    legal_business_name = (data.get("legalBusinessName") or "").strip()

    if is_dealer_signup:
        if not legal_business_name or len(legal_business_name) < 3:
            return jsonify({
                "message": "Legal business name is required",
                "code": "legal_business_name_required",
                "field": "legalBusinessName",
            }), 400
        trn_digits = re.sub(r"[^\d]", "", trn_raw)
        if len(trn_digits) != 15:
            return jsonify({
                "message": "TRN must be exactly 15 digits",
                "code": "trn_invalid_format",
                "field": "trn",
            }), 400
        # Uniqueness check before we create the auth user.
        existing, exists_status = supabase_request(
            "get",
            f"/rest/v1/users?select=id&trn=eq.{trn_digits}&limit=1",
            use_service_role=True,
        )
        if exists_status < 400 and existing:
            return jsonify({
                "message": "This TRN is already registered with another account",
                "code": "trn_in_use",
                "field": "trn",
            }), 409
        trn_normalized = trn_digits
    else:
        trn_normalized = ""

    # Extract additional user metadata
    user_metadata = {
        "first_name": data.get("firstName", ""),
        "last_name": data.get("lastName", ""),
        "username": data.get("username", ""),
        "phone": phone_digits,
        "country_code": data.get("countryCode", "+971"),
        "city": data.get("city", ""),
        "area": data.get("area", ""),
        "emirate": data.get("emirate", ""),
        "is_dealer": is_dealer_signup,
        "company_name": data.get("companyName", ""),
        "company_registration_number": data.get("companyRegistrationNumber", ""),
        "legal_business_name": legal_business_name,
        "trn": trn_normalized,
        "trade_license_number": data.get("tradeLicenseNumber", ""),
        "display_name": data.get("displayName", ""),
        "email_notifications": data.get("emailNotifications", True),
        "sms_notifications": data.get("smsNotifications", True),
        "marketing_emails": data.get("marketingEmails", False),
    }
    if is_dealer_signup:
        user_metadata["dealer_application_status"] = "draft"

    # Remove empty strings so unique constraints (e.g., username) are not violated by blank values
    cleaned_metadata = {}
    for key, value in user_metadata.items():
        if isinstance(value, str) and value.strip() == "":
            continue
        cleaned_metadata[key] = value

    requested_username = _normalize_username_value(cleaned_metadata.get("username"))
    if not requested_username:
        return jsonify(
            {
                "message": "Username is required",
                "code": "username_required",
                "field": "username",
            }
        ), 400

    if _is_username_blocked(requested_username):
        return jsonify(
            {
                "message": _username_blocked_message(),
                "code": "username_blocked",
                "field": "username",
            }
        ), 409
    username_check = _check_username_availability(requested_username)
    if not username_check.get("available", False):
        return jsonify(
            {
                "message": username_check.get("message")
                or _username_conflict_message(),
                "code": "username_taken",
                "field": "username",
            }
        ), 409

    # Sign up with Supabase
    redirect_to = _get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirectTo") if data else None,
        fallback_path="/auth/callback",
    )
    url = f"{SUPABASE_URL}/auth/v1/signup?redirect_to={quote(redirect_to)}"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    payload = {
        "email": email,
        "password": password,
        "data": cleaned_metadata,  # This will be stored in raw_user_meta_data
        "redirect_to": redirect_to,
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)

        if response.status_code == 200:
            try:
                response_data = response.json()
            except Exception:
                logger.error(
                    f"Signup succeeded but response was not valid JSON: {response.text}",
                    exc_info=True,
                )
                return jsonify(
                    {"message": "Signup succeeded but response was invalid"}
                ), 502
            user_id = None
            try:
                user_id = (
                    response_data.get("user", {}).get("id")
                    or response_data.get("id")
                    or response_data.get("user_id")
                )
            except Exception:
                user_id = None

            response_data["phone_verification"] = None
            response_data["phone_verification_required"] = False
            response_data["email_verification_required"] = True
            response_data["next_step"] = (
                "Verify your email first. Phone verification will be available after email confirmation."
            )
            if user_id:
                capture_posthog_event(
                    "user_signed_up",
                    user_id,
                    {"account_type": "dealer" if is_dealer_signup else "individual"},
                )
            return jsonify(response_data), 200

        # Try to parse error details; fall back to raw text
        try:
            error_data = response.json()
        except Exception:
            logger.error(f"Signup failed with non-JSON response: {response.text}")
            return jsonify(
                {"message": "Signup failed", "details": response.text}
            ), response.status_code

        logger.error(f"Signup failed: {error_data}")
        if _is_username_conflict_error(error_data, response.text):
            return jsonify(
                {
                    "message": _username_conflict_message(),
                    "code": "username_taken",
                    "field": "username",
                }
            ), 409
        normalized_error = _format_auth_email_error(error_data, "Signup failed")
        return jsonify(normalized_error), response.status_code

    except Exception as e:
        logger.error(f"Signup error: {str(e)}", exc_info=True)
        return jsonify({"message": "An error occurred during signup"}), 500


def register_auth_public_routes(app, backend_symbols):
    """Install backend symbols after app.py has finished defining them."""
    globals().update(backend_symbols)
    # Keep commonly patched helpers live so existing contract tests and
    # operational overrides continue to target the compatibility root.
    for name in (
        "_auth_rate_limited",
        "_request_client_ip",
        "_check_username_availability",
        "_get_user_details_with_admin_status",
        "capture_posthog_event",
        "find_user_email_by_username",
        "supabase_request",
    ):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(auth_public_bp)
