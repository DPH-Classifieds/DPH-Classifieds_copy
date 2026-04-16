"""
Admin routes for managing listings, users, reports, and dealers
"""

from flask import Blueprint, jsonify, request
from functools import wraps
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
    """Get pending listings by item type (cars, bikes, parts, plates)"""
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

    table_name = valid_item_types[item_type]
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        query = f"{SUPABASE_URL}/rest/v1/{table_name}?status=eq.pending&select=*&order=created_at.desc"
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

        stats = {}

        # Get total views across all listing types
        for table, label in [
            ("cars", "cars"),
            ("bikes", "bikes"),
            ("license_plates", "plates"),
            ("car_parts", "parts"),
        ]:
            query = f"{SUPABASE_URL}/rest/v1/{table}?select=view_count"
            response = requests.get(query, headers=headers, timeout=5)

            if response.status_code == 200:
                listings = response.json()
                total_views = sum(
                    listing.get("view_count", 0) or 0 for listing in listings
                )
                stats[f"{label}_total_views"] = total_views
                stats[f"{label}_count"] = len(listings)

        # Get dealer stats
        dealer_query = (
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=dealer_verified"
        )
        dealer_response = requests.get(dealer_query, headers=headers, timeout=5)

        if dealer_response.status_code == 200:
            dealers = dealer_response.json()
            stats["total_dealers"] = len(dealers)
            stats["verified_dealers"] = sum(
                1 for d in dealers if d.get("dealer_verified")
            )

        # Get report stats
        report_query = f"{SUPABASE_URL}/rest/v1/reports?select=status"
        report_response = requests.get(report_query, headers=headers, timeout=5)

        if report_response.status_code == 200:
            reports = report_response.json()
            stats["total_reports"] = len(reports)
            stats["pending_reports"] = sum(
                1 for r in reports if r.get("status") == "pending"
            )

        return jsonify(stats), 200

    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
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
