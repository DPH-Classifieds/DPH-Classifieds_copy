"""Unified admin listing search route.

Preview, draft, image, source/status, and verification helpers remain in the
compatibility backend and resolve through the runtime dependency boundary.
"""

from collections import defaultdict
from functools import wraps

from flask import Flask, current_app, jsonify, request


class _BackendProxy:
    def __getattr__(self, name):
        return current_app.extensions["dph_user_backend"][name]


_BACKEND = _BackendProxy()


def _backend():
    return _BACKEND


def _token_required(function):
    """Apply the compatibility root's auth decorator at request time."""

    @wraps(function)
    def decorated(*args, **kwargs):
        return _backend().token_required(function)(*args, **kwargs)

    return decorated


@_token_required
def admin_listings_search(current_user):
    backend = _backend()
    """Unified admin listing search for moderation and lifecycle views."""
    try:
        if not backend._require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        raw_types = request.args.get("types", "")
        raw_statuses = request.args.get("statuses", "")
        requested_sources = {
            (value or "").strip().lower()
            for value in request.args.get("source", "").split(",")
            if (value or "").strip() and (value or "").strip().lower() != "all"
        } & {"member", "dealer", "reddit"}

        requested_types = [
            (value or "").strip().lower()
            for value in raw_types.split(",")
            if (value or "").strip()
        ]
        requested_statuses = [
            (value or "").strip().lower()
            for value in raw_statuses.split(",")
            if (value or "").strip()
        ]

        type_map = {
            "car": "car",
            "cars": "car",
            "bike": "bike",
            "bikes": "bike",
            "part": "part",
            "parts": "part",
            "plate": "plate",
            "plates": "plate",
            "draft": "drafts",
            "drafts": "drafts",
            "buying_request": "buying_request",
            "buying_requests": "buying_request",
        }
        if requested_types:
            normalized_types = [
                type_map[value] for value in requested_types if value in type_map
            ]
        else:
            normalized_types = list(backend.LISTING_TABLE_CONFIG.keys()) + ["drafts"]

        if not requested_statuses or "all" in requested_statuses:
            requested_statuses = []

        try:
            _req_limit = int(request.args.get("limit", "100"))
        except (ValueError, TypeError):
            _req_limit = 100
        per_type_limit = min(max(_req_limit, 1), 200)
        include_verification = (
            str(request.args.get("include_verification", "")).strip().lower()
            in {"1", "true", "yes"}
        )

        listings = []
        counts = defaultdict(int)

        for listing_type in normalized_types:
            if listing_type == "drafts":
                rows, status_code = backend.supabase_request(
                    "get",
                    "/rest/v1/listing_drafts",
                    params={
                        "select": "id,user_id,draft_key,payload,created_at,updated_at",
                        "order": "updated_at.desc",
                        "limit": str(per_type_limit),
                    },
                    use_service_role=True,
                )
                if status_code >= 400:
                    backend.logger.warning("Failed to fetch admin drafts: %s", rows)
                    continue

                draft_rows = rows or []
                owner_map = backend._admin_fetch_user_display_map(
                    [row.get("user_id") for row in draft_rows if row.get("user_id")]
                )

                for row in draft_rows:
                    try:
                        owner_row = owner_map.get(str(row.get("user_id"))) if row.get("user_id") else None
                        draft_listing = backend._build_draft_listing_summary(row, owner_row=owner_row)
                        draft_listing["source_kind"] = "member"
                        if requested_sources and "member" not in requested_sources:
                            continue
                        if requested_statuses and not any(
                            backend._admin_listing_matches_status(draft_listing, status)
                            for status in requested_statuses
                        ):
                            continue
                        counts["total"] += 1
                        counts["draft"] += 1
                        listings.append(draft_listing)
                    except Exception as draft_err:
                        backend.logger.exception(
                            "admin_listings_search: failed processing draft %s — %s",
                            (row or {}).get("id"),
                            draft_err,
                        )
                        continue
                continue

            config = backend.LISTING_TABLE_CONFIG.get(listing_type)
            if not config:
                continue

            rows, status_code = backend.supabase_request(
                "get",
                f"/rest/v1/{config['table']}",
                params={
                    "select": backend.ADMIN_LISTING_SELECTS.get(listing_type, "*"),
                    "order": "created_at.desc",
                    "limit": str(per_type_limit),
                },
                use_service_role=True,
            )
            if status_code >= 400:
                backend.logger.warning(
                    "Failed to fetch admin listings for %s: %s", listing_type, rows
                )
                continue

            for row in rows or []:
                # Defensively isolate per-row work so a single malformed listing
                # cannot 500 the whole admin page.
                try:
                    preview = backend._preview_listing_record(row)
                    if not preview:
                        continue

                    if listing_type == "car":
                        preview["images"] = backend._sort_listing_images(preview.pop("car_images", []) or [])
                    elif listing_type == "bike":
                        preview["images"] = backend._sort_listing_images(preview.pop("bike_images", []) or [])
                    elif listing_type == "part":
                        preview["images"] = backend._sort_listing_images(preview.pop("part_images", []) or [])
                    else:
                        preview["images"] = preview.get("images") or []
                    if not preview["images"] and (
                        preview.get("display_url") or preview.get("image_url") or preview.get("url")
                    ):
                        main_url = (
                            preview.get("display_url")
                            or preview.get("image_url")
                            or preview.get("url")
                        )
                        preview["images"] = [
                            {"id": "main", "url": main_url, "image_url": main_url}
                        ]

                    display_status = backend._admin_listing_display_status(preview)
                    preview["display_status"] = display_status
                    preview["listing_type"] = f"{listing_type}s" if listing_type != "part" else "parts"
                    preview["_table_status"] = preview.get("status")
                    preview["source_kind"] = backend._listing_source_kind(preview)

                    if requested_sources and preview["source_kind"] not in requested_sources:
                        continue
                    if requested_statuses and not any(
                        backend._admin_listing_matches_status(preview, status)
                        for status in requested_statuses
                    ):
                        continue

                    counts["total"] += 1
                    counts[preview.get("_table_status") or "unknown"] += 1
                    if preview.get("listing_state") == "active":
                        counts["active"] += 1
                    if preview.get("listing_state") in {"expired", "archived"}:
                        counts["expired"] += 1

                    listings.append(preview)
                except Exception as row_err:
                    backend.logger.exception(
                        "admin_listings_search: failed processing %s/%s — %s",
                        config["table"], (row or {}).get("id"), row_err,
                    )
                    continue

        if include_verification:
            try:
                latest_scan_map = backend._admin_fetch_latest_verification_scans(
                    [
                        (listing.get("listing_type"), listing.get("id"))
                        for listing in listings
                    ]
                )
                for listing in listings:
                    backend._admin_attach_latest_verification_scan(listing, latest_scan_map)
            except Exception as scan_err:
                backend.logger.exception(
                    "admin_listings_search: verification scan enrichment failed — %s",
                    scan_err,
                )

        return jsonify({"listings": listings, "metadata": dict(counts)}), 200
    except Exception as e:
        backend.logger.exception("Error searching admin listings: %s", e)
        return jsonify({"error": "Failed to search listings"}), 500


def register_admin_listing_search_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/admin/listings-search",
        endpoint="admin_listings_search",
        view_func=admin_listings_search,
        methods=["GET"],
    )
    
