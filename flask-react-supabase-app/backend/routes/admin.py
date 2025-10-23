"""
Admin routes for managing listings, users, reports, and dealers
"""
from flask import Blueprint, jsonify, request
from functools import wraps
import logging
import requests
import os

logger = logging.getLogger(__name__)

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')

# Get config from environment
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def admin_required(f):
    """Decorator to check if user is admin"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get user from request context (set by token_required)
        user_id = getattr(request, 'user_id', None)
        
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
        
        # Check if user is admin
        try:
            headers = {
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=is_admin",
                headers=headers,
                timeout=5
            )
            
            if response.status_code == 200:
                users = response.json()
                if users and users[0].get('is_admin'):
                    return f(*args, **kwargs)
            
            return jsonify({'error': 'Admin access required'}), 403
            
        except Exception as e:
            logger.error(f"Error checking admin status: {e}")
            return jsonify({'error': 'Authorization check failed'}), 500
    
    return decorated_function

# Listings Management
@admin_bp.route('/listings', methods=['GET'])
@admin_required
def get_all_listings():
    """Get all listings with user details for admin review"""
    try:
        listing_type = request.args.get('type', 'cars')  # cars, bikes, plates, parts
        status = request.args.get('status')  # pending, approved, rejected
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json'
        }
        
        # Build query
        table_map = {
            'cars': 'cars',
            'bikes': 'bikes',
            'plates': 'license_plates',
            'parts': 'car_parts'
        }
        
        table = table_map.get(listing_type, 'cars')
        query = f"{SUPABASE_URL}/rest/v1/{table}?select=*,users(email,first_name,last_name,username)&order=created_at.desc"
        
        if status:
            query += f"&status=eq.{status}"
        
        response = requests.get(query, headers=headers, timeout=10)
        
        if response.status_code == 200:
            listings = response.json()
            
            # Enhance with user info for display
            for listing in listings:
                user_info = listing.pop('users', {})
                if user_info:
                    listing['user_email'] = user_info.get('email')
                    listing['user_name'] = f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip() or user_info.get('username', 'Unknown')
                else:
                    listing['user_email'] = 'Unknown'
                    listing['user_name'] = 'Unknown'
                
                # Create display title
                if listing_type == 'cars':
                    listing['display_title'] = f"{listing.get('make_year', '')} {listing.get('car_manufacturer', '')} {listing.get('car_model', '')} — posted by {listing['user_name']}"
                elif listing_type == 'bikes':
                    listing['display_title'] = f"{listing.get('make_year', '')} {listing.get('make', '')} {listing.get('model', '')} — posted by {listing['user_name']}"
                elif listing_type == 'plates':
                    listing['display_title'] = f"{listing.get('city', '')} {listing.get('code', '')} {listing.get('number', '')} — posted by {listing['user_name']}"
                else:
                    listing['display_title'] = f"{listing.get('title', 'Unknown listing')} — posted by {listing['user_name']}"
            
            return jsonify(listings), 200
        else:
            return jsonify({'error': 'Failed to fetch listings'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error fetching admin listings: {e}")
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/listings/<listing_id>/approve', methods=['POST'])
@admin_required
def approve_listing(listing_id):
    """Approve a listing"""
    try:
        listing_type = request.json.get('type', 'cars')
        
        table_map = {
            'cars': 'cars',
            'bikes': 'bikes',
            'plates': 'license_plates',
            'parts': 'car_parts'
        }
        
        table = table_map.get(listing_type, 'cars')
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        update_data = {
            'status': 'approved',
            'is_approved': True,
            'approved_at': 'now()',
            'approved_by': request.user_id
        }
        
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{listing_id}",
            headers=headers,
            json=update_data,
            timeout=5
        )
        
        if response.status_code in [200, 204]:
            return jsonify({'message': 'Listing approved successfully'}), 200
        else:
            return jsonify({'error': 'Failed to approve listing'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error approving listing: {e}")
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/listings/<listing_id>/reject', methods=['POST'])
@admin_required
def reject_listing(listing_id):
    """Reject a listing"""
    try:
        listing_type = request.json.get('type', 'cars')
        reason = request.json.get('reason', '')
        
        table_map = {
            'cars': 'cars',
            'bikes': 'bikes',
            'plates': 'license_plates',
            'parts': 'car_parts'
        }
        
        table = table_map.get(listing_type, 'cars')
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        update_data = {
            'status': 'rejected',
            'is_approved': False,
            'rejected_at': 'now()',
            'rejected_by': request.user_id,
            'rejection_reason': reason
        }
        
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{listing_id}",
            headers=headers,
            json=update_data,
            timeout=5
        )
        
        if response.status_code in [200, 204]:
            return jsonify({'message': 'Listing rejected successfully'}), 200
        else:
            return jsonify({'error': 'Failed to reject listing'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error rejecting listing: {e}")
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/listings/<listing_id>/delete', methods=['DELETE'])
@admin_required
def delete_listing(listing_id):
    """Delete a listing (admin only)"""
    try:
        listing_type = request.args.get('type', 'cars')
        
        table_map = {
            'cars': 'cars',
            'bikes': 'bikes',
            'plates': 'license_plates',
            'parts': 'car_parts'
        }
        
        table = table_map.get(listing_type, 'cars')
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json'
        }
        
        # Delete associated images first
        image_table_map = {
            'cars': 'car_images',
            'bikes': 'bike_images',
            'plates': 'plate_images',
            'parts': 'part_images'
        }
        
        image_table = image_table_map.get(listing_type)
        if image_table:
            id_field = f"{listing_type[:-1] if listing_type.endswith('s') else listing_type}_id"
            if listing_type == 'plates':
                id_field = 'plate_id'
            
            requests.delete(
                f"{SUPABASE_URL}/rest/v1/{image_table}?{id_field}=eq.{listing_id}",
                headers=headers,
                timeout=5
            )
        
        # Delete the listing
        response = requests.delete(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{listing_id}",
            headers=headers,
            timeout=5
        )
        
        if response.status_code in [200, 204]:
            return jsonify({'message': 'Listing deleted successfully'}), 200
        else:
            return jsonify({'error': 'Failed to delete listing'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error deleting listing: {e}")
        return jsonify({'error': str(e)}), 500

# Reports Management
@admin_bp.route('/reports', methods=['GET'])
@admin_required
def get_reports():
    """Get all reports"""
    try:
        status = request.args.get('status')  # pending, resolved, dismissed
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json'
        }
        
        query = f"{SUPABASE_URL}/rest/v1/reports?select=*,users!reporter_id(email,username)&order=created_at.desc"
        
        if status:
            query += f"&status=eq.{status}"
        
        response = requests.get(query, headers=headers, timeout=10)
        
        if response.status_code == 200:
            reports = response.json()
            
            # Enhance with reporter info
            for report in reports:
                reporter = report.pop('users', {})
                if reporter:
                    report['reporter_email'] = reporter.get('email')
                    report['reporter_username'] = reporter.get('username')
                
            return jsonify(reports), 200
        else:
            return jsonify({'error': 'Failed to fetch reports'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error fetching reports: {e}")
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/reports/<report_id>/resolve', methods=['POST'])
@admin_required
def resolve_report(report_id):
    """Resolve a report"""
    try:
        action = request.json.get('action')  # 'dismiss' or 'action_taken'
        notes = request.json.get('notes', '')
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        update_data = {
            'status': 'resolved' if action == 'action_taken' else 'dismissed',
            'resolved_at': 'now()',
            'resolved_by': request.user_id,
            'admin_notes': notes
        }
        
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/reports?id=eq.{report_id}",
            headers=headers,
            json=update_data,
            timeout=5
        )
        
        if response.status_code in [200, 204]:
            return jsonify({'message': 'Report resolved successfully'}), 200
        else:
            return jsonify({'error': 'Failed to resolve report'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error resolving report: {e}")
        return jsonify({'error': str(e)}), 500

# Dealer Management
@admin_bp.route('/dealers', methods=['GET'])
@admin_required
def get_dealers():
    """Get all dealers and pending dealer verification requests"""
    try:
        status = request.args.get('status')  # verified, pending, all
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json'
        }
        
        query = f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=*&order=created_at.desc"
        
        if status == 'verified':
            query += "&dealer_verified=eq.true"
        elif status == 'pending':
            query += "&dealer_verified=eq.false&dealer_verification_requested_at=not.is.null"
        
        response = requests.get(query, headers=headers, timeout=10)
        
        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            return jsonify({'error': 'Failed to fetch dealers'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error fetching dealers: {e}")
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/dealers/<user_id>/verify', methods=['POST'])
@admin_required
def verify_dealer(user_id):
    """Verify a dealer"""
    try:
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        update_data = {
            'dealer_verified': True,
            'dealer_verified_at': 'now()',
            'dealer_verified_by': request.user_id
        }
        
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json=update_data,
            timeout=5
        )
        
        if response.status_code in [200, 204]:
            return jsonify({'message': 'Dealer verified successfully'}), 200
        else:
            return jsonify({'error': 'Failed to verify dealer'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error verifying dealer: {e}")
        return jsonify({'error': str(e)}), 500

@admin_bp.route('/dealers/<user_id>/reject', methods=['POST'])
@admin_required
def reject_dealer(user_id):
    """Reject dealer verification"""
    try:
        reason = request.json.get('reason', '')
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        update_data = {
            'dealer_verified': False,
            'dealer_verification_rejected_at': 'now()',
            'dealer_verification_rejected_by': request.user_id,
            'dealer_rejection_reason': reason
        }
        
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json=update_data,
            timeout=5
        )
        
        if response.status_code in [200, 204]:
            return jsonify({'message': 'Dealer verification rejected'}), 200
        else:
            return jsonify({'error': 'Failed to reject dealer'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error rejecting dealer: {e}")
        return jsonify({'error': str(e)}), 500

# User Management
@admin_bp.route('/users', methods=['GET'])
@admin_required
def get_users():
    """Get all users"""
    try:
        search = request.args.get('search', '')
        
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': 'application/json'
        }
        
        query = f"{SUPABASE_URL}/rest/v1/users?select=*&order=created_at.desc"
        
        if search:
            query += f"&or=(email.ilike.%{search}%,username.ilike.%{search}%,first_name.ilike.%{search}%,last_name.ilike.%{search}%)"
        
        response = requests.get(query, headers=headers, timeout=10)
        
        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            return jsonify({'error': 'Failed to fetch users'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error fetching users: {e}")
        return jsonify({'error': str(e)}), 500
