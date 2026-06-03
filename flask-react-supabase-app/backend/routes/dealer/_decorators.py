"""Dealer-panel auth decorator.

Resolves caller -> effective dealership_id by either:
  1) reading the active dealership_members row for the caller, OR
  2) (admin only) reading X-Acting-As-Dealership header / ?as= query param.

Attaches dict to flask.g.dealer_ctx: {dealership_id, role, actor_kind, admin_user_id?}.
"""
import hashlib
import json
import logging
import os
from functools import wraps

import requests
from flask import g, jsonify, request

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY", ""
)


def _service_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _get_current_user_id():
    """Returns the JWT-authenticated user id from flask.g (set by token_required).

    The existing app.py token_required decorator sets ``g.current_user`` or returns
    the user id. We accept either via flask.g lookup; callers stack token_required
    above dealer_required.
    """
    return getattr(g, "current_user", None) or getattr(g, "user_id", None)


def _lookup_membership(user_id):
    if not user_id:
        return None
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealership_members",
            headers=_service_headers(),
            params={
                "select": "dealership_id,role,status",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "limit": 1,
            },
            timeout=10,
        )
        if r.status_code != 200:
            return None
        rows = r.json()
        return rows[0] if rows else None
    except Exception as exc:
        logger.error("membership lookup failed: %s", exc)
        return None


def _is_admin(user_id):
    if not user_id:
        return False
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/users",
            headers=_service_headers(),
            params={"select": "is_admin,is_super_admin", "id": f"eq.{user_id}", "limit": 1},
            timeout=10,
        )
        if r.status_code != 200:
            return False
        rows = r.json()
        if not rows:
            return False
        return bool(rows[0].get("is_admin")) or bool(rows[0].get("is_super_admin"))
    except Exception as exc:
        logger.error("admin lookup failed: %s", exc)
        return False


def _audit_write(*, admin_user_id, dealership_id, method, endpoint, payload, status_code):
    """Append an audit row when an admin performs a write while acting-as."""
    try:
        digest = None
        if payload is not None:
            body = payload if isinstance(payload, (str, bytes)) else json.dumps(payload, default=str)
            if isinstance(body, str):
                body = body.encode("utf-8")
            digest = hashlib.sha256(body).hexdigest()

        requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
            headers=_service_headers(),
            json={
                "admin_user_id": admin_user_id,
                "dealership_id": dealership_id,
                "http_method": method,
                "endpoint": endpoint,
                "payload_digest": digest,
                "result_status": status_code,
                "user_agent": request.headers.get("User-Agent"),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            },
            timeout=10,
        )
    except Exception as exc:
        logger.error("audit insert failed: %s", exc)


def dealer_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user_id = _get_current_user_id()
        membership = _lookup_membership(user_id)

        if membership:
            g.dealer_ctx = {
                "dealership_id": membership["dealership_id"],
                "role": membership["role"],
                "actor_kind": "member",
            }
            return fn(*args, **kwargs)

        if _is_admin(user_id):
            acting_as = (
                request.headers.get("X-Acting-As-Dealership")
                or request.args.get("as")
            )
            if not acting_as:
                return jsonify({"error": {"code": "acting_as_required",
                                          "message": "X-Acting-As-Dealership header or ?as= query param is required for admins"}}), 400
            g.dealer_ctx = {
                "dealership_id": acting_as,
                "role": "owner",
                "actor_kind": "admin",
                "admin_user_id": user_id,
            }
            response = fn(*args, **kwargs)
            if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                try:
                    body = request.get_json(silent=True)
                except Exception:
                    body = None
                status = response[1] if isinstance(response, tuple) else 200
                _audit_write(
                    admin_user_id=user_id,
                    dealership_id=acting_as,
                    method=request.method,
                    endpoint=request.path,
                    payload=body,
                    status_code=status,
                )
            return response

        return jsonify({"error": {"code": "not_a_dealer",
                                  "message": "You are not a member of any dealership."}}), 403

    return wrapper


def role_required(*allowed_roles):
    """Decorator to restrict to specific roles. Stack BELOW dealer_required.

    Admins (actor_kind='admin') bypass — they're already owner-equivalent.
    """
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            ctx = getattr(g, "dealer_ctx", None) or {}
            if ctx.get("actor_kind") == "admin":
                return fn(*args, **kwargs)
            if ctx.get("role") not in allowed_roles:
                return jsonify({"error": {"code": "insufficient_role",
                                          "message": f"Requires one of {allowed_roles}"}}), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco
