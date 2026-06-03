# flask-react-supabase-app/backend/routes/dealer/analytics.py
"""Dealer dashboard analytics endpoints.

All endpoints scoped by g.dealer_ctx['dealership_id'].
Windowed by ?window= 7|30|90 days; default 30.

Endpoints:
  GET /api/dealer/analytics/kpis            -> 6 KPI tiles
  GET /api/dealer/analytics/trends          -> daily impressions, daily leads, leads-by-source
  GET /api/dealer/analytics/funnel          -> impressions -> details -> leads -> won
  GET /api/dealer/analytics/top-performers  -> top 5 by impressions, top 5 by lead conv
  GET /api/dealer/analytics/underperformers -> 5 worst impressions/day, 5 with views-but-no-leads
  GET /api/dealer/listings                  -> dealer's listings list (paginated)
  GET /api/dealer/listings/<id>/analytics   -> per-listing KPIs + time series
"""
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, g, jsonify, request

from services.dealer_kpi import dedupe_impressions, dedupe_leads
from ._decorators import dealer_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

analytics_bp = Blueprint("dealer_analytics", __name__, url_prefix="/api/dealer")


def _svc():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Accept": "application/json",
    }


def _window():
    days = request.args.get("window", "30")
    try:
        n = max(1, min(365, int(days)))
    except ValueError:
        n = 30
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=n)
    prev_start = start - timedelta(days=n)
    return start, end, prev_start, n


def _listing_ids_for_dealership(dealership_id):
    """Return dict of listing_type -> set of listing_ids owned by the dealership."""
    out = {"car": set(), "bike": set(), "plate": set(), "part": set()}
    for table, kind in (("cars", "car"), ("bikes", "bike"), ("license_plates", "plate"), ("car_parts", "part")):
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_svc(),
            params={"select": "id,status", "dealership_id": f"eq.{dealership_id}", "limit": 5000},
            timeout=15,
        )
        if r.status_code == 200:
            for row in r.json():
                out[kind].add(str(row["id"]))
    return out


def _fetch_platform_events(dealership_id, start, end, page_kind=None):
    """Fetch platform_events for this dealership's listings in window."""
    listings = _listing_ids_for_dealership(dealership_id)
    events = []
    for kind, ids in listings.items():
        if not ids:
            continue
        # Supabase REST: filter by listing_type + listing_id in (...).
        # PostgREST `in.()` has length limits, chunk.
        ids_list = list(ids)
        for i in range(0, len(ids_list), 200):
            chunk = ids_list[i:i + 200]
            params = {
                "select": "visitor_id,listing_id,listing_type,event_name,page_kind,created_at,metadata",
                "listing_type": f"eq.{kind}",
                "listing_id": f"in.({','.join(chunk)})",
                "created_at": f"gte.{start.isoformat()}",
                "limit": 50000,
            }
            if page_kind:
                params["page_kind"] = f"eq.{page_kind}"
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/platform_events",
                headers=_svc(), params=params, timeout=30,
            )
            if r.status_code == 200:
                events.extend(r.json())
    return events


def _fetch_lead_events(dealership_id, start, end):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/lead_events",
        headers=_svc(),
        params={
            "select": "visitor_id,listing_id,listing_type,action,created_at",
            "dealership_id": f"eq.{dealership_id}",
            "created_at": f"gte.{start.isoformat()}",
            "limit": 50000,
        },
        timeout=20,
    )
    return r.json() if r.status_code == 200 else []


@analytics_bp.route("/analytics/kpis", methods=["GET"])
def kpis():
    # Inline token_required avoiding import cycles.
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, prev_start, n = _window()

        # Active listings count (point-in-time).
        listings = _listing_ids_for_dealership(dealership_id)
        active_count = 0
        for table in ("cars", "bikes", "license_plates", "car_parts"):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": "count=exact"},
                params={"select": "id", "dealership_id": f"eq.{dealership_id}",
                        "status": "eq.active", "limit": 1},
                timeout=15,
            )
            cr = r.headers.get("Content-Range", "")
            if "/" in cr:
                try:
                    active_count += int(cr.split("/")[-1])
                except ValueError:
                    pass

        # Current window events.
        impressions_events = _fetch_platform_events(dealership_id, start, end)
        detail_events = [e for e in impressions_events if e.get("page_kind") == "listing_detail"]
        lead_events = _fetch_lead_events(dealership_id, start, end)

        impressions = dedupe_impressions(impressions_events)
        detail_views = dedupe_impressions(detail_events)
        leads = dedupe_leads(lead_events)
        conv = (leads / detail_views * 100) if detail_views else 0.0

        # Sold-on-platform count: cars + bikes + plates + parts with sold_status='sold_on_dph' set in window.
        sold = 0
        for table in ("cars", "bikes", "license_plates", "car_parts"):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": "count=exact"},
                params={
                    "select": "id",
                    "dealership_id": f"eq.{dealership_id}",
                    "sold_status": "eq.sold_on_dph",
                    "sold_status_set_at": f"gte.{start.isoformat()}",
                    "limit": 1,
                },
                timeout=15,
            )
            cr = r.headers.get("Content-Range", "")
            if "/" in cr:
                try:
                    sold += int(cr.split("/")[-1])
                except ValueError:
                    pass

        # Previous-window deltas for impressions + leads (active_count snapshot has no prior comparison).
        prev_impressions_ev = _fetch_platform_events(dealership_id, prev_start, start)
        prev_leads_ev = _fetch_lead_events(dealership_id, prev_start, start)
        prev_impressions = dedupe_impressions(prev_impressions_ev)
        prev_leads = dedupe_leads(prev_leads_ev)

        def _delta(curr, prev):
            if not prev:
                return None
            return round((curr - prev) / prev * 100, 1)

        return jsonify({
            "window_days": n,
            "tiles": {
                "active_listings": {"value": active_count, "delta_pct": None},
                "impressions": {"value": impressions, "delta_pct": _delta(impressions, prev_impressions)},
                "detail_views": {"value": detail_views, "delta_pct": None},
                "leads": {"value": leads, "delta_pct": _delta(leads, prev_leads)},
                "lead_conversion_pct": {"value": round(conv, 2), "delta_pct": None},
                "sold_on_platform": {"value": sold, "delta_pct": None},
            },
        })

    return _inner()


@analytics_bp.route("/analytics/trends", methods=["GET"])
def trends():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, n = _window()

        impressions_events = _fetch_platform_events(dealership_id, start, end)
        lead_events = _fetch_lead_events(dealership_id, start, end)

        # Group by day, dedupe within day.
        imps_by_day = defaultdict(list)
        for e in impressions_events:
            d = e["created_at"][:10]
            imps_by_day[d].append(e)
        leads_by_day = defaultdict(list)
        for e in lead_events:
            d = e["created_at"][:10]
            leads_by_day[d].append(e)

        days = []
        cursor = start.date()
        while cursor <= end.date():
            ds = cursor.isoformat()
            days.append({
                "date": ds,
                "impressions": dedupe_impressions(imps_by_day.get(ds, [])),
                "leads": dedupe_leads(leads_by_day.get(ds, [])),
            })
            cursor += timedelta(days=1)

        # Leads by source breakdown.
        by_source = defaultdict(int)
        for e in lead_events:
            by_source[e.get("action") or "other"] += 1

        return jsonify({"daily": days, "leads_by_source": dict(by_source)})

    return _inner()


@analytics_bp.route("/analytics/funnel", methods=["GET"])
def funnel():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, _ = _window()

        all_events = _fetch_platform_events(dealership_id, start, end)
        detail_events = [e for e in all_events if e.get("page_kind") == "listing_detail"]
        lead_events = _fetch_lead_events(dealership_id, start, end)

        impressions = dedupe_impressions(all_events)
        detail_views = dedupe_impressions(detail_events)
        leads = dedupe_leads(lead_events)

        # Won = sold_on_dph in window.
        won = 0
        for table in ("cars", "bikes", "license_plates", "car_parts"):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": "count=exact"},
                params={"select": "id", "dealership_id": f"eq.{dealership_id}",
                        "sold_status": "eq.sold_on_dph",
                        "sold_status_set_at": f"gte.{start.isoformat()}",
                        "limit": 1},
                timeout=15,
            )
            cr = r.headers.get("Content-Range", "")
            if "/" in cr:
                try:
                    won += int(cr.split("/")[-1])
                except ValueError:
                    pass

        return jsonify({
            "steps": [
                {"label": "Impressions", "value": impressions},
                {"label": "Detail views", "value": detail_views},
                {"label": "Leads", "value": leads},
                {"label": "Won", "value": won},
            ]
        })

    return _inner()


@analytics_bp.route("/analytics/top-performers", methods=["GET"])
def top_performers():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, _ = _window()

        impressions_events = _fetch_platform_events(dealership_id, start, end)
        lead_events = _fetch_lead_events(dealership_id, start, end)

        # Aggregate by listing.
        imps_by_listing = defaultdict(list)
        for e in impressions_events:
            imps_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)
        leads_by_listing = defaultdict(list)
        for e in lead_events:
            leads_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)

        rows = []
        for key, evs in imps_by_listing.items():
            imp = dedupe_impressions(evs)
            ld = dedupe_leads(leads_by_listing.get(key, []))
            conv = (ld / imp * 100) if imp else 0.0
            rows.append({
                "listing_type": key[0],
                "listing_id": key[1],
                "impressions": imp,
                "leads": ld,
                "conv_pct": round(conv, 2),
            })

        top_imp = sorted(rows, key=lambda r: r["impressions"], reverse=True)[:5]
        top_conv = sorted([r for r in rows if r["impressions"] >= 10],
                          key=lambda r: r["conv_pct"], reverse=True)[:5]
        return jsonify({"top_by_impressions": top_imp, "top_by_conversion": top_conv})

    return _inner()


@analytics_bp.route("/analytics/underperformers", methods=["GET"])
def underperformers():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, _ = _window()

        listings = _listing_ids_for_dealership(dealership_id)
        impressions_events = _fetch_platform_events(dealership_id, start, end)
        lead_events = _fetch_lead_events(dealership_id, start, end)

        imps_by_listing = defaultdict(list)
        for e in impressions_events:
            imps_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)
        leads_by_listing = defaultdict(list)
        for e in lead_events:
            leads_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)

        rows = []
        for kind, ids in listings.items():
            for lid in ids:
                key = (kind, lid)
                imp = dedupe_impressions(imps_by_listing.get(key, []))
                ld = dedupe_leads(leads_by_listing.get(key, []))
                rows.append({
                    "listing_type": kind, "listing_id": lid,
                    "impressions": imp, "leads": ld,
                })

        worst_imp = sorted(rows, key=lambda r: r["impressions"])[:5]
        views_no_leads = sorted(
            [r for r in rows if r["impressions"] >= 20 and r["leads"] == 0],
            key=lambda r: r["impressions"], reverse=True,
        )[:5]
        return jsonify({"worst_by_impressions": worst_imp, "views_no_leads": views_no_leads})

    return _inner()


@analytics_bp.route("/listings", methods=["GET"])
def list_listings():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        merged = []
        for table, kind in (("cars", "car"), ("bikes", "bike"),
                            ("license_plates", "plate"), ("car_parts", "part")):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers=_svc(),
                params={
                    "select": "id,status,view_count,created_at,updated_at,sold_status,sold_status_set_at",
                    "dealership_id": f"eq.{dealership_id}",
                    "order": "created_at.desc",
                    "limit": 500,
                },
                timeout=20,
            )
            if r.status_code == 200:
                for row in r.json():
                    row["listing_type"] = kind
                    merged.append(row)
        merged.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return jsonify({"listings": merged})

    return _inner()


@analytics_bp.route("/listings/<listing_type>/<listing_id>/analytics", methods=["GET"])
def listing_analytics(listing_type, listing_id):
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, n = _window()

        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/platform_events",
            headers=_svc(),
            params={
                "select": "visitor_id,event_name,page_kind,created_at,metadata,duration_ms",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"eq.{listing_id}",
                "created_at": f"gte.{start.isoformat()}",
                "limit": 50000,
            },
            timeout=20,
        )
        events = r.json() if r.status_code == 200 else []
        leads_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers=_svc(),
            params={
                "select": "visitor_id,action,created_at",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"eq.{listing_id}",
                "created_at": f"gte.{start.isoformat()}",
                "limit": 50000,
            },
            timeout=20,
        )
        lead_events = leads_r.json() if leads_r.status_code == 200 else []

        impressions = dedupe_impressions(events)
        detail_events = [e for e in events if e.get("page_kind") == "listing_detail"]
        detail_views = dedupe_impressions(detail_events)

        calls = dedupe_leads([e for e in lead_events if e.get("action") == "call_click"])
        whatsapp = dedupe_leads([e for e in lead_events if e.get("action") == "whatsapp_click"])
        vin = dedupe_leads([e for e in lead_events if e.get("action") in ("vin_open", "vin_reveal")])

        # Engagement-without-contact: sessions with >30s OR >3 image events that produced no lead.
        sessions = defaultdict(lambda: {"dur": 0, "image_events": 0, "had_lead": False})
        for e in detail_events:
            sid = e.get("visitor_id") or ""
            sessions[sid]["dur"] += int(e.get("duration_ms") or 0)
        for e in events:
            if (e.get("event_name") or "").startswith("image_"):
                sessions[e.get("visitor_id") or ""]["image_events"] += 1
        for e in lead_events:
            sessions[e.get("visitor_id") or ""]["had_lead"] = True
        eng_no_contact = sum(
            1 for s in sessions.values()
            if (s["dur"] >= 30000 or s["image_events"] >= 3) and not s["had_lead"]
        )

        # Time series by day.
        ts = defaultdict(lambda: {"impressions": [], "detail_views": [], "leads": []})
        for e in events:
            d = e["created_at"][:10]
            ts[d]["impressions"].append(e)
            if e.get("page_kind") == "listing_detail":
                ts[d]["detail_views"].append(e)
        for e in lead_events:
            ts[e["created_at"][:10]]["leads"].append(e)
        series = sorted([
            {
                "date": k,
                "impressions": dedupe_impressions(v["impressions"]),
                "detail_views": dedupe_impressions(v["detail_views"]),
                "leads": dedupe_leads(v["leads"]),
            } for k, v in ts.items()
        ], key=lambda x: x["date"])

        return jsonify({
            "window_days": n,
            "tiles": {
                "impressions": impressions,
                "detail_views": detail_views,
                "call_clicks": calls,
                "whatsapp_clicks": whatsapp,
                "vin_reveals": vin,
                "engagement_no_contact": eng_no_contact,
                "conversion_pct": round((calls + whatsapp + vin) / detail_views * 100, 2) if detail_views else 0,
            },
            "series": series,
        })

    return _inner()
