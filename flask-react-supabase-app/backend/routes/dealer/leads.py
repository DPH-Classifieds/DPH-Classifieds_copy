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


def _emit_event(lead_id, actor_user_id, kind, payload):
    requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_lead_events",
        headers=_svc(prefer="return=minimal"),
        json={"lead_id": lead_id, "actor_user_id": actor_user_id,
              "kind": kind, "payload": payload},
        timeout=10,
    )


@leads_bp.route("/leads/<lead_id>", methods=["PATCH"])
@_token_required
@dealer_required
def update_lead(current_user, lead_id):
    """Update status, assignee, notes, sale_price, lost_reason.

    Role gating:
      - owner / manager / admin: any field on any lead in the dealership.
      - sales_rep: status / notes only, and ONLY on leads assigned to them.
    """
    dealership_id = g.dealer_ctx["dealership_id"]
    role = g.dealer_ctx["role"]
    actor_kind = g.dealer_ctx.get("actor_kind")
    body = request.get_json(silent=True) or {}

    cur_r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_leads",
        headers=_svc(prefer=""),
        params={"select": "id,status,assigned_to",
                "id": f"eq.{lead_id}",
                "dealership_id": f"eq.{dealership_id}",
                "limit": 1},
        timeout=10,
    )
    if cur_r.status_code != 200 or not cur_r.json():
        return jsonify({"error": {"code": "not_found"}}), 404
    current = cur_r.json()[0]

    # sales_rep gating
    if actor_kind != "admin" and role == "sales_rep":
        if current.get("assigned_to") != current_user:
            return jsonify({"error": {"code": "forbidden",
                                      "message": "Sales reps can only update their own leads."}}), 403
        body = {k: v for k, v in body.items() if k in ("status", "notes")}

    update = {}
    if "status" in body:
        if body["status"] not in ALLOWED_STATUS:
            return jsonify({"error": {"code": "invalid_status"}}), 400
        update["status"] = body["status"]
    if "assigned_to" in body:
        update["assigned_to"] = body["assigned_to"]
    if "notes" in body:
        update["notes"] = body["notes"]
    if "sale_price" in body:
        try:
            update["sale_price"] = float(body["sale_price"]) if body["sale_price"] is not None else None
        except (TypeError, ValueError):
            return jsonify({"error": {"code": "invalid_sale_price"}}), 400
    if "lost_reason" in body:
        if body["lost_reason"] is not None and body["lost_reason"] not in ALLOWED_LOST:
            return jsonify({"error": {"code": "invalid_lost_reason"}}), 400
        update["lost_reason"] = body["lost_reason"]

    if not update:
        return jsonify({"error": {"code": "no_fields"}}), 400

    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    pr = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_leads?id=eq.{lead_id}",
        headers=_svc(),
        json=update,
        timeout=10,
    )
    if pr.status_code not in (200, 204):
        return jsonify({"error": {"code": "update_failed", "message": pr.text[:300]}}), 502

    # Emit timeline events for meaningful changes.
    if "status" in update and update["status"] != current.get("status"):
        _emit_event(lead_id, current_user, "status_change",
                    {"from": current.get("status"), "to": update["status"]})
    if "assigned_to" in update and update["assigned_to"] != current.get("assigned_to"):
        _emit_event(lead_id, current_user, "assignment",
                    {"from": current.get("assigned_to"), "to": update["assigned_to"]})
        _email_assignment(lead_id, update["assigned_to"], dealership_id)

    new_row = pr.json()[0] if isinstance(pr.json(), list) and pr.json() else None
    return jsonify({"lead": new_row}), 200


@leads_bp.route("/leads/<lead_id>/note", methods=["POST"])
@_token_required
@dealer_required
def add_lead_note(current_user, lead_id):
    """Append a free-text note to a lead's timeline."""
    dealership_id = g.dealer_ctx["dealership_id"]
    body = (request.get_json(silent=True) or {}).get("body", "").strip()
    if not body:
        return jsonify({"error": {"code": "empty_note"}}), 400

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_leads",
        headers=_svc(prefer=""),
        params={"select": "id", "id": f"eq.{lead_id}",
                "dealership_id": f"eq.{dealership_id}", "limit": 1},
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return jsonify({"error": {"code": "not_found"}}), 404

    ir = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_lead_events",
        headers=_svc(),
        json={"lead_id": lead_id, "actor_user_id": current_user,
              "kind": "note", "payload": {"body": body}},
        timeout=10,
    )
    if ir.status_code not in (200, 201):
        return jsonify({"error": {"code": "insert_failed", "message": ir.text[:300]}}), 502
    return jsonify({"event": ir.json()[0] if ir.json() else None}), 201


def _email_assignment(lead_id, assignee_user_id, dealership_id):
    """Best-effort email to the assignee. Swallows any error so it never
    blocks the PATCH response."""
    if not assignee_user_id:
        return
    try:
        u = requests.get(f"{SUPABASE_URL}/rest/v1/users",
                         headers=_svc(prefer=""),
                         params={"select": "email,first_name",
                                 "id": f"eq.{assignee_user_id}", "limit": 1},
                         timeout=8).json()
        if not u:
            return
        d = requests.get(f"{SUPABASE_URL}/rest/v1/dealerships",
                         headers=_svc(prefer=""),
                         params={"select": "name", "id": f"eq.{dealership_id}", "limit": 1},
                         timeout=8).json()
        dealership_name = d[0]["name"] if d else "your dealership"
        site_url = os.getenv("SITE_URL", "").rstrip("/")
        link = f"{site_url}/dealer/leads/{lead_id}" if site_url else f"/dealer/leads/{lead_id}"

        # Real signature: _send_email(to_address, subject, html_body)
        from app import _send_email
        _send_email(
            u[0]["email"],
            f"New lead assigned to you — {dealership_name}",
            (
                f"<p>Hi {u[0].get('first_name') or ''},</p>"
                f"<p>A lead has been assigned to you in <strong>{dealership_name}</strong>.</p>"
                f"<p><a href=\"{link}\">Open the lead</a></p>"
            ),
        )
    except Exception:
        pass
