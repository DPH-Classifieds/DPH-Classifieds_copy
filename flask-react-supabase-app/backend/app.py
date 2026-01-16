from flask import Flask, jsonify, request, abort, send_from_directory, session, redirect, url_for, flash, Blueprint, render_template, make_response
from dotenv import load_dotenv
import os
import requests
from flask_cors import CORS
import logging
from functools import wraps
import jwt
import json
import time
import re
from collections import defaultdict, deque
from werkzeug.utils import secure_filename
import psycopg2
from PIL import Image, ImageDraw, ImageFont
import uuid
import threading
import datetime
import secrets

load_dotenv()  # Loads the environment variables from .env

# Set up logging with conditional verbosity
log_level = logging.INFO if os.getenv('FLASK_ENV') == 'production' else logging.DEBUG
logging.basicConfig(
    level=log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static')
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = os.getenv('FLASK_ENV') == 'production'
MAX_LISTINGS_PER_USER = int(os.getenv('MAX_LISTINGS_PER_USER', '4'))
MAX_UPLOAD_SIZE_MB = int(os.getenv('MAX_UPLOAD_SIZE_MB', '10'))
Image.MAX_IMAGE_PIXELS = int(os.getenv('MAX_IMAGE_PIXELS', '25000000'))
CONTACT_RATE_LIMIT_WINDOW_SEC = int(os.getenv('CONTACT_RATE_LIMIT_WINDOW_SEC', '3600'))
CONTACT_RATE_LIMIT_MAX = int(os.getenv('CONTACT_RATE_LIMIT_MAX', '5'))
CONTACT_RATE_LIMIT = defaultdict(deque)
EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

def _get_cors_origins():
    origins_env = os.getenv("CORS_ORIGINS", "")
    if origins_env:
        origins = [origin.strip() for origin in origins_env.split(",") if origin.strip()]
        if origins:
            return origins
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://dph-classifieds.vercel.app",
        "https://dph-classifieds-three.vercel.app",
    ]

# Enable CORS for all routes, with specific origins for security
CORS(app, resources={r"/*": {"origins": _get_cors_origins()}}, supports_credentials=True)

# Configure a secret key for session management
# IMPORTANT: In a production environment, use a strong, randomly generated key set via environment variable.
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-please-change")
if os.getenv('FLASK_ENV') == 'production' and app.secret_key == "dev-secret-key-please-change":
    raise RuntimeError("FLASK_SECRET_KEY must be set in production.")

def _get_safe_frontend_origin(request_origin):
    allowed_origins = _get_cors_origins()
    if request_origin in allowed_origins:
        return request_origin
    return os.getenv("FRONTEND_URL", allowed_origins[0] if allowed_origins else "http://localhost:3000")

def _redact_headers(headers):
    if not headers:
        return {}
    redacted = dict(headers)
    for key in ['Authorization', 'apikey', 'X-Postgres-Role']:
        if key in redacted:
            redacted[key] = 'redacted'
    return redacted

def _contact_rate_limited(client_ip):
    if not client_ip:
        return False
    now = time.time()
    window_start = now - CONTACT_RATE_LIMIT_WINDOW_SEC
    entries = CONTACT_RATE_LIMIT[client_ip]
    while entries and entries[0] < window_start:
        entries.popleft()
    if len(entries) >= CONTACT_RATE_LIMIT_MAX:
        return True
    entries.append(now)
    return False

# Create static directory for file uploads if it doesn't exist
os.makedirs(os.path.join('static', 'uploads', 'plates'), exist_ok=True)

@app.after_request
def add_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    if os.getenv('FLASK_ENV') == 'production':
        response.headers.setdefault('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return response

def _get_user_listing_count(user_id):
    tables = ['cars', 'bikes', 'license_plates', 'car_parts']
    total = 0

    for table in tables:
        data, status_code = supabase_request(
            'get',
            f'/rest/v1/{table}',
            params={
                'select': 'id',
                'user_id': f'eq.{user_id}',
                'limit': MAX_LISTINGS_PER_USER + 1
            },
            use_service_role=True
        )

        if status_code >= 400:
            return None, data

        total += len(data)
        if total >= MAX_LISTINGS_PER_USER:
            break

    return total, None

def _enforce_listing_limit(user_id):
    total, error = _get_user_listing_count(user_id)
    if error is not None:
        return jsonify({'error': 'Failed to verify listing limit'}), 500
    if total >= MAX_LISTINGS_PER_USER:
        return jsonify({
            'error': f'Listing limit reached. You can only post {MAX_LISTINGS_PER_USER} ads.',
            'code': 'listing_limit',
            'limit': MAX_LISTINGS_PER_USER,
            'current': total
        }), 403
    return None

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Add service role key to app config for easy access
app.config['SUPABASE_URL'] = SUPABASE_URL
app.config['SUPABASE_SERVICE_ROLE_KEY'] = SUPABASE_SERVICE_ROLE_KEY

logger.info(f"SUPABASE_URL: {SUPABASE_URL}")
logger.info(f"SUPABASE_KEY exists: {bool(SUPABASE_KEY)}")
logger.info(f"SUPABASE_JWT_SECRET exists: {bool(SUPABASE_JWT_SECRET)}")
logger.info(f"SUPABASE_SERVICE_ROLE_KEY exists: {bool(SUPABASE_SERVICE_ROLE_KEY)}")

# Check Turnstile configuration
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY")
if TURNSTILE_SECRET_KEY:
    logger.info(f"✓ TURNSTILE_SECRET_KEY is configured (length: {len(TURNSTILE_SECRET_KEY)})")
else:
    logger.warning("✗ TURNSTILE_SECRET_KEY is NOT configured - Captcha validation will be skipped!")

# Import and register admin routes
try:
    from routes.admin import admin_bp
    app.register_blueprint(admin_bp)
    logger.info("Admin routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin routes: {e}")

@app.context_processor
def inject_current_year():
    return {'current_year': datetime.datetime.now().year}

# Initialize database tables
def ensure_tables_exist():
    try:
        logger.info("Checking if required tables exist")
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
        
        headers = {
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
            'X-Postgres-Role': 'service_role'
        }
        
        # Check if users table exists by trying to query it
        users_check = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?limit=1",
            headers=headers
        )
        
        if users_check.status_code == 404 or 'does not exist' in users_check.text.lower():
            logger.info("Users table does not exist, creating it")
            
            # Use RPC to create the table
            create_table_query = {
                "name": "execute_sql",
                "schema": "postgres",
                "arguments": {
                    "query": """
                    CREATE TABLE IF NOT EXISTS public.users (
                        id UUID PRIMARY KEY,
                        email TEXT,
                        is_admin BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    
                    -- Add RLS policies
                    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
                    
                    -- Policy for users to read their own data
                    CREATE POLICY "Users can read their own data" 
                    ON public.users 
                    FOR SELECT 
                    USING (auth.uid() = id);
                    
                    -- Policy for users to update their own data
                    CREATE POLICY "Users can update their own data" 
                    ON public.users 
                    FOR UPDATE 
                    USING (auth.uid() = id);
                    
                    -- Grant permissions to authenticated users
                    GRANT SELECT, UPDATE ON public.users TO authenticated;
                    """
                }
            }
            
            rpc_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc",
                json=create_table_query,
                headers=headers
            )
            
            if rpc_response.status_code >= 400:
                logger.error(f"Failed to create users table: {rpc_response.status_code} - {rpc_response.text}")
            else:
                logger.info("Successfully created users table")
        else:
            logger.info("Users table already exists")
            
    except Exception as e:
        logger.error(f"Error checking/creating tables: {str(e)}")

# Start the table check in a background thread to not delay startup
threading.Thread(target=ensure_tables_exist).start()

# Database connection
def get_db_connection():
    try:
        # Instead of trying to connect directly to Supabase's Postgres (which won't work),
        # let's use our existing supabase_request function to handle the plate creation
        logger.info("Using supabase_request for database operations instead of direct connection")
        return None
    except Exception as e:
        logger.error(f"Error connecting to database: {str(e)}")
        raise e

# Authentication middleware
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        logger.info("Checking authorization header")
        
        # Check if Authorization header exists and has correct format
        if not auth_header:
            logger.error("No Authorization header present")
            return jsonify({'message': 'Authorization header is required'}), 401
            
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            logger.error("Invalid Authorization header format")
            return jsonify({'message': 'Invalid Authorization format. Use: Bearer <token>'}), 401
            
        token = parts[1]
        
        try:
            # Validate token with Supabase
            url = f"{SUPABASE_URL}/auth/v1/user"
            headers = {
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {token}'
            }
            
            logger.info("Validating token with Supabase")
            response = requests.get(url, headers=headers, timeout=10)
            
            if response.status_code == 401:
                logger.error("Token expired or invalid")
                return jsonify({'message': 'Token has expired or is invalid'}), 401
            elif response.status_code != 200:
                logger.error(f"Supabase validation failed: {response.status_code}")
                return jsonify({'message': 'Token validation failed'}), response.status_code
                
            # Get user data from response
            user_data = response.json()
            if not user_data or 'id' not in user_data:
                logger.error("Invalid user data in token")
                return jsonify({'message': 'Invalid user data'}), 401
                
            current_user = user_data['id']
            logger.info(f"Token validated for user: {current_user}")
            
            # Add user data to request context
            request.user_id = current_user
            request.user_data = user_data
            
            return f(current_user, *args, **kwargs)
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Network error during token validation: {str(e)}")
            return jsonify({'message': 'Error validating token'}), 503
        except Exception as e:
            logger.error(f"Unexpected error during token validation: {str(e)}")
            return jsonify({'message': 'Internal server error'}), 500
    
    return decorated

# Supabase REST API Helper
def supabase_request(method, path, data=None, params=None, user_id=None, use_service_role=False):
    url = f"{SUPABASE_URL}{path}"
    
    # Determine which key to use - for admin operations or data-modifying operations, always use service role key
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
    
    if use_service_role or method.lower() in ['post', 'put', 'patch', 'delete'] or 'users' in path or 'admin' in path:
        # For admin operations, always use service role
        headers = {
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
            'X-Client-Info': 'backend-api',
            'X-Postgres-Role': 'service_role'  # This bypasses RLS
        }
    else:
        # For read operations, use regular anon key
        headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json'
        }
    
    # Add Row Level Security (RLS) policy for authenticated users
    if user_id:
        headers['X-User-Id'] = user_id
    
    logger.info(f"Making {method.upper()} request to {url}")
    logger.debug(f"Headers: {_redact_headers(headers)}")
    if params:
        logger.debug(f"Params: {params}")
    
    try:
        if method.lower() == 'get':
            response = requests.get(url, headers=headers, params=params)
        elif method.lower() == 'post':
            response = requests.post(url, headers=headers, json=data)
        elif method.lower() == 'put':
            response = requests.put(url, headers=headers, json=data)
        elif method.lower() == 'patch':
            response = requests.patch(url, headers=headers, json=data)
        elif method.lower() == 'delete':
            response = requests.delete(url, headers=headers, params=params)
        else:
            return {'error': 'Invalid method'}, 400
        
        logger.info(f"Response status: {response.status_code}")
        
        if response.status_code >= 400:
            logger.error(f"Error response: {response.text}")
            return {'error': response.text}, response.status_code
        
        return response.json(), response.status_code
    
    except Exception as e:
        logger.error(f"Request error: {str(e)}")
        return {'error': str(e)}, 500

# Home endpoint
@app.route('/')
def home():
    logger.info("Root endpoint accessed")
    return jsonify({
        'message': 'Welcome to the Car Classifieds API',
        'status': 'online',
        'version': '1.0.0'
    })

# Get all cars (public)
@app.route('/api/cars', methods=['GET'])
def get_cars():
    try:
        # Get query parameters
        limit = request.args.get('limit', '50')
        offset = request.args.get('offset', '0')
        order = request.args.get('order', 'created_at.desc')
        
        # Create parameters for Supabase query, excluding tracking parameters
        params = {
            'select': '*',
            'limit': limit,
            'offset': offset,
            'order': order,
            'status': 'eq.approved',  # Only show approved cars on the frontend
            'is_approved': 'eq.true'  # Double check with is_approved field
        }
        
        # Remove any parameters starting with underscore (like _t)
        filtered_params = {k: v for k, v in params.items() if not k.startswith('_')}
        
        # Define allowed filter fields that exist in the cars table
        allowed_filters = [
            'car_manufacturer', 'car_model', 'car_city', 'make_year_from', 'make_year_to',
            'price_from', 'price_to', 'body_type', 'fuel_type', 'transmission_type',
            'regional_spec', 'kilometer_from', 'kilometer_to', 'steering_side',
            'seating_capacity', 'horsepower', 'engine_capacity'
        ]
        
        # Add additional filters from request args that are in the allowed list
        for key, value in request.args.items():
            if not key.startswith('_') and key not in ['limit', 'offset', 'order', 'extras'] and value:
                if key in allowed_filters:
                    # Handle range filters
                    if key.endswith('_from'):
                        base_field = key.replace('_from', '')
                        if base_field == 'price':
                            filtered_params[f"expected_selling_price"] = f"gte.{value}"
                        elif base_field == 'make_year':
                            filtered_params[f"make_year"] = f"gte.{value}"
                        elif base_field == 'kilometer':
                            filtered_params[f"kilometer_driven"] = f"gte.{value}"
                    elif key.endswith('_to'):
                        base_field = key.replace('_to', '')
                        if base_field == 'price':
                            filtered_params[f"expected_selling_price"] = f"lte.{value}"
                        elif base_field == 'make_year':
                            filtered_params[f"make_year"] = f"lte.{value}"
                        elif base_field == 'kilometer':
                            filtered_params[f"kilometer_driven"] = f"lte.{value}"
                    else:
                        filtered_params[f"{key}"] = f"eq.{value}"
        
        # Handle extras filtering - map frontend extras to database boolean columns
        if 'extras' in request.args:
            extras_list = request.args.getlist('extras')
            
            # Mapping from frontend extras to database boolean columns
            extras_mapping = {
                'Keyless Entry': 'keyless_entry',
                'DVD Player': 'dvd_player',
                'Climate Control': 'climate_control',
                'Navigation System': 'navigation_system',
                'Premium Sound System': 'premium_sound_system',
                'Cooled Seats': 'cooled_seats',
                'Front Wheel Drive': 'front_wheel_drive',
                'Leather Seats': 'leather_seats',
                'Parking Sensors': 'parking_sensors',
                'Rear View Camera': 'rear_view_camera'
            }
            
            for extra in extras_list:
                db_field = extras_mapping.get(extra)
                if db_field:
                    filtered_params[db_field] = 'eq.true'
        
        logger.info(f"Fetching cars with params: {filtered_params}")
        
        response, status_code = supabase_request(
            'get',
            '/rest/v1/cars',
            params=filtered_params
        )
        
        if status_code >= 400:
            logger.error(f"Error response from Supabase: {response}")
            return jsonify({'error': response.get('error', 'Unknown error'), 'data': []}), status_code
        
        # Ensure we always return a list, even if response is None or not a list
        if not response:
            response = []
        elif not isinstance(response, list):
            logger.warning(f"Unexpected response format: {type(response)}")
            response = []
        
        # Fetch images for each car
        try:
            for car in response:
                car_id = car.get('id')
                if car_id:
                    images_response, images_status = supabase_request(
                        'get',
                        '/rest/v1/car_images',
                        params={'select': '*', 'car_id': f'eq.{car_id}'}
                    )
                    
                    if images_status < 400:
                        # Transform url to image_url for frontend compatibility
                        for image in images_response:
                            if 'url' in image and 'image_url' not in image:
                                image['image_url'] = image['url']
                        car['images'] = images_response
                    else:
                        car['images'] = []
                else:
                    car['images'] = []
        except Exception as e:
            logger.warning(f"Error fetching car images: {e}")
            # Continue without images if fetching fails
            for car in response:
                if 'images' not in car:
                    car['images'] = []
            
        logger.info(f"Successfully fetched {len(response)} cars")
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error getting cars: {str(e)}")
        return jsonify({'error': str(e), 'data': []}), 500

# Get car details by ID (public)
@app.route('/api/cars/<string:car_id>', methods=['GET'])
def get_car_by_id(car_id):
    try:
        logger.info(f"Fetching car details for ID: {car_id}")
        
        # Increment view count (async, don't wait for response)
        try:
            headers = {
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                'Content-Type': 'application/json'
            }
            current_view_count = 0
            
            # Get current view count
            view_response = requests.get(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}&select=view_count",
                headers=headers,
                timeout=2
            )
            if view_response.status_code == 200 and view_response.json():
                current_view_count = view_response.json()[0].get('view_count', 0) or 0
            
            # Increment view count
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                headers=headers,
                json={'view_count': current_view_count + 1, 'last_viewed_at': 'now()'},
                timeout=2
            )
        except Exception as view_error:
            logger.warning(f"Failed to increment view count: {view_error}")
        
        # Get car details
        query = f"/rest/v1/cars?id=eq.{car_id}&select=*"
        car_response, car_status = supabase_request('get', query)
        
        if not car_response or len(car_response) == 0:
            logger.warning(f"Car not found with ID: {car_id}")
            return jsonify({"error": "Car not found"}), 404
            
        car = car_response[0]
        logger.info(f"Found car: {car.get('listing_title', 'Untitled')} (ID: {car['id']})")
        
        # Get car images
        images_query = f"/rest/v1/car_images?car_id=eq.{car_id}&select=*"
        logger.info(f"Fetching images with query: {images_query}")
        images_response, images_status = supabase_request('get', images_query)
        
        if images_status < 400:
            logger.info(f"Found {len(images_response)} images for car {car_id}")
            # Transform images for frontend compatibility
            for image in images_response:
                # Ensure both url and image_url fields are present
                if 'url' in image and not image.get('image_url'):
                    image['image_url'] = image['url']
                elif 'image_url' in image and not image.get('url'):
                    image['url'] = image['image_url']
            
            car["images"] = images_response
        else:
            logger.warning(f"Failed to fetch images for car {car_id}: status {images_status}")
            car["images"] = []
        
        logger.info(f"Returning car with {len(car['images'])} images (Views: {car.get('view_count', 0)})")
        return jsonify(car), 200
    except Exception as e:
        logger.error(f"Error fetching car details: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

# Get user's own cars (authenticated)
@app.route('/api/user/cars', methods=['GET'])
@token_required
def get_user_cars(current_user):
    data, status_code = supabase_request(
        'get', 
        '/rest/v1/cars', 
        params={'select': '*', 'user_id': f'eq.{current_user}', 'order': 'created_at.desc'},
        user_id=current_user
    )
    
    if status_code >= 400:
        return jsonify(data), status_code
    
    # Get the car images for each car
    for car in data:
        car_id = car.get('id')
        images_data, images_status = supabase_request(
            'get', 
            '/rest/v1/car_images', 
            params={'select': '*', 'car_id': f'eq.{car_id}'},
            user_id=current_user
        )
        
        if images_status < 400:
            # Transform url to image_url for frontend compatibility
            for image in images_data:
                if 'url' in image and 'image_url' not in image:
                    image['image_url'] = image['url']
            car['images'] = images_data
        else:
            car['images'] = []
    
    return jsonify(data), 200

# Create a new car listing (authenticated)
@app.route('/api/cars', methods=['POST'])
@token_required
def create_car(current_user):
    try:
        # Validate input
        if not request.json:
            return jsonify({'error': 'Invalid request data'}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response
        
        car_data = request.json
        car_data['user_id'] = current_user
        
        # Extract and transform extras array to individual boolean fields
        extras = car_data.pop('extras', [])
        
        # Mapping from extras array values to database boolean columns
        extras_mapping = {
            'Keyless Entry': 'keyless_entry',
            'DVD Player': 'dvd_player',
            'Climate Control': 'climate_control',
            'Navigation System': 'navigation_system',
            'Premium Sound System': 'premium_sound_system',
            'Cooled Seats': 'cooled_seats',
            'Front Wheel Drive': 'front_wheel_drive',
            'Leather Seats': 'leather_seats',
            'Parking Sensors': 'parking_sensors',
            'Rear View Camera': 'rear_view_camera'
        }
        
        # Set all extras boolean fields to False first
        for db_field in extras_mapping.values():
            car_data[db_field] = False
        
        # Set selected extras to True
        for extra in extras:
            if extra in extras_mapping:
                car_data[extras_mapping[extra]] = True
        
        # Extract images from the request
        images = car_data.pop('images', [])

        # Whitelist allowed columns for cars to avoid schema cache errors
        # Cars table schema (per cars_schema.sql) - keep only these fields
        allowed_fields = {
            'car_manufacturer', 'car_model', 'trim', 'regional_spec', 'make_year',
            'kilometer_driven', 'body_type', 'is_insured', 'expected_selling_price',
            'car_owner_phone_number', 'car_city', 'listing_title', 'tour_url',
            'car_description', 'fuel_type', 'transmission_type', 'seating_capacity',
            'horsepower', 'engine_capacity', 'steering_side', 'car_location',
            'vehicle_type', 'is_approved', 'user_id',
            'keyless_entry', 'dvd_player', 'climate_control', 'navigation_system',
            'premium_sound_system', 'cooled_seats', 'front_wheel_drive', 'leather_seats',
            'parking_sensors', 'rear_view_camera'
        }
        car_data = {k: v for k, v in car_data.items() if k in allowed_fields}
        
        # Enforce at least one image
        if not images or len(images) == 0:
            return jsonify({'error': 'At least one image is required for a car listing.'}), 400
        
        # Create the car
        data, status_code = supabase_request(
            'post', 
            '/rest/v1/cars', 
            data=car_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            return jsonify(data), status_code
        
        car_id = data[0]['id']
        
        # Add images if any
        image_inserts = []
        for image_url in images:
            image_inserts.append({
                'car_id': car_id,
                'url': image_url,
                'image_url': image_url  # Add image_url field for frontend compatibility
            })
        images_data, images_status = supabase_request(
            'post', 
            '/rest/v1/car_images', 
            data=image_inserts,
            user_id=current_user
        )
        if images_status < 400:
            data[0]['images'] = images_data
        else:
            data[0]['images'] = []
        
        return jsonify(data[0]), 201
    except Exception as e:
        logger.error(f"Error creating car listing: {e}")
        return jsonify({"error": str(e)}), 500

# Handle OPTIONS preflight for car update
@app.route('/api/cars/<string:car_id>', methods=['OPTIONS'])
def update_car_options(car_id):
    response = make_response()
    origin = request.headers.get("Origin")
    if origin in _get_cors_origins():
        response.headers.add("Access-Control-Allow-Origin", origin)
    response.headers.add('Access-Control-Allow-Headers', "*")
    response.headers.add('Access-Control-Allow-Methods', "*")
    return response

# Update a car listing (authenticated)
@app.route('/api/cars/<string:car_id>', methods=['PUT'])
@token_required
def update_car(current_user, car_id):
        
    try:
        logger.info(f"Updating car {car_id} for user {current_user}")
        
        # Check if this is FormData or JSON
        is_form_data = request.content_type and 'multipart/form-data' in request.content_type
        
        if not is_form_data and not request.json:
            return jsonify({'error': 'Invalid request data'}), 400
        
        # Verify car ownership
        car_data, car_status = supabase_request(
            'get', 
            f'/rest/v1/cars', 
            params={'select': 'user_id', 'id': f'eq.{car_id}', 'limit': 1},
            user_id=current_user
        )
        
        if car_status >= 400:
            return jsonify(car_data), car_status
        
        if not car_data:
            return jsonify({'error': 'Car not found'}), 404
        
        if car_data[0]['user_id'] != current_user:
            return jsonify({'error': 'You do not have permission to update this car'}), 403
        
        # Extract data based on content type
        if is_form_data:
            logger.info("Processing FormData request")
            update_data = {}
            
            # Extract form fields
            for key in request.form.keys():
                value = request.form.get(key)
                if key not in ['keep_image_ids'] and value not in ['', 'false', 'undefined', 'null']:
                    # Convert boolean strings
                    if value == 'true':
                        update_data[key] = True
                    elif value == 'false':
                        update_data[key] = False
                    # Convert numeric strings
                    elif key in ['make_year', 'mileage', 'expected_selling_price'] and value.isdigit():
                        update_data[key] = int(value)
                    else:
                        update_data[key] = value
            
            logger.info(f"Extracted form data: {update_data}")
            
            # Handle new images
            new_images = request.files.getlist('images') if 'images' in request.files else []
            keep_image_ids = request.form.getlist('keep_image_ids')
            
        else:
            logger.info("Processing JSON request")
            update_data = request.json
            new_images = []
            keep_image_ids = []

        # Drop fields that don't exist in the cars table schema
        update_data.pop('is_dealer', None)
        
        # Extract and transform extras array to individual boolean fields
        if 'extras' in update_data:
            extras = update_data.pop('extras', [])
            
            # Mapping from extras array values to database boolean columns
            extras_mapping = {
                'Keyless Entry': 'keyless_entry',
                'DVD Player': 'dvd_player',
                'Climate Control': 'climate_control',
                'Navigation System': 'navigation_system',
                'Premium Sound System': 'premium_sound_system',
                'Cooled Seats': 'cooled_seats',
                'Front Wheel Drive': 'front_wheel_drive',
                'Leather Seats': 'leather_seats',
                'Parking Sensors': 'parking_sensors',
                'Rear View Camera': 'rear_view_camera'
            }
            
            # Set all extras boolean fields to False first
            for db_field in extras_mapping.values():
                update_data[db_field] = False
            
            # Set selected extras to True
            for extra in extras:
                if extra in extras_mapping:
                    update_data[extras_mapping[extra]] = True

        # Whitelist allowed columns (cars schema)
        allowed_fields = {
            'car_manufacturer', 'car_model', 'trim', 'regional_spec', 'make_year',
            'kilometer_driven', 'body_type', 'is_insured', 'expected_selling_price',
            'car_owner_phone_number', 'car_city', 'listing_title', 'tour_url',
            'car_description', 'fuel_type', 'transmission_type', 'seating_capacity',
            'horsepower', 'engine_capacity', 'steering_side', 'car_location',
            'vehicle_type', 'is_approved',
            'keyless_entry', 'dvd_player', 'climate_control', 'navigation_system',
            'premium_sound_system', 'cooled_seats', 'front_wheel_drive', 'leather_seats',
            'parking_sensors', 'rear_view_camera'
        }
        update_data = {k: v for k, v in update_data.items() if k in allowed_fields}
        
        # Update the car
        data, status_code = supabase_request(
            'put', 
            f'/rest/v1/cars', 
            params={'id': f'eq.{car_id}'},
            data=update_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            return jsonify(data), status_code
        
        # Handle image updates for FormData requests
        if is_form_data and (new_images or keep_image_ids):
            logger.info(f"Managing images: keeping {len(keep_image_ids)} existing, uploading {len(new_images)} new")
            
            # Get all current images
            current_images_resp, current_images_status = supabase_request(
                'get', 
                '/rest/v1/car_images', 
                params={'select': '*', 'car_id': f'eq.{car_id}'},
                user_id=current_user
            )
            
            current_images = current_images_resp if current_images_status < 400 else []
            
            # Delete images not in keep_image_ids
            for img in current_images:
                if img['id'] not in keep_image_ids:
                    logger.info(f"Deleting image {img['id']}")
                    supabase_request(
                        'delete', 
                        '/rest/v1/car_images', 
                        params={'id': f'eq.{img["id"]}'},
                        user_id=current_user
                    )
            
            # Upload new images
            if new_images:
                upload_dir = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
                os.makedirs(upload_dir, exist_ok=True)
                
                for file in new_images:
                    if file and file.filename:
                        # Generate unique filename
                        filename = secure_filename(file.filename)
                        timestamp = int(time.time())
                        file_extension = os.path.splitext(filename)[1]
                        unique_filename = f"{timestamp}_{uuid.uuid4().hex[:8]}{file_extension}"
                        
                        # Save file
                        file_path = os.path.join(upload_dir, unique_filename)
                        file.save(file_path)
                        logger.info(f"Saved new image to {file_path}")
                        
                        # Generate URL
                        image_url = f"/static/uploads/{unique_filename}"
                        
                        # Save to database
                        image_data = {
                            'car_id': car_id,
                            'url': image_url,
                            'image_url': image_url
                        }
                        
                        supabase_request(
                            'post', 
                            '/rest/v1/car_images', 
                            data=image_data,
                            user_id=current_user
                        )
        
        # Get updated car with images
        updated_car, updated_status = supabase_request(
            'get', 
            f'/rest/v1/cars', 
            params={'select': '*', 'id': f'eq.{car_id}', 'limit': 1},
            user_id=current_user
        )
        
        if updated_status >= 400 or not updated_car:
            return jsonify({'message': 'Car updated successfully'}), 200
        
        car = updated_car[0]
        
        # Get car images
        images_data, images_status = supabase_request(
            'get', 
            '/rest/v1/car_images', 
            params={'select': '*', 'car_id': f'eq.{car_id}'},
            user_id=current_user
        )
        
        if images_status < 400:
            # Transform url to image_url for frontend compatibility
            for image in images_data:
                if 'url' in image and 'image_url' not in image:
                    image['image_url'] = image['url']
            car['images'] = images_data
        else:
            car['images'] = []
        
        return jsonify(car), 200
    except Exception as e:
        logger.error(f"Error updating car: {e}")
        return jsonify({"error": str(e)}), 500

# Delete a car listing (authenticated)
@app.route('/api/cars/<string:car_id>', methods=['DELETE'])
@token_required
def delete_car(current_user, car_id):
    try:
        # Verify car ownership
        car_data, car_status = supabase_request(
            'get', 
            f'/rest/v1/cars', 
            params={'select': 'user_id', 'id': f'eq.{car_id}', 'limit': 1},
            user_id=current_user
        )
        
        if car_status >= 400:
            return jsonify(car_data), car_status
        
        if not car_data:
            return jsonify({'error': 'Car not found'}), 404
        
        if car_data[0]['user_id'] != current_user:
            return jsonify({'error': 'You do not have permission to delete this car'}), 403
        
        # Delete car images first
        delete_images, delete_images_status = supabase_request(
            'delete', 
            '/rest/v1/car_images', 
            params={'car_id': f'eq.{car_id}'},
            user_id=current_user
        )
        
        # Delete the car
        delete_car, delete_car_status = supabase_request(
            'delete', 
            '/rest/v1/cars', 
            params={'id': f'eq.{car_id}'},
            user_id=current_user
        )
        
        if delete_car_status >= 400:
            return jsonify(delete_car), delete_car_status
        
        return jsonify({'message': 'Car deleted successfully'}), 200
    except Exception as e:
        logger.error(f"Error deleting car: {e}")
        return jsonify({"error": str(e)}), 500

# Upload car images (authenticated)
@app.route('/api/cars/<string:car_id>/images', methods=['POST'])
@token_required
def upload_car_images(current_user, car_id):
    try:
        # Verify the car belongs to the user
        verify_query = f"/rest/v1/cars?id=eq.{car_id}&user_id=eq.{current_user}"
        verify_response, verify_status = supabase_request('get', verify_query)
        
        if not verify_response or len(verify_response) == 0:
            # Try checking if the car has a null user_id (for demo purposes)
            null_verify_query = f"/rest/v1/cars?id=eq.{car_id}&user_id=is.null"
            null_verify_response, null_verify_status = supabase_request('get', null_verify_query)
            
            if not null_verify_response or len(null_verify_response) == 0:
                return jsonify({"error": "Car not found or you don't have permission"}), 403
        
        # Process the images (in a real implementation, you would handle file uploads)
        data = request.json
        image_urls = data.get('image_urls', [])
        
        # Save each image URL to the database
        for image_url in image_urls:
            image_data = {
                "car_id": car_id,
                "url": image_url,
                "image_url": image_url  # Add image_url field for frontend compatibility
            }
            supabase_request('post', '/rest/v1/car_images', data=image_data, user_id=current_user)
        
        return jsonify({"message": f"{len(image_urls)} images uploaded successfully"})
    except Exception as e:
        logger.error(f"Error uploading images: {e}")
        return jsonify({"error": str(e)}), 500

def upload_to_supabase_storage(file, bucket_name='listing-images', folder=''):
    """
    Upload a file to Supabase Storage and return the public URL.
    Uses image compression for faster loading.
    """
    try:
        if not file or not file.filename:
            return None, "No file provided"

        allowed_types = {'image/jpeg', 'image/png', 'image/webp'}
        if file.mimetype not in allowed_types:
            return None, "Unsupported image type"

        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        if file_size > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
            return None, f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)"

        # Generate unique filename
        filename = secure_filename(file.filename)
        file_extension = os.path.splitext(filename)[1].lower()
        unique_filename = f"{folder}/{uuid.uuid4().hex}{file_extension}" if folder else f"{uuid.uuid4().hex}{file_extension}"
        
        # Read and compress image
        img = Image.open(file)
        img.verify()
        file.seek(0)
        img = Image.open(file)
        
        # Convert RGBA to RGB if needed
        if img.mode == 'RGBA':
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background
        
        # Resize if too large (max 1920px width)
        max_width = 1920
        if img.width > max_width:
            ratio = max_width / img.width
            new_size = (max_width, int(img.height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        
        # Save to bytes with compression
        from io import BytesIO
        output = BytesIO()
        
        # Use WebP for better compression, fallback to JPEG
        if file_extension in ['.jpg', '.jpeg', '.png']:
            img.save(output, format='JPEG', quality=85, optimize=True)
            unique_filename = unique_filename.rsplit('.', 1)[0] + '.jpg'
            content_type = 'image/jpeg'
        else:
            img.save(output, format=img.format or 'JPEG', quality=85)
            content_type = f'image/{img.format.lower()}' if img.format else 'image/jpeg'
        
        output.seek(0)
        file_data = output.read()
        
        # Upload to Supabase Storage
        upload_url = f"{SUPABASE_URL}/storage/v1/object/{bucket_name}/{unique_filename}"
        headers = {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
            'Content-Type': content_type
        }
        
        response = requests.post(upload_url, headers=headers, data=file_data, timeout=30)
        
        if response.status_code in [200, 201]:
            # Return public URL
            public_url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket_name}/{unique_filename}"
            logger.info(f"Image uploaded to Supabase Storage: {public_url}")
            return public_url, None
        else:
            error_msg = f"Supabase Storage upload failed: {response.status_code} - {response.text}"
            logger.error(error_msg)
            return None, error_msg
            
    except Exception as e:
        logger.error(f"Error uploading to Supabase Storage: {str(e)}", exc_info=True)
        return None, str(e)

@app.route('/api/upload-images', methods=['POST'])
@token_required
def upload_images(current_user):
    try:
        logger.info(f"Image upload request received from user: {current_user}")
        
        # Check if files were uploaded
        if 'images' not in request.files:
            logger.error("No images field in request")
            return jsonify({"error": "No images provided"}), 400
        
        files = request.files.getlist('images')
        if not files or all(file.filename == '' for file in files):
            logger.error("No image files selected")
            return jsonify({"error": "No images selected"}), 400
        
        logger.info(f"Processing {len(files)} images")
        image_urls = []
        errors = []
        
        for file in files:
            if file and file.filename:
                # Upload to Supabase Storage
                public_url, error = upload_to_supabase_storage(file, bucket_name='listing-images', folder=current_user)
                
                if public_url:
                    image_urls.append(public_url)
                else:
                    errors.append(f"Failed to upload {file.filename}: {error}")
                    logger.error(f"Failed to upload {file.filename}: {error}")
        
        if not image_urls and errors:
            return jsonify({"error": "All image uploads failed", "details": errors}), 500
        
        logger.info(f"Successfully uploaded {len(image_urls)} images to Supabase Storage")
        
        return jsonify({
            "urls": image_urls,
            "absolute_urls": image_urls,  # Already absolute URLs from Supabase
            "count": len(image_urls),
            "errors": errors if errors else None
        }), 200
    except Exception as e:
        logger.error(f"Error in upload_images: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

# Serve uploaded files
@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    """Serve uploaded files from the uploads directory."""
    try:
        upload_dir = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
        return send_from_directory(upload_dir, filename)
    except Exception as e:
        logger.error(f"Error serving uploaded file {filename}: {e}")
        abort(404)

# Get privacy policy
@app.route('/api/privacy-policy', methods=['GET'])
def get_privacy_policy():
    try:
        query = "/rest/v1/privacy_policies?select=*&order=created_at.desc&limit=1"
        response, response_status = supabase_request('get', query)
        
        if not response or len(response) == 0:
            return jsonify({"privacy_policy": "Privacy policy not found"}), 404
            
        return jsonify(response[0])
    except Exception as e:
        logger.error(f"Error fetching privacy policy: {e}")
        return jsonify({"error": str(e)}), 500

# Get advertisements
@app.route('/api/advertisements', methods=['GET'])
def get_advertisements():
    try:
        query = "/rest/v1/advertisements?select=*&order=created_at.desc&limit=1"
        response, response_status = supabase_request('get', query)
        
        if not response or len(response) == 0:
            return jsonify({"error": "Advertisements not found"}), 404
            
        return jsonify(response[0])
    except Exception as e:
        logger.error(f"Error fetching advertisements: {e}")
        return jsonify({"error": str(e)}), 500

def _send_resend_email(payload):
    resend_api_key = os.getenv("RESEND_API_KEY")
    if not resend_api_key:
        return None, "Missing RESEND_API_KEY"

    response = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {resend_api_key}",
            "Content-Type": "application/json"
        },
        json=payload,
        timeout=10
    )

    if response.status_code >= 400:
        return None, response.text
    return response.json(), None

@app.route('/api/contact', methods=['POST'])
def send_contact_message():
    try:
        data = request.json or {}
        name = (data.get('name') or '').strip()
        email = (data.get('email') or '').strip()
        subject = (data.get('subject') or '').strip()
        message = (data.get('message') or '').strip()

        if not name or not email or not subject or not message:
            return jsonify({'error': 'Missing required fields'}), 400

        if not EMAIL_REGEX.match(email):
            return jsonify({'error': 'Invalid email address'}), 400

        if len(name) > 100 or len(subject) > 200 or len(message) > 5000:
            return jsonify({'error': 'Message is too long'}), 400

        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        if _contact_rate_limited(client_ip):
            return jsonify({'error': 'Too many requests. Please try again later.'}), 429

        from_email = os.getenv("RESEND_FROM_EMAIL")
        to_email = os.getenv("RESEND_TO_EMAIL")
        if not from_email or not to_email:
            return jsonify({'error': 'Email service is not configured'}), 500

        payload = {
            "from": from_email,
            "to": [to_email],
            "subject": f"[Contact] {subject}",
            "reply_to": email,
            "text": f"From: {name} <{email}>\nSubject: {subject}\n\n{message}"
        }

        result, error = _send_resend_email(payload)
        if error:
            logger.error(f"Resend email failed: {error}")
            return jsonify({'error': 'Failed to send message'}), 502

        return jsonify({'message': 'Message sent successfully'}), 200
    except Exception as e:
        logger.error(f"Error sending contact message: {str(e)}")
        return jsonify({'error': 'Failed to send message'}), 500

# Get license plates
@app.route('/api/license-plates', methods=['GET'])
def get_license_plates():
    try:
        # Optional query parameters
        city = request.args.get('city')
        code = request.args.get('code')
        digits = request.args.get('digits')
        
        # Build query
        query = "/rest/v1/license_plates?select=*"
        
        # Add filters if provided
        if city and city != 'All cities':
            query += f"&city=eq.{city}"
        if code and code != 'All codes':
            query += f"&code=eq.{code}"
        if digits and digits != 'Any digits':
            query += f"&digits=eq.{digits}"
            
        response, response_status = supabase_request('get', query)
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error fetching license plates: {e}")
        return jsonify({"error": str(e)}), 500

# Add a test endpoint that returns static data
@app.route('/api/test', methods=['GET'])
def test_data():
    logger.info("Test endpoint accessed")
    sample_data = [
        {"id": "1", "car_manufacturer": "Toyota", "car_model": "Camry", "make_year": 2020, "expected_selling_price": 25000, "listing_title": "2020 Toyota Camry LE"},
        {"id": "2", "car_manufacturer": "Honda", "car_model": "Civic", "make_year": 2019, "expected_selling_price": 22000, "listing_title": "2019 Honda Civic Sport"},
        {"id": "3", "car_manufacturer": "Ford", "car_model": "Mustang", "make_year": 2021, "expected_selling_price": 35000, "listing_title": "2021 Ford Mustang GT"}
    ]
    return jsonify(sample_data)

# User profile routes
@app.route('/api/user/profile', methods=['GET'])
@token_required
def get_user_profile(current_user):
    """Get complete user profile from users table"""
    logger.info(f"=" * 50)
    logger.info(f"GET USER PROFILE REQUEST")
    logger.info(f"User ID: {current_user}")
    
    try:
        # Fetch user data from the users table (not auth table)
        # This is where profile updates are stored
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Get user from users table
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=*"
        
        logger.info(f"Fetching user profile from users table: {url}")
        response = requests.get(url, headers=headers, timeout=10)
        
        logger.info(f"Profile fetch response status: {response.status_code}")
        
        if response.status_code == 200:
            users = response.json()
            
            if users and len(users) > 0:
                user_data = users[0]
                logger.info(f"✓ Successfully retrieved profile for: {user_data.get('email')}")
                logger.info(f"Profile fields: {list(user_data.keys())}")
                logger.info(f"=" * 50)
                
                # Remove sensitive data
                sensitive_fields = ['password', 'encrypted_password']
                for field in sensitive_fields:
                    if field in user_data:
                        del user_data[field]
                
                return jsonify(user_data), 200
            else:
                logger.error(f"✗ No user found with ID: {current_user}")
                logger.info(f"=" * 50)
                return jsonify({'message': 'User not found'}), 404
        else:
            logger.error(f"✗ Failed to get user profile: {response.status_code}")
            logger.error(f"Response: {response.text}")
            logger.info(f"=" * 50)
            return jsonify({'message': 'Failed to get user profile'}), response.status_code
        
    except Exception as e:
        logger.error(f"✗ Exception in get_user_profile: {str(e)}", exc_info=True)
        logger.info(f"=" * 50)
        return jsonify({'error': str(e)}), 500

# Profile management routes
@app.route('/api/user/update-profile', methods=['PUT'])
@token_required
def update_user_profile(current_user):
    """Update user profile information"""
    try:
        data = request.json
        logger.info(f"=" * 50)
        logger.info(f"PROFILE UPDATE REQUEST")
        logger.info(f"User ID: {current_user}")
        logger.info(f"Received data: {json.dumps(data, indent=2)}")
        
        if not data:
            return jsonify({'message': 'No data provided'}), 400
        
        # Map frontend field names to database field names
        field_mapping = {
            'email': 'email',
            'firstName': 'first_name',
            'lastName': 'last_name',
            'username': 'username',
            'displayName': 'display_name',
            'phone': 'phone',
            'countryCode': 'country_code',
            'whatsappNumber': 'whatsapp_number',
            'area': 'area',
            'city': 'area',  # Support legacy city field
            'emirate': 'emirate',
            'country': 'country',
            'postalCode': 'postal_code',
            'address': 'address',
            'bio': 'bio',
            'companyName': 'company_name',
            'companyRegistrationNumber': 'company_registration_number',
            'tradeLicenseNumber': 'trade_license_number',
            'taxRegistrationNumber': 'tax_registration_number',
            'websiteUrl': 'website_url',
            'facebookUrl': 'facebook_url',
            'instagramUrl': 'instagram_url',
            'twitterUrl': 'twitter_url',
            'emailNotifications': 'email_notifications',
            'smsNotifications': 'sms_notifications',
            'marketingEmails': 'marketing_emails',
            'profilePhotoUrl': 'profile_photo_url'
        }
        
        # Prepare update data - only include fields that are provided and not empty
        update_payload = {}
        for frontend_field, db_field in field_mapping.items():
            if frontend_field in data:
                value = data[frontend_field]
                # Include the value if it's not an empty string, or if it's a required field
                if value or value is False or value == 0:  # Include False and 0 but not empty strings
                    update_payload[db_field] = value
        
        if not update_payload:
            logger.warning("No valid fields to update")
            return jsonify({'message': 'No valid fields to update'}), 400
        
        logger.info(f"Update payload: {json.dumps(update_payload, indent=2)}")
        
        # First, verify the user exists
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
        
        # Check if user exists
        check_url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=id,email"
        check_response = requests.get(check_url, headers=headers, timeout=10)
        
        if check_response.status_code != 200 or not check_response.json():
            logger.error(f"User not found: {current_user}")
            return jsonify({'message': 'User not found'}), 404
        
        logger.info(f"User exists, proceeding with update")
        
        # Update using the REST API with eq filter
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}"
        
        logger.info(f"Sending PATCH request to: {url}")
        logger.info(f"Headers: {json.dumps({k: v for k, v in headers.items() if k != 'Authorization'}, indent=2)}")
        
        response = requests.patch(url, headers=headers, json=update_payload, timeout=10)
        
        logger.info(f"PATCH response status: {response.status_code}")
        logger.info(f"PATCH response headers: {dict(response.headers)}")
        logger.info(f"PATCH response body: {response.text}")
        
        if response.status_code in [200, 204]:
            logger.info("Update successful, fetching updated user data")
            
            # Always fetch the updated user data
            get_url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=*"
            get_response = requests.get(get_url, headers=headers, timeout=10)
            
            logger.info(f"GET response status: {get_response.status_code}")
            
            if get_response.status_code == 200:
                users = get_response.json()
                logger.info(f"Fetched {len(users)} user(s)")
                
                if users and len(users) > 0:
                    updated_user = users[0]
                    logger.info(f"✓ Profile updated successfully for: {updated_user.get('email')}")
                    logger.info(f"Updated fields: {list(update_payload.keys())}")
                    logger.info(f"=" * 50)
                    
                    return jsonify({
                        'message': 'Profile updated successfully',
                        'user': updated_user,
                        'updated_fields': list(update_payload.keys())
                    }), 200
                else:
                    logger.error("No users returned after update")
                    return jsonify({'message': 'Update succeeded but could not fetch user data'}), 500
            else:
                logger.error(f"Failed to fetch updated user: {get_response.status_code}")
                return jsonify({'message': 'Update succeeded but could not fetch user data'}), 500
        else:
            logger.error(f"✗ Failed to update profile: {response.status_code}")
            logger.error(f"Response: {response.text}")
            logger.info(f"=" * 50)
            
            error_data = {}
            try:
                error_data = response.json()
            except:
                error_data = {'detail': response.text}
            
            return jsonify({
                'message': 'Failed to update profile', 
                'error': error_data,
                'status': response.status_code
            }), response.status_code
            
    except Exception as e:
        logger.error(f"✗ Exception in update_user_profile: {str(e)}", exc_info=True)
        logger.info(f"=" * 50)
        return jsonify({'error': str(e), 'message': 'Internal server error during profile update'}), 500

@app.route('/api/user/upload-profile-photo', methods=['POST'])
@token_required
def upload_profile_photo(current_user):
    """Upload profile photo to Supabase Storage"""
    try:
        logger.info(f"Uploading profile photo for user ID: {current_user}")
        
        if 'profile_photo' not in request.files:
            return jsonify({'message': 'No file provided'}), 400
        
        file = request.files['profile_photo']
        if file.filename == '':
            return jsonify({'message': 'No file selected'}), 400
        
        # Validate file type
        allowed_types = {'image/jpeg', 'image/jpg', 'image/png', 'image/gif'}
        if file.content_type not in allowed_types:
            return jsonify({'message': 'Invalid file type. Only JPG, PNG, and GIF are allowed'}), 400
        
        # Validate file size (5MB max)
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Reset to beginning
        
        if file_size > 5 * 1024 * 1024:  # 5MB
            return jsonify({'message': 'File size too large. Maximum size is 5MB'}), 400
        
        # Generate unique filename
        import uuid
        from datetime import datetime
        file_extension = file.filename.rsplit('.', 1)[1].lower()
        unique_filename = f"{current_user}/{uuid.uuid4()}.{file_extension}"
        
        # Upload to Supabase Storage
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        upload_url = f"{app.config['SUPABASE_URL']}/storage/v1/object/profile-photos/{unique_filename}"
        
        headers = {
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': file.content_type
        }
        
        file_data = file.read()
        logger.info(f"Uploading file to: {upload_url}")
        
        upload_response = requests.post(upload_url, headers=headers, data=file_data)
        
        if upload_response.status_code in [200, 201]:
            # Generate public URL
            public_url = f"{app.config['SUPABASE_URL']}/storage/v1/object/public/profile-photos/{unique_filename}"
            
            logger.info(f"Profile photo uploaded successfully: {public_url}")
            return jsonify({
                'message': 'Photo uploaded successfully',
                'profile_photo_url': public_url
            }), 200
        else:
            logger.error(f"Failed to upload photo: {upload_response.status_code} - {upload_response.text}")
            return jsonify({'message': 'Failed to upload photo'}), 500
            
    except Exception as e:
        logger.error(f"Error in upload_profile_photo: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/user/statistics', methods=['GET'])
@token_required
def get_user_statistics(current_user):
    """Get user listing statistics"""
    try:
        logger.debug(f"Getting statistics for user ID: {current_user}")
        
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        base_url = app.config['SUPABASE_URL']
        
        # Count cars
        cars_response = requests.get(
            f"{base_url}/rest/v1/cars?user_id=eq.{current_user}&select=id,status,view_count",
            headers=headers
        )
        
        # Count bikes  
        bikes_response = requests.get(
            f"{base_url}/rest/v1/bikes?user_id=eq.{current_user}&select=id,status,view_count",
            headers=headers
        )
        
        # Count plates
        plates_response = requests.get(
            f"{base_url}/rest/v1/license_plates?user_id=eq.{current_user}&select=id,status,view_count",
            headers=headers
        )
        
        # Count parts
        parts_response = requests.get(
            f"{base_url}/rest/v1/car_parts?user_id=eq.{current_user}&select=id,status",
            headers=headers
        )
        
        # Process results
        cars = cars_response.json() if cars_response.status_code == 200 else []
        bikes = bikes_response.json() if bikes_response.status_code == 200 else []
        plates = plates_response.json() if plates_response.status_code == 200 else []
        parts = parts_response.json() if parts_response.status_code == 200 else []
        
        all_listings = cars + bikes + plates + parts
        
        # Calculate statistics
        total_listings = len(all_listings)
        active_listings = sum(1 for item in all_listings if item.get('status') == 'approved')
        pending_listings = sum(1 for item in all_listings if item.get('status') == 'pending')
        
        # Calculate total views (only cars, bikes, and plates have view counts)
        total_views = sum(item.get('view_count', 0) for item in (cars + bikes + plates))
        
        # Get user creation date
        user_response = requests.get(
            f"{base_url}/rest/v1/users?id=eq.{current_user}&select=created_at",
            headers=headers
        )
        
        member_since = None
        if user_response.status_code == 200:
            users = user_response.json()
            if users:
                member_since = users[0].get('created_at')
        
        statistics = {
            'total_listings': total_listings,
            'active_listings': active_listings,
            'sold_listings': 0,  # Placeholder for future feature
            'pending_listings': pending_listings,
            'total_views': total_views,
            'member_since': member_since
        }
        
        logger.debug(f"Statistics calculated for user: {statistics}")
        return jsonify(statistics), 200
        
    except Exception as e:
        logger.error(f"Error in get_user_statistics: {str(e)}")
        return jsonify({'error': str(e)}), 500

def find_user_email_by_username(username):
    """Find user's email by username for login"""
    try:
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Search for user by username
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?username=eq.{username}&select=email"
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            users = response.json()
            if users and len(users) > 0:
                return users[0].get('email')
        
        return None
    except Exception as e:
        logger.error(f"Error finding user by username: {str(e)}")
        return None

# User authentication routes
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    identifier = data.get('email', '')  # This can now be either email or username
    logger.info(f"[Login] Attempt for identifier: {identifier}")
    
    if not data or not identifier or not data.get('password'):
        logger.warning("[Login] Missing email/username or password in request.")
        return jsonify({'message': 'Missing email/username or password'}), 400
    
    password = data.get('password')
    
    # Determine if the identifier is an email or username
    email = identifier
    if '@' not in identifier:
        # It's a username, find the corresponding email
        logger.info(f"[Login] Identifier appears to be username: {identifier}")
        email = find_user_email_by_username(identifier)
        if not email:
            logger.warning(f"[Login] No user found with username: {identifier}")
            return jsonify({'message': 'Invalid username or password'}), 401
        logger.info(f"[Login] Found email for username {identifier}: {email}")
    else:
        logger.info(f"[Login] Identifier appears to be email: {identifier}")
    
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' }
    payload = { 'email': email, 'password': password }
    
    try:
        logger.info(f"[Login] Sending login request to Supabase auth: {url}")
        response = requests.post(url, headers=headers, json=payload)
        
        logger.info(f"[Login] Supabase auth response status: {response.status_code}")
        if response.status_code == 200:
            resp_data = response.json()
            supabase_user_info = resp_data.get('user') 
            token = resp_data.get('access_token')
            logger.info(f"[Login] Supabase auth successful. Token received. Supabase user info: {supabase_user_info}")

            if supabase_user_info and token:
                user_id = supabase_user_info.get('id')
                logger.info(f"[Login] Extracted user_id from Supabase auth: {user_id}")
                
                user_details_for_session = _get_user_details_with_admin_status(user_id)
                logger.info(f"[Login] Details from _get_user_details_with_admin_status: {user_details_for_session}")
                
                if user_details_for_session:
                    resp_data['user'] = user_details_for_session 
                    
                    is_admin_flag = user_details_for_session.get('is_admin')
                    logger.info(f"[Login] Checking 'is_admin' flag from user_details_for_session: {is_admin_flag} (Type: {type(is_admin_flag)})")

                    if is_admin_flag is True:
                        session['is_admin'] = True
                        session['admin_user_id'] = user_details_for_session.get('id')
                        logger.info(f"[Login] !!! Admin session SET for user {user_details_for_session.get('id')}. Session data: {dict(session)}")
                    else:
                        session.pop('is_admin', None)
                        session.pop('admin_user_id', None)
                        logger.info(f"[Login] Not an admin or is_admin flag is not True. User: {user_details_for_session.get('id')}. is_admin value: '{is_admin_flag}'. Session data: {dict(session)}")
                else:
                    logger.warning(f"[Login] Could not fetch full user details for user ID {user_id} from _get_user_details_with_admin_status. Session not fully set.")
                    resp_data['user'] = supabase_user_info
            else:
                logger.warning("[Login] Supabase user info or token missing in successful auth response.")
            
            return jsonify(resp_data), 200
        else:
            error_data = response.json()
            error_msg = error_data.get('error_description', 'Login failed')
            logger.error(f"[Login] Supabase auth failed: {error_msg}. Response: {error_data}")
            return jsonify({'message': error_msg}), response.status_code
    
    except Exception as e:
        logger.error(f"[Login] Exception during login: {str(e)}", exc_info=True)
        return jsonify({'message': 'An error occurred during login'}), 500

@app.route('/api/auth/signup', methods=['POST'])
def signup():
    data = request.json
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Missing email or password'}), 400
    
    email = data.get('email')
    password = data.get('password')
    
    # Extract additional user metadata
    user_metadata = {
        'first_name': data.get('firstName', ''),
        'last_name': data.get('lastName', ''),
        'username': data.get('username', ''),
        'phone': data.get('phone', ''),
        'country_code': data.get('countryCode', '+971'),
        'city': data.get('city', ''),
        'emirate': data.get('emirate', ''),
        'is_dealer': data.get('isDealer', False),
        'company_name': data.get('companyName', ''),
        'company_registration_number': data.get('companyRegistrationNumber', ''),
        'display_name': data.get('displayName', ''),
        'email_notifications': data.get('emailNotifications', True),
        'sms_notifications': data.get('smsNotifications', True),
        'marketing_emails': data.get('marketingEmails', False)
    }

    # Remove empty strings so unique constraints (e.g., username) are not violated by blank values
    cleaned_metadata = {}
    for key, value in user_metadata.items():
        if isinstance(value, str) and value.strip() == '':
            continue
        cleaned_metadata[key] = value
    
    # Sign up with Supabase
    url = f"{SUPABASE_URL}/auth/v1/signup"
    headers = {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
    }
    payload = {
        'email': email,
        'password': password,
        'data': cleaned_metadata  # This will be stored in raw_user_meta_data
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)

        if response.status_code == 200:
            return jsonify(response.json()), 200

        # Try to parse error details; fall back to raw text
        try:
            error_data = response.json()
        except Exception:
            logger.error(f"Signup failed with non-JSON response: {response.text}")
            return jsonify({'message': 'Signup failed', 'details': response.text}), response.status_code

        logger.error(f"Signup failed: {error_data}")
        return jsonify({'message': error_data.get('error_description', 'Signup failed'), 'details': error_data}), response.status_code

    except Exception as e:
        logger.error(f"Signup error: {str(e)}")
        return jsonify({'message': 'An error occurred during signup'}), 500

@app.route('/api/auth/logout', methods=['POST'])
@token_required
def logout(current_user):
    # The actual logout happens on the client, but this endpoint can be used to track logouts or invalidate sessions
    return jsonify({'message': 'Successfully logged out'}), 200

def get_user_admin_status(user_id):
    try:
        # Get user data from Supabase
        user_data, status_code = supabase_request(
            'get',
            f'/rest/v1/users?id=eq.{user_id}',
            user_id=user_id
        )
        
        if status_code >= 400 or not user_data:
            return False
            
        return user_data[0].get('is_admin', False)
    except Exception as e:
        logger.error(f"Error getting user admin status: {str(e)}")
        return False

def _get_user_details_with_admin_status(user_id_from_token):
    logger.info(f"[_get_user_details_with_admin_status] Called for user_id: {user_id_from_token}")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
    headers = {
        'apikey': service_key,
        'Authorization': f'Bearer {service_key}',
        'Content-Type': 'application/json',
        'X-Postgres-Role': 'service_role'
    }
    logger.debug(f"[_get_user_details_with_admin_status] Using headers for Supabase requests: {_redact_headers(headers)}")

    auth_email = None
    auth_user_data = None
    try:
        auth_response = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id_from_token}",
            headers=headers, timeout=10 # Increased timeout slightly
        )
        logger.info(f"[_get_user_details_with_admin_status] Auth system response status: {auth_response.status_code}") # New Log
        if auth_response.status_code == 200:
            auth_user_data = auth_response.json()
            auth_email = auth_user_data.get('email')
            logger.info(f"[_get_user_details_with_admin_status] Found user in auth system. Email: {auth_email}, Data: {auth_user_data}")
        else:
            logger.warning(f"[_get_user_details_with_admin_status] Could not get user from auth system: {auth_response.status_code} - {auth_response.text}")
    except requests.exceptions.RequestException as e_auth:
        logger.error(f"[_get_user_details_with_admin_status] Error checking auth system: {e_auth}")

    db_user_data = None
    is_admin_in_db = False
    try:
        rest_url_users = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id_from_token}"
        logger.info(f"[_get_user_details_with_admin_status] Querying public.users table with URL: {rest_url_users}") # New Log
        users_response = requests.get(
            rest_url_users,
            headers=headers, timeout=10 # Increased timeout slightly
        )
        logger.info(f"[_get_user_details_with_admin_status] public.users response status: {users_response.status_code}") # New Log
        logger.info(f"[_get_user_details_with_admin_status] public.users response text: {users_response.text}") # New Log
        
        parsed_json = None
        if users_response.status_code == 200:
            try:
                parsed_json = users_response.json()
                logger.info(f"[_get_user_details_with_admin_status] public.users parsed_json: {parsed_json}") # New Log
            except requests.exceptions.JSONDecodeError as json_err:
                logger.error(f"[_get_user_details_with_admin_status] Failed to parse JSON from public.users response: {json_err}")

        if users_response.status_code == 200 and parsed_json: # Check parsed_json directly
            db_user_data = parsed_json[0] # Assumes non-empty list
            is_admin_in_db = db_user_data.get('is_admin', False)
            # Prefer email from users table if exists and auth_email was not retrieved
            if not auth_email and db_user_data.get('email'): 
                auth_email = db_user_data.get('email')
            logger.info(f"[_get_user_details_with_admin_status] Found user in public.users table. Email: {db_user_data.get('email')}, Admin: {is_admin_in_db}, DB Data: {db_user_data}")
        elif not auth_email: # Only enter if auth_email is still None (i.e. auth lookup failed AND public.users lookup failed or was empty)
             logger.warning(f"[_get_user_details_with_admin_status] User {user_id_from_token} not found or empty in public.users (parsed_json: {parsed_json}) AND no email from auth system (auth_email: {auth_email}).")
             return None 
        else: # User not in public.users or parsed_json was empty, but we have auth_email from the auth system lookup
            logger.info(f"[_get_user_details_with_admin_status] User {user_id_from_token} not found or empty in public.users (parsed_json: {parsed_json}), but auth_email ({auth_email}) exists from auth system. Will attempt to create entry in public.users.")
            
    except requests.exceptions.RequestException as e_db:
        logger.error(f"[_get_user_details_with_admin_status] Error checking public.users table: {e_db}")

    # ... (rest of the function for creating user if not db_user_data and auth_email, and for returning final details)
    # Ensure is_admin_in_db is correctly used for the final result if db_user_data was populated.
    # This part of the logic might need adjustment based on the above changes.

    if not db_user_data and auth_email: 
        logger.info(f"[_get_user_details_with_admin_status] User {user_id_from_token} (Email: {auth_email}) was not in public.users. Creating entry.")
        try:
            create_payload = {
                'id': user_id_from_token,
                'email': auth_email,
                'is_admin': False 
            }
            logger.info(f"[_get_user_details_with_admin_status] Create payload for public.users: {create_payload}")
            create_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/users",
                json=create_payload, headers=headers, timeout=5
            )
            if create_response.status_code == 201 or create_response.status_code == 200: 
                db_user_data_created = create_response.json()[0] if create_response.json() else create_payload
                is_admin_in_db = db_user_data_created.get('is_admin', False) # This will be False as per payload
                logger.info(f"[_get_user_details_with_admin_status] Created user {user_id_from_token} in public.users table. Admin: {is_admin_in_db}, DB Data: {db_user_data_created}")
                # Update db_user_data to use the newly created data for the final return object
                db_user_data = db_user_data_created
            else:
                logger.warning(f"[_get_user_details_with_admin_status] Failed to create user {user_id_from_token} in public.users table: {create_response.status_code} - {create_response.text}")
        except requests.exceptions.RequestException as e_create:
            logger.error(f"[_get_user_details_with_admin_status] Error creating user in public.users table: {e_create}")

    final_email_to_use = None
    if db_user_data and db_user_data.get('email'):
        final_email_to_use = db_user_data.get('email')
    elif auth_email: # Fallback to email from auth.users if not in db_user_data or db_user_data has no email
        final_email_to_use = auth_email
    
    if not final_email_to_use:
        logger.error(f"[_get_user_details_with_admin_status] Could not determine final email for user {user_id_from_token}. auth_email: {auth_email}, db_user_data: {db_user_data}")
        return None

    # Determine final is_admin status primarily from db_user_data if it exists
    final_is_admin = False
    if db_user_data:
        final_is_admin = db_user_data.get('is_admin', False)
    # No else needed, defaults to False if db_user_data is None

    final_created_at = None
    if db_user_data and db_user_data.get('created_at'):
        final_created_at = db_user_data.get('created_at')
    elif auth_user_data and auth_user_data.get('created_at'):
        final_created_at = auth_user_data.get('created_at')

    final_user_details = {
        'id': user_id_from_token,
        'email': final_email_to_use,
        'is_admin': final_is_admin, # Use the derived is_admin_in_db from potentially populated db_user_data
        'created_at': final_created_at
    }
    logger.info(f"[_get_user_details_with_admin_status] Returning final details: {final_user_details}")
    return final_user_details

@app.route('/api/auth/me', methods=['GET'])
@token_required
def get_user_info(current_user): # current_user is user_id from @token_required
    user_details = _get_user_details_with_admin_status(current_user)
    if user_details:
        return jsonify(user_details), 200
    else:
        return jsonify({'error': 'Failed to retrieve user details or user not found'}), 404

@app.route('/api/auth/refresh', methods=['POST'])
def refresh_token():
    # Extract refresh token from request
    data = request.json
    if not data or not data.get('refresh_token'):
        return jsonify({'message': 'Missing refresh token'}), 400
    
    refresh_token = data.get('refresh_token')
    
    # Call Supabase refresh token endpoint
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
    headers = {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
    }
    payload = {
        'refresh_token': refresh_token
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            error_data = response.json()
            return jsonify({'message': error_data.get('error_description', 'Token refresh failed')}), response.status_code
    
    except Exception as e:
        logger.error(f"Token refresh error: {str(e)}")
        return jsonify({'message': 'An error occurred during token refresh'}), 500

@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.json
    if not data or not data.get('email'):
        return jsonify({'message': 'Missing email'}), 400
    
    email = data.get('email')
    
    # Request password reset from Supabase
    url = f"{SUPABASE_URL}/auth/v1/recover"
    headers = {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
    }
    redirect_origin = _get_safe_frontend_origin(request.headers.get('Origin'))
    payload = {
        'email': email,
        'redirect_to': f"{redirect_origin}/reset-password"
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            return jsonify({'message': 'Password reset email sent successfully'}), 200
        else:
            error_data = response.json()
            return jsonify({'message': error_data.get('error_description', 'Failed to send password reset email')}), response.status_code
    
    except Exception as e:
        logger.error(f"Password reset error: {str(e)}")
        return jsonify({'message': 'An error occurred during password reset'}), 500

@app.route('/api/auth/update-password', methods=['POST'])
def update_password():
    data = request.json
    if not data or not data.get('password') or not data.get('hash'):
        return jsonify({'message': 'Missing password or reset token'}), 400
    
    password = data.get('password')
    hash_token = data.get('hash')
    
    # Parse the hash to extract parameters
    # Note: This depends on how your Supabase instance formats the reset token
    # The implementation might need to be adjusted
    
    # Update password with Supabase
    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {hash_token}'  # This might not work directly - adjust as needed
    }
    payload = {
        'password': password
    }
    
    try:
        response = requests.put(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            return jsonify({'message': 'Password updated successfully'}), 200
        else:
            error_data = response.json()
            return jsonify({'message': error_data.get('error_description', 'Failed to update password')}), response.status_code
    
    except Exception as e:
        logger.error(f"Password update error: {str(e)}")
        return jsonify({'message': 'An error occurred during password update'}), 500

# Bike Endpoints (Similar to Car Endpoints)
@app.route('/api/bikes', methods=['GET'])
def get_bikes():
    try:
        # Get query parameters
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        order = request.args.get('order', 'created_at')
        
        # Construct parameters for Supabase query
        params = {
            'limit': limit,
            'offset': offset,
            'order': order,
            'status': 'eq.approved',  # Only show approved bikes
            'is_approved': 'eq.true'  # Ensure consistency
        }
        
        # Filter out any underscore parameters
        params = {k: v for k, v in params.items() if not k.startswith('_')}
        
        logger.info(f"Fetching bikes with params: {params}")
        
        try:
            # Use direct request with service role key for admin operations
            service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
            headers = {
                'apikey': service_role_key,
                'Authorization': f'Bearer {service_role_key}',
                'Content-Type': 'application/json'
            }
            
            # Construct query string
            query_params = []
            for key, value in params.items():
                if key == 'order':
                    query_params.append(f"order={value}")
                else:
                    query_params.append(f"{key}={value}")
            
            query_string = '&'.join(query_params)
            url = f"{app.config['SUPABASE_URL']}/rest/v1/bikes?{query_string}"
            
            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                bikes = response.json()
                
                # Fetch images for each bike
                for bike in bikes:
                    bike_id = bike['id']
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/bike_images?bike_id=eq.{bike_id}"
                    image_response = requests.get(image_url, headers=headers)
                    
                    if image_response.status_code == 200:
                        images = image_response.json()
                        bike['images'] = [img['image_url'] for img in images]
                    else:
                        bike['images'] = []
                
                return jsonify(bikes)
            else:
                logger.error(f"Direct request failed: {response.status_code} - {response.text}")
                # Fallback to regular method
                raise Exception("Direct request failed")
                
        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request('get', '/rest/v1/bikes', params=params)
            if status_code < 400 and response:
                # Fetch images for each bike in fallback
                for bike in response:
                    bike_id = bike['id']
                    images_response, images_status = supabase_request(
                        'get',
                        '/rest/v1/bike_images',
                        params={'select': '*', 'bike_id': f'eq.{bike_id}'}
                    )
                    if images_status < 400 and images_response:
                        bike['images'] = images_response
                    else:
                        bike['images'] = []
                return jsonify(response)
            else:
                return jsonify([])
    
    except Exception as e:
        logger.error(f"Error fetching bikes: {str(e)}")
        return jsonify([]), 500

@app.route('/api/bikes/<string:bike_id>', methods=['GET'])
def get_bike_by_id(bike_id):
    try:
        logger.info(f"Fetching bike details for ID: {bike_id}")
        
        # Get bike details
        query = f"/rest/v1/bikes?id=eq.{bike_id}&select=*"
        bike_response, bike_status = supabase_request('get', query)
        
        if not bike_response or len(bike_response) == 0:
            logger.warning(f"Bike not found with ID: {bike_id}")
            return jsonify({"error": "Bike not found"}), 404
            
        bike = bike_response[0]
        logger.info(f"Found bike: {bike['make']} {bike['model']} (ID: {bike['id']})")
        
        # Get bike images
        images_query = f"/rest/v1/bike_images?bike_id=eq.{bike_id}&select=*"
        logger.info(f"Fetching images with query: {images_query}")
        images_response, images_status = supabase_request('get', images_query)
        
        if images_status < 400:
            logger.info(f"Found {len(images_response)} images for bike {bike_id}")
            # Transform images for frontend compatibility
            for image in images_response:
                logger.info(f"Processing image: {image}")
                # Ensure both url and image_url fields are present
                if 'url' in image and not image.get('image_url'):
                    image['image_url'] = image['url']
                    logger.info(f"Added image_url from url: {image['url']}")
                elif 'image_url' in image and not image.get('url'):
                    image['url'] = image['image_url']
                    logger.info(f"Added url from image_url: {image['image_url']}")
                # If neither field exists, create a placeholder
                elif not image.get('url') and not image.get('image_url'):
                    logger.warning(f"Image {image.get('id', 'unknown')} has no URL fields")
            
            bike["images"] = images_response
            logger.info(f"Processed images: {bike['images']}")
        else:
            logger.warning(f"Failed to fetch images for bike {bike_id}: status {images_status}")
            bike["images"] = []
        
        logger.info(f"Returning bike with {len(bike['images'])} images")
        return jsonify(bike), 200
    except Exception as e:
        logger.error(f"Error fetching bike details: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/user/bikes', methods=['GET'])
@token_required
def get_user_bikes(current_user):
    data, status_code = supabase_request(
        'get', 
        '/rest/v1/bikes', 
        params={'select': '*', 'user_id': f'eq.{current_user}', 'order': 'created_at.desc'},
        user_id=current_user
    )
    
    if status_code >= 400:
        return jsonify(data), status_code
    
    # Get the bike images for each bike
    for bike in data:
        bike_id = bike.get('id')
        images_data, images_status = supabase_request(
            'get', 
            '/rest/v1/bike_images', 
            params={'select': '*', 'bike_id': f'eq.{bike_id}'},
            user_id=current_user
        )
        
        if images_status < 400:
            bike['images'] = images_data
        else:
            bike['images'] = []
    
    return jsonify(data), 200

@app.route('/api/bikes', methods=['POST'])
@token_required
def create_bike(current_user):
    try:
        # Validate input
        if not request.json:
            return jsonify({'error': 'Invalid request data'}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response
        
        bike_data = request.json
        bike_data['user_id'] = current_user
        bike_data['status'] = 'pending'  # Set status as pending for admin approval
        
        # Extract images from the request
        images = bike_data.pop('images', [])
        
        # Create the bike
        data, status_code = supabase_request(
            'post', 
            '/rest/v1/bikes', 
            data=bike_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            return jsonify(data), status_code
        
        bike_id = data[0]['id']
        
        # Add images if any
        if images:
            image_inserts = []
            for image_url in images:
                image_inserts.append({
                    'bike_id': bike_id,
                    'url': image_url,
                    'image_url': image_url  # Add image_url field for frontend compatibility
                })
            
            images_data, images_status = supabase_request(
                'post', 
                '/rest/v1/bike_images', 
                data=image_inserts,
                user_id=current_user
            )
            
            if images_status < 400:
                data[0]['images'] = images_data
            else:
                data[0]['images'] = []
        
        return jsonify(data[0]), 201
    except Exception as e:
        logger.error(f"Error creating bike listing: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/bikes/<string:bike_id>', methods=['PUT'])
@token_required
def update_bike(current_user, bike_id):
    try:
        # Validate input
        if not request.json:
            return jsonify({'error': 'Invalid request data'}), 400
        
        # Verify bike ownership
        bike_data, bike_status = supabase_request(
            'get', 
            f'/rest/v1/bikes', 
            params={'select': 'user_id', 'id': f'eq.{bike_id}', 'limit': 1},
            user_id=current_user
        )
        
        if bike_status >= 400:
            return jsonify(bike_data), bike_status
        
        if not bike_data:
            return jsonify({'error': 'Bike not found'}), 404
        
        if bike_data[0]['user_id'] != current_user:
            return jsonify({'error': 'You do not have permission to update this bike'}), 403
        
        update_data = request.json
        images = update_data.pop('images', None)
        
        # Update the bike
        data, status_code = supabase_request(
            'put', 
            f'/rest/v1/bikes', 
            params={'id': f'eq.{bike_id}'},
            data=update_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            return jsonify(data), status_code
        
        # Update images if provided
        if images is not None:
            # First, delete all existing images
            delete_resp, delete_status = supabase_request(
                'delete', 
                '/rest/v1/bike_images', 
                params={'bike_id': f'eq.{bike_id}'},
                user_id=current_user
            )
            
            # Add new images
            if images:
                image_inserts = []
                for image_url in images:
                    image_inserts.append({
                        'bike_id': bike_id,
                        'url': image_url,
                        'image_url': image_url  # Add image_url field for frontend compatibility
                    })
                
                images_data, images_status = supabase_request(
                    'post', 
                    '/rest/v1/bike_images', 
                    data=image_inserts,
                    user_id=current_user
                )
        
        # Get updated bike with images
        updated_bike, updated_status = supabase_request(
            'get', 
            f'/rest/v1/bikes', 
            params={'select': '*', 'id': f'eq.{bike_id}', 'limit': 1},
            user_id=current_user
        )
        
        if updated_status >= 400 or not updated_bike:
            return jsonify({'message': 'Bike updated successfully'}), 200
        
        bike = updated_bike[0]
        
        # Get bike images
        images_data, images_status = supabase_request(
            'get', 
            '/rest/v1/bike_images', 
            params={'select': '*', 'bike_id': f'eq.{bike_id}'},
            user_id=current_user
        )
        
        if images_status < 400:
            bike['images'] = images_data
        else:
            bike['images'] = []
        
        return jsonify(bike), 200
    except Exception as e:
        logger.error(f"Error updating bike: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/bikes/<string:bike_id>', methods=['DELETE'])
@token_required
def delete_bike(current_user, bike_id):
    try:
        # Verify bike ownership
        bike_data, bike_status = supabase_request(
            'get', 
            f'/rest/v1/bikes', 
            params={'select': 'user_id', 'id': f'eq.{bike_id}', 'limit': 1},
            user_id=current_user
        )
        
        if bike_status >= 400:
            return jsonify(bike_data), bike_status
        
        if not bike_data:
            return jsonify({'error': 'Bike not found'}), 404
        
        if bike_data[0]['user_id'] != current_user:
            return jsonify({'error': 'You do not have permission to delete this bike'}), 403
        
        # Delete bike images first
        delete_images, delete_images_status = supabase_request(
            'delete', 
            '/rest/v1/bike_images', 
            params={'bike_id': f'eq.{bike_id}'},
            user_id=current_user
        )
        
        # Delete the bike
        delete_resp, delete_status = supabase_request(
            'delete', 
            '/rest/v1/bikes', 
            params={'id': f'eq.{bike_id}'},
            user_id=current_user
        )
        
        if delete_status >= 400:
            return jsonify(delete_resp), delete_status
        
        return jsonify({'message': 'Bike listing deleted successfully'}), 200
    except Exception as e:
        logger.error(f"Error deleting bike: {e}")
        return jsonify({"error": str(e)}), 500

# License Plate Endpoints
@app.route('/api/plates', methods=['GET'])
def get_plates():
    try:
        # Get query parameters
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        logger.info(f"Fetching plates with limit: {limit}, offset: {offset}")
        
        # Use direct request with service role key
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Build query - only get approved plates
        url = f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?status=eq.approved&order=created_at.desc&limit={limit}&offset={offset}&select=*"
        
        logger.info(f"Fetching plates from: {url}")
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            plates = response.json()
            logger.info(f"Found {len(plates)} plates")
            
            # Fetch images for each plate
            for plate in plates:
                plate_id = plate.get('id')
                if plate_id:
                    try:
                        image_url = f"{app.config['SUPABASE_URL']}/rest/v1/plate_images?plate_id=eq.{plate_id}&select=*"
                        image_response = requests.get(image_url, headers=headers, timeout=5)
                        
                        if image_response.status_code == 200:
                            images = image_response.json()
                            plate['images'] = [img.get('image_url') for img in images if img.get('image_url')]
                        else:
                            plate['images'] = []
                    except Exception as img_error:
                        logger.error(f"Error fetching images for plate {plate_id}: {str(img_error)}")
                        plate['images'] = []
                else:
                    plate['images'] = []
            
            return jsonify(plates), 200
        else:
            logger.error(f"Failed to fetch plates: {response.status_code} - {response.text}")
            return jsonify([]), 200  # Return empty array instead of error
    
    except Exception as e:
        logger.error(f"Error fetching plates: {str(e)}", exc_info=True)
        return jsonify([]), 200  # Return empty array instead of error to prevent frontend crash

@app.route('/api/plates/<plate_id>', methods=['GET'])
def get_plate_details(plate_id):
    """Get details for a specific plate by ID"""
    try:
        logger.info(f"Fetching plate details for ID: {plate_id}")
        
        try:
            # Use direct request with service role key
            service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
            headers = {
                'apikey': service_role_key,
                'Authorization': f'Bearer {service_role_key}',
                'Content-Type': 'application/json'
            }
            
            # Get the specific plate
            url = f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?id=eq.{plate_id}&select=*"
            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                plates = response.json()
                if not plates:
                    logger.warning(f"No plate found with ID: {plate_id}")
                    return jsonify({"error": "Plate not found"}), 404
                    
                plate = plates[0]
                logger.info(f"Found plate: {plate.get('city')} {plate.get('code')} {plate.get('number')}")
                
                # Fetch images for this plate
                try:
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/plate_images?plate_id=eq.{plate['id']}&select=*"
                    image_response = requests.get(image_url, headers=headers)
                    
                    if image_response.status_code == 200:
                        images = image_response.json()
                        plate['images'] = images
                        logger.info(f"Found {len(images)} images for plate")
                    else:
                        plate['images'] = []
                        logger.warning(f"No images found for plate {plate_id}")
                except Exception as img_err:
                    logger.error(f"Error fetching images for plate {plate['id']}: {img_err}")
                    plate['images'] = []
                
                return jsonify(plate), 200
            else:
                logger.error(f"Error fetching plate details: {response.status_code} - {response.text}")
                return jsonify({"error": "Failed to fetch plate details"}), 500
                
        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request(
                'get', 
                '/rest/v1/license_plates', 
                params={'id': f'eq.{plate_id}', 'select': '*'}
            )
            if status_code < 400 and response and len(response) > 0:
                plate = response[0]
                
                # Fetch images for this plate in fallback
                images_response, images_status = supabase_request(
                    'get',
                    '/rest/v1/plate_images',
                    params={'select': '*', 'plate_id': f'eq.{plate_id}'}
                )
                if images_status < 400 and images_response:
                    plate['images'] = images_response
                else:
                    plate['images'] = []
                    
                return jsonify(plate), 200
            else:
                return jsonify({"error": "Plate not found"}), 404
            
    except Exception as e:
        logger.error(f"Error in get_plate_details: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Car Parts Endpoints
@app.route('/api/parts', methods=['GET'])
def get_parts():
    try:
        # Get query parameters
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        order = request.args.get('order', 'created_at')
        
        # Construct parameters for Supabase query
        params = {
            'limit': limit,
            'offset': offset,
            'order': order,
            'status': 'eq.approved',  # Only show approved parts
            'is_approved': 'eq.true'  # Ensure consistency
        }
        
        # Filter out any underscore parameters
        params = {k: v for k, v in params.items() if not k.startswith('_')}
        
        logger.info(f"Fetching parts with params: {params}")
        
        try:
            # Use direct request with service role key for admin operations
            service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
            headers = {
                'apikey': service_role_key,
                'Authorization': f'Bearer {service_role_key}',
                'Content-Type': 'application/json'
            }
            
            # Construct query string
            query_params = []
            for key, value in params.items():
                if key == 'order':
                    query_params.append(f"order={value}")
                else:
                    query_params.append(f"{key}={value}")
            
            query_string = '&'.join(query_params)
            url = f"{app.config['SUPABASE_URL']}/rest/v1/car_parts?{query_string}"
            
            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                parts = response.json()
                
                # Fetch images for each part
                for part in parts:
                    part_id = part['id']
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/part_images?part_id=eq.{part_id}"
                    image_response = requests.get(image_url, headers=headers)
                    
                    if image_response.status_code == 200:
                        images = image_response.json()
                        part['images'] = [img['image_url'] for img in images]
                    else:
                        part['images'] = []
                
                return jsonify(parts)
            else:
                logger.error(f"Direct request failed: {response.status_code} - {response.text}")
                # Fallback to regular method
                raise Exception("Direct request failed")
                
        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request('get', '/rest/v1/car_parts', params=params)
            if status_code < 400 and response:
                # Fetch images for each part in fallback
                for part in response:
                    part_id = part['id']
                    images_response, images_status = supabase_request(
                        'get',
                        '/rest/v1/part_images',
                        params={'select': '*', 'part_id': f'eq.{part_id}'}
                    )
                    if images_status < 400 and images_response:
                        part['images'] = images_response
                    else:
                        part['images'] = []
                return jsonify(response)
            else:
                return jsonify([])
    
    except Exception as e:
        logger.error(f"Error fetching parts: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Create a new car parts listing (authenticated)
@app.route('/api/parts', methods=['POST'])
@token_required
def create_part(current_user):
    try:
        logger.info("Creating new car part listing")

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response
        
        # Check if this is FormData or JSON
        is_form_data = request.content_type and 'multipart/form-data' in request.content_type
        
        if is_form_data:
            # Handle FormData (with file uploads)
            part_data = {}
            
            # Get form fields
            for key, value in request.form.items():
                if key.startswith('image_'):
                    continue  # Skip image fields, handle separately
                elif key == 'compatible_makes' or key == 'compatible_models':
                    # Parse JSON strings back to arrays
                    try:
                        part_data[key] = json.loads(value) if value else []
                    except:
                        part_data[key] = []
                else:
                    part_data[key] = value
            
            # Handle file uploads
            uploaded_files = []
            for key, file in request.files.items():
                if key.startswith('image_') and file and file.filename:
                    # Save the uploaded file
                    filename = secure_filename(file.filename)
                    timestamp = int(time.time())
                    random_suffix = secrets.token_hex(4)
                    file_extension = filename.rsplit('.', 1)[1].lower() if '.' in filename else 'jpg'
                    unique_filename = f"{timestamp}_{random_suffix}.{file_extension}"
                    file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
                    
                    file.save(file_path)
                    
                    # Store the URL for the database
                    file_url = f"/static/uploads/{unique_filename}"
                    uploaded_files.append(file_url)
                    logger.info(f"Saved part image: {unique_filename}")
            
        else:
            # Handle JSON data
            if not request.json:
                return jsonify({'error': 'Invalid request data'}), 400
            part_data = request.json.copy()
            uploaded_files = part_data.pop('images', [])
        
        # Set required fields
        part_data['user_id'] = current_user
        part_data['status'] = 'pending'  # Set status as pending for admin approval
        
        # Validate required fields
        required_fields = ['name', 'part_type', 'price']
        for field in required_fields:
            if not part_data.get(field):
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Create the part entry
        logger.info(f"Creating part with data: {part_data}")
        data, status_code = supabase_request(
            'post', 
            '/rest/v1/car_parts', 
            data=part_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            logger.error(f"Error creating part: {data}")
            return jsonify(data), status_code
        
        part_id = data[0]['id']
        logger.info(f"Created part with ID: {part_id}")
        
        # Add images if any
        if uploaded_files:
            image_inserts = []
            for image_url in uploaded_files:
                image_inserts.append({
                    'part_id': part_id,
                    'url': image_url,
                    'image_url': image_url  # Add image_url field for frontend compatibility
                })
            
            images_data, images_status = supabase_request(
                'post', 
                '/rest/v1/part_images', 
                data=image_inserts,
                user_id=current_user
            )
            
            if images_status < 400:
                data[0]['images'] = images_data
                logger.info(f"Added {len(images_data)} images to part")
            else:
                data[0]['images'] = []
                logger.warning(f"Failed to add images: {images_data}")
        else:
            data[0]['images'] = []
        
        return jsonify(data[0]), 201
        
    except Exception as e:
        logger.error(f"Error creating car part listing: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/parts/<part_id>', methods=['GET'])
def get_part_details(part_id):
    """Get details for a specific car part by ID"""
    try:
        logger.info(f"Fetching part details for ID: {part_id}")
        
        try:
            # Use direct request with service role key
            service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
            headers = {
                'apikey': service_role_key,
                'Authorization': f'Bearer {service_role_key}',
                'Content-Type': 'application/json'
            }
            
            # Get the specific part
            url = f"{app.config['SUPABASE_URL']}/rest/v1/car_parts?id=eq.{part_id}&select=*"
            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                parts = response.json()
                if not parts:
                    logger.warning(f"No part found with ID: {part_id}")
                    return jsonify({"error": "Part not found"}), 404
                    
                part = parts[0]
                logger.info(f"Found part: {part.get('name', 'Unknown part')}")
                
                # Fetch images for this part
                try:
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/part_images?part_id=eq.{part['id']}&select=*"
                    image_response = requests.get(image_url, headers=headers)
                    
                    if image_response.status_code == 200:
                        images = image_response.json()
                        part['images'] = images
                        logger.info(f"Found {len(images)} images for part")
                    else:
                        part['images'] = []
                        logger.warning(f"No images found for part {part_id}")
                except Exception as img_err:
                    logger.error(f"Error fetching images for part {part['id']}: {img_err}")
                    part['images'] = []
                
                return jsonify(part), 200
            else:
                logger.error(f"Error fetching part details: {response.status_code} - {response.text}")
                return jsonify({"error": "Failed to fetch part details"}), 500
                
        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request(
                'get', 
                '/rest/v1/car_parts', 
                params={'id': f'eq.{part_id}', 'select': '*'}
            )
            if status_code < 400 and response and len(response) > 0:
                part = response[0]
                
                # Fetch images for this part in fallback
                images_response, images_status = supabase_request(
                    'get',
                    '/rest/v1/part_images',
                    params={'select': '*', 'part_id': f'eq.{part_id}'}
                )
                if images_status < 400 and images_response:
                    part['images'] = images_response
                else:
                    part['images'] = []
                    
                return jsonify(part), 200
            else:
                return jsonify({"error": "Part not found"}), 404
            
    except Exception as e:
        logger.error(f"Error in get_part_details: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Diagnostic endpoint to check if service role key is available
@app.route('/api/diagnostics/config', methods=['GET'])
@token_required
def check_config(current_user):
    try:
        if os.getenv("ENABLE_DIAGNOSTICS", "false").lower() != "true":
            return jsonify({'error': 'Not found'}), 404

        if not get_user_admin_status(current_user):
            return jsonify({'error': 'Unauthorized'}), 403

        # Get the keys for diagnostic purposes
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "not-set")
        regular_key = SUPABASE_KEY
        
        # Only show partial keys for security
        def mask_key(key):
            if not key or len(key) < 20:
                return "invalid-key-format"
            return key[:5] + "..." + key[-5:]
        
        service_key_masked = mask_key(service_key)
        regular_key_masked = mask_key(regular_key)
        
        # Check if they're the same key
        keys_are_same = service_key == regular_key
        
        return jsonify({
            "service_key_available": service_key != "not-set",
            "service_key_preview": service_key_masked,
            "regular_key_preview": regular_key_masked,
            "using_same_key": keys_are_same,
            "postgres_role_header_present": True
        }), 200
    except Exception as e:
        logger.error(f"Error in diagnostics endpoint: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Endpoint to make yourself an admin (for development)
@app.route('/api/auth/make-admin', methods=['POST'])
@token_required
def make_self_admin(current_user):
    try:
        if os.getenv("ENABLE_ADMIN_BOOTSTRAP", "false").lower() != "true":
            return jsonify({'error': 'Admin bootstrap is disabled'}), 403

        bootstrap_token = os.getenv("ADMIN_BOOTSTRAP_TOKEN")
        request_token = request.headers.get("X-Admin-Bootstrap-Token")
        if not bootstrap_token or request_token != bootstrap_token:
            return jsonify({'error': 'Invalid admin bootstrap token'}), 403

        logger.info(f"Attempting to make user {current_user} an admin")
        
        # Get the service role key for admin operations
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not service_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY not set, falling back to SUPABASE_KEY")
            service_key = SUPABASE_KEY
            
        if not service_key:
            logger.error("No Supabase API key available")
            return jsonify({'error': 'Server configuration error - no API key available'}), 500
            
        logger.info("Using service key for admin bootstrap")
        
        # Create a simple users table if it doesn't exist
        try:
            # First, just try to directly set the user as admin by inserting/updating in the users table
            logger.info(f"Creating/updating admin record for user: {current_user}")
            
            # Create headers with service role
            headers = {
                'apikey': service_key,
                'Authorization': f'Bearer {service_key}',
                'Content-Type': 'application/json',
                'Prefer': 'return=representation',
                'X-Postgres-Role': 'service_role'  # This bypasses RLS
            }
            
            # Get user email from token information (already validated in @token_required)
            user_email = request.user_data.get('email', 'unknown@example.com') if hasattr(request, 'user_data') else 'unknown@example.com'
            logger.info(f"Using email from token: {user_email}")
            
            # Try to upsert the user record with PATCH
            update_response = requests.patch(
                f"{SUPABASE_URL}/rest/v1/users?id=eq.{current_user}",
                json={'id': current_user, 'email': user_email, 'is_admin': True},
                headers=headers,
                timeout=10
            )
            
            # If PATCH fails with 404 (not found), try to create with POST
            if update_response.status_code == 404 or len(update_response.text.strip()) == 0:
                logger.info("User not found in users table, creating new record")
                create_response = requests.post(
                    f"{SUPABASE_URL}/rest/v1/users",
                    json={'id': current_user, 'email': user_email, 'is_admin': True},
                    headers=headers,
                    timeout=10
                )
                
                if create_response.status_code >= 400:
                    error_text = create_response.text or f"Status code: {create_response.status_code}"
                    logger.error(f"Failed to create user record: {error_text}")
                    return jsonify({'error': 'Failed to create user record', 'details': error_text}), 500
                    
                logger.info(f"Created new admin user record")
                return jsonify({'message': 'You are now an admin', 'success': True}), 201
            elif update_response.status_code >= 400:
                error_text = update_response.text or f"Status code: {update_response.status_code}"
                logger.error(f"Failed to update user record: {error_text}")
                return jsonify({'error': 'Failed to update user record', 'details': error_text}), 500
                
            logger.info(f"Updated user {current_user} to admin status")
            return jsonify({'message': 'You are now an admin', 'success': True}), 200
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Network error in admin operation: {str(e)}")
            return jsonify({'error': 'Service unavailable - could not connect to database service', 'details': str(e)}), 503
            
    except Exception as e:
        logger.error(f"Unexpected error making user admin: {str(e)}")
        return jsonify({'error': f'Internal server error', 'details': str(e)}), 500

@app.route('/api/users', methods=['GET'])
@token_required
def get_users(current_user):
    try:
        # Check if the current user is an admin
        user_data, status_code = supabase_request(
            'get',
            f'/rest/v1/users?id=eq.{current_user}',
            user_id=current_user
        )
        
        if status_code >= 400 or not user_data or not user_data[0].get('is_admin'):
            return jsonify({'error': 'Unauthorized. Only admins can view users.'}), 403
        
        # Get all users with the service role key to bypass RLS
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
        
        # Create headers with service role
        headers = {
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}',
            'Content-Type': 'application/json',
            'X-Client-Info': 'backend-api',
            'X-Postgres-Role': 'service_role'  # This bypasses RLS
        }
        
        # Fetch all users
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?select=*",
            headers=headers
        )
        
        if response.status_code != 200:
            logger.error(f"Failed to get users: {response.text}")
            return jsonify({'error': 'Failed to fetch users'}), response.status_code
            
        return jsonify(response.json()), 200
        
    except Exception as e:
        logger.error(f"Error getting users: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/plates/with-image', methods=['POST'])
@token_required
def create_plate_with_image(current_user):
    try:
        logger.info("Creating plate listing with image upload")
        
        # Get form data
        city = request.form.get('city')
        code = request.form.get('code')
        digits = request.form.get('digits')
        price = request.form.get('price')
        number = request.form.get('number')
        plate_format = request.form.get('plate_format')
        contact_name = request.form.get('contact_name')
        contact_phone = request.form.get('contact_phone')
        description = request.form.get('description')
        
        # Validate required fields
        if not city or not code or not digits or not price:
            return jsonify({'error': 'Missing required fields'}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response
        
        # Create plate entry
        plate_data = {
            'city': city,
            'code': code,
            'digits': digits,
            'price': price,
            'number': number,
            'plate_format': plate_format,
            'contact_name': contact_name,
            'contact_phone': contact_phone,
            'description': description,
            'user_id': current_user,
            'user_email': get_user_email(current_user),
            'status': 'pending'  # Set status as pending for admin approval
        }
        
        logger.info(f"Creating plate entry with data: {plate_data}")
        
        # Create plate in database
        response, status_code = supabase_request(
            'post',
            '/rest/v1/license_plates',
            data=plate_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            logger.error(f"Error creating plate: {response}")
            return jsonify(response), status_code
        
        plate_id = response[0]['id']
        logger.info(f"Created plate with ID: {plate_id}")
        
        # Generate and save the plate image
        import os
        from PIL import Image, ImageDraw, ImageFont
        import uuid
        
        # Create directory for this plate if it doesn't exist
        plate_dir = os.path.join('static', 'uploads', 'plates', str(plate_id))
        os.makedirs(plate_dir, exist_ok=True)
        
        # Create a simple plate image
        plate_width, plate_height = 600, 200
        plate_img = Image.new('RGB', (plate_width, plate_height), color=(255, 255, 255))
        draw = ImageDraw.Draw(plate_img)
        
        # Add border
        draw.rectangle([(0, 0), (plate_width-1, plate_height-1)], outline=(0, 0, 0), width=5)
        
        # Try to use a font, or fall back to default
        try:
            font_path = os.path.join('static', 'fonts', 'arial.ttf')
            if not os.path.exists(font_path):
                import matplotlib.font_manager as fm
                font_path = fm.findfont(fm.FontProperties(family='Arial'))
            font = ImageFont.truetype(font_path, 50)
        except Exception as e:
            logger.error(f"Error loading font: {str(e)}")
            font = ImageFont.load_default()
        
        # Add text
        text = f"{city} {code} {number}"
        text_width = draw.textlength(text, font=font)
        draw.text(
            ((plate_width - text_width) / 2, plate_height / 3),
            text,
            fill=(0, 0, 0),
            font=font
        )
        
        # Save the image
        image_filename = f"plate_{city}_{code}_{number}.png"
        image_path = os.path.join(plate_dir, image_filename)
        plate_img.save(image_path)
        logger.info(f"Saved plate preview image to: {image_path}")
        
        # Get the URL for the saved image
        image_url = f"/static/uploads/plates/{plate_id}/{image_filename}"
        
        # Add the image to the plate_images table
        try:
            image_data = {
                'plate_id': plate_id,
                'url': image_url,
                'is_primary': True
            }
            
            image_response, image_status = supabase_request(
                'post',
                '/rest/v1/plate_images',
                data=image_data,
                user_id=current_user
            )
            
            if image_status >= 400:
                logger.error(f"Failed to add image: {image_response}")
        except Exception as img_err:
            logger.error(f"Error adding image: {str(img_err)}")
        
        # Return the created plate
        response[0]['image_url'] = image_url
        return jsonify(response[0]), 201
        
    except Exception as e:
        logger.error(f"Error creating plate with image: {str(e)}")
        return jsonify({"error": str(e)}), 500

def get_user_email(user_id):
    try:
        # Try to get user info from our database first
        user_data, status_code = supabase_request(
            'get',
            f'/rest/v1/users?id=eq.{user_id}',
            user_id=user_id
        )
        
        if status_code < 400 and user_data:
            return user_data[0].get('email', 'unknown@example.com')
            
        # If not found, fetch from auth users
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
        headers = {
            'apikey': service_key,
            'Authorization': f'Bearer {service_key}'
        }
        
        response = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers=headers
        )
        
        if response.status_code == 200:
            user_info = response.json()
            return user_info.get('email', 'unknown@example.com')
            
        return 'unknown@example.com'
    except Exception as e:
        logger.error(f"Error getting user email: {str(e)}")
        return 'unknown@example.com'

# Admin-only endpoints to fetch ALL listings (including pending) for admin dashboard
@app.route('/api/admin/cars', methods=['GET'])
@token_required
def admin_get_cars(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        
        # Get ALL cars regardless of status for admin review
        response, status_code = supabase_request(
            'get',
            '/rest/v1/cars',
            params={'select': '*', 'order': 'created_at.desc'},
            use_service_role=True
        )
        
        if status_code >= 400:
            return jsonify({'error': 'Failed to fetch cars'}), status_code
        
        if not response:
            response = []
        
        # Fetch images for each car
        for car in response:
            car_id = car.get('id')
            if car_id:
                images_response, images_status = supabase_request(
                    'get',
                    '/rest/v1/car_images',
                    params={'select': '*', 'car_id': f'eq.{car_id}'},
                    use_service_role=True
                )
                
                if images_status < 400:
                    for image in images_response:
                        if 'url' in image and 'image_url' not in image:
                            image['image_url'] = image['url']
                    car['images'] = images_response
                else:
                    car['images'] = []
            else:
                car['images'] = []
        
        logger.info(f"Admin fetched {len(response)} cars (all statuses)")
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error in admin_get_cars: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/bikes', methods=['GET'])
@token_required
def admin_get_bikes(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        
        # Get ALL bikes regardless of status for admin review
        response, status_code = supabase_request(
            'get',
            '/rest/v1/bikes',
            params={'select': '*', 'order': 'created_at.desc'},
            use_service_role=True
        )
        
        if status_code >= 400:
            return jsonify({'error': 'Failed to fetch bikes'}), status_code
        
        if not response:
            response = []
        
        # Fetch images for each bike
        for bike in response:
            bike_id = bike.get('id')
            if bike_id:
                images_response, images_status = supabase_request(
                    'get',
                    '/rest/v1/bike_images',
                    params={'select': '*', 'bike_id': f'eq.{bike_id}'},
                    use_service_role=True
                )
                
                if images_status < 400:
                    for image in images_response:
                        if 'url' in image and 'image_url' not in image:
                            image['image_url'] = image['url']
                    bike['images'] = images_response
                else:
                    bike['images'] = []
            else:
                bike['images'] = []
        
        logger.info(f"Admin fetched {len(response)} bikes (all statuses)")
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error in admin_get_bikes: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/parts', methods=['GET'])
@token_required
def admin_get_parts(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        
        # Get ALL parts regardless of status for admin review
        response, status_code = supabase_request(
            'get',
            '/rest/v1/car_parts',
            params={'select': '*', 'order': 'created_at.desc'},
            use_service_role=True
        )
        
        if status_code >= 400:
            return jsonify({'error': 'Failed to fetch parts'}), status_code
        
        if not response:
            response = []
        
        # Fetch images for each part
        for part in response:
            part_id = part.get('id')
            if part_id:
                images_response, images_status = supabase_request(
                    'get',
                    '/rest/v1/part_images',
                    params={'select': '*', 'part_id': f'eq.{part_id}'},
                    use_service_role=True
                )
                
                if images_status < 400:
                    for image in images_response:
                        if 'url' in image and 'image_url' not in image:
                            image['image_url'] = image['url']
                    part['images'] = images_response
                else:
                    part['images'] = []
            else:
                part['images'] = []
        
        logger.info(f"Admin fetched {len(response)} parts (all statuses)")
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error in admin_get_parts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/plates', methods=['GET'])
@token_required
def admin_get_plates(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        
        # Get ALL plates regardless of status for admin review
        response, status_code = supabase_request(
            'get',
            '/rest/v1/license_plates',
            params={'select': '*', 'order': 'created_at.desc'},
            use_service_role=True
        )
        
        if status_code >= 400:
            return jsonify({'error': 'Failed to fetch plates'}), status_code
        
        if not response:
            response = []
        
        # License plates may have images, but they're often generated
        for plate in response:
            if 'images' not in plate:
                plate['images'] = []
        
        logger.info(f"Admin fetched {len(response)} plates (all statuses)")
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error in admin_get_plates: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Generic API approval/rejection endpoints for admin dashboard
@app.route('/api/<item_type>/<item_id>/approve', methods=['POST'])
@token_required
def api_approve_item(current_user, item_type, item_id):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        
        # Map item types to table names
        valid_item_types = {
            'cars': 'cars',
            'bikes': 'bikes',
            'parts': 'car_parts',
            'plates': 'license_plates'
        }
        
        if item_type not in valid_item_types:
            return jsonify({'error': f'Invalid item type: {item_type}'}), 400
        
        table_name = valid_item_types[item_type]
        
        # Update the item status to approved
        patch_data = {'status': 'approved'}
        if item_type == 'cars':
            patch_data['is_approved'] = True
        
        response, status_code = supabase_request(
            'patch',
            f'/rest/v1/{table_name}?id=eq.{item_id}',
            data=patch_data,
            use_service_role=True
        )
        
        if status_code >= 200 and status_code < 300:
            logger.info(f"Admin {current_user} approved {item_type} {item_id}")
            return jsonify({'success': True, 'message': f'{item_type} approved successfully'}), 200
        else:
            logger.error(f"Error approving {item_type} {item_id}: {status_code} - {response}")
            return jsonify({'error': f'Failed to approve {item_type}'}), status_code
            
    except Exception as e:
        logger.error(f"Exception in api_approve_item: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/<item_type>/<item_id>/reject', methods=['POST'])
@token_required
def api_reject_item(current_user, item_type, item_id):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        
        # Map item types to table names
        valid_item_types = {
            'cars': 'cars',
            'bikes': 'bikes',
            'parts': 'car_parts',
            'plates': 'license_plates'
        }
        
        if item_type not in valid_item_types:
            return jsonify({'error': f'Invalid item type: {item_type}'}), 400
        
        table_name = valid_item_types[item_type]
        
        # Get rejection note from request if provided
        rejection_note = ''
        if request.is_json and request.json:
            rejection_note = request.json.get('rejection_note', '')
        
        # Update the item status to rejected and add rejection note
        patch_data = {'status': 'rejected'}
        if rejection_note:
            patch_data['rejection_note'] = rejection_note
        
        response, status_code = supabase_request(
            'patch',
            f'/rest/v1/{table_name}?id=eq.{item_id}',
            data=patch_data,
            use_service_role=True
        )
        
        if status_code >= 200 and status_code < 300:
            logger.info(f"Admin {current_user} rejected {item_type} {item_id} with note: {rejection_note}")
            return jsonify({'success': True, 'message': f'{item_type} rejected successfully'}), 200
        else:
            logger.error(f"Error rejecting {item_type} {item_id}: {status_code} - {response}")
            return jsonify({'error': f'Failed to reject {item_type}'}), status_code
            
    except Exception as e:
        logger.error(f"Exception in api_reject_item: {str(e)}")
        return jsonify({'error': str(e)}), 500

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('is_admin') or not session.get('admin_user_id'):
            flash("You must be logged in as an admin to access this page.", "danger")
            # In a real app, you might redirect to a specific admin login page
            # or the main app's login page if it handles role redirection.
            # For now, redirecting to a conceptual main page or a placeholder.
            # If your React app handles routing, direct redirect might not work as expected without frontend handling.
            # However, for server-rendered pages, direct redirect is standard.
            # Let's assume a main page or login for now.
            # If frontend login is at '/', this might be fine.
            return redirect(url_for('admin.admin_login')) # UPDATED: Redirect to admin login page
        return f(*args, **kwargs)
    return decorated_function

# Admin Blueprint Setup
admin_bp = Blueprint(
    'admin',
    __name__,
    template_folder='templates/admin', # Specifies that templates are in backend/templates/admin
    url_prefix='/admin', # All routes in this blueprint will be prefixed with /admin
    static_folder='static/admin' # Optional: if you have admin-specific static files
)

# Define a simple admin route here for now, will be expanded
@admin_bp.route('/') # This is /admin/
@admin_required
def admin_dashboard():
    pending_counts = get_pending_counts()
    
    # Get dealer statistics
    dealer_stats = get_dealer_statistics()
    
    # Get user statistics
    user_stats = get_user_statistics_admin()
    
    # The template 'dashboard.html' is implicitly looked for in 'templates/admin/'
    # because of the admin_bp.template_folder setting.
    return render_template('dashboard.html', 
                         pending_counts=pending_counts,
                         dealer_stats=dealer_stats,
                         user_stats=user_stats)

@admin_bp.route('/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        logger.info(f"[Admin Login] Attempt for email: {email}")

        if not email or not password:
            flash("Email and password are required.", "warning")
            return render_template('admin_login.html'), 400

        # Authenticate with Supabase auth
        url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
        headers = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' }
        payload = { 'email': email, 'password': password }

        try:
            auth_response = requests.post(url, headers=headers, json=payload, timeout=10)
            logger.info(f"[Admin Login] Supabase auth response status: {auth_response.status_code}")

            if auth_response.status_code == 200:
                resp_data = auth_response.json()
                supabase_user_info = resp_data.get('user')
                
                if supabase_user_info:
                    user_id = supabase_user_info.get('id')
                    logger.info(f"[Admin Login] Extracted user_id: {user_id}")
                    
                    user_details = _get_user_details_with_admin_status(user_id)
                    logger.info(f"[Admin Login] User details from _get_user_details_with_admin_status: {user_details}")

                    if user_details and user_details.get('is_admin') is True:
                        session['is_admin'] = True
                        session['admin_user_id'] = user_id
                        session['admin_user_email'] = user_details.get('email') # Optional: store email for display
                        flash("Login successful!", "success")
                        logger.info(f"[Admin Login] Admin session SET for user {user_id}. Session: {dict(session)}")
                        return redirect(url_for('admin.admin_dashboard'))
                    else:
                        logger.warning(f"[Admin Login] User {user_id} is not an admin or details fetch failed.")
                        flash("Access denied. Not an authorized admin.", "danger")
                else:
                    logger.warning("[Admin Login] Supabase user info missing in auth response.")
                    flash("Authentication failed. Please try again.", "danger")
            else:
                error_data = auth_response.json()
                error_msg = error_data.get('error_description', 'Invalid credentials or login failed')
                logger.error(f"[Admin Login] Supabase auth failed: {error_msg}. Response: {error_data}")
                flash(error_msg, "danger")
        
        except requests.exceptions.RequestException as e:
            logger.error(f"[Admin Login] Network error: {e}", exc_info=True)
            flash("A network error occurred. Please try again.", "danger")
        except Exception as e:
            logger.error(f"[Admin Login] Unexpected error: {e}", exc_info=True)
            flash("An unexpected error occurred. Please try again.", "danger")
        
        return render_template('admin_login.html') # Re-render login form with error

    # For GET request
    if session.get('is_admin') and session.get('admin_user_id'):
        # If already logged in as admin, redirect to dashboard
        return redirect(url_for('admin.admin_dashboard'))
    return render_template('admin_login.html')

@admin_bp.route('/logout')
@admin_required # Ensure only logged-in admins can access logout, though it might be open too
def admin_logout():
    session.pop('is_admin', None)
    session.pop('admin_user_id', None)
    session.pop('admin_user_email', None) # Clear optional email too
    flash("You have been successfully logged out.", "success")
    logger.info(f"[Admin Logout] Admin session cleared. Session: {dict(session)}")
    return redirect(url_for('admin.admin_login'))

# Move blueprint registration to after all routes are defined
# app.register_blueprint(admin_bp)  # Remove this line from here

def get_dealer_statistics():
    """Get dealer statistics for admin dashboard"""
    try:
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Get total dealers
        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=id,dealer_verified",
            headers=headers
        )
        
        if dealers_response.status_code == 200:
            dealers = dealers_response.json()
            total_dealers = len(dealers)
            verified_dealers = sum(1 for d in dealers if d.get('dealer_verified'))
            pending_dealers = total_dealers - verified_dealers
            
            return {
                'total': total_dealers,
                'verified': verified_dealers,
                'pending': pending_dealers
            }
        return {'total': 0, 'verified': 0, 'pending': 0}
    except Exception as e:
        logger.error(f"Error getting dealer statistics: {str(e)}")
        return {'total': 0, 'verified': 0, 'pending': 0}

def get_user_statistics_admin():
    """Get user statistics for admin dashboard"""
    try:
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Get total users
        users_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?select=id,created_at",
            headers=headers
        )
        
        if users_response.status_code == 200:
            users = users_response.json()
            total_users = len(users)
            
            # Count users from last 7 days
            from datetime import datetime, timedelta
            week_ago = datetime.now() - timedelta(days=7)
            new_users = sum(1 for u in users if datetime.fromisoformat(u['created_at'].replace('Z', '+00:00')) > week_ago)
            
            return {
                'total': total_users,
                'new_this_week': new_users
            }
        return {'total': 0, 'new_this_week': 0}
    except Exception as e:
        logger.error(f"Error getting user statistics: {str(e)}")
        return {'total': 0, 'new_this_week': 0}

def get_pending_counts():
    counts = {}
    item_types_and_tables = {
        'cars': 'cars',
        'bikes': 'bikes',
        'parts': 'car_parts',
        'plates': 'license_plates'
    }
    for item_type, table_name in item_types_and_tables.items():
        try:
            # Using supabase_request to get count of items with status 'pending'
            # Ensure your supabase_request can handle count queries or adapt as needed.
            # Supabase PostgREST can do this with params `select=count` and a filter.
            # This requires `status` column on all these tables.
            response, status_code = supabase_request(
                'get',
                f'/rest/v1/{table_name}',
                params={'status': 'eq.pending', 'select': 'count'},
                use_service_role=True # Admin actions might need service role
            )
            if status_code == 200 and response and isinstance(response, list) and 'count' in response[0]:
                counts[item_type] = response[0]['count']
            elif status_code == 200 and isinstance(response, list) and not response: # No pending items
                 counts[item_type] = 0
            else:
                logger.error(f"Error fetching pending count for {item_type}: {status_code} - {response}")
                counts[item_type] = 'Error' # Or 0, or handle differently
        except Exception as e:
            logger.error(f"Exception fetching pending count for {item_type}: {e}")
            counts[item_type] = 'Exception'
    return counts

# ... (inside admin_bp blueprint)

# Generic route for listing pending items
@admin_bp.route('/approve/<item_type>')
@admin_required
def list_pending_items(item_type):
    valid_item_types = {
        'cars': 'cars',
        'bikes': 'bikes',
        'parts': 'car_parts',
        'plates': 'license_plates'
    }
    if item_type not in valid_item_types:
        flash(f"Invalid item type: {item_type}", "danger")
        return redirect(url_for('admin.admin_dashboard'))

    table_name = valid_item_types[item_type]
    items = []
    error_message = None
    try:
        # Fetch items with status 'pending' (or any non-'approved' status if that makes more sense)
        # This assumes a 'status' column exists and non-approved items are 'pending'.
        response, status_code = supabase_request(
            'get',
            f'/rest/v1/{table_name}',
            params={'status': 'eq.pending', 'select': '*'}, # Select all columns for display
            use_service_role=True
        )
        if status_code == 200:
            items = response
        else:
            error_message = f"Error fetching pending {item_type}: {status_code} - {response}"
            logger.error(error_message)
            flash(error_message, "danger")
    except Exception as e:
        error_message = f"Exception fetching pending {item_type}: {e}"
        logger.error(error_message)
        flash(error_message, "danger")
    
    return render_template('approve_list.html', 
                           items=items, 
                           item_type=item_type, 
                           item_type_title=item_type.replace('_', ' ').title(),
                           error_message=error_message)

# ... (rest of admin_bp routes)

@admin_bp.route('/approve/<item_type>/<item_id>/approve', methods=['POST'])
@admin_required
def approve_item(item_type, item_id):
    valid_item_types = {
        'cars': 'cars',
        'bikes': 'bikes',
        'parts': 'car_parts',
        'plates': 'license_plates'
    }
    if item_type not in valid_item_types:
        flash(f"Invalid item type: {item_type}", "danger")
        return redirect(url_for('admin.admin_dashboard'))

    table_name = valid_item_types[item_type]
    # Define item_type_title for flash messages
    item_type_display_name = item_type.replace('_', ' ').title()
    if item_type_display_name.endswith('s'):
        item_type_display_name = item_type_display_name[:-1]

    try:
        # The existing API routes for approval already check admin status, but good to have @admin_required here too.
        # Those API routes use current_user from token. Here, session['admin_user_id'] is the admin.
        # We are calling supabase_request directly for simplicity now.
        patch_data = {'status': 'approved'}
        if item_type == 'cars':
            patch_data['is_approved'] = True
        response, status_code = supabase_request(
            'patch',
            f'/rest/v1/{table_name}?id=eq.{item_id}',
            data=patch_data,
            use_service_role=True # Admin actions should use service role to bypass RLS if needed
        )
        if status_code >= 200 and status_code < 300:
            flash(f"{item_type_display_name} {item_id} approved successfully.", "success")
        else:
            # Use item_type_display_name here as well
            flash(f"Error approving {item_type_display_name} {item_id}: {status_code} - {response}", "danger")
            logger.error(f"Error approving {item_type} {item_id}: {status_code} - {response}")
    except Exception as e:
        flash(f"Exception approving {item_type_display_name} {item_id}: {e}", "danger")
        logger.error(f"Exception approving {item_type} {item_id}: {e}")
    
    return redirect(url_for('admin.list_pending_items', item_type=item_type))

@admin_bp.route('/approve/<item_type>/<item_id>/reject', methods=['POST'])
@admin_required
def reject_item(item_type, item_id):
    valid_item_types = {
        'cars': 'cars',
        'bikes': 'bikes',
        'parts': 'car_parts',
        'plates': 'license_plates'
    }
    if item_type not in valid_item_types:
        flash(f"Invalid item type: {item_type}", "danger")
        return redirect(url_for('admin.admin_dashboard'))

    table_name = valid_item_types[item_type]
    item_type_title = item_type.replace('_', ' ').title()
    try:
        response, status_code = supabase_request(
            'patch',
            f'/rest/v1/{table_name}?id=eq.{item_id}',
            data={'status': 'rejected'},
            use_service_role=True
        )
        if status_code >= 200 and status_code < 300:
            flash(f"{item_type_title} {item_id} rejected successfully.", "success")
        else:
            flash(f"Error rejecting {item_type_title} {item_id}: {status_code} - {response}", "danger")
            logger.error(f"Error rejecting {item_type} {item_id}: {status_code} - {response}")
    except Exception as e:
        flash(f"Exception rejecting {item_type} {item_id}: {e}", "danger")
        logger.error(f"Exception rejecting {item_type} {item_id}: {e}")
        
    return redirect(url_for('admin.list_pending_items', item_type=item_type))

# Dealer Management Routes
@admin_bp.route('/dealers')
@admin_required
def list_dealers():
    """List all dealers with their status"""
    try:
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Get all dealers
        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=*&order=created_at.desc",
            headers=headers
        )
        
        if dealers_response.status_code == 200:
            dealers = dealers_response.json()
            return render_template('dealers.html', dealers=dealers)
        else:
            flash('Error loading dealers', 'danger')
            return render_template('dealers.html', dealers=[])
    except Exception as e:
        logger.error(f"Error listing dealers: {str(e)}")
        flash(f'Error loading dealers: {str(e)}', 'danger')
        return render_template('dealers.html', dealers=[])

@admin_bp.route('/dealers/pending')
@admin_required
def list_pending_dealers():
    """List dealers awaiting verification"""
    try:
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Get pending dealers
        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&dealer_verified=eq.false&select=*&order=created_at.desc",
            headers=headers
        )
        
        if dealers_response.status_code == 200:
            dealers = dealers_response.json()
            return render_template('pending_dealers.html', dealers=dealers)
        else:
            flash('Error loading pending dealers', 'danger')
            return render_template('pending_dealers.html', dealers=[])
    except Exception as e:
        logger.error(f"Error listing pending dealers: {str(e)}")
        flash(f'Error loading pending dealers: {str(e)}', 'danger')
        return render_template('pending_dealers.html', dealers=[])

@admin_bp.route('/dealers/<dealer_id>/verify', methods=['POST'])
@admin_required
def verify_dealer(dealer_id):
    """Verify a dealer account"""
    try:
        from datetime import datetime
        
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Update dealer verification
        update_data = {
            'dealer_verified': True,
            'dealer_verified_at': datetime.utcnow().isoformat(),
            'dealer_verified_by': session.get('admin_user_id')
        }
        
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{dealer_id}",
            headers=headers,
            json=update_data
        )
        
        if response.status_code in [200, 204]:
            flash('Dealer verified successfully!', 'success')
        else:
            flash(f'Error verifying dealer: {response.text}', 'danger')
            
    except Exception as e:
        logger.error(f"Error verifying dealer: {str(e)}")
        flash(f'Error verifying dealer: {str(e)}', 'danger')
    
    return redirect(url_for('admin.list_pending_dealers'))

@admin_bp.route('/dealers/<dealer_id>/reject', methods=['POST'])
@admin_required
def reject_dealer(dealer_id):
    """Reject a dealer verification request"""
    try:
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Get rejection note from form
        rejection_note = request.form.get('rejection_note', 'Verification rejected by admin')
        
        # Update user - set is_dealer to false or keep it but mark as not verified
        update_data = {
            'is_dealer': False,  # Remove dealer status
            'rejection_note': rejection_note
        }
        
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{dealer_id}",
            headers=headers,
            json=update_data
        )
        
        if response.status_code in [200, 204]:
            flash('Dealer verification rejected', 'warning')
        else:
            flash(f'Error rejecting dealer: {response.text}', 'danger')
            
    except Exception as e:
        logger.error(f"Error rejecting dealer: {str(e)}")
        flash(f'Error rejecting dealer: {str(e)}', 'danger')
    
    return redirect(url_for('admin.list_pending_dealers'))

@admin_bp.route('/users')
@admin_required
def list_users():
    """List all users"""
    try:
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        # Get all users
        users_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?select=*&order=created_at.desc",
            headers=headers
        )
        
        if users_response.status_code == 200:
            users = users_response.json()
            return render_template('users.html', users=users)
        else:
            flash('Error loading users', 'danger')
            return render_template('users.html', users=[])
    except Exception as e:
        logger.error(f"Error listing users: {str(e)}")
        flash(f'Error loading users: {str(e)}', 'danger')
        return render_template('users.html', users=[])

# ... (End of admin_bp blueprint, before app.register_blueprint(admin_bp) if it was moved, or before if __name__ ...)

# =====================
# Reports API Routes
# =====================

@app.route('/api/reports', methods=['POST'])
@token_required
def create_report(current_user):
    """Submit a report for a listing"""
    try:
        data = request.json
        
        # Validate required fields
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        listing_id = data.get('listing_id')
        listing_type = data.get('listing_type')
        reason = data.get('reason')
        details = data.get('details', '')
        
        if not listing_id or not listing_type or not reason:
            return jsonify({'error': 'Missing required fields: listing_id, listing_type, or reason'}), 400
        
        # Validate listing_type
        valid_types = ['car', 'bike', 'plate', 'part', 'bug']
        if listing_type not in valid_types:
            return jsonify({'error': f'Invalid listing_type. Must be one of: {", ".join(valid_types)}'}), 400
        
        # Validate reason
        valid_reasons = ['spam', 'fraud', 'inappropriate', 'wrong_category', 'duplicate', 'sold', 'incorrect_info', 'other', 'bug']
        if reason not in valid_reasons:
            return jsonify({'error': f'Invalid reason. Must be one of: {", ".join(valid_reasons)}'}), 400
        
        # Create the report in Supabase
        report_data = {
            'listing_id': listing_id,
            'listing_type': listing_type,
            'reporter_id': current_user,
            'reason': reason,
            'details': details,
            'status': 'pending'
        }
        
        response, status_code = supabase_request(
            'post',
            '/rest/v1/reports',
            data=report_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            logger.error(f"Failed to create report: {response}")
            return jsonify({'error': 'Failed to submit report'}), status_code
        
        logger.info(f"Report created successfully by user {current_user} for {listing_type} {listing_id}")
        return jsonify({'message': 'Report submitted successfully', 'report': response}), 201
        
    except Exception as e:
        logger.error(f"Error creating report: {str(e)}")
        return jsonify({'error': 'An error occurred while submitting the report'}), 500

@app.route('/api/reports', methods=['GET'])
@token_required
def get_reports(current_user):
    """Get reports - users see their own, admins see all"""
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        is_admin = user_details and user_details.get('is_admin', False)
        
        if is_admin:
            # Admins can see all reports
            response, status_code = supabase_request(
                'get',
                '/rest/v1/reports?order=created_at.desc',
                user_id=current_user
            )
        else:
            # Regular users can only see their own reports
            response, status_code = supabase_request(
                'get',
                f'/rest/v1/reports?reporter_id=eq.{current_user}&order=created_at.desc',
                user_id=current_user
            )
        
        if status_code >= 400:
            logger.error(f"Failed to fetch reports: {response}")
            return jsonify({'error': 'Failed to fetch reports'}), status_code
        
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error fetching reports: {str(e)}")
        return jsonify({'error': 'An error occurred while fetching reports'}), 500

@app.route('/api/admin/reports', methods=['GET'])
@token_required
def get_admin_reports(current_user):
    """Get all reports for admin dashboard"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Unauthorized - Admin access required'}), 403
        
        # Get query parameters for filtering
        status = request.args.get('status')
        listing_type = request.args.get('listing_type')
        
        # Build query
        query = '/rest/v1/reports?order=created_at.desc'
        
        if status:
            query += f'&status=eq.{status}'
        if listing_type:
            query += f'&listing_type=eq.{listing_type}'
        
        response, status_code = supabase_request(
            'get',
            query,
            user_id=current_user
        )
        
        if status_code >= 400:
            logger.error(f"Failed to fetch admin reports: {response}")
            return jsonify({'error': 'Failed to fetch reports'}), status_code
        
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error fetching admin reports: {str(e)}")
        return jsonify({'error': 'An error occurred while fetching reports'}), 500

@app.route('/api/admin/dealers', methods=['GET'])
@token_required
def get_admin_dealers(current_user):
    """Get all dealers for admin dashboard"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Unauthorized - Admin access required'}), 403
        
        # Get query parameters for filtering
        verified_only = request.args.get('verified')
        pending_only = request.args.get('pending')
        
        # Build query
        query = '/rest/v1/users?is_dealer=eq.true&order=created_at.desc'
        
        if verified_only == 'true':
            query += '&dealer_verified=eq.true'
        elif pending_only == 'true':
            query += '&dealer_verified=eq.false'
        
        # Add select to get relevant fields
        query += '&select=id,email,first_name,last_name,company_name,company_registration_number,trade_license_number,is_dealer,dealer_verified,dealer_verified_at,created_at,phone,city,emirate,profile_completion_percentage'
        
        response, status_code = supabase_request(
            'get',
            query,
            use_service_role=True
        )
        
        if status_code >= 400:
            logger.error(f"Failed to fetch dealers: {response}")
            return jsonify({'error': 'Failed to fetch dealers'}), status_code
        
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error fetching dealers: {str(e)}")
        return jsonify({'error': 'An error occurred while fetching dealers'}), 500

@app.route('/api/admin/dealers/<dealer_id>/verify', methods=['POST'])
@token_required
def api_verify_dealer(current_user, dealer_id):
    """Verify a dealer account"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Unauthorized - Admin access required'}), 403
        
        from datetime import datetime
        
        # Update dealer verification
        update_data = {
            'dealer_verified': True,
            'dealer_verified_at': datetime.utcnow().isoformat()
        }
        
        response, status_code = supabase_request(
            'patch',
            f'/rest/v1/users?id=eq.{dealer_id}',
            data=update_data,
            use_service_role=True
        )
        
        if status_code in [200, 204]:
            logger.info(f"Admin {current_user} verified dealer {dealer_id}")
            return jsonify({'success': True, 'message': 'Dealer verified successfully'}), 200
        else:
            logger.error(f"Error verifying dealer {dealer_id}: {status_code} - {response}")
            return jsonify({'error': 'Failed to verify dealer'}), status_code
            
    except Exception as e:
        logger.error(f"Exception in api_verify_dealer: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/dealers/<dealer_id>/reject', methods=['POST'])
@token_required
def api_reject_dealer(current_user, dealer_id):
    """Reject a dealer verification request"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Unauthorized - Admin access required'}), 403
        
        # Get rejection note from request
        rejection_note = ''
        if request.is_json and request.json:
            rejection_note = request.json.get('rejection_note', '')
        
        # Update user - set is_dealer to false and add rejection note
        update_data = {
            'is_dealer': False,
            'rejection_note': rejection_note
        }
        
        response, status_code = supabase_request(
            'patch',
            f'/rest/v1/users?id=eq.{dealer_id}',
            data=update_data,
            use_service_role=True
        )
        
        if status_code in [200, 204]:
            logger.info(f"Admin {current_user} rejected dealer {dealer_id}")
            return jsonify({'success': True, 'message': 'Dealer verification rejected'}), 200
        else:
            logger.error(f"Error rejecting dealer {dealer_id}: {status_code} - {response}")
            return jsonify({'error': 'Failed to reject dealer'}), status_code
            
    except Exception as e:
        logger.error(f"Exception in api_reject_dealer: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/reports/<report_id>', methods=['PATCH'])
@token_required
def update_report(current_user, report_id):
    """Update a report (admin only)"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Unauthorized - Admin access required'}), 403
        
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Prepare update data
        update_data = {}
        if 'status' in data:
            valid_statuses = ['pending', 'reviewed', 'resolved', 'dismissed']
            if data['status'] not in valid_statuses:
                return jsonify({'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'}), 400
            update_data['status'] = data['status']
        
        if 'admin_note' in data:
            update_data['admin_note'] = data['admin_note']
        
        if 'status' in data and data['status'] in ['reviewed', 'resolved', 'dismissed']:
            update_data['reviewed_by'] = current_user
            update_data['reviewed_at'] = 'now()'
        
        # Update the report
        response, status_code = supabase_request(
            'patch',
            f'/rest/v1/reports?id=eq.{report_id}',
            data=update_data,
            user_id=current_user
        )
        
        if status_code >= 400:
            logger.error(f"Failed to update report: {response}")
            return jsonify({'error': 'Failed to update report'}), status_code
        
        logger.info(f"Report {report_id} updated by admin {current_user}")
        return jsonify({'message': 'Report updated successfully', 'report': response}), 200
        
    except Exception as e:
        logger.error(f"Error updating report: {str(e)}")
        return jsonify({'error': 'An error occurred while updating the report'}), 500

@app.route('/api/<item_type>/<item_id>/delete', methods=['DELETE'])
@token_required
def delete_listing(current_user, item_type, item_id):
    """Delete a listing (admin only)"""
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        
        # Validate item_type
        valid_types = ['car', 'bike', 'car-part', 'plate']
        if item_type not in valid_types:
            return jsonify({'error': 'Invalid item type'}), 400
        
        # Map item_type to table name
        table_mapping = {
            'car': 'cars',
            'bike': 'bikes', 
            'car-part': 'car_parts',
            'plate': 'license_plates'
        }
        
        table_name = table_mapping[item_type]
        
        # Delete the listing using service role
        service_role_key = app.config['SUPABASE_SERVICE_ROLE_KEY']
        headers = {
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json'
        }
        
        url = f"{app.config['SUPABASE_URL']}/rest/v1/{table_name}?id=eq.{item_id}"
        
        response = requests.delete(url, headers=headers)
        
        if response.status_code == 200 or response.status_code == 204:
            logger.info(f"Admin {current_user} deleted {item_type} {item_id}")
            return jsonify({'message': f'{item_type.title()} deleted successfully'}), 200
        else:
            logger.error(f"Failed to delete {item_type} {item_id}: {response.status_code}")
            return jsonify({'error': 'Failed to delete listing'}), response.status_code
            
    except Exception as e:
        logger.error(f"Error deleting {item_type} {item_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/check-session', methods=['GET'])
@token_required
def check_session_route(current_user):
    if os.getenv("ENABLE_DIAGNOSTICS", "false").lower() != "true":
        return jsonify({'error': 'Not found'}), 404

    if not get_user_admin_status(current_user):
        return jsonify({'error': 'Unauthorized'}), 403

    is_admin_in_session = session.get('is_admin', False)
    admin_id_in_session = session.get('admin_user_id')
    return jsonify({
        'message': 'Session check',
        'is_admin_flag_from_session': is_admin_in_session,
        'admin_id_from_session': admin_id_in_session
    }), 200

# Admin routes are registered at the top of the file (after imports)
# No need to register again here

if __name__ == "__main__":
    logger.info("Starting Flask application on port 8000")
    debug_mode = os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"} or os.getenv("FLASK_ENV") != "production"
    app.run(debug=debug_mode, host='0.0.0.0', port=8000) 
