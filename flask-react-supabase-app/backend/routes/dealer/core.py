"""Dealer core endpoints: identity, profile, members, invitations.

Routes accept ``current_user`` as the first positional argument because
that's what the project's ``token_required`` decorator (app.py:2587)
passes through.
"""
import os
import secrets
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, g, jsonify, request

from ._decorators import dealer_required, role_required, _is_admin, _lookup_membership

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

core_bp = Blueprint("dealer_core", __name__, url_prefix="/api/dealer")


def _svc_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }


def _logout_user_sessions(user_id):
    """Globally block target-user JWTs after membership revocation."""
    from app import revoke_user_sessions
    return revoke_user_sessions(user_id)


def _token_required(fn):
    """Late-binding shim so app.py imports cleanly before routes register."""
    from app import token_required
    return token_required(fn)


@core_bp.route("/me", methods=["GET"])
@_token_required
def me(current_user):
    """Probe-friendly dealer identity endpoint.

    Always returns 200 so the frontend can use it as a status check without
    polluting the console with expected 4xx errors for non-dealer users.
    Response shape:
      - dealer member: {is_dealer: true, dealership, role, actor_kind: "member"}
      - admin acting-as: {is_dealer: true, dealership, role: "owner", actor_kind: "admin"}
      - admin without acting-as: {is_dealer: false, reason: "acting_as_required", is_admin: true}
      - non-dealer: {is_dealer: false, reason: "not_a_dealer"}
    """
    membership = _lookup_membership(current_user)
    if membership:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers=_svc_headers(),
            params={"select": "*", "id": f"eq.{membership['dealership_id']}", "limit": 1},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return jsonify({"is_dealer": False, "reason": "dealership_not_found"}), 200
        return jsonify({
            "is_dealer": True,
            "dealership": r.json()[0],
            "role": membership["role"],
            "actor_kind": "member",
        }), 200

    if _is_admin(current_user):
        acting_as = (
            request.headers.get("X-Acting-As-Dealership")
            or request.args.get("as")
        )
        if not acting_as:
            return jsonify({
                "is_dealer": False,
                "is_admin": True,
                "reason": "acting_as_required",
            }), 200
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers=_svc_headers(),
            params={"select": "*", "id": f"eq.{acting_as}", "limit": 1},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return jsonify({
                "is_dealer": False,
                "is_admin": True,
                "reason": "dealership_not_found",
            }), 200
        return jsonify({
            "is_dealer": True,
            "dealership": r.json()[0],
            "role": "owner",
            "actor_kind": "admin",
        }), 200

    return jsonify({"is_dealer": False, "reason": "not_a_dealer"}), 200


@core_bp.route("/profile", methods=["PATCH"])
@_token_required
@dealer_required
@role_required("owner")
def update_profile(current_user):
    body = request.get_json(silent=True) or {}
    allowed = {"name", "legal_name", "trade_license_no", "emirate", "address",
               "phone", "whatsapp", "logo_url", "cover_url", "website", "bio"}
    update = {k: v for k, v in body.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers=_svc_headers(),
        params={"id": f"eq.{g.dealer_ctx['dealership_id']}"},
        json=update,
        timeout=10,
    )
    if r.status_code not in (200, 204):
        return jsonify({"error": {"code": "update_failed", "message": r.text}}), 500
    return jsonify({"ok": True, "dealership": r.json()[0] if r.json() else None})


@core_bp.route("/members", methods=["GET"])
@_token_required
@dealer_required
def list_members(current_user):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealership_members",
        headers=_svc_headers(),
        params={
            "select": "id,user_id,role,status,joined_at,invited_at,"
                      "user:users(id,email,first_name,last_name,username,profile_photo_url)",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
            "status": "in.(active,invited)",
            "order": "joined_at.asc",
        },
        timeout=10,
    )
    return jsonify({"members": r.json() if r.status_code == 200 else []})


@core_bp.route("/invitations", methods=["POST"])
@_token_required
@dealer_required
@role_required("owner")
def create_invitation(current_user):
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    role = body.get("role") or "sales_rep"
    if not email or "@" not in email:
        return jsonify({"error": {"code": "invalid_email"}}), 400
    if role not in {"manager", "sales_rep"}:
        return jsonify({"error": {"code": "invalid_role"}}), 400

    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        json={
            "dealership_id": g.dealer_ctx["dealership_id"],
            "email": email,
            "role": role,
            "token": token,
            "invited_by": current_user or g.dealer_ctx.get("admin_user_id"),
            "expires_at": expires,
        },
        timeout=10,
    )
    if r.status_code not in (200, 201):
        return jsonify({"error": {"code": "invite_failed", "message": r.text}}), 500
    return jsonify({"invitation": r.json()[0] if r.json() else None}), 201


@core_bp.route("/invitations/<invite_id>", methods=["DELETE"])
@_token_required
@dealer_required
@role_required("owner")
def revoke_invitation(current_user, invite_id):
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        params={
            "id": f"eq.{invite_id}",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
        },
        timeout=10,
    )
    return jsonify({"ok": r.status_code in (200, 204)})


@core_bp.route("/members/<member_id>", methods=["DELETE"])
@_token_required
@dealer_required
@role_required("owner")
def revoke_member(current_user, member_id):
    member_response = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealership_members",
        headers=_svc_headers(),
        params={
            "select": "id,user_id,status",
            "id": f"eq.{member_id}",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
            "limit": 1,
        },
        timeout=10,
    )
    members = member_response.json() if member_response.status_code == 200 else []
    if not members:
        return jsonify({"error": {"code": "member_not_found"}}), 404
    member = members[0]

    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealership_members",
        headers=_svc_headers(),
        params={
            "id": f"eq.{member_id}",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
        },
        json={"status": "revoked"},
        timeout=10,
    )
    if r.status_code not in (200, 204):
        return jsonify({"error": {"code": "member_revoke_failed"}}), 502
    if not _logout_user_sessions(member["user_id"]):
        return jsonify({
            "ok": False,
            "membership_revoked": True,
            "error": {"code": "session_invalidation_failed"},
        }), 502
    return jsonify({"ok": True})


@core_bp.route("/invitations/accept", methods=["POST"])
@_token_required
def accept_invitation(current_user):
    body = request.get_json(silent=True) or {}
    token = body.get("token")
    if not token or not current_user:
        return jsonify({"error": {"code": "missing_token"}}), 400

    inv = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        params={"select": "*", "token": f"eq.{token}", "limit": 1},
        timeout=10,
    )
    if inv.status_code != 200 or not inv.json():
        return jsonify({"error": {"code": "invitation_not_found"}}), 404

    invitation = inv.json()[0]
    if invitation.get("accepted_at"):
        return jsonify({"error": {"code": "already_accepted"}}), 409
    if invitation["expires_at"] < datetime.now(timezone.utc).isoformat():
        return jsonify({"error": {"code": "expired"}}), 410

    m = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealership_members",
        headers=_svc_headers(),
        json={
            "dealership_id": invitation["dealership_id"],
            "user_id": current_user,
            "role": invitation["role"],
            "status": "active",
            "invited_by": invitation["invited_by"],
            "invited_at": invitation["created_at"],
            "joined_at": datetime.now(timezone.utc).isoformat(),
        },
        timeout=10,
    )
    if m.status_code not in (200, 201):
        return jsonify({"error": {"code": "join_failed", "message": m.text}}), 409

    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        params={"id": f"eq.{invitation['id']}"},
        json={"accepted_at": datetime.now(timezone.utc).isoformat()},
        timeout=10,
    )
    return jsonify({"ok": True, "dealership_id": invitation["dealership_id"]})
