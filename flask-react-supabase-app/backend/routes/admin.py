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


# Lightweight per-process cache for admin list responses. Admin endpoints are not
# under heavy load like public ones, so a small TTL + an "invalidate on write"
# pattern avoids stale data while taking the worst hits off the DB. The in-process
# dict is intentionally simple — Redis already covers the public API surface.
import threading
import time as _time

_ADMIN_CACHE_LOCK = threading.Lock()
_ADMIN_CACHE = {}
ADMIN_CACHE_TTL_SECONDS = 30


def _admin_cache_get(key):
    if not key:
        return None
    with _ADMIN_CACHE_LOCK:
        entry = _ADMIN_CACHE.get(key)
        if entry and entry["expires_at"] > _time.time():
            return entry["value"]
        if entry:
            _ADMIN_CACHE.pop(key, None)
    return None


def _admin_cache_set(key, value, ttl=ADMIN_CACHE_TTL_SECONDS):
    if not key:
        return
    with _ADMIN_CACHE_LOCK:
        _ADMIN_CACHE[key] = {"value": value, "expires_at": _time.time() + ttl}


def _admin_cache_invalidate(prefix):
    """Drop any cached entries whose key starts with `prefix`. Called on mutating ops."""
    with _ADMIN_CACHE_LOCK:
        for key in list(_ADMIN_CACHE.keys()):
            if key.startswith(prefix):
                _ADMIN_CACHE.pop(key, None)


_PRIMARY_SUPER_ADMIN_EMAIL = (
    os.getenv("PRIMARY_SUPER_ADMIN_EMAIL", "admin@dphclassifieds.com").strip().lower()
)
_PRIMARY_SUPER_ADMIN_USERNAME = (
    os.getenv("PRIMARY_SUPER_ADMIN_USERNAME", "DPHClassifieds").strip().lower()
)
_PRIMARY_SUPER_ADMIN_USER_ID = os.getenv("PRIMARY_SUPER_ADMIN_USER_ID", "").strip()


def _is_super_admin_target(user_id):
    """Identify the protected super-admin so it can't be banned/deleted by another admin."""
    if _PRIMARY_SUPER_ADMIN_USER_ID and str(user_id) == _PRIMARY_SUPER_ADMIN_USER_ID:
        return True
    user_row = _admin_fetch_user(user_id)
    if not user_row:
        return False
    if user_row.get("is_super_admin"):
        return True
    email = (user_row.get("email") or "").strip().lower()
    username = (user_row.get("username") or "").strip().lower()
    return email == _PRIMARY_SUPER_ADMIN_EMAIL or username == _PRIMARY_SUPER_ADMIN_USERNAME


def _protect_super_admin(user_id, action_label="perform this action on"):
    if _is_super_admin_target(user_id):
        return jsonify({
            "error": f"The primary super-admin account cannot be used to {action_label}.",
            "code": "super_admin_protected",
        }), 403
    return None


def _log_admin_action(
    admin_user_id,
    action,
    target_user_id=None,
    target_listing_type=None,
    target_listing_id=None,
    reason=None,
    metadata=None,
):
    """Insert a moderation audit row. Best-effort: errors are logged, never raised,
    so a logging failure can't block the action itself."""
    try:
        payload = {
            "admin_user_id": admin_user_id,
            "action": action,
            "target_user_id": target_user_id,
            "target_listing_type": target_listing_type,
            "target_listing_id": target_listing_id,
            "reason": (reason or None),
            "metadata": metadata or {},
        }
        payload = {k: v for k, v in payload.items() if v is not None or k in ("reason", "metadata")}
        requests.post(
            f"{SUPABASE_URL}/rest/v1/admin_actions",
            headers={**_admin_headers(), "Prefer": "return=minimal"},
            json=payload,
            timeout=5,
        )
    except Exception as exc:
        logger.warning("Failed to log admin action %s: %s", action, exc)


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


def _admin_display_name_from_user_row(user_row):
    if not user_row:
        return None

    display_name = user_row.get("display_name")
    if display_name:
        return display_name

    full_name = " ".join(
        part for part in [user_row.get("first_name"), user_row.get("last_name")] if part
    ).strip()
    if full_name:
        return full_name

    return user_row.get("username") or user_row.get("email")


def _admin_fetch_user_display_map(user_ids):
    normalized_ids = []
    seen_ids = set()

    for user_id in user_ids or []:
        if not user_id:
            continue
        user_id = str(user_id)
        if user_id in seen_ids:
            continue
        seen_ids.add(user_id)
        normalized_ids.append(user_id)

    if not normalized_ids:
        return {}

    user_map = {}
    for index in range(0, len(normalized_ids), 50):
        chunk = normalized_ids[index : index + 50]
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users",
            headers=_admin_headers(),
            params={
                "select": "id,username,display_name,first_name,last_name,email",
                "id": f"in.({','.join(chunk)})",
            },
            timeout=10,
        )
        if response.status_code != 200:
            continue
        for row in response.json() or []:
            user_map[str(row.get("id"))] = row

    return user_map


def _admin_enrich_activity_rows(rows, user_field="user_id"):
    enriched_rows = [dict(row) for row in (rows or [])]
    user_ids = [row.get(user_field) for row in enriched_rows if row.get(user_field)]
    user_map = _admin_fetch_user_display_map(user_ids)

    for row in enriched_rows:
        user_id = row.get(user_field)
        user_row = user_map.get(str(user_id)) if user_id else None
        actor_name = _admin_display_name_from_user_row(user_row)
        row["actor_name"] = actor_name or ("Guest" if not user_id else "Unknown user")
        if user_row:
            row["actor_username"] = user_row.get("username")
            row["actor_email"] = user_row.get("email")

    return enriched_rows


def _admin_listing_config(item_type):
    normalized = (item_type or "").strip().lower().rstrip("s")
    return {
        "car": {
            "table": "cars",
            "image_table": "car_images",
            "fk": "car_id",
            "label": "cars",
        },
        "bike": {
            "table": "bikes",
            "image_table": "bike_images",
            "fk": "bike_id",
            "label": "bikes",
        },
        "part": {
            "table": "car_parts",
            "image_table": "part_images",
            "fk": "part_id",
            "label": "parts",
        },
        "plate": {
            "table": "license_plates",
            "image_table": "plate_images",
            "fk": "plate_id",
            "label": "plates",
        },
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
    price = (
        row.get("display_price")
        or row.get("price")
        or row.get("expected_selling_price")
    )
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
            params={
                "select": "*",
                "user_id": f"eq.{user_id}",
                "order": "created_at.desc",
                "limit": "50",
            },
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
        params={
            "select": "*",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": "2000",
        },
        timeout=20,
    )
    lead_events = lead_events_resp.json() if lead_events_resp.status_code == 200 else []
    report_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/reports",
        headers=_admin_headers(),
        params={
            "select": "id,listing_id,listing_type,status,reason,details,created_at,reviewed_by,reviewed_at",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": "500",
        },
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

    recent_events = _admin_enrich_activity_rows(recent_events, "user_id")

    owned_listing_set = {
        listing_id for ids in owned_listing_ids.values() for listing_id in ids
    }
    user_reports = []
    for report in reports or []:
        if (
            report.get("reporter_id") == user_id
            or str(report.get("listing_id")) in owned_listing_set
        ):
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
            "buying_requests": "buying_requests",
            "buying_request": "buying_requests",
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
                elif listing_type in ("buying_requests", "buying_request"):
                    listing["display_title"] = (
                        f"{listing.get('item_name', 'Buying request')} — posted by {listing['user_name']}"
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
            "buying_requests": "buying_requests",
            "buying_request": "buying_requests",
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
                                user_info["email"], listing_type, listing, "approved"
                            )
            except Exception as email_err:
                logger.error(f"Failed to send approval email: {email_err}")

            # Clean up registration document (Mulkiya) after approval
            if item_type == "cars":
                try:
                    updated_rows = response.json()
                    if updated_rows and len(updated_rows) > 0:
                        listing_row = updated_rows[0]
                        reg_doc_url = listing_row.get("registration_document_url")
                        if reg_doc_url:
                            if "registration-documents/" in reg_doc_url:
                                storage_path = reg_doc_url.split(
                                    "registration-documents/", 1
                                )[-1].split("?")[0]
                                del_resp = requests.delete(
                                    f"{SUPABASE_URL}/storage/v1/object/registration-documents/{storage_path}",
                                    headers=headers,
                                    timeout=10,
                                )
                                if del_resp.status_code in [200, 204]:
                                    logger.info(
                                        f"Deleted registration document: {storage_path}"
                                    )
                                else:
                                    logger.warning(
                                        f"Failed to delete registration document: {del_resp.status_code}"
                                    )
                            requests.patch(
                                f"{SUPABASE_URL}/rest/v1/{table_name}?id=eq.{item_id}",
                                headers=headers,
                                json={"registration_document_url": None},
                                timeout=5,
                            )
                            logger.info(
                                f"Cleared registration_document_url for {item_type} {item_id}"
                            )
                except Exception as cleanup_err:
                    logger.warning(
                        f"Failed to cleanup registration document: {cleanup_err}"
                    )

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
        "buying_requests": "buying_requests",
        "buying_request": "buying_requests",
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
                                user_info["email"], item_type, listing, "rejected"
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
            "buying_requests": "buying_requests",
            "buying_request": "buying_requests",
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
            "buying_requests": "buying_request_images",
            "buying_request": "buying_request_images",
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


@admin_bp.route("/dealers/<user_id>/listing-limit", methods=["PATCH"])
@admin_required
def set_dealer_listing_limit(user_id):
    """Set or clear the per-dealer active-listing cap.

    Body: {"limit": <int|null>}
        - int >= 0  → store as users.dealer_listing_limit, takes effect next post
        - null      → clear, dealer falls back to DEFAULT_DEALER_LISTING_LIMIT env

    Returns the effective limit so the UI can display "(default)" when null.
    """
    try:
        body = request.json or {}
        if "limit" not in body:
            return jsonify({"error": "Missing 'limit' field"}), 400

        raw_limit = body.get("limit")
        if raw_limit is None:
            new_limit = None
        else:
            try:
                new_limit = int(raw_limit)
            except (TypeError, ValueError):
                return jsonify({"error": "'limit' must be an integer or null"}), 400
            if new_limit < 0 or new_limit > 10000:
                return jsonify({"error": "'limit' must be between 0 and 10000"}), 400

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json={"dealer_listing_limit": new_limit},
            timeout=10,
        )
        if response.status_code not in (200, 204):
            logger.warning(
                f"Failed to set dealer_listing_limit for {user_id}: "
                f"{response.status_code} {response.text}"
            )
            return jsonify({"error": "Failed to set listing limit"}), response.status_code

        default_limit = int(os.getenv("DEFAULT_DEALER_LISTING_LIMIT", "20"))
        effective = new_limit if new_limit is not None else default_limit
        return jsonify({
            "message": "Listing limit updated",
            "dealer_listing_limit": new_limit,
            "effective_limit": effective,
            "default_limit": default_limit,
        }), 200
    except Exception as e:
        logger.error(f"Error setting dealer listing limit: {e}")
        return jsonify({"error": str(e)}), 500


# User Management
@admin_bp.route("/users", methods=["GET"])
@admin_required
def get_users():
    """Paginated user list. Supports search, role filter, status filter.
    Returns {users, total, limit, offset} so the frontend can paginate cleanly."""
    try:
        search = (request.args.get("search") or "").strip()
        role = (request.args.get("role") or "").strip().lower()
        status_filter = (request.args.get("status") or "").strip().lower()
        limit = max(min(int(request.args.get("limit", 50)), 200), 1)
        offset = max(int(request.args.get("offset", 0)), 0)

        # select=* keeps us robust against missing migrations on prod (a single
        # absent column would 400 the whole list). At sub-10k users the
        # projection saving is negligible. Revisit if/when the users table
        # picks up large JSONB columns we don't need in the list view.
        params = {
            "select": "*",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        }

        if search:
            from urllib.parse import quote
            search_escaped = quote(search, safe="")
            params["or"] = (
                f"(email.ilike.*{search_escaped}*,username.ilike.*{search_escaped}*,"
                f"first_name.ilike.*{search_escaped}*,last_name.ilike.*{search_escaped}*,"
                f"phone.ilike.*{search_escaped}*)"
            )

        if role == "admin":
            params["is_admin"] = "eq.true"
        elif role == "dealer":
            params["is_dealer"] = "eq.true"
        elif role == "regular":
            params["is_admin"] = "eq.false"
            params["is_dealer"] = "eq.false"

        if status_filter in ("active", "suspended", "banned", "pending_verification"):
            params["account_status"] = f"eq.{status_filter}"

        cache_key = f"admin:users:{search}:{role}:{status_filter}:{limit}:{offset}"
        cached = _admin_cache_get(cache_key)
        if cached is not None:
            return jsonify(cached), 200

        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users",
            headers={**_admin_headers(), "Prefer": "count=exact"},
            params=params,
            timeout=10,
        )

        if response.status_code != 200:
            # Surface PostgREST's actual message so the frontend can show a
            # useful error instead of a generic 400. Common cause is a
            # missing column on prod when the projection drifts ahead of
            # the schema; logging both makes that diagnosis a one-step task.
            try:
                detail = response.json()
            except ValueError:
                detail = {"raw": response.text[:300]}
            logger.error(
                "Admin users fetch failed: status=%s detail=%s",
                response.status_code, detail,
            )
            return jsonify({"error": "Failed to fetch users", "detail": detail}), response.status_code

        users = response.json() or []
        total = None
        content_range = response.headers.get("Content-Range")
        if content_range and "/" in content_range:
            try:
                total = int(content_range.split("/")[-1])
            except ValueError:
                total = None

        payload = {
            "users": users,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
        _admin_cache_set(cache_key, payload)
        return jsonify(payload), 200

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
        # Promoting also reactivates: a banned/suspended user being made admin
        # implies the admin status is the source of truth now.
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json={"is_admin": True, "account_status": "active"},
            timeout=5,
        )
        if response.status_code in [200, 204]:
            _admin_cache_invalidate("admin:users:")
            _log_admin_action(
                admin_user_id=getattr(request, "user_id", None),
                action="user_make_admin",
                target_user_id=user_id,
            )
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
            _admin_cache_invalidate("admin:users:")
            _log_admin_action(
                admin_user_id=getattr(request, "user_id", None),
                action="user_remove_admin",
                target_user_id=user_id,
            )
            return jsonify(
                {"success": True, "message": "Admin privileges removed successfully"}
            ), 200
        else:
            return jsonify({"error": "Failed to remove admin privileges"}), 500
    except Exception as e:
        logger.error(f"Error removing admin privileges: {e}")
        return jsonify({"error": str(e)}), 500


_LISTING_TABLES_FOR_USER_ARCHIVE = (
    ("car", "cars"),
    ("bike", "bikes"),
    ("part", "car_parts"),
    ("plate", "license_plates"),
)


def _archive_user_listings(user_id):
    """Soft-archive (status='archived') all of a user's active listings.
    Returns the per-table counts so the action log records what was hidden."""
    counts = {}
    for label, table in _LISTING_TABLES_FOR_USER_ARCHIVE:
        try:
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/{table}"
                f"?user_id=eq.{user_id}"
                f"&status=in.(approved,active,pending)",
                headers={**_admin_headers(), "Prefer": "return=representation"},
                json={"status": "archived", "is_archived": True},
                timeout=10,
            )
            if resp.status_code in (200, 204):
                rows = resp.json() if resp.status_code == 200 else []
                counts[label] = len(rows) if isinstance(rows, list) else 0
            else:
                logger.warning("Archive failed for %s/%s: %s", table, user_id, resp.text[:200])
                counts[label] = 0
        except Exception as exc:
            logger.warning("Archive exception for %s/%s: %s", table, user_id, exc)
            counts[label] = 0
    return counts


def _restore_user_listings(user_id):
    """Reverse of _archive_user_listings on unban — flip archived rows back to 'pending'
    so the user can review them. Active state requires re-approval."""
    counts = {}
    for label, table in _LISTING_TABLES_FOR_USER_ARCHIVE:
        try:
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/{table}"
                f"?user_id=eq.{user_id}"
                f"&status=eq.archived",
                headers={**_admin_headers(), "Prefer": "return=representation"},
                json={"status": "pending", "is_archived": False},
                timeout=10,
            )
            if resp.status_code in (200, 204):
                rows = resp.json() if resp.status_code == 200 else []
                counts[label] = len(rows) if isinstance(rows, list) else 0
        except Exception as exc:
            logger.warning("Restore exception for %s/%s: %s", table, user_id, exc)
            counts[label] = 0
    return counts


@admin_bp.route("/users/<user_id>/status", methods=["PATCH"])
@admin_required
def update_user_status(user_id):
    """Update user account status (active/suspended/banned).
    For 'banned': requires reason, records banned_by/banned_at, and archives the user's listings."""
    try:
        data = request.get_json() or {}
        new_status = (data.get("status") or "").lower().strip()
        reason = (data.get("reason") or "").strip()

        if new_status not in ("active", "suspended", "banned"):
            return jsonify({"error": "Status must be 'active', 'suspended', or 'banned'"}), 400

        if new_status in ("suspended", "banned") and not reason:
            return jsonify({"error": f"A reason is required to {new_status[:-2] if new_status.endswith('ed') else new_status} a user"}), 400

        admin_user_id = getattr(request, "user_id", None)

        if new_status in ("suspended", "banned") and admin_user_id == user_id:
            return jsonify({"error": "You cannot change your own account status"}), 400

        if new_status in ("suspended", "banned"):
            label = "ban" if new_status == "banned" else "suspend"
            protect = _protect_super_admin(user_id, label)
            if protect:
                return protect

        update_payload = {"account_status": new_status}

        if new_status == "banned":
            update_payload["ban_reason"] = reason
            update_payload["banned_at"] = datetime.utcnow().isoformat() + "Z"
            update_payload["banned_by"] = admin_user_id
        elif new_status == "active":
            # Clear ban fields on reactivation
            update_payload["ban_reason"] = None
            update_payload["banned_at"] = None
            update_payload["banned_by"] = None

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers={**_admin_headers(), "Prefer": "return=representation"},
            json=update_payload,
            timeout=10,
        )
        if response.status_code not in (200, 204):
            return jsonify({"error": "Failed to update user status"}), 500

        archive_counts = None
        if new_status == "banned":
            archive_counts = _archive_user_listings(user_id)
        elif new_status == "active":
            archive_counts = _restore_user_listings(user_id)

        action_map = {"banned": "user_ban", "active": "user_unban", "suspended": "user_suspend"}
        _log_admin_action(
            admin_user_id=admin_user_id,
            action=action_map.get(new_status, "user_suspend"),
            target_user_id=user_id,
            reason=reason or None,
            metadata={"new_status": new_status, "archive_counts": archive_counts} if archive_counts else {"new_status": new_status},
        )
        _admin_cache_invalidate("admin:users:")
        _admin_cache_invalidate("admin:list:")

        return jsonify(
            {
                "success": True,
                "message": f"User status changed to {new_status}",
                "archive_counts": archive_counts,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error updating user status: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/users/<user_id>", methods=["DELETE"])
@admin_required
def delete_user(user_id):
    """Delete a user (admin only). Requires a reason for the audit log."""
    try:
        # Reason can come from JSON body OR query string (DELETE bodies are flaky in some browsers)
        body = request.get_json(silent=True) or {}
        reason = (body.get("reason") or request.args.get("reason") or "").strip()
        if not reason:
            return jsonify({"error": "A reason is required to delete a user"}), 400

        admin_user_id = getattr(request, "user_id", None)
        if admin_user_id == user_id:
            return jsonify({"error": "You cannot delete your own account"}), 400

        protect = _protect_super_admin(user_id, "delete")
        if protect:
            return protect

        headers = _admin_headers()

        # Confirm user exists before doing anything irreversible
        check_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=id,email,username",
            headers=headers,
            timeout=5,
        )

        if check_response.status_code != 200 or not check_response.json():
            return jsonify({"error": "User not found"}), 404

        user_data = check_response.json()[0]

        # Archive their listings first so we have an accurate count in the audit log
        archive_counts = _archive_user_listings(user_id)

        # Delete the Supabase Auth user too — otherwise the auth row outlives
        # the public.users row and the email/phone can never be re-registered.
        # 404 is acceptable: means the auth user was already gone.
        try:
            auth_resp = requests.delete(
                f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
                headers={"apikey": SUPABASE_SERVICE_ROLE_KEY,
                         "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"},
                timeout=15,
            )
            if auth_resp.status_code not in (200, 204, 404):
                logger.error(
                    "Failed deleting auth user %s: status=%s body=%s",
                    user_id, auth_resp.status_code, auth_resp.text[:300],
                )
                return jsonify({"error": "Failed to delete auth user"}), auth_resp.status_code
        except Exception as auth_err:
            logger.error("Auth user delete exception for %s: %s", user_id, auth_err)
            return jsonify({"error": "Failed to delete auth user"}), 500

        delete_response = requests.delete(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}", headers=headers, timeout=10
        )

        if delete_response.status_code in (200, 204):
            _log_admin_action(
                admin_user_id=admin_user_id,
                action="user_delete",
                target_user_id=user_id,
                reason=reason,
                metadata={
                    "email": user_data.get("email"),
                    "username": user_data.get("username"),
                    "archive_counts": archive_counts,
                },
            )
            _admin_cache_invalidate("admin:users:")
            _admin_cache_invalidate("admin:list:")
            logger.info(f"User {user_id} ({user_data.get('email')}) deleted by admin {admin_user_id} reason={reason!r}")
            return jsonify({"message": "User deleted successfully", "archive_counts": archive_counts}), 200

        logger.error(
            f"Failed to delete user {user_id}: {delete_response.status_code} - {delete_response.text}"
        )
        return jsonify({"error": "Failed to delete user"}), delete_response.status_code

    except Exception as e:
        logger.error(f"Error deleting user: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/users/<user_id>/actions", methods=["GET"])
@admin_required
def get_user_action_history(user_id):
    """Return moderation actions taken against a single user, with admin display names."""
    try:
        limit = max(min(int(request.args.get("limit", 50)), 200), 1)
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/admin_actions",
            headers=_admin_headers(),
            params={
                "select": "*",
                "target_user_id": f"eq.{user_id}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": "Failed to fetch action history"}), resp.status_code
        actions = resp.json() or []
        # Hydrate admin display names
        admin_ids = list({a.get("admin_user_id") for a in actions if a.get("admin_user_id")})
        admin_names = _admin_fetch_user_display_map(admin_ids)
        for action in actions:
            action["admin_display_name"] = admin_names.get(action.get("admin_user_id"))
        return jsonify({"actions": actions}), 200
    except Exception as e:
        logger.error(f"Error fetching action history for user {user_id}: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route("/actions", methods=["GET"])
@admin_required
def get_action_log():
    """Global moderation action feed for the admin dashboard."""
    try:
        limit = max(min(int(request.args.get("limit", 100)), 500), 1)
        offset = max(int(request.args.get("offset", 0)), 0)
        action_filter = (request.args.get("action") or "").strip()

        params = {
            "select": "*",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        }
        if action_filter:
            params["action"] = f"eq.{action_filter}"

        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/admin_actions",
            headers={**_admin_headers(), "Prefer": "count=exact"},
            params=params,
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": "Failed to fetch action log"}), resp.status_code

        actions = resp.json() or []
        admin_ids = list({a.get("admin_user_id") for a in actions if a.get("admin_user_id")})
        target_ids = list({a.get("target_user_id") for a in actions if a.get("target_user_id")})
        display_map = _admin_fetch_user_display_map(admin_ids + target_ids)
        for action in actions:
            action["admin_display_name"] = display_map.get(action.get("admin_user_id"))
            action["target_display_name"] = display_map.get(action.get("target_user_id"))

        total = None
        content_range = resp.headers.get("Content-Range")
        if content_range and "/" in content_range:
            try:
                total = int(content_range.split("/")[-1])
            except ValueError:
                total = None

        return jsonify({"actions": actions, "total": total, "limit": limit, "offset": offset}), 200
    except Exception as e:
        logger.error(f"Error fetching action log: {e}")
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Helpers for admin listing endpoints (cars/bikes/parts/plates).
# Replaces per-row user + image fetches (N+1) with chunked batched queries.
# ---------------------------------------------------------------------------

_ADMIN_LISTING_TYPES = {
    "cars": {
        "table": "cars",
        "images_table": "car_images",
        "image_fk": "car_id",
        "phone_field": "car_owner_phone_number",
    },
    "bikes": {
        "table": "bikes",
        "images_table": "bike_images",
        "image_fk": "bike_id",
        "phone_field": "contact_phone",
    },
    "parts": {
        "table": "car_parts",
        "images_table": "part_images",
        "image_fk": "part_id",
        "phone_field": "contact_phone",
    },
    "plates": {
        "table": "license_plates",
        "images_table": "plate_images",
        "image_fk": "plate_id",
        "phone_field": "contact_phone",
    },
}


def _chunks(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def _admin_batch_fetch_users(user_ids):
    """Fetch user profile fields for many ids in chunks. Returns {id: row}."""
    out = {}
    unique_ids = list({uid for uid in user_ids if uid})
    if not unique_ids:
        return out
    for chunk in _chunks(unique_ids, 100):
        ids_in = ",".join(chunk)
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/users",
            headers=_admin_headers(),
            params={
                "select": "id,email,first_name,last_name,phone,account_status",
                "id": f"in.({ids_in})",
            },
            timeout=10,
        )
        if resp.status_code == 200:
            for row in resp.json() or []:
                out[row["id"]] = row
    return out


def _admin_batch_fetch_images(images_table, image_fk, listing_ids):
    """Fetch images for many listings in chunks. Returns {listing_id: [images]}."""
    out = {}
    unique = list({lid for lid in listing_ids if lid})
    if not unique:
        return out
    for chunk in _chunks(unique, 100):
        ids_in = ",".join(chunk)
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{images_table}",
            headers=_admin_headers(),
            params={"select": "*", image_fk: f"in.({ids_in})"},
            timeout=10,
        )
        if resp.status_code == 200:
            for img in resp.json() or []:
                lid = img.get(image_fk)
                if not lid:
                    continue
                # Normalise url/image_url so the frontend can rely on one field
                if "url" in img and "image_url" not in img:
                    img["image_url"] = img["url"]
                out.setdefault(lid, []).append(img)
    return out


def _admin_serve_listings(slug):
    """Common paginated handler for cars/bikes/parts/plates admin lists."""
    config = _ADMIN_LISTING_TYPES[slug]
    try:
        limit = max(min(int(request.args.get("limit", 50)), 200), 1)
        offset = max(int(request.args.get("offset", 0)), 0)
        status_filter = (request.args.get("status") or "").strip().lower()
        search = (request.args.get("search") or "").strip()

        cache_key = f"admin:list:{slug}:{status_filter}:{search}:{limit}:{offset}"
        cached = _admin_cache_get(cache_key)
        if cached is not None:
            return jsonify(cached), 200

        params = {
            "select": "*",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        }
        if status_filter and status_filter != "all":
            params["status"] = f"eq.{status_filter}"
        if search:
            from urllib.parse import quote
            s = quote(search, safe="")
            # Most listing tables expose title/description-like fields; fall back to id match too.
            search_clauses = [f"title.ilike.*{s}*", f"description.ilike.*{s}*"]
            if slug == "plates":
                search_clauses = [f"digits.ilike.*{s}*", f"city.ilike.*{s}*"]
            params["or"] = f"({','.join(search_clauses)})"

        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{config['table']}",
            headers={**_admin_headers(), "Prefer": "count=exact"},
            params=params,
            timeout=15,
        )
        if resp.status_code != 200:
            return jsonify({"error": f"Failed to fetch {slug}"}), resp.status_code

        listings = resp.json() or []

        # Batch user + image lookups
        users_map = _admin_batch_fetch_users([row.get("user_id") for row in listings])
        images_map = _admin_batch_fetch_images(
            config["images_table"], config["image_fk"], [row.get("id") for row in listings]
        )

        for listing in listings:
            user_info = users_map.get(listing.get("user_id")) or {}
            listing["user_email"] = user_info.get("email") or "N/A"
            full_name = " ".join(
                p for p in [user_info.get("first_name"), user_info.get("last_name")] if p
            ).strip()
            listing["user_name"] = full_name or "Unknown"
            listing["user_account_status"] = user_info.get("account_status")
            listing[config["phone_field"]] = (
                user_info.get("phone") or listing.get(config["phone_field"]) or "N/A"
            )
            listing["images"] = images_map.get(listing.get("id"), [])

        total = None
        content_range = resp.headers.get("Content-Range")
        if content_range and "/" in content_range:
            try:
                total = int(content_range.split("/")[-1])
            except ValueError:
                total = None

        payload = {
            "listings": listings,
            "total": total,
            "limit": limit,
            "offset": offset,
        }
        _admin_cache_set(cache_key, payload)
        return jsonify(payload), 200
    except Exception as exc:
        logger.error(f"Error fetching admin {slug}: {exc}")
        return jsonify({"error": str(exc)}), 500


@admin_bp.route("/plates", methods=["GET"])
@admin_required
def get_plates():
    return _admin_serve_listings("plates")


@admin_bp.route("/cars", methods=["GET"])
@admin_required
def get_cars():
    return _admin_serve_listings("cars")


@admin_bp.route("/bikes", methods=["GET"])
@admin_required
def get_bikes():
    return _admin_serve_listings("bikes")


@admin_bp.route("/parts", methods=["GET"])
@admin_required
def get_parts():
    return _admin_serve_listings("parts")


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
            return jsonify(
                {"error": "Failed to fetch listing history"}
            ), response.status_code
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
            params={
                "select": "*",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "100",
            },
            timeout=20,
        )
        recent_rows = recent_resp.json() if recent_resp.status_code == 200 else []

        reports_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/reports",
            headers=_admin_headers(),
            params={
                "select": "id,listing_id,listing_type,status,created_at",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "100",
            },
            timeout=20,
        )
        report_rows = reports_resp.json() if reports_resp.status_code == 200 else []

        totals = defaultdict(int)
        for event in lead_rows or []:
            totals[event.get("action") or "unknown"] += 1

        qualified = totals["call_click"] + totals["whatsapp_click"]
        report_count = len(report_rows or [])
        conversion_rate = round((report_count / qualified) * 100, 2) if qualified else 0

        recent_rows = _admin_enrich_activity_rows(recent_rows, "user_id")

        return jsonify(
            {
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
            }
        ), 200
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

        listing_summary, recent_listings, owned_listing_ids = (
            _admin_owned_listing_stats(user_id)
        )
        activity = _admin_user_activity(user_id, owned_listing_ids)

        total_views = sum(bucket["views"] for bucket in listing_summary.values())
        total_listings = sum(bucket["count"] for bucket in listing_summary.values())
        active_listings = sum(bucket["approved"] for bucket in listing_summary.values())
        pending_listings = sum(bucket["pending"] for bucket in listing_summary.values())

        return jsonify(
            {
                "user": user_row,
                "summary": {
                    "total_listings": total_listings,
                    "active_listings": active_listings,
                    "pending_listings": pending_listings,
                    "total_views": total_views,
                    "call_clicks": int(activity["lead_totals"].get("call_click", 0)),
                    "whatsapp_clicks": int(
                        activity["lead_totals"].get("whatsapp_click", 0)
                    ),
                    "vin_opens": int(activity["lead_totals"].get("vin_open", 0)),
                    "qualified_leads": int(activity["lead_totals"].get("call_click", 0))
                    + int(activity["lead_totals"].get("whatsapp_click", 0)),
                    "report_count": len(activity["reports"]),
                },
                "listing_summary": listing_summary,
                "recent_listings": recent_listings,
                "recent_events": activity["recent_events"],
                "recent_reports": activity["reports"],
            }
        ), 200
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

        listing_summary, recent_listings, owned_listing_ids = (
            _admin_owned_listing_stats(dealer_id)
        )
        activity = _admin_user_activity(dealer_id, owned_listing_ids)

        return jsonify(
            {
                "dealer": dealer_row,
                "summary": {
                    "total_listings": sum(
                        bucket["count"] for bucket in listing_summary.values()
                    ),
                    "total_views": sum(
                        bucket["views"] for bucket in listing_summary.values()
                    ),
                    "call_clicks": int(activity["lead_totals"].get("call_click", 0)),
                    "whatsapp_clicks": int(
                        activity["lead_totals"].get("whatsapp_click", 0)
                    ),
                    "vin_opens": int(activity["lead_totals"].get("vin_open", 0)),
                    "qualified_leads": int(activity["lead_totals"].get("call_click", 0))
                    + int(activity["lead_totals"].get("whatsapp_click", 0)),
                    "recent_reports": len(activity["reports"]),
                },
                "listing_summary": listing_summary,
                "recent_listings": recent_listings,
                "recent_events": activity["recent_events"],
                "reports": activity["reports"],
            }
        ), 200
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

        # Lifecycle-sync so the detail page sees the same state as the listings
        # table: expired_at, listing_state, sold_response_deadline, etc. — and so
        # the renewal-nudge button (which gates on `expired`/`deleted`/`auto_removed_at`)
        # has all the fields it needs. Service-role import avoids circular import.
        try:
            from app import (
                _sync_listing_lifecycle,
                _admin_listing_display_status,
                _admin_attach_latest_verification_scan,
            )

            synced = _sync_listing_lifecycle(
                config["table"], dict(listing), hard_delete_archived=False
            )
            if synced:
                listing = synced
            listing.setdefault(
                "listing_type",
                {
                    "cars": "cars",
                    "bikes": "bikes",
                    "car_parts": "parts",
                    "license_plates": "plates",
                }.get(config["table"], config["table"]),
            )
            listing["display_status"] = _admin_listing_display_status(listing)
            _admin_attach_latest_verification_scan(listing)
        except Exception as enrich_err:
            logger.warning(
                f"Failed to enrich listing overview for {config['table']}/{item_id}: {enrich_err}"
            )

        owner_row = (
            _admin_fetch_user(listing.get("user_id"))
            if listing.get("user_id")
            else None
        )

        images_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/{config['image_table']}",
            headers=_admin_headers(),
            params={
                "select": "*",
                config["fk"]: f"eq.{item_id}",
                "order": "uploaded_at.asc",
            },
            timeout=15,
        )
        images_rows = images_resp.json() if images_resp.status_code == 200 else []

        lead_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers=_admin_headers(),
            params={
                "select": "*",
                "listing_id": f"eq.{item_id}",
                "listing_type": f"eq.{item_type.rstrip('s')}",
                "order": "created_at.desc",
                "limit": "100",
            },
            timeout=15,
        )
        lead_rows = lead_resp.json() if lead_resp.status_code == 200 else []

        report_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/reports",
            headers=_admin_headers(),
            params={
                "select": "*",
                "listing_id": f"eq.{item_id}",
                "listing_type": f"eq.{item_type.rstrip('s')}",
                "order": "created_at.desc",
                "limit": "100",
            },
            timeout=15,
        )
        report_rows = report_resp.json() if report_resp.status_code == 200 else []

        deletion_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/listing_deletion_events",
            headers=_admin_headers(),
            params={
                "select": "*",
                "listing_id": f"eq.{item_id}",
                "listing_type": f"eq.{item_type.rstrip('s')}",
                "order": "created_at.desc",
                "limit": "50",
            },
            timeout=15,
        )
        deletion_rows = deletion_resp.json() if deletion_resp.status_code == 200 else []

        lead_rows = _admin_enrich_activity_rows(lead_rows, "user_id")

        lead_totals = defaultdict(int)
        for event in lead_rows or []:
            lead_totals[event.get("action") or "unknown"] += 1

        return jsonify(
            {
                "listing": listing,
                "owner": owner_row,
                "images": images_rows or [],
                # Mirror verification + lifecycle fields at the top level too —
                # AdminListingDetail.jsx reads them from either spot.
                "latest_verification_scan": listing.get("latest_verification_scan"),
                "verification_status": listing.get("verification_status"),
                "display_status": listing.get("display_status"),
                "summary": {
                    "view_count": int(listing.get("view_count") or 0),
                    "call_clicks": int(lead_totals.get("call_click", 0)),
                    "whatsapp_clicks": int(lead_totals.get("whatsapp_click", 0)),
                    "vin_opens": int(lead_totals.get("vin_open", 0)),
                    "qualified_leads": int(lead_totals.get("call_click", 0))
                    + int(lead_totals.get("whatsapp_click", 0)),
                    "report_count": len(report_rows or []),
                    "deletion_count": len(deletion_rows or []),
                },
                "lead_events": lead_rows or [],
                "reports": report_rows or [],
                "deletion_events": deletion_rows or [],
            }
        ), 200
    except Exception as e:
        logger.error(f"Error fetching listing overview: {e}")
        return jsonify({"error": str(e)}), 500


@admin_bp.route(
    "/listings/<item_type>/<item_id>/send-renewal-nudge", methods=["POST"]
)
@admin_required
def send_listing_renewal_nudge(item_type, item_id):
    """Email + SMS the listing owner asking them to renew (or mark sold).

    Stamps `renewal_nudge_sent_at`, increments `renewal_nudge_count`, and records
    which channels actually delivered. Throttled to one nudge per 6 hours per
    listing so a stuck admin doesn't spam owners.
    """
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

        owner_row = (
            _admin_fetch_user(listing.get("user_id"))
            if listing.get("user_id")
            else None
        ) or {}

        # 6-hour throttle to avoid spamming owners.
        last_sent_raw = listing.get("renewal_nudge_sent_at")
        if last_sent_raw and not (request.json or {}).get("force"):
            try:
                last_sent = datetime.fromisoformat(
                    str(last_sent_raw).replace("Z", "+00:00")
                )
                from datetime import timezone as _tz

                now = datetime.now(_tz.utc)
                if last_sent.tzinfo is None:
                    last_sent = last_sent.replace(tzinfo=_tz.utc)
                if (now - last_sent) < timedelta(hours=6):
                    return jsonify(
                        {
                            "error": "Renewal nudge was sent recently. Pass force=true to resend.",
                            "renewal_nudge_sent_at": last_sent_raw,
                        }
                    ), 429
            except Exception:
                pass

        owner_email = (
            listing.get("user_email")
            or listing.get("contact_email")
            or owner_row.get("email")
        )
        owner_phone = (
            listing.get("car_owner_phone_number")
            or listing.get("contact_phone")
            or listing.get("whatsapp_number")
            or owner_row.get("phone")
        )
        owner_country_code = (
            listing.get("country_code") or owner_row.get("country_code") or "+971"
        )

        listing_title = (
            listing.get("listing_title")
            or listing.get("title")
            or listing.get("item_name")
            or listing.get("car_model")
            or listing.get("bike_model")
            or listing.get("name")
            or "Your listing"
        )

        # Call helpers defined in app.py via lazy import to avoid circular import.
        from app import (
            _send_renewal_nudge_email,
            _send_renewal_nudge_sms,
            _send_renewal_nudge_whatsapp,
            _invalidate_public_inventory_cache,
        )

        results = {"email": False, "sms": False, "whatsapp": False}
        errors = {}

        if owner_email:
            email_ok, email_err = _send_renewal_nudge_email(
                owner_email, listing_title, item_type, item_id
            )
            results["email"] = bool(email_ok)
            if not email_ok:
                errors["email"] = email_err
        else:
            errors["email"] = "No email on file"

        if owner_phone:
            sms_ok, sms_resp = _send_renewal_nudge_sms(
                owner_phone, item_type, item_id, owner_country_code
            )
            results["sms"] = bool(sms_ok)
            if not sms_ok:
                errors["sms"] = sms_resp
            # WhatsApp stub: best-effort if you wire it up later.
            wa_ok, wa_resp = _send_renewal_nudge_whatsapp(
                owner_phone, item_type, item_id, owner_country_code
            )
            results["whatsapp"] = bool(wa_ok)
            if not wa_ok and wa_resp and wa_resp.get("message") not in (
                "WhatsApp channel not configured",
            ):
                errors["whatsapp"] = wa_resp
        else:
            errors["sms"] = "No phone on file"

        if not any(results.values()):
            return jsonify(
                {
                    "error": "Could not deliver renewal nudge",
                    "channels": results,
                    "details": errors,
                }
            ), 502

        now_iso = datetime.utcnow().isoformat() + "Z"
        patch_payload = {
            "renewal_nudge_sent_at": now_iso,
            "renewal_nudge_sent_by": getattr(request, "user_id", None),
            "renewal_nudge_count": int(listing.get("renewal_nudge_count") or 0) + 1,
            "renewal_nudge_channels": results,
        }
        patch_resp = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{config['table']}?id=eq.{item_id}",
            headers=_admin_headers(),
            json=patch_payload,
            timeout=15,
        )
        if patch_resp.status_code >= 400:
            logger.warning(
                f"Failed to stamp renewal_nudge_sent_at for {config['table']}/{item_id}: "
                f"{patch_resp.status_code} {patch_resp.text}"
            )

        try:
            _invalidate_public_inventory_cache(config["table"])
        except Exception as cache_err:
            logger.warning(f"Cache invalidation failed after renewal nudge: {cache_err}")

        return jsonify(
            {
                "message": "Renewal nudge sent",
                "channels": results,
                "errors": errors,
                "renewal_nudge_sent_at": now_iso,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error sending renewal nudge: {e}")
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
            "buying_requests": "buying_requests",
            "buying_request": "buying_requests",
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
