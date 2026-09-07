"""Public listing price-history endpoint.

The endpoint reads only approved listings and resolves Supabase access through
the Flask runtime registry.
"""

from flask import Flask, current_app, jsonify


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


_PRICE_HISTORY_TABLES = {
    "cars": ("cars", "expected_selling_price"),
    "bikes": ("bikes", "price"),
    "plates": ("license_plates", "price"),
    "parts": ("car_parts", "price"),
}


def get_listing_price_history(listing_type, listing_id):
    """Public price history + analysis for one listing. Always returns at least
    the current price; the history table is optional (falls back gracefully if
    the migration hasn't been applied)."""
    backend = _backend()
    cfg = _PRICE_HISTORY_TABLES.get(listing_type)
    if not cfg:
        return jsonify({"error": "Unknown listing type"}), 404
    table, price_col = cfg

    # Only expose price history for a public (approved) listing.
    cur, csc = backend.supabase_request(
        "get", f"/rest/v1/{table}",
        params={"select": f"{price_col},is_approved", "id": f"eq.{listing_id}"},
        use_service_role=True,
    )
    if csc >= 400 or not isinstance(cur, list) or not cur or not cur[0].get("is_approved"):
        return jsonify({"error": "Listing not found"}), 404
    current = cur[0].get(price_col)

    rows, sc = backend.supabase_request(
        "get", "/rest/v1/listing_price_history",
        params={"select": "price,recorded_at,source", "listing_id": f"eq.{listing_id}",
                "order": "recorded_at.asc"},
        use_service_role=True,
    )
    raw = rows if (sc < 400 and isinstance(rows, list)) else []

    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    series = []
    for p in raw:
        val = _num(p.get("price"))
        if val is not None:
            series.append({"price": val, "recorded_at": p.get("recorded_at"),
                           "source": p.get("source")})
    cur_num = _num(current)
    if cur_num is not None and (not series or series[-1]["price"] != cur_num):
        series.append({"price": cur_num, "recorded_at": None, "source": "current"})

    prices = [s["price"] for s in series]
    analysis = None
    if prices:
        first, last = prices[0], prices[-1]
        analysis = {
            "first": first, "current": last,
            "min": min(prices), "max": max(prices),
            "change": round(last - first, 2),
            "change_pct": round((last - first) / first * 100, 1) if first else 0,
            "points": len(prices),
        }
    return jsonify({"points": series, "analysis": analysis}), 200



def register_price_history_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/<string:listing_type>/<string:listing_id>/price-history",
        endpoint="get_listing_price_history",
        view_func=get_listing_price_history,
        methods=["GET"],
    )
