"""Admin listing deletion route.

The soft-delete implementation and notification helpers remain shared runtime
services so this boundary changes composition without changing deletion policy.
"""

from functools import wraps

import requests
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


@_token_required
def delete_listing(current_user, item_type, item_id):
    """Soft-delete a listing (admin only)."""
    backend = _backend()
    try:
        user_details = backend._get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        valid_types = {"car", "bike", "car-part", "part", "plate"}
        if item_type not in valid_types:
            return jsonify({"error": "Invalid item type"}), 400

        table_name = {
            "car": "cars",
            "bike": "bikes",
            "car-part": "car_parts",
            "part": "car_parts",
            "plate": "license_plates",
        }[item_type]
        delete_reason = "Removed by admin"
        if request.is_json and request.json:
            delete_reason = (
                request.json.get("reason")
                or request.json.get("deletion_reason")
                or delete_reason
            )

        headers = {
            "apikey": backend.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {backend.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        owner_email = None
        listing_title = f"{item_type.title()} listing"
        try:
            fetch_url = (
                f"{backend.SUPABASE_URL}/rest/v1/{table_name}?id=eq.{item_id}"
                "&select=user_id,user_email,contact_email,car_manufacturer,car_model,"
                "car_trim,bike_brand,bike_model,part_name,title,plate_code,plate_number"
            )
            fetch_response = requests.get(fetch_url, headers=headers)
            if fetch_response.status_code == 200:
                fetch_data = fetch_response.json()
                if isinstance(fetch_data, list) and fetch_data:
                    listing = fetch_data[0]
                    owner_email = listing.get("user_email") or listing.get("contact_email")
                    if not owner_email and listing.get("user_id"):
                        owner_email = backend.get_user_email(listing["user_id"])
                    if item_type in ("car", "car-part", "part"):
                        manufacturer = listing.get("car_manufacturer", "")
                        model = listing.get("car_model", "")
                        trim = listing.get("car_trim", "")
                        part_name = listing.get("part_name") or listing.get("title", "")
                        if manufacturer or model:
                            listing_title = f"{manufacturer} {model} {trim}".strip()
                        elif part_name:
                            listing_title = part_name
                    elif item_type == "bike":
                        brand = listing.get("bike_brand", "")
                        model = listing.get("bike_model", "")
                        if brand or model:
                            listing_title = f"{brand} {model}".strip()
                    elif item_type == "plate":
                        code = listing.get("plate_code", "")
                        number = listing.get("plate_number", "")
                        if code or number:
                            listing_title = f"{code} {number}".strip()
        except Exception as fetch_error:
            backend.logger.warning(
                f"Could not fetch listing data before delete: {fetch_error}"
            )

        delete_response, delete_status = backend._soft_delete_listing(
            table_name,
            item_id,
            deleted_by_role="admin",
            deleted_by=current_user,
            reason=delete_reason,
            metadata={"endpoint": "admin_delete"},
        )

        if delete_status < 400:
            normalized_type = "part" if item_type == "car-part" else item_type
            if owner_email and owner_email != "unknown@example.com":
                try:
                    backend._send_listing_deleted_email(
                        user_email=owner_email,
                        item_type=normalized_type,
                        listing_title=listing_title,
                        listing_id=item_id,
                        reason=delete_reason,
                    )
                except Exception as email_error:
                    backend.logger.warning(
                        f"Failed to send deletion email for {item_id}: {email_error}"
                    )

            backend.logger.info(f"Admin {current_user} deleted {item_type} {item_id}")
            return jsonify({"message": f"{item_type.title()} deleted successfully"}), 200

        backend.logger.error(f"Failed to delete {item_type} {item_id}: {delete_status}")
        return jsonify({"error": "Failed to delete listing"}), delete_status

    except Exception as exc:
        backend.logger.error(f"Error deleting {item_type} {item_id}: {str(exc)}")
        return jsonify({"error": str(exc)}), 500


def register_admin_listing_delete_routes(app: Flask) -> None:
    app.add_url_rule(
        "/api/<item_type>/<item_id>/delete",
        endpoint="delete_listing",
        view_func=delete_listing,
        methods=["DELETE"],
    )

