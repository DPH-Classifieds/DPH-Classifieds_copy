from collections import Counter, defaultdict
from datetime import datetime, timezone
from statistics import median
import re

LISTING_PATH_PATTERNS = [
    (re.compile(r"^/cars/([^/?#]+)$", re.IGNORECASE), "car"),
    (re.compile(r"^/bikes/([^/?#]+)$", re.IGNORECASE), "bike"),
    (re.compile(r"^/plates/([^/?#]+)$", re.IGNORECASE), "plate"),
    (re.compile(r"^/car-parts/([^/?#]+)$", re.IGNORECASE), "part"),
]

PAGE_VIEW_EVENTS = {"page_view"}
PAGE_EXIT_EVENTS = {"page_exit", "session_end"}
CONVERSION_EVENTS = {
    "call_click",
    "whatsapp_click",
    "vin_open",
    "vin_reveal",
    "form_submit",
    "listing_submit",
    "purchase_complete",
    "transaction_complete",
}

PRICE_BANDS = [
    (0, 50000, "0-50k"),
    (50000, 100000, "50k-100k"),
    (100000, 250000, "100k-250k"),
    (250000, 500000, "250k-500k"),
    (500000, 1000000, "500k-1M"),
    (1000000, None, "1M+"),
]


def _safe_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_timestamp(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def classify_platform_path(path):
    normalized = (path or "").split("?")[0].split("#")[0].rstrip("/") or "/"
    for pattern, listing_type in LISTING_PATH_PATTERNS:
        match = pattern.match(normalized)
        if match:
            return {"listing_type": listing_type, "listing_id": match.group(1)}
    return {}


def _infer_page_kind(path):
    normalized = (path or "").split("?")[0].split("#")[0].rstrip("/") or "/"
    if normalized == "/":
        return "home"
    if normalized.startswith("/admin"):
        return "admin"
    if normalized.startswith("/post-") or normalized.startswith("/create"):
        return "post_form"
    if normalized.startswith("/edit/"):
        return "edit_form"
    if normalized.startswith("/login") or normalized.startswith("/signup") or normalized.startswith("/verify"):
        return "auth"
    if normalized.startswith("/cars/") or normalized.startswith("/bikes/") or normalized.startswith("/plates/") or normalized.startswith("/car-parts/"):
        return "listing_detail"
    if normalized.startswith("/cars") or normalized.startswith("/bikes") or normalized.startswith("/plates") or normalized.startswith("/car-parts"):
        return "browse"
    if normalized.startswith("/about") or normalized.startswith("/contact") or normalized.startswith("/privacy") or normalized.startswith("/terms"):
        return "content"
    return "other"


def _listing_segment_for_car(row):
    return (
        row.get("body_type")
        or row.get("vehicle_type")
        or row.get("car_manufacturer")
        or row.get("car_model")
        or "Unknown"
    )


def _listing_segment_for_plate(row):
    return (
        row.get("city")
        or row.get("plate_format")
        or f"Code {row.get('code') or 'Unknown'}"
        or "Unknown"
    )


def _price_for_row(row):
    return _safe_float(
        row.get("expected_selling_price")
        if row.get("expected_selling_price") is not None
        else row.get("price")
    )


def _price_band_label(price):
    for lower, upper, label in PRICE_BANDS:
        if upper is None and price >= lower:
            return label
        if upper is not None and lower <= price < upper:
            return label
    return "Unpriced"


def _price_band_summary(rows):
    counts = Counter()
    for row in rows or []:
        price = _price_for_row(row)
        if price > 0:
            counts[_price_band_label(price)] += 1
    return [
        {"band": band, "count": counts.get(band, 0)}
        for _, _, band in PRICE_BANDS
    ]


def _build_segment_summary(rows, segment_getter, event_counts):
    prefer_tracked_views = any(event_counts.values())
    bucket = defaultdict(lambda: {"segment": "Unknown", "listings": 0, "views": 0, "avg_price": 0.0, "total_price": 0.0})
    for row in rows or []:
        segment = segment_getter(row) or "Unknown"
        info = bucket[segment]
        info["segment"] = segment
        info["listings"] += 1
        price = _price_for_row(row)
        info["total_price"] += price
        tracked_views = _safe_int(event_counts.get(str(row.get("id"))))
        info["views"] += tracked_views if prefer_tracked_views else _safe_int(row.get("view_count"))
    segments = []
    for info in bucket.values():
        listings = info["listings"] or 1
        info["avg_price"] = round(info["total_price"] / listings, 2)
        segments.append(
            {
                "segment": info["segment"],
                "listings": info["listings"],
                "views": info["views"],
                "avg_price": round(info["avg_price"], 2),
            }
        )
    segments.sort(key=lambda item: (item["views"], item["listings"]), reverse=True)
    return segments


def _top_rows_by_views(rows, event_counts, title_getter):
    prefer_tracked_views = any(event_counts.values())
    ranked = []
    for row in rows or []:
        listing_id = str(row.get("id"))
        tracked_views = _safe_int(event_counts.get(listing_id))
        views = tracked_views if prefer_tracked_views else _safe_int(row.get("view_count"))
        ranked.append(
            {
                "id": row.get("id"),
                "title": title_getter(row),
                "views": views,
                "price": _price_for_row(row),
                "user_id": row.get("user_id"),
            }
        )
    ranked.sort(key=lambda item: (item["views"], item["price"]), reverse=True)
    return ranked[:10]


def build_platform_metrics(
    platform_events,
    car_rows=None,
    plate_rows=None,
    user_rows=None,
    bike_rows=None,
    part_rows=None,
    days=30,
):
    events = [dict(event) for event in (platform_events or [])]
    for event in events:
        page_path = event.get("page_path") or event.get("path") or "/"
        event.update(classify_platform_path(page_path))
        event.setdefault("page_kind", _infer_page_kind(page_path))
        event.setdefault("event_name", event.get("action") or "unknown")
        if not event.get("visitor_id"):
            event["visitor_id"] = event.get("user_id") or event.get("session_id") or "anonymous"
        if not event.get("session_id"):
            event["session_id"] = event.get("visitor_id") or "anonymous"

    events_by_session = defaultdict(list)
    events_by_visitor = defaultdict(list)
    page_views_by_path = Counter()
    event_counts = Counter()
    traffic_sources = Counter()
    # Web-vs-mobile split. metadata.platform is 'mobile' (mobile tracker) or
    # 'web' (web tracker); events predating the tag default to 'web'.
    platform_breakdown = defaultdict(lambda: {"visitors": set(), "sessions": set(), "app_opens": 0})
    daily_sessions = defaultdict(lambda: {"date": None, "sessions": set(), "page_views": 0, "conversions": 0})
    listings_by_id = {}
    plate_by_id = {}

    for row in car_rows or []:
        listings_by_id[str(row.get("id"))] = row
    for row in plate_rows or []:
        plate_by_id[str(row.get("id"))] = row

    for event in events:
        session_id = str(event.get("session_id") or "anonymous")
        visitor_id = str(event.get("visitor_id") or "anonymous")
        event_name = str(event.get("event_name") or "unknown")
        event_counts[event_name] += 1
        events_by_session[session_id].append(event)
        events_by_visitor[visitor_id].append(event)

        if event_name in PAGE_VIEW_EVENTS:
            path = event.get("page_path") or "/"
            page_views_by_path[path] += 1

        metadata = event.get("metadata") or {}
        source = metadata.get("utm_source") or metadata.get("source") or event.get("traffic_source") or "direct"
        traffic_sources[source] += 1

        platform_name = str(metadata.get("platform") or "web").lower()
        bucket_pb = platform_breakdown[platform_name]
        bucket_pb["visitors"].add(visitor_id)
        bucket_pb["sessions"].add(session_id)
        if event_name == "app_open":
            bucket_pb["app_opens"] += 1

        date_key = None
        parsed = _parse_timestamp(event.get("created_at"))
        if parsed:
            date_key = parsed.date().isoformat()
        if date_key:
            bucket = daily_sessions[date_key]
            bucket["date"] = date_key
            bucket["sessions"].add(session_id)
            if event_name in PAGE_VIEW_EVENTS:
                bucket["page_views"] += 1
            if _is_conversion_event(event):
                bucket["conversions"] += 1

    sessions = []
    for session_id, rows in events_by_session.items():
        created_times = [time for time in (_parse_timestamp(row.get("created_at")) for row in rows) if time]
        created_times.sort()
        page_views = sum(1 for row in rows if row.get("event_name") in PAGE_VIEW_EVENTS)
        duration_ms = sum(_safe_int(row.get("duration_ms")) for row in rows if row.get("event_name") in PAGE_EXIT_EVENTS)
        conversions = sum(1 for row in rows if _is_conversion_event(row))
        sessions.append(
            {
                "session_id": session_id,
                "visitor_id": rows[0].get("visitor_id") or rows[0].get("user_id") or session_id,
                "user_id": rows[0].get("user_id"),
                "page_views": page_views,
                "duration_ms": duration_ms,
                "started_at": created_times[0].isoformat() if created_times else None,
                "ended_at": created_times[-1].isoformat() if created_times else None,
                "conversions": conversions,
            }
        )

    unique_visitors = len(events_by_visitor)
    session_count = len(sessions)
    page_view_count = sum(session["page_views"] for session in sessions)
    total_duration_ms = sum(session["duration_ms"] for session in sessions)
    conversion_sessions = sum(1 for session in sessions if session["conversions"] > 0)
    bounce_sessions = sum(
        1
        for session in sessions
        if session["page_views"] <= 1 and session["duration_ms"] < 15000 and session["conversions"] == 0
    )
    repeat_visitors = sum(1 for rows in events_by_visitor.values() if len({row.get("session_id") for row in rows}) > 1)
    repeat_sessions = sum(
        1 for rows in events_by_visitor.values() if sum(1 for row in rows if row.get("event_name") in PAGE_VIEW_EVENTS) > 1
    )

    first_session_by_visitor = {}
    visitor_sessions = defaultdict(list)
    for session in sessions:
        visitor_sessions[session["visitor_id"]].append(session)
        started_at = _parse_timestamp(session["started_at"])
        if not started_at:
            continue
        current = first_session_by_visitor.get(session["visitor_id"])
        if current is None or started_at < current:
            first_session_by_visitor[session["visitor_id"]] = started_at

    cohort_windows = {1: 0, 7: 0, 30: 0}
    cohort_total = max(len(first_session_by_visitor), 1)
    for visitor_id, first_session_at in first_session_by_visitor.items():
        sessions_for_visitor = visitor_sessions.get(visitor_id, [])
        return_offsets = []
        for session in sessions_for_visitor:
            started_at = _parse_timestamp(session["started_at"])
            if started_at and started_at > first_session_at:
                return_offsets.append((started_at - first_session_at).days)
        for window in cohort_windows:
            if any(offset <= window for offset in return_offsets):
                cohort_windows[window] += 1

    daily_trends = []
    for date_key in sorted(daily_sessions):
        bucket = daily_sessions[date_key]
        daily_trends.append(
            {
                "date": date_key,
                "sessions": len(bucket["sessions"]),
                "page_views": bucket["page_views"],
                "conversions": bucket["conversions"],
            }
        )

    top_pages = [
        {"page_path": path, "views": views, "page_kind": _infer_page_kind(path)}
        for path, views in page_views_by_path.most_common(10)
    ]

    total_price_pool = []
    all_listing_rows = list(car_rows or []) + list(plate_rows or []) + list(bike_rows or []) + list(part_rows or [])
    for row in all_listing_rows:
        price = _price_for_row(row)
        if price > 0:
            total_price_pool.append(price)

    acquisition_spend = sum(
        _safe_float((event.get("metadata") or {}).get("marketing_spend") or (event.get("metadata") or {}).get("spend"))
        for event in events
    )
    new_users = 0
    if user_rows:
        cutoff_days = days
        now = max((_parse_timestamp(event.get("created_at")) for event in events if _parse_timestamp(event.get("created_at"))), default=None)
        if now:
            for row in user_rows:
                created_at = _parse_timestamp(row.get("created_at"))
                if created_at and (now - created_at).days <= cutoff_days:
                    new_users += 1

    total_gmv = round(sum(total_price_pool), 2)
    avg_listing_price = round((sum(total_price_pool) / len(total_price_pool)) if total_price_pool else 0, 2)
    unique_sellers = {str(row.get("user_id")) for row in all_listing_rows if row.get("user_id")}
    listings_per_seller_avg = round(len(all_listing_rows) / max(len(unique_sellers), 1), 2) if all_listing_rows else 0
    estimated_ltv = round(total_gmv / max(unique_visitors, 1), 2) if total_gmv else 0
    estimated_cac = round(acquisition_spend / max(new_users, 1), 2) if acquisition_spend > 0 and new_users > 0 else None
    ltv_cac_ratio = round(estimated_ltv / estimated_cac, 2) if estimated_cac else None

    car_event_counts = Counter()
    plate_event_counts = Counter()
    for event in events:
        listing_id = str(event.get("listing_id") or "")
        if event.get("listing_type") == "car" and listing_id and event.get("event_name") in PAGE_VIEW_EVENTS:
            car_event_counts[listing_id] += 1
        if event.get("listing_type") == "plate" and listing_id and event.get("event_name") in PAGE_VIEW_EVENTS:
            plate_event_counts[listing_id] += 1

    car_segments = _build_segment_summary(
        car_rows or [],
        _listing_segment_for_car,
        car_event_counts,
    )
    plate_segments = _build_segment_summary(
        plate_rows or [],
        _listing_segment_for_plate,
        plate_event_counts,
    )

    def _car_title(row):
        return " ".join(
            str(part)
            for part in [row.get("make_year"), row.get("car_manufacturer"), row.get("car_model")]
            if part
        ).strip() or f"Car {row.get('id')}"

    def _plate_title(row):
        return " ".join(
            str(part)
            for part in [row.get("city"), row.get("code"), row.get("number")]
            if part
        ).strip() or f"Plate {row.get('id')}"

    return {
        "window_days": days,
        "user_metrics": {
            "sessions": session_count,
            "unique_visitors": unique_visitors,
            "page_views": page_view_count,
            "avg_pages_per_session": round(page_view_count / max(session_count, 1), 2),
            "bounce_rate_percent": round((bounce_sessions / max(session_count, 1)) * 100, 2),
            "repeat_visit_rate_percent": round((repeat_visitors / max(unique_visitors, 1)) * 100, 2),
            "repeat_purchase_rate_percent": round((repeat_sessions / max(unique_visitors, 1)) * 100, 2),
            "avg_time_on_site_seconds": round(total_duration_ms / max(session_count, 1) / 1000, 2),
            "conversion_sessions": conversion_sessions,
            "conversion_rate_percent": round((conversion_sessions / max(session_count, 1)) * 100, 2),
            "cohort_retention": {
                "day_1": round((cohort_windows[1] / cohort_total) * 100, 2),
                "day_7": round((cohort_windows[7] / cohort_total) * 100, 2),
                "day_30": round((cohort_windows[30] / cohort_total) * 100, 2),
            },
            "top_pages": top_pages,
            "traffic_sources": [
                {"source": source, "sessions": count}
                for source, count in traffic_sources.most_common(8)
            ],
            "platform_breakdown": [
                {
                    "platform": name,
                    "visitors": len(vals["visitors"]),
                    "sessions": len(vals["sessions"]),
                    "app_opens": vals["app_opens"],
                }
                for name, vals in sorted(
                    platform_breakdown.items(),
                    key=lambda kv: len(kv[1]["visitors"]),
                    reverse=True,
                )
            ],
            "daily_trends": daily_trends,
            "top_events": [
                {"event_name": name, "count": count}
                for name, count in event_counts.most_common(10)
            ],
        },
        "financial_metrics": {
            "gross_merchandise_value": total_gmv,
            "average_listing_price": avg_listing_price,
            "new_users": new_users,
            "unique_sellers": len(unique_sellers),
            "listings_per_seller_avg": listings_per_seller_avg,
            "estimated_ltv": estimated_ltv,
            "estimated_cac": estimated_cac,
            "ltv_cac_ratio": ltv_cac_ratio,
            "notes": [
                "CAC only computes when spend data is attached to events.",
                "LTV uses the current marketplace value pool as a proxy until transaction revenue is available.",
            ],
        },
        "car_metrics": {
            "total_listings": len(car_rows or []),
            "avg_price": round(
                sum(_price_for_row(row) for row in (car_rows or []) if _price_for_row(row) > 0) / max(len([row for row in (car_rows or []) if _price_for_row(row) > 0]), 1),
                2,
            ) if any(_price_for_row(row) > 0 for row in (car_rows or [])) else 0,
            "median_price": round(median([_price_for_row(row) for row in (car_rows or []) if _price_for_row(row) > 0]), 2) if any(_price_for_row(row) > 0 for row in (car_rows or [])) else 0,
            "price_bands": _price_band_summary(car_rows or []),
            "segment_views": car_segments,
            "most_viewed_segment": car_segments[0] if car_segments else {"segment": "Unknown", "views": 0},
            "top_listings": _top_rows_by_views(car_rows or [], car_event_counts, _car_title),
            "top_makes": [
                {"label": item["segment"], "views": item["views"]}
                for item in car_segments[:8]
            ],
        },
        "plate_metrics": {
            "total_listings": len(plate_rows or []),
            "avg_price": round(
                sum(_price_for_row(row) for row in (plate_rows or []) if _price_for_row(row) > 0) / max(len([row for row in (plate_rows or []) if _price_for_row(row) > 0]), 1),
                2,
            ) if any(_price_for_row(row) > 0 for row in (plate_rows or [])) else 0,
            "median_price": round(median([_price_for_row(row) for row in (plate_rows or []) if _price_for_row(row) > 0]), 2) if any(_price_for_row(row) > 0 for row in (plate_rows or [])) else 0,
            "price_bands": _price_band_summary(plate_rows or []),
            "segment_views": plate_segments,
            "most_in_demand": plate_segments[0] if plate_segments else {"segment": "Unknown", "views": 0},
            "top_listings": _top_rows_by_views(plate_rows or [], plate_event_counts, _plate_title),
        },
        "raw_counts": {
            "events": len(events),
            "sessions": session_count,
            "cars": len(car_rows or []),
            "plates": len(plate_rows or []),
        },
    }


def _is_conversion_event(event):
    event_name = str(event.get("event_name") or "").strip().lower()
    if event_name in CONVERSION_EVENTS:
        return True
    if event_name in {"click", "button_click", "link_click"}:
        metadata = event.get("metadata") or {}
        if metadata.get("intent") == "conversion" or event.get("listing_type") or event.get("listing_id"):
            return True
        page_kind = event.get("page_kind")
        if page_kind in {"listing_detail", "post_form"}:
            return True
    return False
