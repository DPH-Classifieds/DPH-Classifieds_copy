"""HTTP routes for phone verification.

The compatibility root owns the phone verification helpers, persistence,
provider integrations, and rate limits.  These handlers resolve those live
dependencies through Flask's runtime registry so the module remains
independent from ``app.py`` while preserving the legacy endpoint names.
"""

import re

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve compatibility-root helpers at request time for patchability."""
    return _BACKEND


def start_phone_verification():
    """Start or resend a phone verification for the authenticated user."""
    backend = _backend()
    current_user = backend._get_optional_user_id_from_auth_header()
    client_ip = backend._request_client_ip()
    user_agent = request.headers.get("User-Agent", "")

    if backend._auth_rate_limited(client_ip):
        return jsonify(
            {"message": "Too many verification attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    purpose = str(data.get("purpose") or "vin_reveal").strip()
    listing_id = data.get("listing_id")
    verification_id = data.get("verification_id")
    phone = data.get("phone")
    country_code = data.get("country_code")
    verification_record = None

    if purpose not in backend.PHONE_VERIFICATION_PURPOSES:
        return jsonify({"message": "Invalid verification purpose"}), 400

    if verification_id:
        verification_record = backend._lookup_phone_verification(
            verification_id=verification_id,
        )
        if not verification_record:
            return jsonify({"message": "Verification record not found"}), 404
        if current_user and verification_record.get("user_id") != current_user:
            backend.logger.info(
                "Stale verification_id %s for user %s (owner %s). Issuing a fresh verification.",
                verification_id,
                current_user,
                verification_record.get("user_id"),
            )
            verification_id = None
            verification_record = None
        elif not current_user:
            return jsonify({"message": "Authentication required"}), 401

    if verification_record:
        try:
            refreshed = backend._resend_phone_verification(verification_record)
            return jsonify(
                {
                    "message": "Verification code resent",
                    "phone_verification": backend._phone_verification_response(
                        refreshed["verification"]
                    ),
                }
            ), 200
        except ValueError as resend_err:
            return jsonify({"message": str(resend_err)}), 400
        except Exception as resend_err:
            backend.logger.error(
                f"Failed to resend verification: {resend_err}", exc_info=True
            )
            return jsonify({"message": "Failed to resend verification code"}), 500

    if not current_user:
        return jsonify({"message": "Authentication required"}), 401

    profile = backend._get_user_profile_for_verification(current_user) or {}
    if purpose == "signup" and not bool(profile.get("email_verified")):
        return jsonify(
            {
                "message": "Please verify your email first before phone verification.",
                "email_verification_required": True,
            }
        ), 403

    if purpose in ("vin_reveal", "profile_verify") and profile.get("phone_verified"):
        return jsonify(
            {
                "message": "Phone already verified",
                "already_verified": True,
                "phone_verification": None,
            }
        ), 200

    verification_phone = backend._normalize_phone_number(
        phone or profile.get("phone"),
        country_code or profile.get("country_code"),
    )
    if not verification_phone:
        return jsonify({"message": "A valid phone number is required"}), 400

    if backend._msg91_handles_phone(
        verification_phone, country_code or profile.get("country_code")
    ):
        phone_key = re.sub(r"[^\d]", "", verification_phone)
        if backend._redis_fixed_window_rate_limited(
            "otp_send_phone",
            phone_key,
            backend.OTP_SEND_RATE_LIMIT_WINDOW_SEC,
            backend.OTP_SEND_RATE_LIMIT_MAX,
        ):
            return jsonify(
                {
                    "message": "Too many verification codes requested for this number. Please wait a few minutes and try again."
                }
            ), 429
        # MSG91 owns send+verify client-side — return "required" with no id so the
        # widget performs the send; never touch Infobip for these numbers.
        return jsonify(
            {
                "message": "Verification handled by MSG91 widget",
                "phone_verification": backend._msg91_pending_verification(
                    verification_phone,
                    country_code or profile.get("country_code"),
                    purpose,
                    listing_id,
                ),
            }
        ), 200

    try:
        issued = backend._issue_phone_verification(
            user_id=current_user,
            phone=verification_phone,
            country_code=country_code or profile.get("country_code"),
            purpose=purpose,
            listing_id=listing_id,
            metadata={
                "source": data.get("source") or "frontend",
                "client_ip": client_ip,
                "user_agent": user_agent,
            },
        )
        return jsonify(
            {
                "message": "Verification code sent",
                "phone_verification": backend._phone_verification_response(
                    issued["verification"]
                ),
            }
        ), 200
    except ValueError as verification_err:
        return jsonify({"message": str(verification_err)}), 400
    except Exception as verification_err:
        backend.logger.error(
            f"Failed to start phone verification: {verification_err}",
            exc_info=True,
        )
        return jsonify({"message": "Failed to send verification code"}), 500


def verify_phone_verification():
    """Verify a code issued through the server-side SMS provider."""
    backend = _backend()
    current_user = backend._get_optional_user_id_from_auth_header()
    client_ip = backend._request_client_ip()
    user_agent = request.headers.get("User-Agent", "")

    if backend._auth_rate_limited(client_ip):
        return jsonify(
            {"message": "Too many verification attempts. Please try again later."}
        ), 429

    data = request.json or {}
    code = str(data.get("code") or "").strip()
    verification_id = data.get("verification_id")
    purpose = data.get("purpose")
    listing_id = data.get("listing_id")

    if not code:
        return jsonify({"message": "Verification code is required"}), 400

    verification_record = None
    if verification_id:
        verification_record = backend._lookup_phone_verification(
            verification_id=verification_id
        )
    elif current_user:
        verification_record = backend._lookup_phone_verification(
            user_id=current_user,
            purpose=purpose,
            listing_id=listing_id,
        )

    if not verification_record:
        return jsonify({"message": "Verification record not found"}), 404

    if current_user and verification_record.get("user_id") != current_user:
        return jsonify({"message": "You cannot verify this code"}), 403

    try:
        result = backend._finalize_phone_verification(
            verification_record,
            code,
            ip_address=client_ip,
            user_agent=user_agent,
        )
        return jsonify(
            {
                "message": "Phone verified successfully",
                "verification": result,
            }
        ), 200
    except ValueError as verification_err:
        status_code = 400
        error_message = str(verification_err)
        if "expired" in error_message.lower():
            status_code = 410
        elif "too many" in error_message.lower():
            status_code = 429
        return jsonify({"message": error_message}), status_code
    except Exception as verification_err:
        backend.logger.error(
            f"Failed to verify phone code: {verification_err}", exc_info=True
        )
        return jsonify({"message": "Failed to verify code"}), 500


def verify_phone_verification_token():
    """Verify the JWT returned by the MSG91 client-side widget."""
    backend = _backend()
    current_user = backend._get_optional_user_id_from_auth_header()
    client_ip = backend._request_client_ip()
    user_agent = request.headers.get("User-Agent", "")

    if backend._auth_rate_limited(client_ip):
        return jsonify(
            {"message": "Too many verification attempts. Please try again later."}
        ), 429
    if not current_user:
        return jsonify({"message": "Authentication required"}), 401

    data = request.get_json(silent=True) or {}
    access_token = str(
        data.get("access_token") or data.get("access-token") or ""
    ).strip()
    purpose = str(data.get("purpose") or "vin_reveal").strip()
    listing_id = data.get("listing_id")
    phone = data.get("phone")
    country_code = data.get("country_code")

    if purpose not in backend.PHONE_VERIFICATION_PURPOSES:
        return jsonify({"message": "Invalid verification purpose"}), 400
    if not access_token:
        return jsonify({"message": "Verification token is required"}), 400

    ok, msg91_body = backend._verify_msg91_access_token(access_token)
    if not ok:
        return jsonify(
            {"message": "Phone verification could not be confirmed. Please try again."}
        ), 400

    profile = backend._get_user_profile_for_verification(current_user) or {}
    verified_phone = backend._normalize_phone_number(
        phone or profile.get("phone"), country_code or profile.get("country_code")
    )
    # MSG91 may echo the verified identifier (country code, no '+'). If it does, it
    # must match the phone we're about to trust — stops a token minted for number A
    # from verifying number B on the account.
    msg91_identifier = backend._extract_msg91_identifier(msg91_body)
    if msg91_identifier:
        identifier_digits = re.sub(r"[^\d]", "", msg91_identifier)
        if verified_phone and identifier_digits != re.sub(r"[^\d]", "", verified_phone):
            backend.logger.warning(
                "MSG91 identifier %s does not match claimed phone %s",
                msg91_identifier,
                verified_phone,
            )
            return jsonify(
                {"message": "Verified number does not match your account phone."}
            ), 400
        if not verified_phone:
            verified_phone = backend._normalize_phone_number(identifier_digits, "+971")

    if not verified_phone:
        return jsonify({"message": "A valid phone number is required"}), 400
    if not backend._is_uae_phone(verified_phone):
        return jsonify(
            {"message": "Only UAE phone numbers are supported for OTP verification"}
        ), 400

    now = backend._utc_now()
    resolved_country = (
        country_code
        or backend._infer_country_code_from_phone(verified_phone)
        or "+971"
    )

    # Audit row so widget verifications sit alongside the SMS ones. Non-fatal:
    # the flags below are what actually gate the app, so a failed insert only logs.
    verification_id = None
    try:
        insert_response, insert_status = backend.supabase_request(
            "post",
            "/rest/v1/phone_verifications",
            data={
                "user_id": current_user,
                "phone": verified_phone,
                "purpose": purpose,
                "listing_id": listing_id,
                "status": "verified",
                "code_hash": "msg91_widget",
                "code_salt": "msg91_widget",
                "attempt_count": 1,
                "send_count": 1,
                "expires_at": backend._isoformat_utc(now),
                "verified_at": backend._isoformat_utc(now),
                "last_sent_at": backend._isoformat_utc(now),
                "verified_ip": client_ip,
                "verified_user_agent": user_agent,
                "last_error": None,
                "metadata": {"provider": "msg91_widget", "country_code": resolved_country},
                "updated_at": backend._isoformat_utc(now),
            },
            use_service_role=True,
        )
        if insert_status < 400:
            rec = (
                insert_response[0]
                if isinstance(insert_response, list) and insert_response
                else insert_response
            )
            verification_id = (rec or {}).get("id")
    except Exception as audit_err:
        backend.logger.error(f"Failed to write MSG91 verification audit row: {audit_err}")

    backend._sync_user_verification_flags(
        current_user,
        phone_verified=True,
        phone_verified_at=backend._isoformat_utc(now),
        phone=verified_phone,
        country_code=country_code,
    )
    try:
        backend._sync_phone_to_listings(current_user, verified_phone)
    except Exception as sync_err:
        backend.logger.error(
            f"Failed to sync phone to listings after MSG91 verification: {sync_err}"
        )

    return jsonify(
        {
            "message": "Phone verified successfully",
            "verification": {
                "verification_id": verification_id,
                "status": "verified",
                "phone": verified_phone,
                "purpose": purpose,
                "listing_id": listing_id,
                "verified_at": backend._isoformat_utc(now),
            },
        }
    ), 200


def register_phone_verification_routes(app: Flask) -> None:
    """Register the three legacy phone-verification POST endpoints."""
    app.add_url_rule(
        "/api/phone-verifications/start",
        endpoint="start_phone_verification",
        view_func=start_phone_verification,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/phone-verifications/verify",
        endpoint="verify_phone_verification",
        view_func=verify_phone_verification,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/phone-verifications/verify-token",
        endpoint="verify_phone_verification_token",
        view_func=verify_phone_verification_token,
        methods=["POST"],
    )
