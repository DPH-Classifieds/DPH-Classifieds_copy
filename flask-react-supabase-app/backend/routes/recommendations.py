"""HTTP recommendations routes.

The compatibility root retains the saved-listing card and image helpers used
by several other endpoints.  Recommendation request handling lives here and
resolves those shared helpers and Supabase access through the Flask runtime
registry, keeping this module independent from ``app.py``.
"""

from collections import defaultdict

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    """Resolve live application helpers at request time for patchability."""
    return _BACKEND


def get_recommendations():
    """Return similar or personalized listing recommendations."""
    backend = _backend()
    try:
        data = request.json or {}
        limit = min(int(data.get("limit", 8)), 20)

        listing_type = data.get("listing_type") or data.get("listingType")
        listing_id = data.get("listing_id") or data.get("listingId")
        if listing_type and listing_id:
            return backend._get_similar_listings(listing_type, listing_id, limit)

        viewed = data.get("viewed", [])
        preferred_types = data.get("preferredTypes", [])
        avg_price = data.get("avgPrice")

        if not viewed and not preferred_types:
            return backend._get_newest_recommendations(limit)

        viewed_ids = {str(v["id"]) for v in viewed if v.get("id")}
        viewed_types = [v["type"] for v in viewed if v.get("type")]
        target_types = preferred_types or list(set(viewed_types))

        cards = []
        for listing_type in target_types:
            normalized_type, config = backend._saved_listing_config(listing_type)
            if not normalized_type:
                continue
            price_col = (
                "expected_selling_price" if normalized_type == "car" else "price"
            )

            params = [
                ("select", "*"),
                ("is_approved", "eq.true"),
                ("order", "created_at.desc"),
                ("limit", str(limit)),
            ]
            if avg_price:
                params.append((price_col, f"gte.{avg_price * 0.6}"))
                params.append((price_col, f"lte.{avg_price * 1.4}"))

            items, status = backend.supabase_request(
                "get",
                f"/rest/v1/{config['table']}",
                params=params,
                use_service_role=True,
            )
            if status >= 400 or not isinstance(items, list):
                continue
            items = [
                item for item in items if str(item.get("id", "")) not in viewed_ids
            ]
            cards.extend(
                backend._build_recommendation_cards(normalized_type, config, items)
            )

        cards.sort(key=lambda card: card.get("createdAt") or "", reverse=True)
        return jsonify({"recommendations": cards[:limit]})

    except Exception as exc:
        backend.logger.error(f"Recommendations error: {exc}")
        return jsonify({"recommendations": [], "error": str(exc)}), 500


def _get_newest_recommendations(limit):
    """Cold start: return newest listings across all types."""
    backend = _backend()
    cards = []
    type_count = len(backend.SAVED_LISTING_TYPE_CONFIG)
    for normalized_type, config in backend.SAVED_LISTING_TYPE_CONFIG.items():
        items, status = backend.supabase_request(
            "get",
            f"/rest/v1/{config['table']}",
            params=[
                ("select", "*"),
                ("is_approved", "eq.true"),
                ("order", "created_at.desc"),
                ("limit", str(limit // type_count + 1)),
            ],
            use_service_role=True,
        )
        if status >= 400 or not isinstance(items, list):
            continue
        cards.extend(
            backend._build_recommendation_cards(normalized_type, config, items)
        )

    cards.sort(key=lambda card: card.get("createdAt") or "", reverse=True)
    return jsonify({"recommendations": cards[:limit]})


def _get_similar_listings(listing_type, listing_id, limit):
    """Return same-category listings in a comparable price band first."""
    backend = _backend()
    normalized_type, config = backend._saved_listing_config(listing_type)
    if not normalized_type:
        return jsonify({"recommendations": []})

    table = config["table"]
    price_col = "expected_selling_price" if normalized_type == "car" else "price"

    source, source_status = backend.supabase_request(
        "get",
        f"/rest/v1/{table}",
        params=[
            ("select", price_col),
            ("id", f"eq.{listing_id}"),
            ("limit", "1"),
        ],
        use_service_role=True,
    )
    price = None
    if source_status < 400 and isinstance(source, list) and source:
        price = source[0].get(price_col)

    def _fetch(with_price_band):
        params = [
            ("select", "*"),
            ("is_approved", "eq.true"),
            ("id", f"neq.{listing_id}"),
            ("order", "created_at.desc"),
            ("limit", str(limit * 3)),
        ]
        if with_price_band and price not in (None, ""):
            try:
                numeric_price = float(price)
                params.append((price_col, f"gte.{numeric_price * 0.6}"))
                params.append((price_col, f"lte.{numeric_price * 1.4}"))
            except (TypeError, ValueError):
                pass
        items, status = backend.supabase_request(
            "get",
            f"/rest/v1/{table}",
            params=params,
            use_service_role=True,
        )
        return items if status < 400 and isinstance(items, list) else []

    items = _fetch(with_price_band=True)
    if len(items) < limit:
        seen_ids = {str(item.get("id")) for item in items}
        for item in _fetch(with_price_band=False):
            if str(item.get("id")) not in seen_ids:
                items.append(item)
                seen_ids.add(str(item.get("id")))

    cards = backend._build_recommendation_cards(
        normalized_type, config, items[: limit * 2]
    )
    return jsonify({"recommendations": cards[:limit]})


def _build_recommendation_cards(normalized_type, config, items):
    """Batch-attach images and build saved-listing-shaped recommendation cards."""
    backend = _backend()
    ids = [item.get("id") for item in items if item.get("id")]
    images_by_listing = defaultdict(list)
    if ids:
        id_query = ",".join(str(item_id) for item_id in ids)
        image_rows, image_status = backend.supabase_request(
            "get",
            f"/rest/v1/{config['images_table']}",
            params={
                "select": "*",
                config["fk"]: f"in.({id_query})",
            },
            use_service_role=True,
        )
        if image_status < 400:
            for image in image_rows or []:
                images_by_listing[image.get(config["fk"])].append(image)

    if normalized_type == "bike":
        for item in items:
            backend._normalize_bike_record(item)

    cards = []
    for item in items:
        item["images"] = backend._sort_listing_images(
            images_by_listing.get(item.get("id"), [])
        )
        card = backend._build_saved_listing_card(normalized_type, item)
        if card:
            cards.append(card)
    return cards


def register_recommendations_routes(app: Flask) -> None:
    """Register the recommendations POST route after runtime setup."""
    app.add_url_rule(
        "/api/recommendations",
        endpoint="get_recommendations",
        view_func=get_recommendations,
        methods=["POST"],
    )
