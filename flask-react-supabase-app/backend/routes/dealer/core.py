"""Dealer core endpoints: identity, profile, members, invitations."""
import os
import secrets
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, g, jsonify, request

from ._decorators import dealer_required, role_required

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


def _token_required():
    from app import token_required
    return token_required


@core_bp.route("/me", methods=["GET"])
def me():
    @_token_required()
    @dealer_required
    def _inner():
        ctx = g.dealer_ctx
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers=_svc_headers(),
            params={"select": "*", "id": f"eq.{ctx['dealership_id']}", "limit": 1},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return jsonify({"error": {"code": "dealership_not_found", "message": "Dealership not found"}}), 404
        dealership = r.json()[0]
        return jsonify({
            "dealership": dealership,
            "role": ctx["role"],
            "actor_kind": ctx["actor_kind"],
        })
    return _inner()


@core_bp.route("/profile", methods=["PATCH"])
def update_profile():
    @_token_required()
    @dealer_required
    @role_required("owner")
    def _inner():
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
    return _inner()


@core_bp.route("/members", methods=["GET"])
def list_members():
    @_token_required()
    @dealer_required
    def _inner():
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
    return _inner()


@core_bp.route("/invitations", methods=["POST"])
def create_invitation():
    @_token_required()
    @dealer_required
    @role_required("owner")
    def _inner():
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
                "invited_by": getattr(g, "current_user", None) or g.dealer_ctx.get("admin_user_id"),
                "expires_at": expires,
            },
            timeout=10,
        )
        if r.status_code not in (200, 201):
            return jsonify({"error": {"code": "invite_failed", "message": r.text}}), 500
        return jsonify({"invitation": r.json()[0] if r.json() else None}), 201
    return _inner()


@core_bp.route("/invitations/<invite_id>", methods=["DELETE"])
def revoke_invitation(invite_id):
    @_token_required()
    @dealer_required
    @role_required("owner")
    def _inner():
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
    return _inner()


@core_bp.route("/members/<member_id>", methods=["DELETE"])
def revoke_member(member_id):
    @_token_required()
    @dealer_required
    @role_required("owner")
    def _inner():
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
        return jsonify({"ok": r.status_code in (200, 204)})
    return _inner()


@core_bp.route("/invitations/accept", methods=["POST"])
def accept_invitation():
    @_token_required()
    def _inner():
        body = request.get_json(silent=True) or {}
        token = body.get("token")
        user_id = getattr(g, "current_user", None)
        if not token or not user_id:
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
                "user_id": user_id,
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
    return _inner()
