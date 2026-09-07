"""Authenticated user listing statistics route."""

from functools import wraps

from flask import Blueprint, current_app


statistics_bp = Blueprint("statistics", __name__)


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


@statistics_bp.route("/api/user/statistics", methods=["GET"])
@_token_required
def get_user_statistics(current_user):
    """Get user listing statistics"""
    try:
        logger.debug(f"Getting statistics for user ID: {current_user}")

        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        base_url = app.config["SUPABASE_URL"]

        # Only count the user's OWN live listings. Exclude soft-deleted rows
        # (deleted_at) so the profile matches "My Listings" (_get_user_listing_count).
        deleted_filter = "&deleted_at=is.null"

        # Count cars
        cars_response = requests.get(
            f"{base_url}/rest/v1/cars?user_id=eq.{current_user}&select=id,status,view_count{deleted_filter}",
            headers=headers,
        )

        # Count bikes
        bikes_response = requests.get(
            f"{base_url}/rest/v1/bikes?user_id=eq.{current_user}&select=id,status,view_count{deleted_filter}",
            headers=headers,
        )

        # Count plates
        plates_response = requests.get(
            f"{base_url}/rest/v1/license_plates?user_id=eq.{current_user}&select=id,status,view_count{deleted_filter}",
            headers=headers,
        )

        # Count parts
        parts_response = requests.get(
            f"{base_url}/rest/v1/car_parts?user_id=eq.{current_user}&select=id,status{deleted_filter}",
            headers=headers,
        )

        # Process results. If deleted_at column isn't present yet the query 400s,
        # so fall back to an unfiltered fetch (mirrors _get_user_listing_count).
        def _fetch_or_fallback(response, table, select):
            if response.status_code == 200:
                return response.json()
            fb = requests.get(
                f"{base_url}/rest/v1/{table}?user_id=eq.{current_user}&select={select}",
                headers=headers,
            )
            return fb.json() if fb.status_code == 200 else []

        cars = _fetch_or_fallback(cars_response, "cars", "id,status,view_count")
        bikes = _fetch_or_fallback(bikes_response, "bikes", "id,status,view_count")
        plates = _fetch_or_fallback(plates_response, "license_plates", "id,status,view_count")
        parts = _fetch_or_fallback(parts_response, "car_parts", "id,status")

        # Terminal statuses aren't the user's live listings; drop them so the
        # count matches what "My Listings" shows (active + drafts they own).
        def _is_live(item):
            return str(item.get("status") or "").strip().lower() not in LISTING_TERMINAL_STATUSES

        cars = [c for c in cars if _is_live(c)]
        bikes = [b for b in bikes if _is_live(b)]
        plates = [p for p in plates if _is_live(p)]
        parts = [p for p in parts if _is_live(p)]

        all_listings = cars + bikes + plates + parts

        # Calculate statistics
        total_listings = len(all_listings)
        active_listings = sum(
            1 for item in all_listings if item.get("status") == "approved"
        )
        pending_listings = sum(
            1 for item in all_listings if item.get("status") == "pending"
        )

        # Calculate total views (only cars, bikes, and plates have view counts)
        total_views = sum(item.get("view_count", 0) for item in (cars + bikes + plates))

        # Get user creation date
        user_response = requests.get(
            f"{base_url}/rest/v1/users?id=eq.{current_user}&select=created_at",
            headers=headers,
        )

        member_since = None
        if user_response.status_code == 200:
            users = user_response.json()
            if users:
                member_since = users[0].get("created_at")

        # Saved-listings count. Use the same source as the Saved list so the count
        # matches exactly (only currently-available listings, orphans purged) — a
        # raw saved_listings row count would include removed/expired items.
        try:
            saved_payload, saved_status = _fetch_saved_listing_cards(current_user)
            saved_count = saved_payload.get("total", 0) if saved_status < 400 else 0
        except Exception:
            saved_count = 0

        statistics = {
            "total_listings": total_listings,
            "active_listings": active_listings,
            "sold_listings": 0,  # Placeholder for future feature
            "pending_listings": pending_listings,
            "total_views": total_views,
            "saved_count": saved_count,
            "member_since": member_since,
        }

        logger.debug(f"Statistics calculated for user: {statistics}")
        return jsonify(statistics), 200

    except Exception as e:
        logger.error(f"Error in get_user_statistics: {str(e)}")
        return jsonify({"error": str(e)}), 500




def register_statistics_routes(app, backend_symbols):
    globals().update(backend_symbols)
    for name in ("_fetch_saved_listing_cards",):
        def _live_helper(*args, _name=name, **kwargs):
            return backend_symbols[_name](*args, **kwargs)

        globals()[name] = _live_helper
    app.register_blueprint(statistics_bp)
