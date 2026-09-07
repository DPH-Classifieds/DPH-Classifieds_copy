"""Session and account-recovery routes for the authentication API."""

import re
from functools import wraps
from urllib.parse import parse_qs

from flask import Blueprint, current_app, jsonify, make_response, request


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


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


@auth_bp.route("/logout", methods=["POST"])
@_token_required
def logout(current_user):
    backend = _backend()
    token = getattr(request, "supabase_token", None)
    provider_ok = False
    if token:
        try:
            provider_response = backend.requests.post(
                f"{backend.SUPABASE_URL}/auth/v1/logout",
                params={"scope": "global"},
                headers={
                    "apikey": backend.SUPABASE_KEY,
                    "Authorization": f"Bearer {token}",
                },
                timeout=10,
            )
            provider_ok = provider_response.status_code in (200, 204)
        except Exception:
            backend.logger.exception("Supabase global logout failed for user %s", current_user)

    revocation_ok = backend.revoke_user_sessions(current_user)
    status = 200 if provider_ok and revocation_ok else 502
    message = "Successfully logged out" if status == 200 else "Logout revocation incomplete"
    response = make_response(jsonify({"message": message}), status)
    response.set_cookie("access_token", "", expires=0)
    response.set_cookie("refresh_token", "", expires=0)
    return response


@auth_bp.route("/me", methods=["GET"])
@_token_required
def get_user_info(current_user):
    user_details = _backend()._get_user_details_with_admin_status(current_user)
    if user_details:
        return jsonify(user_details), 200
    return jsonify({"error": "Failed to retrieve user details or user not found"}), 404


@auth_bp.route("/refresh", methods=["POST"])
def refresh_token():
    backend = _backend()
    client_ip = backend._request_client_ip()
    if backend._auth_rate_limited(client_ip):
        backend.logger.warning("[Refresh Token] Rate limit exceeded")
        return jsonify(
            {"message": "Too many refresh attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    if not data or not data.get("refresh_token"):
        return jsonify({"message": "Missing refresh token"}), 400

    try:
        response = backend.requests.post(
            f"{backend.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
            headers={"apikey": backend.SUPABASE_KEY, "Content-Type": "application/json"},
            json={"refresh_token": data["refresh_token"]},
        )
        if response.status_code == 200:
            return jsonify(response.json()), 200
        error_data = response.json()
        return jsonify(
            {"message": error_data.get("error_description", "Token refresh failed")}
        ), response.status_code
    except Exception as exc:
        backend.logger.error("Token refresh error: %s", exc)
        return jsonify({"message": "An error occurred during token refresh"}), 500


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    backend = _backend()
    client_ip = backend._request_client_ip()
    if backend._auth_rate_limited(client_ip):
        backend.logger.warning("[Reset Password] Rate limit exceeded")
        return jsonify(
            {"message": "Too many password reset attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    if not data or not data.get("email"):
        return jsonify({"message": "Missing email"}), 400

    redirect_to = backend._get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirectTo"),
        fallback_path="/reset-password",
    )
    try:
        response = backend.requests.post(
            f"{backend.SUPABASE_URL}/auth/v1/recover",
            headers={"apikey": backend.SUPABASE_KEY, "Content-Type": "application/json"},
            json={"email": data["email"], "redirect_to": redirect_to},
        )
        if response.status_code == 200:
            return jsonify({"message": "Password reset email sent successfully"}), 200
        normalized_error = backend._format_auth_email_error(
            response.json(), "Failed to send password reset email"
        )
        return jsonify(normalized_error), response.status_code
    except Exception as exc:
        backend.logger.error("Password reset error: %s", exc)
        return jsonify({"message": "An error occurred during password reset"}), 500


@auth_bp.route("/resend-confirmation", methods=["POST"])
def resend_confirmation():
    backend = _backend()
    client_ip = backend._request_client_ip()
    if backend._auth_rate_limited(client_ip):
        backend.logger.warning("[Resend Confirmation] Rate limit exceeded")
        return jsonify(
            {"message": "Too many confirmation email attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    if not data or not data.get("email"):
        return jsonify({"message": "Missing email"}), 400

    redirect_to = backend._get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirectTo"),
        fallback_path="/auth/callback",
    )
    try:
        response = backend.requests.post(
            f"{backend.SUPABASE_URL}/auth/v1/resend",
            headers={"apikey": backend.SUPABASE_KEY, "Content-Type": "application/json"},
            json={"type": "signup", "email": data["email"], "redirect_to": redirect_to},
            timeout=10,
        )
        if response.status_code == 200:
            return jsonify({"message": "Confirmation email resent successfully"}), 200
        try:
            error_data = response.json()
        except Exception:
            return jsonify(
                {"message": "Failed to resend confirmation email", "details": response.text}
            ), response.status_code
        return jsonify(
            backend._format_auth_email_error(
                error_data, "Failed to resend confirmation email"
            )
        ), response.status_code
    except Exception as exc:
        backend.logger.error("Resend confirmation error: %s", exc)
        return jsonify(
            {"message": "An error occurred while resending confirmation email"}
        ), 500


@auth_bp.route("/update-email", methods=["POST"])
@_token_required
def update_user_email(current_user):
    backend = _backend()
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Missing request body"}), 400

    current_email = str(data.get("current_email") or "").strip().lower()
    new_email = str(data.get("new_email") or "").strip().lower()
    redirect_to = backend._get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirect_to"),
        fallback_path="/auth/callback",
    )
    if not current_email or not new_email:
        return jsonify({"error": "Both current_email and new_email are required"}), 400
    if current_email == new_email:
        return jsonify({"error": "New email is the same as the current email"}), 400

    email_pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$"
    if any(
        len(email) > 254 or not re.fullmatch(email_pattern, email)
        for email in (current_email, new_email)
    ):
        return jsonify({"error": "Enter valid email addresses"}), 400

    authenticated_email = str(
        (getattr(request, "user_data", {}) or {}).get("email") or ""
    ).strip().lower()
    if authenticated_email and current_email != authenticated_email:
        return jsonify({"error": "Current email does not match the signed-in user"}), 403

    service_role_key = str(backend.SUPABASE_SERVICE_ROLE_KEY or "").strip()
    if not service_role_key:
        return jsonify({"error": "Email update service is not configured"}), 503
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }
    try:
        update_resp = backend.requests.put(
            f"{backend.SUPABASE_URL}/auth/v1/admin/users/{current_user}",
            headers=headers,
            json={"email": new_email},
            timeout=10,
        )
        if update_resp.status_code not in (200, 204):
            return jsonify({"error": "Failed to update email. Please try again."}), 502

        db_resp = backend.requests.patch(
            f"{backend.SUPABASE_URL}/rest/v1/users?id=eq.{current_user}",
            headers=headers,
            json={"email": new_email, "email_verified": False},
            timeout=10,
        )
        if db_resp.status_code not in (200, 204):
            backend.logger.error("Email auth update succeeded but local user sync failed: %s", db_resp.status_code)
            return jsonify({"error": "Failed to synchronize email changes"}), 502

        resend_resp = backend.requests.post(
            f"{backend.SUPABASE_URL}/auth/v1/resend",
            headers={"apikey": backend.SUPABASE_KEY, "Content-Type": "application/json"},
            json={"type": "signup", "email": new_email, "redirect_to": redirect_to},
            timeout=10,
        )
        if resend_resp.status_code not in (200, 204):
            backend.logger.error("Email auth update succeeded but confirmation resend failed: %s", resend_resp.status_code)
            return jsonify({"error": "Email updated but confirmation could not be sent"}), 502
        return jsonify({"message": "Email updated successfully. Confirmation sent to new address."}), 200
    except Exception as exc:
        backend.logger.error("Update email error: %s", exc)
        return jsonify({"error": "Failed to update email. Please try again."}), 500


@auth_bp.route("/update-password", methods=["POST"])
def update_password():
    backend = _backend()
    data = request.get_json(silent=True) or {}
    if not data or not data.get("password"):
        return jsonify({"message": "Missing password"}), 400
    password_errors = backend._get_password_policy_errors(data["password"])
    if password_errors:
        return jsonify(
            {"message": "Password does not meet requirements", "details": password_errors}
        ), 400

    access_token = data.get("access_token")
    hash_token = data.get("hash")
    if not access_token and hash_token:
        try:
            parsed = parse_qs(hash_token, keep_blank_values=True)
            access_token = (parsed.get("access_token") or [None])[0]
        except Exception as exc:
            backend.logger.error("Failed to parse reset hash: %s", exc)
    if not access_token:
        return jsonify({"message": "Missing or invalid reset token"}), 400

    try:
        response = backend.requests.put(
            f"{backend.SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": backend.SUPABASE_KEY,
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
            json={"password": data["password"]},
        )
        if response.status_code != 200:
            error_data = response.json()
            return jsonify(
                {"message": error_data.get("error_description", "Failed to update password")}
            ), response.status_code

        user_id = (response.json() or {}).get("id")
        revocation_ok = backend.revoke_user_sessions(user_id)
        try:
            logout_response = backend.requests.post(
                f"{backend.SUPABASE_URL}/auth/v1/logout",
                params={"scope": "global"},
                headers={
                    "apikey": backend.SUPABASE_KEY,
                    "Authorization": f"Bearer {access_token}",
                },
                timeout=10,
            )
            provider_ok = logout_response.status_code in (200, 204)
        except Exception:
            provider_ok = False
            backend.logger.exception("Global logout failed after password update")
        if not revocation_ok or not provider_ok:
            return jsonify({"message": "Password updated, but session revocation was incomplete"}), 502
        return jsonify({"message": "Password updated successfully"}), 200
    except Exception as exc:
        backend.logger.error("Password update error: %s", exc)
        return jsonify({"message": "An error occurred during password update"}), 500

