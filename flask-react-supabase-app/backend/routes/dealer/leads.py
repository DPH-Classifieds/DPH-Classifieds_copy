"""Dealer lead inbox + pipeline endpoints.

All endpoints scoped by g.dealer_ctx['dealership_id'] (provided by
@dealer_required). Pagination via ?limit (default 50, max 200)
and ?offset.
"""
import os
from datetime import datetime, timezone

import requests
from flask import Blueprint, g, jsonify, request

from ._decorators import dealer_required, role_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

leads_bp = Blueprint("dealer_leads", __name__, url_prefix="/api/dealer")


def _svc(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": prefer,
    }


def _token_required(fn):
    from app import token_required
    return token_required(fn)


ALLOWED_STATUS = {"new", "contacted", "quoted", "test_drive", "won", "lost"}
ALLOWED_LOST = {"price", "financing", "stock", "unreachable", "other"}
ALLOWED_SORT = {"recency": "last_event_at.desc", "oldest": "first_event_at.asc"}


@leads_bp.route("/leads", methods=["GET"])
@_token_required
@dealer_required
def list_leads(current_user):
    """Paginated, filtered lead list for the caller's dealership."""
    dealership_id = g.dealer_ctx["dealership_id"]

    limit = max(1, min(int(request.args.get("limit", 50)), 200))
    offset = max(0, int(request.args.get("offset", 0)))
    sort = request.args.get("sort", "recency")
    order = ALLOWED_SORT.get(sort, ALLOWED_SORT["recency"])

    params = {
        "select": "id,listing_type,listing_id,source,status,assigned_to,"
                  "first_event_at,last_event_at,event_count,contact_phone,contact_name,"
                  "sale_price,lost_reason,updated_at",
        "dealership_id": f"eq.{dealership_id}",
        "order": order,
        "limit": str(limit),
        "offset": str(offset),
    }
    status = request.args.get("status")
    if status and status in ALLOWED_STATUS:
        params["status"] = f"eq.{status}"
    assigned_to = request.args.get("assigned_to")
    if assigned_to:
        params["assigned_to"] = f"eq.{assigned_to}"
    source = request.args.get("source")
    if source:
        params["source"] = f"eq.{source}"
    listing_id = request.args.get("listing_id")
    if listing_id:
        params["listing_id"] = f"eq.{listing_id}"

    r = requests.get(f"{SUPABASE_URL}/rest/v1/dealer_leads",
                     headers=_svc(prefer="count=exact"),
                     params=params, timeout=15)
    if r.status_code != 200:
        return jsonify({"error": {"code": "fetch_failed", "message": r.text[:300]}}), 502

    content_range = r.headers.get("content-range", "")
    total = None
    if "/" in content_range:
        try:
            total = int(content_range.split("/")[-1])
        except ValueError:
            total = None

    return jsonify({"leads": r.json(), "limit": limit, "offset": offset, "total": total}), 200
