# flask-react-supabase-app/backend/routes/dealer/admin_oversight.py
"""Admin-side oversight endpoints — only callable by is_admin=true users.

  GET    /api/admin/dealerships
  GET    /api/admin/dealerships/<id>
  POST   /api/admin/dealerships/<id>/suspend
  POST   /api/admin/dealerships/<id>/restore
  GET    /api/admin/dealer-audit-log
"""
import os
from functools import wraps
from datetime import datetime, timezone

import requests
from flask import Blueprint, g, jsonify, request

from ._decorators import _is_admin, _request_client_ip

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)
admin_oversight_bp = Blueprint("dealer_admin_oversight", __name__, url_prefix="/api/admin")


def _token_required(fn):
    """Late-binding shim so app.py imports cleanly before routes register."""
    from app import token_required
    return token_required(fn)


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


def admin_only(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        from flask import request
        user_id = getattr(request, "user_id", None)
        if not _is_admin(user_id):
            return jsonify({"error": {"code": "admin_required"}}), 403
        return fn(*args, **kwargs)
    return wrapper


@admin_oversight_bp.route("/dealerships", methods=["GET"])
@_token_required
@admin_only
def list_dealerships(current_user):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers=_svc(),
        params={"select": "*", "order": "created_at.desc", "limit": 500},
        timeout=15,
    )
    rows = r.json() if r.status_code == 200 else []
    return jsonify({"dealerships": rows})


@admin_oversight_bp.route("/dealerships/<dealership_id>", methods=["GET"])
@_token_required
@admin_only
def get_dealership(current_user, dealership_id):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers=_svc(),
        params={"select": "*,members:dealership_members(*,user:users!dealership_members_user_id_fkey("
                           "id,email,first_name,last_name,company_name,is_dealer,dealer_verified,dealer_verified_at))",
                "id": f"eq.{dealership_id}", "limit": 1}, timeout=15,
    )
    rows = r.json() if r.status_code == 200 else []
    if not rows:
        return jsonify({"error": {"code": "not_found"}}), 404
    return jsonify({"dealership": rows[0]})


@admin_oversight_bp.route("/dealerships/<dealership_id>/suspend", methods=["POST"])
@_token_required
@admin_only
def suspend(current_user, dealership_id):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers={**_svc(), "Content-Type": "application/json"},
        params={"id": f"eq.{dealership_id}"},
        json={"status": "suspended", "updated_at": datetime.now(timezone.utc).isoformat()},
        timeout=10,
    )
    # Audit
    requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
        headers={**_svc(), "Content-Type": "application/json"},
        json={
            "admin_user_id": current_user,
            "dealership_id": dealership_id,
            "http_method": "POST", "endpoint": request.path,
            "result_status": r.status_code,
            "user_agent": request.headers.get("User-Agent"),
            "ip_address": _request_client_ip(),
        }, timeout=5,
    )
    return jsonify({"ok": r.status_code in (200, 204)})


@admin_oversight_bp.route("/dealerships/<dealership_id>/restore", methods=["POST"])
@_token_required
@admin_only
def restore(current_user, dealership_id):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers={**_svc(), "Content-Type": "application/json"},
        params={"id": f"eq.{dealership_id}"},
        json={"status": "active", "updated_at": datetime.now(timezone.utc).isoformat()},
        timeout=10,
    )
    requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
        headers={**_svc(), "Content-Type": "application/json"},
        json={
            "admin_user_id": current_user,
            "dealership_id": dealership_id,
            "http_method": "POST", "endpoint": request.path,
            "result_status": r.status_code,
            "user_agent": request.headers.get("User-Agent"),
            "ip_address": _request_client_ip(),
        }, timeout=5,
    )
    return jsonify({"ok": r.status_code in (200, 204)})


@admin_oversight_bp.route("/dealer-audit-log", methods=["GET"])
@_token_required
@admin_only
def audit_log(current_user):
    dealership_id = request.args.get("dealership_id")
    params = {
        "select": "*,admin:users!admin_user_id(id,email,first_name),dealership:dealerships(id,name)",
        "order": "created_at.desc",
        "limit": 500,
    }
    if dealership_id:
        params["dealership_id"] = f"eq.{dealership_id}"
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
        headers=_svc(), params=params, timeout=15,
    )
    rows = r.json() if r.status_code == 200 else []
    return jsonify({"audit": rows})
