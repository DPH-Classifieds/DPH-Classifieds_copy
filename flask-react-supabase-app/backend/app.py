from flask import Flask, jsonify, request, abort, send_from_directory, session, redirect, url_for, flash, Blueprint, render_template
from dotenv import load_dotenv
import os
import requests
from flask_cors import CORS
import logging
from functools import wraps
import jwt
import json
import time
from werkzeug.utils import secure_filename
import psycopg2
from PIL import Image, ImageDraw, ImageFont
import uuid
import threading
import datetime

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static')
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
# Enable CORS for all routes, with specific origins for security
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000"]}}, supports_credentials=True)

# Configure a secret key for session management
# IMPORTANT: In a production environment, use a strong, randomly generated key set via environment variable.
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-please-change")

# Create static directory for file uploads if it doesn't exist
os.makedirs(os.path.join('static', 'uploads', 'plates'), exist_ok=True)

load_dotenv()  # Loads the environment variables from .env
print(f"DEBUG: Value of SUPABASE_SERVICE_ROLE_KEY from os.getenv is: {os.getenv('SUPABASE_SERVICE_ROLE_KEY')}")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

logger.info(f"SUPABASE_URL: {SUPABASE_URL}")
logger.info(f"SUPABASE_KEY exists: {bool(SUPABASE_KEY)}")
logger.info(f"SUPABASE_JWT_SECRET exists: {bool(SUPABASE_JWT_SECRET)}")

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
    logger.info(f"Headers: {headers}")
    if data:
        logger.info(f"Data: {data}")
    if params:
        logger.info(f"Params: {params}")
    
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
        
        # Handle extras parameter specially (ignore it as it doesn't exist in the table)
        # The extras are stored as individual boolean columns, not as an array
        
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
        
        # Get car details
        query = f"/rest/v1/cars?id=eq.{car_id}&select=*"
        car_response, car_status = supabase_request('get', query)
        
        if not car_response or len(car_response) == 0:
            logger.warning(f"Car not found with ID: {car_id}")
            return jsonify({"error": "Car not found"}), 404
            
        car = car_response[0]
        logger.info(f"Found car: {car['listing_title']} (ID: {car['id']})")
        
        # Get car images
        images_query = f"/rest/v1/car_images?car_id=eq.{car_id}&select=*"
        logger.info(f"Fetching images with query: {images_query}")
        images_response, images_status = supabase_request('get', images_query)
        
        if images_status < 400:
            logger.info(f"Found {len(images_response)} images for car {car_id}")
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
            
            car["images"] = images_response
            logger.info(f"Processed images: {car['images']}")
        else:
            logger.warning(f"Failed to fetch images for car {car_id}: status {images_status}")
            car["images"] = []
        
        logger.info(f"Returning car with {len(car['images'])} images")
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

# Update a car listing (authenticated)
@app.route('/api/cars/<string:car_id>', methods=['PUT'])
@token_required
def update_car(current_user, car_id):
    try:
        # Validate input
        if not request.json:
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
        
        update_data = request.json
        
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
        
        images = update_data.pop('images', None)
        
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
        
        # Update images if provided
        if images is not None:
            # First, delete all existing images
            delete_resp, delete_status = supabase_request(
                'delete', 
                '/rest/v1/car_images', 
                params={'car_id': f'eq.{car_id}'},
                user_id=current_user
            )
            
            # Add new images
            if images:
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
        upload_dir = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
        
        # Create uploads directory if it doesn't exist
        os.makedirs(upload_dir, exist_ok=True)
        
        for file in files:
            if file and file.filename:
                # Generate unique filename
                filename = secure_filename(file.filename)
                timestamp = int(time.time())
                file_extension = os.path.splitext(filename)[1]
                unique_filename = f"{timestamp}_{uuid.uuid4().hex[:8]}{file_extension}"
                
                # Save file
                file_path = os.path.join(upload_dir, unique_filename)
                file.save(file_path)
                logger.info(f"Saved image to {file_path}")
                
                # Generate URL (relative to the API base)
                image_url = f"/static/uploads/{unique_filename}"
                image_urls.append(image_url)
        
        logger.info(f"Successfully uploaded {len(image_urls)} images: {image_urls}")
        
        # Return both URLs and absolute URLs for better frontend compatibility
        host_url = request.host_url.rstrip('/')
        absolute_urls = [f"{host_url}{url}" for url in image_urls]
        
        return jsonify({
            "urls": image_urls,
            "absolute_urls": absolute_urls,
            "count": len(image_urls)
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
    # Get user details from Supabase auth
    logger.info(f"Getting profile for user ID: {current_user}")
    
    try:
        # Get the token from the request header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith('Bearer '):
            logger.error("Invalid Authorization header format in profile request")
            return jsonify({'message': 'Invalid Authorization header'}), 401
            
        token = auth_header.split()[1]
        
        # Use the same method we use in token_required for consistency
        url = f"{SUPABASE_URL}/auth/v1/user"
        headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {token}'
        }
        
        logger.info(f"Fetching user profile data from Supabase")
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            user_data = response.json()
            logger.info(f"Successfully retrieved user profile for: {user_data.get('email')}")
            
            # Remove sensitive data
            if 'phone' in user_data:
                del user_data['phone']
            if 'password' in user_data:
                del user_data['password']
            
            return jsonify(user_data), 200
        else:
            logger.error(f"Failed to get user profile: {response.status_code} - {response.text}")
            return jsonify({'message': 'Failed to get user profile'}), response.status_code
        
    except Exception as e:
        logger.error(f"Error in get_user_profile: {str(e)}")
        return jsonify({'error': str(e)}), 500

# User authentication routes
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    logger.info(f"[Login] Attempt for email: {data.get('email', 'unknown')}")
    
    if not data or not data.get('email') or not data.get('password'):
        logger.warning("[Login] Missing email or password in request.")
        return jsonify({'message': 'Missing email or password'}), 400
    
    email = data.get('email')
    password = data.get('password')
    
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
    
    # Sign up with Supabase
    url = f"{SUPABASE_URL}/auth/v1/signup"
    headers = {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json'
    }
    payload = {
        'email': email,
        'password': password
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code == 200:
            # Return the response to the client
            return jsonify(response.json()), 200
        else:
            error_data = response.json()
            return jsonify({'message': error_data.get('error_description', 'Signup failed')}), response.status_code
    
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
    logger.info(f"[_get_user_details_with_admin_status] Using headers for Supabase requests: {headers}") # Log headers

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
    payload = {
        'email': email,
        'redirect_to': f"{request.headers.get('Origin', 'http://localhost:3000')}/reset-password"
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
        
        bike_data = request.json
        bike_data['user_id'] = current_user
        
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
        order = request.args.get('order', 'created_at')
        
        # Construct parameters for Supabase query
        params = {
            'limit': limit,
            'offset': offset,
            'order': order,
            'status': 'eq.approved',  # Only show approved plates
            'is_approved': 'eq.true'  # Ensure consistency
        }
        
        # Filter out any underscore parameters
        params = {k: v for k, v in params.items() if not k.startswith('_')}
        
        logger.info(f"Fetching plates with params: {params}")
        
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
            url = f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?{query_string}"
            
            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)
            
            if response.status_code == 200:
                plates = response.json()
                
                # Fetch images for each plate
                for plate in plates:
                    plate_id = plate['id']
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/plate_images?plate_id=eq.{plate_id}"
                    image_response = requests.get(image_url, headers=headers)
                    
                    if image_response.status_code == 200:
                        images = image_response.json()
                        plate['images'] = [img['image_url'] for img in images]
                    else:
                        plate['images'] = []
                
                return jsonify(plates)
            else:
                logger.error(f"Direct request failed: {response.status_code} - {response.text}")
                # Fallback to regular method
                raise Exception("Direct request failed")
                
        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request('get', '/rest/v1/license_plates', params=params)
            if status_code < 400 and response:
                # Fetch images for each plate in fallback
                for plate in response:
                    plate_id = plate['id']
                    images_response, images_status = supabase_request(
                        'get',
                        '/rest/v1/plate_images',
                        params={'select': '*', 'plate_id': f'eq.{plate_id}'}
                    )
                    if images_status < 400 and images_response:
                        plate['images'] = images_response
                    else:
                        plate['images'] = []
                return jsonify(response)
            else:
                return jsonify([])
    
    except Exception as e:
        logger.error(f"Error fetching plates: {str(e)}")
        logger.error(f"Error creating plate directly: {str(e)}")
        return jsonify({'error': str(e)}), 500

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

# Diagnostic endpoint to check if service role key is available
@app.route('/api/diagnostics/config', methods=['GET'])
def check_config():
    try:
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
        logger.info(f"Attempting to make user {current_user} an admin")
        
        # Get the service role key for admin operations
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not service_key:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY not set, falling back to SUPABASE_KEY")
            service_key = SUPABASE_KEY
            
        if not service_key:
            logger.error("No Supabase API key available")
            return jsonify({'error': 'Server configuration error - no API key available'}), 500
            
        logger.info(f"Using service key (first 5 chars): {service_key[:5]}...")
        
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
    # The template 'dashboard.html' is implicitly looked for in 'templates/admin/'
    # because of the admin_bp.template_folder setting.
    return render_template('dashboard.html', pending_counts=pending_counts)

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

# ... (End of admin_bp blueprint, before app.register_blueprint(admin_bp) if it was moved, or before if __name__ ...)

@app.route('/api/check-session', methods=['GET'])
def check_session_route():
    logger.info(f"[Check Session] Session data: {dict(session)}")
    is_admin_in_session = session.get('is_admin', False)
    admin_id_in_session = session.get('admin_user_id')
    return jsonify({
        'message': 'Session check',
        'session_data_on_backend': dict(session),
        'is_admin_flag_from_session': is_admin_in_session,
        'admin_id_from_session': admin_id_in_session
    }), 200

# Register the admin blueprint after all routes are defined
app.register_blueprint(admin_bp)

if __name__ == "__main__":
    logger.info("Starting Flask application on port 8000")
    app.run(debug=True, host='0.0.0.0', port=8000) 