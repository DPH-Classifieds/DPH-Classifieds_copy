"""
Admin routes for managing listings, users, reports, and dealers
"""

from flask import Blueprint, jsonify, request
from functools import wraps
from collections import defaultdict
from datetime import datetime, timedelta
import logging
import requests
import os

logger = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

# Get config from environment
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def admin_required(f):
    """Decorator to check if user is admin"""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get user from request context (set by token_required)
        auth_header = request.headers.get("Authorization")

        if not auth_header:
            return jsonify({"error": "Authentication required"}), 401

        # Extract token
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return jsonify({"error": "Invalid Authorization format"}), 401

        token = parts[1]

        # Validate token and check admin status
        try:
            # First validate the token with Supabase Auth
            auth_headers = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {token}",
            }

            auth_response = requests.get(
                f"{SUPABASE_URL}/auth/v1/user", headers=auth_headers, timeout=5
            )

            if auth_response.status_code != 200:
                return jsonify({"error": "Invalid or expired token"}), 401

            user_data = auth_response.json()
            user_id = user_data.get("id")

            if not user_id:
                return jsonify({"error": "Invalid user data"}), 401

            user_role = user_data.get("role", "")
            is_supabase_superadmin = user_role == "superadmin"

            # Check if user is admin via database
            headers = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            }

            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=is_admin",
                headers=headers,
                timeout=5,
            )

            is_db_admin = False
            if response.status_code == 200:
                users = response.json()
                is_db_admin = users and len(users) > 0 and users[0].get("is_admin")

            if is_supabase_superadmin or is_db_admin:
                request.user_id = user_id
                return f(*args, **kwargs)

            return jsonify({"error": "Admin access required"}), 403

        except Exception as e:
            logger.error(f"Error checking admin status: {e}")
            return jsonify({"error": "Authorization check failed"}), 500

    return decorated_function


def _admin_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _admin_fetch_user(user_id):
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=*",
        headers=_admin_headers(),
        timeout=10,
    )
    if response.status_code != 200:
        return None
    rows = response.json() or []
    return rows[0] if rows else None


def _admin_listing_config(item_type):
    normalized = (item_type or "").strip().lower().rstrip("s")
    return {
        "car": {"table": "cars", "image_table": "car_images", "fk": "car_id", "label": "cars"},
        "bike": {"table": "bikes", "image_table": "bike_images", "fk": "bike_id", "label": "bikes"},
        "part": {"table": "car_parts", "image_table": "part_images", "fk": "part_id", "label": "parts"},
        "plate": {"table": "license_plates", "image_table": "plate_images", "fk": "plate_id", "label": "plates"},
    }.get(normalized)


def _admin_listing_brief(listing_type, row):
    title = (
        row.get("display_title")
        or row.get("listing_title")
        or row.get("title")
        or row.get("name")
        or row.get("car_model")
        or row.get("bike_model")
        or row.get("code")
        or row.get("number")
        or "Untitled listing"
    )
    price = row.get("display_price") or row.get("price") or row.get("expected_selling_price")
    return {
        "id": row.get("id"),
        "type": listing_type,
        "title": title,
        "status": row.get("status") or "unknown",
        "view_count": int(row.get("view_count") or 0),
        "price": price,
        "created_at": row.get("created_at"),
        "last_viewed_at": row.get("last_viewed_at"),
        "user_id": row.get("user_id"),
    }


def _admin_owned_listing_stats(user_id):
    summary = {
        "cars": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
        "bikes": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
        "parts": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
        "plates": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
    }
    owned_listing_ids = defaultdict(list)
    recent_listings = []

    for listing_type, cfg in {
        "cars": {"table": "cars"},
        "bikes": {"table": "bikes"},
        "parts": {"table": "car_parts"},
        "plates": {"table": "license_plates"},
    }.items():
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/{cfg['table']}",
            headers=_admin_headers(),
            params={"select": "*", "user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": "50"},
            timeout=15,
        )
        rows = response.json() if response.status_code == 200 else []
        for row in rows or []:
            summary[listing_type]["count"] += 1
            summary[listing_type]["views"] += int(row.get("view_count") or 0)
            status = (row.get("status") or "pending").lower()
            if status in summary[listing_type]:
                summary[listing_type][status] += 1
            owned_listing_ids[listing_type].append(str(row.get("id")))
            brief = _admin_listing_brief(listing_type, row)
            if brief:
                recent_listings.append(brief)

    recent_listings.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return summary, recent_listings[:20], owned_listing_ids


def _admin_user_activity(user_id, owned_listing_ids, days=90):
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    lead_events_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/lead_events",
        headers=_admin_headers(),
        params={"select": "*", "created_at": f"gte.{cutoff}", "order": "created_at.desc", "limit": "2000"},
        timeout=20,
    )
    lead_events = lead_events_resp.json() if lead_events_resp.status_code == 200 else []
    report_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/reports",
        headers=_admin_headers(),
        params={"select": "id,listing_id,listing_type,status,reason,details,created_at,reviewed_by,reviewed_at", "created_at": f"gte.{cutoff}", "order": "created_at.desc", "limit": "500"},
        timeout=20,
    )
    reports = report_resp.json() if report_resp.status_code == 200 else []

    recent_events = []
    lead_totals = defaultdict(int)
    for event in lead_events or []:
        listing_type = (event.get("listing_type") or "").rstrip("s")
        listing_id = str(event.get("listing_id"))
        if listing_id in owned_listing_ids.get(listing_type, []):
            recent_events.append(event)
            lead_totals[event.get("action") or "unknown"] += 1

    owned_listing_set = {listing_id for ids in owned_listing_ids.values() for listing_id in ids}
    user_reports = []
    for report in reports or []:
        if report.get("reporter_id") == user_id or str(report.get("listing_id")) in owned_listing_set:
            user_reports.append(report)

    return {
        "lead_totals": dict(lead_totals),
        "recent_events": recent_events[:100],
        "reports": user_reports[:100],
    }


# Listings Management
@admin_bp.route("/listings", methods=["GET"])
@admin_required
def get_all_listings():
    """Get all listings with user details for admin review"""
    try:
        listing_type = request.args.get("type", "cars")  # cars, bikes, plates, parts
        status = request.args.get("status")  # pending, approved, rejected

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Build query
        table_map = {
            "cars": "cars",
            "bikes": "bikes",
            "plates": "license_plates",
            "parts": "car_parts",
        }

        table = table_map.get(listing_type, "cars")
        query = f"{SUPABASE_URL}/rest/v1/{table}?select=*,users(email,first_name,last_name,username)&order=created_at.desc"

        if status:
            query += f"&status=eq.{status}"

        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            listings = response.json()

            # Enhance with user info for display
            for listing in listings:
                user_info = listing.pop("users", {})
                if user_info:
                    listing["user_email"] = user_info.get("email")
                    listing["user_name"] = (
                        f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip()
                        or user_info.get("username", "Unknown")
                    )
                else:
                    listing["user_email"] = "Unknown"
                    listing["user_name"] = "Unknown"

                # Create display title
                if listing_type == "cars":
                    listing["display_title"] = (
                        f"{listing.get('make_year', '')} {listing.get('car_manufacturer', '')} {listing.get('car_model', '')} — posted by {listing['user_name']}"
                    )
                elif listing_type == "bikes":
                    listing["display_title"] = (
                        f"{listing.get('make_year', '')} {listing.get('make', '')} {listing.get('model', '')} — posted by {listing['user_name']}"
                    )
                elif listing_type == "plates":
                    listing["display_title"] = (
                        f"{listing.get('city', '')} {listing.get('code', '')} {listing.get('number', '')} — posted by {listing['user_name']}"
                    )
                else:
                    listing["display_title"] = (
                        f"{listing.get('title', 'Unknown listing')} — posted by {listing['user_name']}"
                    )

            return jsonify(listings), 200
        else:
            return jsonify({"error": "Failed to fetch listings"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching admin listings: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/listings/<listing_id>/approve", methods=["POST"])
@admin_required
def approve_listing(listing_id):
    """Approve a listing"""
    try:
        listing_type = request.json.get("type", "cars")

        table_map = {
            "cars": "cars",
            "bikes": "bikes",
            "plates": "license_plates",
            "parts": "car_parts",
        }

        table = table_map.get(listing_type, "cars")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        update_data = {
            "status": "approved",
            "is_approved": True,
            "approved_at": "now()",
            "approved_by": request.user_id,
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{listing_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            # Send email notification
            try:
                from app import _get_user_email_by_id, _send_listing_status_email
                
                updated_listings = response.json()
                if updated_listings and len(updated_listings) > 0:
                    listing = updated_listings[0]
                    user_id = listing.get("user_id")
                    if user_id:
                        user_info = _get_user_email_by_id(user_id)
                        if user_info and user_info.get("email"):
                            _send_listing_status_email(
                                user_info["email"], 
                                listing_type, 
                                listing, 
                                "approved"
                            )
            except Exception as email_err:
                logger.error(f"Failed to send approval email: {email_err}")

            return jsonify({"message": "Listing approved successfully"}), 200
        else:
            return jsonify({"error": "Failed to approve listing"}), response.status_code

    except Exception as e:
        logger.error(f"Error approving listing: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/listings/<listing_id>/reject", methods=["POST"])
@admin_required
def reject_listing(listing_id):
    """Reject a listing"""
    try:
        listing_type = request.json.get("type", "cars")
        reason = request.json.get("reason", "")

        table_map = {
            "cars": "cars",
            "bikes": "bikes",
            "plates": "license_plates",
            "parts": "car_parts",
        }

        table = table_map.get(listing_type, "cars")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        update_data = {
            "status": "rejected",
            "is_approved": False,
            "rejected_at": "now()",
            "rejected_by": request.user_id,
            "rejection_reason": reason,
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{listing_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            # Send email notification
            try:
                from app import _get_user_email_by_id, _send_listing_status_email
                
                updated_listings = response.json()
                if updated_listings and len(updated_listings) > 0:
                    listing = updated_listings[0]
                    user_id = listing.get("user_id")
                    if user_id:
                        user_info = _get_user_email_by_id(user_id)
                        if user_info and user_info.get("email"):
                            _send_listing_status_email(
                                user_info["email"], 
                                listing_type, 
                                listing, 
                                "rejected"
                            )
            except Exception as email_err:
                logger.error(f"Failed to send rejection email: {email_err}")

            return jsonify({"message": "Listing rejected successfully"}), 200
        else:
            return jsonify({"error": "Failed to reject listing"}), response.status_code

    except Exception as e:
        logger.error(f"Error rejecting listing: {e}")
        return jsonify({"error": str(e)}), 500


# Approve routes matching frontend expectations: /api/admin/approve/<item_type>
@admin_bp.route("/approve/<item_type>")
@admin_required
def list_pending_items(item_type):
    """Get listings by item type and status (cars, bikes, parts, plates)"""
    valid_item_types = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
    }
    image_tables = {
        "cars": ("car_images", "car_id"),
        "bikes": ("bike_images", "bike_id"),
        "parts": ("part_images", "part_id"),
        "plates": ("plate_images", "plate_id"),
    }
    if item_type not in valid_item_types:
        return jsonify({"error": f"Invalid item type: {item_type}"}), 400

    status = request.args.get("status", "pending")
    if status not in ("pending", "approved", "rejected"):
        status = "pending"

    table_name = valid_item_types[item_type]
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        query = f"{SUPABASE_URL}/rest/v1/{table_name}?status=eq.{status}&select=*&order=created_at.desc"
        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code != 200:
            logger.error(f"Error fetching pending {item_type}: {response.status_code}")
            return jsonify({"error": f"Error fetching pending {item_type}"}), 500

        listings = response.json()

        img_table, img_fk = image_tables.get(item_type, (None, None))

        for listing in listings:
            user_id = listing.get("user_id")
            if user_id:
                user_query = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=email,first_name,last_name,username,phone"
                user_resp = requests.get(user_query, headers=headers, timeout=5)
                if user_resp.status_code == 200 and user_resp.json():
                    user_info = user_resp.json()[0]
                    listing["user_email"] = user_info.get("email", "N/A")
                    listing["user_name"] = (
                        f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip()
                        or user_info.get("username", "Unknown")
                    )
                else:
                    listing["user_email"] = "N/A"
                    listing["user_name"] = "Unknown"
            else:
                listing["user_email"] = "N/A"
                listing["user_name"] = "Unknown"

            if img_table:
                img_query = f"{SUPABASE_URL}/rest/v1/{img_table}?{img_fk}=eq.{listing['id']}&select=*"
                img_resp = requests.get(img_query, headers=headers, timeout=5)
                if img_resp.status_code == 200:
                    images = img_resp.json()
                    for img in images:
                        if "url" in img and not img.get("image_url"):
                            img["image_url"] = img["url"]
                        elif "image_url" in img and not img.get("url"):
                            img["url"] = img["image_url"]
                    listing["images"] = images
                else:
                    listing["images"] = []

            if item_type == "cars":
                listing["display_title"] = (
                    f"{listing.get('make_year', '')} {listing.get('car_manufacturer', '')} {listing.get('car_model', '')}"
                ).strip()
                listing["display_price"] = listing.get("expected_selling_price")
                listing["display_description"] = listing.get("car_description", "")
                listing["display_make"] = listing.get("car_manufacturer", "")
                listing["display_model"] = listing.get("car_model", "")
                listing["display_year"] = listing.get("make_year", "")
                listing["display_mileage"] = listing.get("kilometer_driven")
            elif item_type == "bikes":
                listing["display_title"] = (
                    f"{listing.get('make_year', '')} {listing.get('make', '') or listing.get('bike_brand', '')} {listing.get('model', '') or listing.get('bike_model', '')}"
                ).strip()
                listing["display_price"] = listing.get("price")
                listing["display_description"] = listing.get("description", "")
            elif item_type == "plates":
                listing["display_title"] = (
                    f"{listing.get('city', '')} {listing.get('code', '')} {listing.get('number', '')}"
                ).strip()
                listing["display_price"] = listing.get("price")
                listing["display_description"] = listing.get("description", "")
            elif item_type == "parts":
                listing["display_title"] = listing.get("name", "Car Part")
                listing["display_price"] = listing.get("price")
                listing["display_description"] = listing.get("description", "")

        return jsonify(listings), 200
    except Exception as e:
        logger.error(f"Exception fetching pending {item_type}: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/approve/<item_type>/<item_id>/approve", methods=["POST"])
@admin_required
def approve_item(item_type, item_id):
    """Approve a pending listing"""
    valid_item_types = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
    }
    if item_type not in valid_item_types:
        return jsonify({"error": f"Invalid item type: {item_type}"}), 400

    table_name = valid_item_types[item_type]
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        update_data = {
            "status": "approved",
            "is_approved": True,
        }
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table_name}?id=eq.{item_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )
        if response.status_code in [200, 204]:
            # Send email notification
            try:
                from app import _get_user_email_by_id, _send_listing_status_email
                
                updated_listings = response.json()
                if updated_listings and len(updated_listings) > 0:
                    listing = updated_listings[0]
                    user_id = listing.get("user_id")
                    if user_id:
                        user_info = _get_user_email_by_id(user_id)
                        if user_info and user_info.get("email"):
                            _send_listing_status_email(
                                user_info["email"], 
                                item_type, 
                                listing, 
                                "approved"
                            )
            except Exception as email_err:
                logger.error(f"Failed to send approval email: {email_err}")

            return jsonify(
                {"success": True, "message": f"{item_type} {item_id} approved"}
            ), 200
        else:
            logger.error(
                f"Error approving {item_type} {item_id}: {response.status_code}"
            )
            return jsonify({"error": f"Error approving item"}), 500
    except Exception as e:
        logger.error(f"Exception approving {item_type} {item_id}: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/approve/<item_type>/<item_id>/reject", methods=["POST"])
@admin_required
def reject_item(item_type, item_id):
    """Reject a pending listing"""
    valid_item_types = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
    }
    if item_type not in valid_item_types:
        return jsonify({"error": f"Invalid item type: {item_type}"}), 400

    table_name = valid_item_types[item_type]
    try:
        data = request.get_json() or {}
        rejection_note = data.get("rejection_note", "")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        update_data = {
            "status": "rejected",
            "is_approved": False,
        }
        if rejection_note:
            update_data["rejection_note"] = rejection_note

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table_name}?id=eq.{item_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )
        if response.status_code in [200, 204]:
            # Send email notification
            try:
                from app import _get_user_email_by_id, _send_listing_status_email
                
                updated_listings = response.json()
                if updated_listings and len(updated_listings) > 0:
                    listing = updated_listings[0]
                    user_id = listing.get("user_id")
                    if user_id:
                        user_info = _get_user_email_by_id(user_id)
                        if user_info and user_info.get("email"):
                            _send_listing_status_email(
                                user_info["email"], 
                                item_type, 
                                listing, 
                                "rejected"
                            )
            except Exception as email_err:
                logger.error(f"Failed to send rejection email: {email_err}")

            return jsonify(
                {"success": True, "message": f"{item_type} {item_id} rejected"}
            ), 200
        else:
            logger.error(
                f"Error rejecting {item_type} {item_id}: {response.status_code}"
            )
            return jsonify({"error": f"Error rejecting item"}), 500
    except Exception as e:
        logger.error(f"Exception rejecting {item_type} {item_id}: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/listings/<listing_id>/delete", methods=["DELETE"])
@admin_required
def delete_listing(listing_id):
    """Delete a listing (admin only)"""
    try:
        listing_type = request.args.get("type", "cars")

        table_map = {
            "cars": "cars",
            "bikes": "bikes",
            "plates": "license_plates",
            "parts": "car_parts",
        }

        table = table_map.get(listing_type, "cars")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Delete associated images first
        image_table_map = {
            "cars": "car_images",
            "bikes": "bike_images",
            "plates": "plate_images",
            "parts": "part_images",
        }

        image_table = image_table_map.get(listing_type)
        if image_table:
            id_field = f"{listing_type[:-1] if listing_type.endswith('s') else listing_type}_id"
            if listing_type == "plates":
                id_field = "plate_id"

            requests.delete(
                f"{SUPABASE_URL}/rest/v1/{image_table}?{id_field}=eq.{listing_id}",
                headers=headers,
                timeout=5,
            )

        # Delete the listing
        response = requests.delete(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{listing_id}",
            headers=headers,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            return jsonify({"message": "Listing deleted successfully"}), 200
        else:
            return jsonify({"error": "Failed to delete listing"}), response.status_code

    except Exception as e:
        logger.error(f"Error deleting listing: {e}")
        return jsonify({"error": str(e)}), 500


# Reports Management
@admin_bp.route("/reports", methods=["GET"])
@admin_required
def get_reports():
    """Get all reports"""
    try:
        status = request.args.get("status")  # pending, resolved, dismissed

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Fetch reports
        query = f"{SUPABASE_URL}/rest/v1/reports?select=*&order=created_at.desc"

        if status:
            query += f"&status=eq.{status}"

        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            reports = response.json()

            # Enhance with reporter info
            for report in reports:
                reporter_id = report.get("reporter_id")
                if reporter_id:
                    user_query = f"{SUPABASE_URL}/rest/v1/users?id=eq.{reporter_id}&select=email,username"
                    user_response = requests.get(user_query, headers=headers, timeout=5)
                    if user_response.status_code == 200 and user_response.json():
                        reporter = user_response.json()[0]
                        report["reporter_email"] = reporter.get("email")
                        report["reporter_username"] = reporter.get("username")

            return jsonify(reports), 200
        else:
            return jsonify({"error": "Failed to fetch reports"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching reports: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/reports/<report_id>/resolve", methods=["POST"])
@admin_required
def resolve_report(report_id):
    """Resolve a report"""
    try:
        action = request.json.get("action")  # 'dismiss' or 'action_taken'
        notes = request.json.get("notes", "")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        update_data = {
            "status": "resolved" if action == "action_taken" else "dismissed",
            "resolved_at": "now()",
            "resolved_by": request.user_id,
            "admin_notes": notes,
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/reports?id=eq.{report_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            return jsonify({"message": "Report resolved successfully"}), 200
        else:
            return jsonify({"error": "Failed to resolve report"}), response.status_code

    except Exception as e:
        logger.error(f"Error resolving report: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/dealers/pending", methods=["GET"])
@admin_required
def get_pending_dealers():
    """Get dealers with pending verification requests"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        query = (
            f"{SUPABASE_URL}/rest/v1/users?"
            "is_dealer=eq.true&dealer_verified=eq.false&dealer_verification_requested_at=not.is.null"
            "&select=*&order=created_at.desc"
        )
        response = requests.get(query, headers=headers, timeout=10)
        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            return jsonify(
                {"error": "Failed to fetch pending dealers"}
            ), response.status_code
    except Exception as e:
        logger.error(f"Error fetching pending dealers: {e}")
        return jsonify({"error": str(e)}), 500


# Dealer Management
@admin_bp.route("/dealers", methods=["GET"])
@admin_required
def get_dealers():
    """Get all dealers and pending dealer verification requests"""
    try:
        status = request.args.get("status")  # verified, pending, all

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        query = f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=*&order=created_at.desc"

        if status == "verified":
            query += "&dealer_verified=eq.true"
        elif status == "pending":
            query += (
                "&dealer_verified=eq.false&dealer_verification_requested_at=not.is.null"
            )

        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            return jsonify({"error": "Failed to fetch dealers"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching dealers: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/dealers/<user_id>/verify", methods=["POST"])
@admin_required
def verify_dealer(user_id):
    """Verify a dealer"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        update_data = {
            "dealer_verified": True,
            "dealer_verified_at": "now()",
            "dealer_verified_by": request.user_id,
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            return jsonify({"message": "Dealer verified successfully"}), 200
        else:
            return jsonify({"error": "Failed to verify dealer"}), response.status_code

    except Exception as e:
        logger.error(f"Error verifying dealer: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/dealers/<user_id>/reject", methods=["POST"])
@admin_required
def reject_dealer(user_id):
    """Reject dealer verification"""
    try:
        reason = request.json.get("reason", "")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        update_data = {
            "dealer_verified": False,
            "dealer_verification_rejected_at": "now()",
            "dealer_verification_rejected_by": request.user_id,
            "dealer_rejection_reason": reason,
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            return jsonify({"message": "Dealer verification rejected"}), 200
        else:
            return jsonify({"error": "Failed to reject dealer"}), response.status_code

    except Exception as e:
        logger.error(f"Error rejecting dealer: {e}")
        return jsonify({"error": str(e)}), 500


# User Management
@admin_bp.route("/users", methods=["GET"])
@admin_required
def get_users():
    """Get all users"""
    try:
        search = request.args.get("search", "")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        query = f"{SUPABASE_URL}/rest/v1/users?select=*&order=created_at.desc"

        if search:
            from urllib.parse import quote

            search_escaped = quote(search, safe="")
            query += f"&or=(email.ilike.*{search_escaped}*,username.ilike.*{search_escaped}*,first_name.ilike.*{search_escaped}*,last_name.ilike.*{search_escaped}*)"

        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            return jsonify({"error": "Failed to fetch users"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching users: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/users/<user_id>/make-admin", methods=["POST"])
@admin_required
def make_admin(user_id):
    """Make a user an admin"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json={"is_admin": True},
            timeout=5,
        )
        if response.status_code in [200, 204]:
            return jsonify(
                {"success": True, "message": "User made admin successfully"}
            ), 200
        else:
            return jsonify({"error": "Failed to make user admin"}), 500
    except Exception as e:
        logger.error(f"Error making user admin: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/users/<user_id>/remove-admin", methods=["POST"])
@admin_required
def remove_admin(user_id):
    """Remove admin privileges from a user"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json={"is_admin": False},
            timeout=5,
        )
        if response.status_code in [200, 204]:
            return jsonify(
                {"success": True, "message": "Admin privileges removed successfully"}
            ), 200
        else:
            return jsonify({"error": "Failed to remove admin privileges"}), 500
    except Exception as e:
        logger.error(f"Error removing admin privileges: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/users/<user_id>/status", methods=["PATCH"])
@admin_required
def update_user_status(user_id):
    """Update user account status (active/suspended)"""
    try:
        data = request.get_json() or {}
        new_status = data.get("status", "").lower()
        if new_status not in ("active", "suspended"):
            return jsonify({"error": "Status must be 'active' or 'suspended'"}), 400

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json={"account_status": new_status},
            timeout=5,
        )
        if response.status_code in [200, 204]:
            return jsonify(
                {"success": True, "message": f"User status changed to {new_status}"}
            ), 200
        else:
            return jsonify({"error": "Failed to update user status"}), 500
    except Exception as e:
        logger.error(f"Error updating user status: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/users/<user_id>", methods=["DELETE"])
@admin_required
def delete_user(user_id):
    """Delete a user (admin only)"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # First check if user exists
        check_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=id,email",
            headers=headers,
            timeout=5,
        )

        if check_response.status_code != 200 or not check_response.json():
            return jsonify({"error": "User not found"}), 404

        user_data = check_response.json()[0]

        # Delete from users table
        delete_response = requests.delete(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}", headers=headers, timeout=5
        )

        if delete_response.status_code in [200, 204]:
            logger.info(f"User {user_id} ({user_data.get('email')}) deleted by admin")
            return jsonify({"message": "User deleted successfully"}), 200
        else:
            logger.error(
                f"Failed to delete user {user_id}: {delete_response.status_code} - {delete_response.text}"
            )
            return jsonify(
                {"error": "Failed to delete user"}
            ), delete_response.status_code

    except Exception as e:
        logger.error(f"Error deleting user: {e}")
        return jsonify({"error": str(e)}), 500


# Specific listing type endpoints
@admin_bp.route("/plates", methods=["GET"])
@admin_required
def get_plates():
    """Get all license plate listings with user details"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Fetch plates
        query = f"{SUPABASE_URL}/rest/v1/license_plates?select=*&order=created_at.desc"
        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            listings = response.json()

            # Enhance with user info and images
            for listing in listings:
                user_id = listing.get("user_id")

                # Fetch user details
                if user_id:
                    user_query = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=email,first_name,last_name,phone"
                    user_response = requests.get(user_query, headers=headers, timeout=5)
                    if user_response.status_code == 200 and user_response.json():
                        user_info = user_response.json()[0]
                        listing["user_email"] = user_info.get("email", "N/A")
                        listing["user_name"] = (
                            f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip()
                            or "Unknown"
                        )
                        listing["contact_phone"] = user_info.get(
                            "phone"
                        ) or listing.get("contact_phone", "N/A")
                    else:
                        listing["user_email"] = "N/A"
                        listing["user_name"] = "Unknown"
                        listing["contact_phone"] = listing.get("contact_phone", "N/A")

                # Fetch images
                img_query = f"{SUPABASE_URL}/rest/v1/plate_images?select=*&plate_id=eq.{listing['id']}"
                img_response = requests.get(img_query, headers=headers, timeout=5)
                if img_response.status_code == 200:
                    listing["images"] = img_response.json()
                else:
                    listing["images"] = []

            return jsonify(listings), 200
        else:
            return jsonify({"error": "Failed to fetch plates"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching plates: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/cars", methods=["GET"])
@admin_required
def get_cars():
    """Get all car listings with user details"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Fetch cars
        query = f"{SUPABASE_URL}/rest/v1/cars?select=*&order=created_at.desc"
        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            listings = response.json()

            # Enhance with user info and images
            for listing in listings:
                user_id = listing.get("user_id")

                # Fetch user details
                if user_id:
                    user_query = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=email,first_name,last_name,phone"
                    user_response = requests.get(user_query, headers=headers, timeout=5)
                    if user_response.status_code == 200 and user_response.json():
                        user_info = user_response.json()[0]
                        listing["user_email"] = user_info.get("email", "N/A")
                        listing["user_name"] = (
                            f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip()
                            or "Unknown"
                        )
                        listing["car_owner_phone_number"] = user_info.get(
                            "phone"
                        ) or listing.get("car_owner_phone_number", "N/A")
                    else:
                        listing["user_email"] = "N/A"
                        listing["user_name"] = "Unknown"
                        listing["car_owner_phone_number"] = listing.get(
                            "car_owner_phone_number", "N/A"
                        )

                # Fetch images
                img_query = f"{SUPABASE_URL}/rest/v1/car_images?select=*&car_id=eq.{listing['id']}"
                img_response = requests.get(img_query, headers=headers, timeout=5)
                if img_response.status_code == 200:
                    images = img_response.json()
                    # Ensure both url and image_url fields
                    for img in images:
                        if "url" in img and "image_url" not in img:
                            img["image_url"] = img["url"]
                    listing["images"] = images
                else:
                    listing["images"] = []

            return jsonify(listings), 200
        else:
            return jsonify({"error": "Failed to fetch cars"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching cars: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/bikes", methods=["GET"])
@admin_required
def get_bikes():
    """Get all bike listings with user details"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Fetch bikes
        query = f"{SUPABASE_URL}/rest/v1/bikes?select=*&order=created_at.desc"
        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            listings = response.json()

            # Enhance with user info and images
            for listing in listings:
                user_id = listing.get("user_id")

                # Fetch user details
                if user_id:
                    user_query = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=email,first_name,last_name,phone"
                    user_response = requests.get(user_query, headers=headers, timeout=5)
                    if user_response.status_code == 200 and user_response.json():
                        user_info = user_response.json()[0]
                        listing["user_email"] = user_info.get("email", "N/A")
                        listing["user_name"] = (
                            f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip()
                            or "Unknown"
                        )
                        listing["contact_phone"] = user_info.get(
                            "phone"
                        ) or listing.get("contact_phone", "N/A")
                    else:
                        listing["user_email"] = "N/A"
                        listing["user_name"] = "Unknown"
                        listing["contact_phone"] = listing.get("contact_phone", "N/A")

                # Fetch images
                img_query = f"{SUPABASE_URL}/rest/v1/bike_images?select=*&bike_id=eq.{listing['id']}"
                img_response = requests.get(img_query, headers=headers, timeout=5)
                if img_response.status_code == 200:
                    listing["images"] = img_response.json()
                else:
                    listing["images"] = []

            return jsonify(listings), 200
        else:
            return jsonify({"error": "Failed to fetch bikes"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching bikes: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/parts", methods=["GET"])
@admin_required
def get_parts():
    """Get all car parts listings with user details"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Fetch parts
        query = f"{SUPABASE_URL}/rest/v1/car_parts?select=*&order=created_at.desc"
        response = requests.get(query, headers=headers, timeout=10)

        if response.status_code == 200:
            listings = response.json()

            # Enhance with user info and images
            for listing in listings:
                user_id = listing.get("user_id")

                # Fetch user details
                if user_id:
                    user_query = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=email,first_name,last_name,phone"
                    user_response = requests.get(user_query, headers=headers, timeout=5)
                    if user_response.status_code == 200 and user_response.json():
                        user_info = user_response.json()[0]
                        listing["user_email"] = user_info.get("email", "N/A")
                        listing["user_name"] = (
                            f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip()
                            or "Unknown"
                        )
                        listing["contact_phone"] = user_info.get(
                            "phone"
                        ) or listing.get("contact_phone", "N/A")
                    else:
                        listing["user_email"] = "N/A"
                        listing["user_name"] = "Unknown"
                        listing["contact_phone"] = listing.get("contact_phone", "N/A")

                # Fetch images
                img_query = f"{SUPABASE_URL}/rest/v1/part_images?select=*&part_id=eq.{listing['id']}"
                img_response = requests.get(img_query, headers=headers, timeout=5)
                if img_response.status_code == 200:
                    listing["images"] = img_response.json()
                else:
                    listing["images"] = []

            return jsonify(listings), 200
        else:
            return jsonify({"error": "Failed to fetch parts"}), response.status_code

    except Exception as e:
        logger.error(f"Error fetching parts: {e}")
        return jsonify({"error": str(e)}), 500


# Analytics and Stats
@admin_bp.route("/stats", methods=["GET"])
@admin_required
def get_stats():
    """Get overall statistics for admin dashboard"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        stats = {
            "cars_total": 0, "cars_pending": 0, "cars_views": 0,
            "bikes_total": 0, "bikes_pending": 0, "bikes_views": 0,
            "plates_total": 0, "plates_pending": 0, "plates_views": 0,
            "parts_total": 0, "parts_pending": 0, "parts_views": 0,
            "total_leads": 0, "total_calls": 0, "total_whatsapp": 0,
            "total_vin_reveals": 0,
            "total_dealers": 0, "verified_dealers": 0,
            "total_users": 0, "total_reports": 0, "pending_reports": 0
        }

        # Get stats for each listing type
        for table, key_prefix in [
            ("cars", "cars"),
            ("bikes", "bikes"),
            ("license_plates", "plates"),
            ("car_parts", "parts"),
        ]:
            query = f"{SUPABASE_URL}/rest/v1/{table}?select=status,view_count"
            response = requests.get(query, headers=headers, timeout=5)

            if response.status_code == 200:
                listings = response.json()
                stats[f"{key_prefix}_total"] = len(listings)
                stats[f"{key_prefix}_pending"] = sum(1 for l in listings if l.get("status") == "pending")
                stats[f"{key_prefix}_views"] = sum(l.get("view_count", 0) or 0 for l in listings)

        # Get lead metrics from lead_events table
        lead_query = f"{SUPABASE_URL}/rest/v1/lead_events?select=action"
        lead_response = requests.get(lead_query, headers=headers, timeout=5)
        if lead_response.status_code == 200:
            events = lead_response.json()
            stats["total_leads"] = len(events)
            stats["total_calls"] = sum(1 for e in events if e.get("action") == "call_click")
            stats["total_whatsapp"] = sum(1 for e in events if e.get("action") == "whatsapp_click")
            stats["total_vin_reveals"] = sum(1 for e in events if e.get("action") == "vin_reveal")

        # Get dealer stats
        dealer_query = f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=dealer_verified"
        dealer_response = requests.get(dealer_query, headers=headers, timeout=5)
        if dealer_response.status_code == 200:
            dealers = dealer_response.json()
            stats["total_dealers"] = len(dealers)
            stats["verified_dealers"] = sum(1 for d in dealers if d.get("dealer_verified"))

        # Get user count
        user_query = f"{SUPABASE_URL}/rest/v1/users?select=id"
        user_response = requests.get(user_query, headers=headers, timeout=5)
        if user_response.status_code == 200:
            stats["total_users"] = len(user_response.json())

        # Get report stats
        report_query = f"{SUPABASE_URL}/rest/v1/reports?select=status"
        report_response = requests.get(report_query, headers=headers, timeout=5)
        if report_response.status_code == 200:
            reports = report_response.json()
            stats["total_reports"] = len(reports)
            stats["pending_reports"] = sum(1 for r in reports if r.get("status") == "pending")

        return jsonify(stats), 200

    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/listing-history", methods=["GET"])
@admin_required
def get_listing_history():
    """History of listing removals for the admin dashboard."""
    try:
        limit = max(min(int(request.args.get("limit", 200)), 500), 1)
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/listing_deletion_events",
            headers=_admin_headers(),
            params={"select": "*", "order": "created_at.desc", "limit": str(limit)},
            timeout=15,
        )
        if response.status_code != 200:
            return jsonify({"error": "Failed to fetch listing history"}), response.status_code
        return jsonify(response.json() or []), 200
    except Exception as e:
        logger.error(f"Error fetching listing history: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/lead-metrics", methods=["GET"])
@admin_required
def get_lead_metrics():
    """Admin lead metrics summary + recent events."""
    try:
        days = max(min(int(request.args.get("days", 30)), 90), 1)
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

        lead_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers=_admin_headers(),
            params={"select": "action", "created_at": f"gte.{cutoff}"},
            timeout=20,
        )
        lead_rows = lead_resp.json() if lead_resp.status_code == 200 else []

        recent_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers=_admin_headers(),
            params={"select": "*", "created_at": f"gte.{cutoff}", "order": "created_at.desc", "limit": "100"},
            timeout=20,
        )
        recent_rows = recent_resp.json() if recent_resp.status_code == 200 else []

        reports_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/reports",
            headers=_admin_headers(),
            params={"select": "id,listing_id,listing_type,status,created_at", "created_at": f"gte.{cutoff}", "order": "created_at.desc", "limit": "100"},
            timeout=20,
        )
        report_rows = reports_resp.json() if reports_resp.status_code == 200 else []

        totals = defaultdict(int)
        for event in lead_rows or []:
            totals[event.get("action") or "unknown"] += 1

        qualified = totals["call_click"] + totals["whatsapp_click"]
        report_count = len(report_rows or [])
        conversion_rate = round((report_count / qualified) * 100, 2) if qualified else 0

        return jsonify({
            "window_days": days,
            "totals": {
                "call_click": totals["call_click"],
                "whatsapp_click": totals["whatsapp_click"],
                "vin_open": totals["vin_open"],
                "vin_reveal": totals["vin_reveal"],
                "qualified_leads": qualified,
                "reports_created": report_count,
                "report_conversion_percent": conversion_rate,
            },
            "recent_events": recent_rows or [],
            "recent_reports": report_rows or [],
        }), 200
    except Exception as e:
        logger.error(f"Error fetching lead metrics: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/users/<user_id>/overview", methods=["GET"])
@admin_required
def get_user_overview(user_id):
    try:
        user_row = _admin_fetch_user(user_id)
        if not user_row:
            return jsonify({"error": "User not found"}), 404

        listing_summary, recent_listings, owned_listing_ids = _admin_owned_listing_stats(user_id)
        activity = _admin_user_activity(user_id, owned_listing_ids)

        total_views = sum(bucket["views"] for bucket in listing_summary.values())
        total_listings = sum(bucket["count"] for bucket in listing_summary.values())
        active_listings = sum(bucket["approved"] for bucket in listing_summary.values())
        pending_listings = sum(bucket["pending"] for bucket in listing_summary.values())

        return jsonify({
            "user": user_row,
            "summary": {
                "total_listings": total_listings,
                "active_listings": active_listings,
                "pending_listings": pending_listings,
                "total_views": total_views,
                "call_clicks": int(activity["lead_totals"].get("call_click", 0)),
                "whatsapp_clicks": int(activity["lead_totals"].get("whatsapp_click", 0)),
                "vin_opens": int(activity["lead_totals"].get("vin_open", 0)),
                "qualified_leads": int(activity["lead_totals"].get("call_click", 0)) + int(activity["lead_totals"].get("whatsapp_click", 0)),
                "report_count": len(activity["reports"]),
            },
            "listing_summary": listing_summary,
            "recent_listings": recent_listings,
            "recent_events": activity["recent_events"],
            "recent_reports": activity["reports"],
        }), 200
    except Exception as e:
        logger.error(f"Error fetching user overview: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/dealers/<dealer_id>/overview", methods=["GET"])
@admin_required
def get_dealer_overview(dealer_id):
    try:
        dealer_row = _admin_fetch_user(dealer_id)
        if not dealer_row:
            return jsonify({"error": "Dealer not found"}), 404

        listing_summary, recent_listings, owned_listing_ids = _admin_owned_listing_stats(dealer_id)
        activity = _admin_user_activity(dealer_id, owned_listing_ids)

        return jsonify({
            "dealer": dealer_row,
            "summary": {
                "total_listings": sum(bucket["count"] for bucket in listing_summary.values()),
                "total_views": sum(bucket["views"] for bucket in listing_summary.values()),
                "call_clicks": int(activity["lead_totals"].get("call_click", 0)),
                "whatsapp_clicks": int(activity["lead_totals"].get("whatsapp_click", 0)),
                "vin_opens": int(activity["lead_totals"].get("vin_open", 0)),
                "qualified_leads": int(activity["lead_totals"].get("call_click", 0)) + int(activity["lead_totals"].get("whatsapp_click", 0)),
                "recent_reports": len(activity["reports"]),
            },
            "listing_summary": listing_summary,
            "recent_listings": recent_listings,
            "recent_events": activity["recent_events"],
            "reports": activity["reports"],
        }), 200
    except Exception as e:
        logger.error(f"Error fetching dealer overview: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/listings/<item_type>/<item_id>/overview", methods=["GET"])
@admin_required
def get_listing_overview(item_type, item_id):
    try:
        config = _admin_listing_config(item_type)
        if not config:
            return jsonify({"error": "Invalid listing type"}), 400

        listing_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{config['table']}",
            headers=_admin_headers(),
            params={"id": f"eq.{item_id}", "select": "*", "limit": "1"},
            timeout=15,
        )
        listing_rows = listing_resp.json() if listing_resp.status_code == 200 else []
        if not listing_rows:
            return jsonify({"error": "Listing not found"}), 404
        listing = listing_rows[0]

        owner_row = _admin_fetch_user(listing.get("user_id")) if listing.get("user_id") else None

        images_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{config['image_table']}",
            headers=_admin_headers(),
            params={"select": "*", config["fk"]: f"eq.{item_id}", "order": "uploaded_at.asc"},
            timeout=15,
        )
        images_rows = images_resp.json() if images_resp.status_code == 200 else []

        lead_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers=_admin_headers(),
            params={"select": "*", "listing_id": f"eq.{item_id}", "listing_type": f"eq.{item_type.rstrip('s')}", "order": "created_at.desc", "limit": "100"},
            timeout=15,
        )
        lead_rows = lead_resp.json() if lead_resp.status_code == 200 else []

        report_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/reports",
            headers=_admin_headers(),
            params={"select": "*", "listing_id": f"eq.{item_id}", "listing_type": f"eq.{item_type.rstrip('s')}", "order": "created_at.desc", "limit": "100"},
            timeout=15,
        )
        report_rows = report_resp.json() if report_resp.status_code == 200 else []

        deletion_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/listing_deletion_events",
            headers=_admin_headers(),
            params={"select": "*", "listing_id": f"eq.{item_id}", "listing_type": f"eq.{item_type.rstrip('s')}", "order": "created_at.desc", "limit": "50"},
            timeout=15,
        )
        deletion_rows = deletion_resp.json() if deletion_resp.status_code == 200 else []

        lead_totals = defaultdict(int)
        for event in lead_rows or []:
            lead_totals[event.get("action") or "unknown"] += 1

        return jsonify({
            "listing": listing,
            "owner": owner_row,
            "images": images_rows or [],
            "summary": {
                "view_count": int(listing.get("view_count") or 0),
                "call_clicks": int(lead_totals.get("call_click", 0)),
                "whatsapp_clicks": int(lead_totals.get("whatsapp_click", 0)),
                "vin_opens": int(lead_totals.get("vin_open", 0)),
                "qualified_leads": int(lead_totals.get("call_click", 0)) + int(lead_totals.get("whatsapp_click", 0)),
                "report_count": len(report_rows or []),
                "deletion_count": len(deletion_rows or []),
            },
            "lead_events": lead_rows or [],
            "reports": report_rows or [],
            "deletion_events": deletion_rows or [],
        }), 200
    except Exception as e:
        logger.error(f"Error fetching listing overview: {e}")
        return jsonify({"error": str(e)}), 500


# View tracking endpoint
@admin_bp.route("/views/<listing_type>/<listing_id>", methods=["GET"])
@admin_required
def get_listing_views(listing_type, listing_id):
    """Get view count for a specific listing"""
    try:
        table_map = {
            "cars": "cars",
            "bikes": "bikes",
            "plates": "license_plates",
            "parts": "car_parts",
        }

        table = table_map.get(listing_type)
        if not table:
            return jsonify({"error": "Invalid listing type"}), 400

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        query = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{listing_id}&select=view_count,last_viewed_at"
        response = requests.get(query, headers=headers, timeout=5)

        if response.status_code == 200 and response.json():
            return jsonify(response.json()[0]), 200
        else:
            return jsonify({"error": "Listing not found"}), 404

    except Exception as e:
        logger.error(f"Error fetching view count: {e}")
        return jsonify({"error": str(e)}), 500
