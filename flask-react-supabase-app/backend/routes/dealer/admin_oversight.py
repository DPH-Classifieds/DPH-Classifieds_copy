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

from ._decorators import _is_admin

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)
admin_oversight_bp = Blueprint("dealer_admin_oversight", __name__, url_prefix="/api/admin")


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


def admin_only(fn):
    @wraps(fn)
    def wrapper(*a, **k):
        user_id = getattr(g, "current_user", None)
        if not _is_admin(user_id):
            return jsonify({"error": {"code": "admin_required"}}), 403
        return fn(*a, **k)
    return wrapper


@admin_oversight_bp.route("/dealerships", methods=["GET"])
def list_dealerships():
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers=_svc(),
            params={"select": "*", "order": "created_at.desc", "limit": 500},
            timeout=15,
        )
        rows = r.json() if r.status_code == 200 else []
        return jsonify({"dealerships": rows})

    return _inner()


@admin_oversight_bp.route("/dealerships/<dealership_id>", methods=["GET"])
def get_dealership(dealership_id):
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers=_svc(),
            params={"select": "*,members:dealership_members(*,user:users(id,email,first_name,last_name))",
                    "id": f"eq.{dealership_id}", "limit": 1}, timeout=15,
        )
        rows = r.json() if r.status_code == 200 else []
        if not rows:
            return jsonify({"error": {"code": "not_found"}}), 404
        return jsonify({"dealership": rows[0]})

    return _inner()


@admin_oversight_bp.route("/dealerships/<dealership_id>/suspend", methods=["POST"])
def suspend(dealership_id):
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
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
                "admin_user_id": getattr(g, "current_user", None),
                "dealership_id": dealership_id,
                "http_method": "POST", "endpoint": request.path,
                "result_status": r.status_code,
                "user_agent": request.headers.get("User-Agent"),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            }, timeout=5,
        )
        return jsonify({"ok": r.status_code in (200, 204)})

    return _inner()


@admin_oversight_bp.route("/dealerships/<dealership_id>/restore", methods=["POST"])
def restore(dealership_id):
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
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
                "admin_user_id": getattr(g, "current_user", None),
                "dealership_id": dealership_id,
                "http_method": "POST", "endpoint": request.path,
                "result_status": r.status_code,
                "user_agent": request.headers.get("User-Agent"),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            }, timeout=5,
        )
        return jsonify({"ok": r.status_code in (200, 204)})

    return _inner()


@admin_oversight_bp.route("/dealer-audit-log", methods=["GET"])
def audit_log():
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
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

    return _inner()
