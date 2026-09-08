"""Public and admin featured-listing routes."""

import json
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _token_required(function):
    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


def _resolve_featured_listing_meta(rows_by_type, listing_type, listing_id):
    rows = rows_by_type.get(listing_type) or {}
    listing = rows.get(listing_id)
    if not listing:
        return None
    if listing_type == "car":
        title = " ".join(
            filter(
                None,
                [
                    str(listing.get("make_year") or ""),
                    str(listing.get("car_manufacturer") or ""),
                    str(listing.get("car_model") or ""),
                ],
            )
        ).strip() or "Untitled car"
    elif listing_type == "bike":
        title = " ".join(
            filter(
                None,
                [
                    str(listing.get("make_year") or ""),
                    str(listing.get("bike_manufacturer") or listing.get("car_manufacturer") or ""),
                    str(listing.get("bike_model") or listing.get("car_model") or ""),
                ],
            )
        ).strip() or "Untitled bike"
    elif listing_type == "plate":
        title = str(listing.get("plate_number") or "Untitled plate")
    elif listing_type == "part":
        title = " ".join(
            filter(
                None,
                [
                    str(listing.get("make") or ""),
                    str(listing.get("part_type") or listing.get("model") or ""),
                ],
            )
        ).strip() or "Untitled part"
    else:
        title = "Listing"
    out = dict(listing)
    out["title"] = title
    return out


def _hydrate_featured_rows(featured_rows):
    if not featured_rows:
        return []
    backend = _backend()
    by_type = {"car": set(), "bike": set(), "plate": set(), "part": set()}
    for row in featured_rows:
        by_type[row.get("listing_type")].add(row["listing_id"])
    rows_by_type = {}
    table_map = {
        "car": "cars",
        "bike": "bikes",
        "plate": "license_plates",
        "part": "car_parts",
    }
    for listing_type, ids in by_type.items():
        if not ids:
            rows_by_type[listing_type] = {}
            continue
        in_filter = ",".join(ids)
        body, code = backend.supabase_request(
            "get",
            f"/rest/v1/{table_map[listing_type]}",
            params={
                "id": f"in.({in_filter})",
                "select": "id,car_make,car_model,car_manufacturer,car_model,bike_manufacturer,bike_model,make_year,make,model,part_type,plate_number,expected_selling_price,is_approved,status,deleted_at",
            },
            use_service_role=True,
        )
        rows_by_type[listing_type] = (
            {row["id"]: row for row in body} if code < 400 and isinstance(body, list) else {}
        )
    out = []
    for row in featured_rows:
        listing = _resolve_featured_listing_meta(
            rows_by_type, row["listing_type"], row["listing_id"]
        )
        if listing is None:
            copy = dict(row)
            copy["title"] = "(deleted listing)"
            copy["listing"] = None
            copy["is_active"] = False
            out.append(copy)
            continue
        copy = dict(row)
        copy["title"] = listing["title"]
        copy["listing"] = listing
        copy["is_active"] = True
        out.append(copy)
    return out


FEATURED_PLACEMENT_REDIS_KEY = "featured:placement_pattern"
DEFAULT_FEATURED_PLACEMENT_PATTERN = [{"featured": 1}, {"normal": 5}]
FEATURED_PLACEMENT_MAX_SEGMENTS = 20
FEATURED_PLACEMENT_MAX_COUNT = 50


def _validate_featured_placement_pattern(pattern):
    if not isinstance(pattern, list) or not pattern:
        return None, {"error": "pattern must be a non-empty array"}
    if len(pattern) > FEATURED_PLACEMENT_MAX_SEGMENTS:
        return None, {
            "error": f"pattern cannot have more than {FEATURED_PLACEMENT_MAX_SEGMENTS} segments"
        }
    clean = []
    for segment in pattern:
        if not isinstance(segment, dict) or len(segment) != 1:
            return None, {"error": "each segment must be {\"featured\": N} or {\"normal\": N}"}
        key, value = next(iter(segment.items()))
        if key not in ("featured", "normal"):
            return None, {"error": "segment key must be 'featured' or 'normal'"}
        if not isinstance(value, int) or isinstance(value, bool) or not (
            1 <= value <= FEATURED_PLACEMENT_MAX_COUNT
        ):
            return None, {
                "error": f"segment count must be an integer between 1 and {FEATURED_PLACEMENT_MAX_COUNT}"
            }
        clean.append({key: value})
    return clean, None


@_token_required
def admin_list_featured_listings(current_user):
    backend = _backend()
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Admin only"}), 403
    include_inactive = (request.args.get("include_inactive") or "").lower() in (
        "1",
        "true",
        "yes",
    )
    body, code = backend.supabase_request(
        "get",
        "/rest/v1/featured_listings",
        params={"select": "*", "order": "featured_at.desc", "limit": "200"},
        use_service_role=True,
    )
    if code >= 400:
        backend.logger.error(
            "admin_list_featured_listings: supabase returned %s body=%s",
            code,
            str(body)[:300],
        )
        hint = ""
        if isinstance(body, dict) and body.get("code") == "42P01":
            hint = " — table featured_listings is missing. Run migrations/2026_08_19_featured_listings.sql"
        return jsonify({"error": f"Failed to fetch featured listings{hint}"}), 500
    rows = backend._hydrate_featured_rows(body or [])
    if not include_inactive:
        rows = [row for row in rows if row.get("is_active")]
    return jsonify(rows), 200


@_token_required
def admin_create_featured_listing(current_user):
    backend = _backend()
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Admin only"}), 403
    data = request.get_json(silent=True) or {}
    payload, err = backend.validate_featured_input(
        data.get("listing_type"), data.get("listing_id"), data.get("featured_until")
    )
    if err:
        return jsonify(err), 400

    note = (data.get("note") or "").strip() or None
    highlight = bool(data.get("highlight", True))
    insert_body = {
        "listing_type": payload["listing_type"],
        "listing_id": payload["listing_id"],
        "featured_by": current_user,
        "featured_until": payload["featured_until"],
        "highlight": highlight,
    }
    if note:
        insert_body["note"] = note
    body, code = backend.supabase_request(
        "post",
        "/rest/v1/featured_listings",
        data=insert_body,
        use_service_role=True,
    )
    if code == 409:
        body, code = backend.supabase_request(
            "patch",
            "/rest/v1/featured_listings",
            params={
                "listing_type": f"eq.{payload['listing_type']}",
                "listing_id": f"eq.{payload['listing_id']}",
            },
            data={
                "featured_by": current_user,
                "featured_until": payload["featured_until"],
                "note": note,
                "highlight": highlight,
            },
            use_service_role=True,
        )
    if code >= 400:
        return jsonify({"error": "Failed to feature listing", "details": body}), 500

    row = body[0] if isinstance(body, list) and body else (
        body if isinstance(body, dict) else None
    )
    if not row:
        refetch, refetch_code = backend.supabase_request(
            "get",
            "/rest/v1/featured_listings",
            params={
                "listing_type": f"eq.{payload['listing_type']}",
                "listing_id": f"eq.{payload['listing_id']}",
                "limit": "1",
            },
            use_service_role=True,
        )
        if refetch_code < 400 and isinstance(refetch, list) and refetch:
            row = refetch[0]
    if not row:
        return jsonify({"error": "Featured listing upserted but not returned"}), 500
    hydrated = backend._hydrate_featured_rows([row])
    return jsonify(hydrated[0] if hydrated else row), 201


@_token_required
def admin_delete_featured_listing(current_user, row_id):
    backend = _backend()
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Admin only"}), 403
    _, code = backend.supabase_request(
        "delete",
        f"/rest/v1/featured_listings?id=eq.{row_id}",
        use_service_role=True,
    )
    if code >= 400:
        return jsonify({"error": "Failed to remove featured listing"}), 500
    return jsonify({"deleted": True, "id": row_id}), 200


@_token_required
def admin_update_featured_listing(current_user, row_id):
    backend = _backend()
    if not backend._require_admin_api_user(current_user):
        return jsonify({"error": "Admin only"}), 403
    data = request.get_json(silent=True) or {}
    patch = {}
    if "featured_until" in data:
        until = data.get("featured_until")
        if until in (None, ""):
            patch["featured_until"] = None
        else:
            try:
                parsed = datetime.fromisoformat(str(until).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                if parsed <= datetime.now(timezone.utc):
                    return jsonify(
                        {
                            "error": "featured_until must be in the future",
                            "code": "featured_until_in_past",
                        }
                    ), 400
                patch["featured_until"] = parsed.isoformat()
            except (ValueError, TypeError):
                return jsonify(
                    {
                        "error": "featured_until must be an ISO timestamp",
                        "code": "invalid_featured_until",
                    }
                ), 400
    if "note" in data:
        patch["note"] = (data.get("note") or "").strip() or None
    if "highlight" in data:
        patch["highlight"] = bool(data.get("highlight"))
    if not patch:
        return jsonify({"error": "No supported fields provided"}), 400
    _, code = backend.supabase_request(
        "patch",
        f"/rest/v1/featured_listings?id=eq.{row_id}",
        data=patch,
        use_service_role=True,
    )
    if code >= 400:
        return jsonify({"error": "Failed to update featured listing"}), 500
    return jsonify({"updated": True, "id": row_id}), 200


def public_list_featured_listings():
    backend = _backend()
    listing_type = (request.args.get("type") or "").strip().lower()
    if listing_type and listing_type not in backend.ALLOWED_LISTING_TYPES:
        return jsonify(
            {"error": f"type must be one of {list(backend.ALLOWED_LISTING_TYPES)}"}
        ), 400
    params = {"select": "*", "order": "featured_at.desc", "limit": "50"}
    if listing_type:
        params["listing_type"] = f"eq.{listing_type}"
    body, code = backend.supabase_request(
        "get",
        "/rest/v1/featured_listings",
        params=params,
        use_service_role=True,
    )
    if code >= 400:
        return jsonify({"error": "Failed to fetch featured listings"}), 500
    rows = [row for row in (body or []) if backend.is_listing_active_featured(row)]
    hydrated = backend._hydrate_featured_rows(rows)
    visible = [
        row
        for row in hydrated
        if row.get("listing")
        and row["listing"].get("is_approved") is True
        and not row["listing"].get("deleted_at")
    ]
    return jsonify(visible), 200


@_token_required
def admin_featured_placement_settings(current_user):
    backend = _backend()
    user_details = backend._get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Admin access required"}), 403

    redis_client = backend._get_redis_cache_client()
    if request.method == "PATCH":
        body = request.get_json(silent=True) or {}
        clean, err = backend._validate_featured_placement_pattern(body.get("pattern"))
        if err:
            return jsonify(err), 400
        if not redis_client:
            return jsonify({"error": "Redis unavailable — cannot persist pattern"}), 503
        try:
            redis_client.set(backend.FEATURED_PLACEMENT_REDIS_KEY, json.dumps(clean))
        except Exception as exc:
            return jsonify({"error": f"Redis error: {exc}"}), 500
        return jsonify({"pattern": clean, "source": "redis"}), 200

    if redis_client:
        try:
            raw = redis_client.get(backend.FEATURED_PLACEMENT_REDIS_KEY)
            if raw:
                return jsonify({"pattern": json.loads(raw), "source": "redis"}), 200
        except Exception:
            pass
    return jsonify(
        {"pattern": backend.DEFAULT_FEATURED_PLACEMENT_PATTERN, "source": "default"}
    ), 200


def public_featured_placement_pattern():
    backend = _backend()
    redis_client = backend._get_redis_cache_client()
    if redis_client:
        try:
            raw = redis_client.get(backend.FEATURED_PLACEMENT_REDIS_KEY)
            if raw:
                return jsonify({"pattern": json.loads(raw)}), 200
        except Exception:
            pass
    return jsonify({"pattern": backend.DEFAULT_FEATURED_PLACEMENT_PATTERN}), 200


def register_featured_listing_routes(app: Flask) -> None:
    routes = (
        ("/api/admin/featured-listings", "admin_list_featured_listings", admin_list_featured_listings, ["GET"]),
        ("/api/admin/featured-listings", "admin_create_featured_listing", admin_create_featured_listing, ["POST"]),
        ("/api/admin/featured-listings/<row_id>", "admin_delete_featured_listing", admin_delete_featured_listing, ["DELETE"]),
        ("/api/admin/featured-listings/<row_id>", "admin_update_featured_listing", admin_update_featured_listing, ["PATCH"]),
        ("/api/featured-listings", "public_list_featured_listings", public_list_featured_listings, ["GET"]),
        ("/api/admin/featured-placement/settings", "admin_featured_placement_settings", admin_featured_placement_settings, ["GET", "PATCH"]),
        ("/api/featured-placement/pattern", "public_featured_placement_pattern", public_featured_placement_pattern, ["GET"]),
    )
    for rule, endpoint, view_func, methods in routes:
        app.add_url_rule(rule, endpoint=endpoint, view_func=view_func, methods=methods)
