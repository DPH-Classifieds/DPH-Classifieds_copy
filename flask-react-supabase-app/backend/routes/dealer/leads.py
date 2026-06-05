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


LISTING_TABLES = {
    "car": ("cars", "id,expected_selling_price,make,make_year,car_model,user_id"),
    "bike": ("bikes", "id,expected_selling_price,make,make_year,bike_model,user_id"),
    "plate": ("license_plates", "id,price,code,number,city,user_id"),
    "part": ("car_parts", "id,price,name,part_name,category,user_id"),
}


def _listing_title(lt, row):
    if lt == "car":
        bits = [row.get("make_year"), row.get("make"), row.get("car_model")]
        return " ".join(str(b) for b in bits if b) or str(row.get("id", ""))
    if lt == "bike":
        bits = [row.get("make_year"), row.get("make"), row.get("bike_model")]
        return " ".join(str(b) for b in bits if b) or str(row.get("id", ""))
    if lt == "plate":
        return f"{row.get('code', '') or ''} {row.get('number', '') or ''}".strip() or str(row.get("id", ""))
    if lt == "part":
        return row.get("part_name") or row.get("name") or str(row.get("id", ""))
    return str(row.get("id", ""))


@leads_bp.route("/leads/<lead_id>", methods=["GET"])
@_token_required
@dealer_required
def get_lead(current_user, lead_id):
    """Detail view: lead + timeline + minimal listing card + visitor session."""
    dealership_id = g.dealer_ctx["dealership_id"]

    lead_r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_leads",
        headers=_svc(prefer=""),
        params={
            "select": "*",
            "id": f"eq.{lead_id}",
            "dealership_id": f"eq.{dealership_id}",
            "limit": 1,
        },
        timeout=10,
    )
    if lead_r.status_code != 200 or not lead_r.json():
        return jsonify({"error": {"code": "not_found", "message": "Lead not found"}}), 404
    lead = lead_r.json()[0]

    # Timeline
    tl_r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_lead_events",
        headers=_svc(prefer=""),
        params={
            "select": "id,actor_user_id,kind,payload,created_at",
            "lead_id": f"eq.{lead_id}",
            "order": "created_at.asc",
            "limit": 200,
        },
        timeout=10,
    )
    timeline = tl_r.json() if tl_r.status_code == 200 else []

    # Listing card
    listing_card = None
    table_select = LISTING_TABLES.get(lead["listing_type"])
    if table_select:
        table, select = table_select
        lr = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_svc(prefer=""),
            params={"select": select, "id": f"eq.{lead['listing_id']}", "limit": 1},
            timeout=10,
        )
        if lr.status_code == 200 and lr.json():
            row = lr.json()[0]
            listing_card = {
                "id": row["id"],
                "title": _listing_title(lead["listing_type"], row),
                "price": row.get("expected_selling_price") or row.get("price"),
                "type": lead["listing_type"],
            }

    # Visitor session — same visitor's platform_events from first_event_at onwards.
    session_events = []
    if lead.get("visitor_id"):
        first_iso = lead["first_event_at"]
        sess_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/platform_events",
            headers=_svc(prefer=""),
            params={
                "select": "id,event_name,page_path,page_title,page_kind,created_at,metadata",
                "visitor_id": f"eq.{lead['visitor_id']}",
                "created_at": f"gte.{first_iso}",
                "order": "created_at.asc",
                "limit": 100,
            },
            timeout=15,
        )
        session_events = sess_r.json() if sess_r.status_code == 200 else []

    return jsonify({
        "lead": lead,
        "timeline": timeline,
        "listing": listing_card,
        "session": session_events,
    }), 200
