from flask import (
    Flask,
    jsonify,
    request,
    abort,
    send_from_directory,
    session,
    redirect,
    url_for,
    flash,
    Blueprint,
    render_template,
    make_response,
)
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
from urllib.parse import quote, parse_qs, urlparse

load_dotenv()  # Loads the environment variables from .env

# Set up logging with conditional verbosity
log_level = logging.INFO if os.getenv("FLASK_ENV") == "production" else logging.DEBUG
logging.basicConfig(
    level=log_level, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder="static")
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV") == "production"
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10MB max request size
MAX_LISTINGS_PER_USER = int(os.getenv("MAX_LISTINGS_PER_USER", "4"))
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "10"))
Image.MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "25000000"))
CONTACT_RATE_LIMIT_WINDOW_SEC = int(os.getenv("CONTACT_RATE_LIMIT_WINDOW_SEC", "3600"))
CONTACT_RATE_LIMIT_MAX = int(os.getenv("CONTACT_RATE_LIMIT_MAX", "5"))
CONTACT_RATE_LIMIT = defaultdict(deque)
AUTH_RATE_LIMIT_WINDOW_SEC = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SEC", "300"))
AUTH_RATE_LIMIT_MAX = int(os.getenv("AUTH_RATE_LIMIT_MAX", "5"))
AUTH_RATE_LIMIT = defaultdict(deque)
EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MIN_ALLOWED_YEAR = 1886
MAX_DESCRIPTION_WORDS = 300
LISTING_EXPIRY_DAYS = 30
LISTING_RETENTION_DAYS = 30

LISTING_TABLE_CONFIG = {
    "car": {"table": "cars", "images_table": "car_images", "fk": "car_id"},
    "bike": {"table": "bikes", "images_table": "bike_images", "fk": "bike_id"},
    "part": {"table": "car_parts", "images_table": "part_images", "fk": "part_id"},
    "plate": {
        "table": "license_plates",
        "images_table": "plate_images",
        "fk": "plate_id",
    },
}

CAR_TRANSMISSION_OPTIONS = {"Automatic", "Manual"}
REGIONAL_SPEC_NORMALIZATION = {
    "GCC Specs": "GCC",
    "American Specs": "North American",
    "European Specs": "European",
    "Japanese Specs": "Japanese",
    "Korean Specs": "Korean",
    "Chinese Specs": "Chinese",
}


def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def _parse_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        return (
            value
            if value.tzinfo is not None
            else value.replace(tzinfo=datetime.timezone.utc)
        )
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        parsed = datetime.datetime.fromisoformat(normalized)
        return (
            parsed
            if parsed.tzinfo is not None
            else parsed.replace(tzinfo=datetime.timezone.utc)
        )
    except ValueError:
        return None


def _isoformat_utc(value):
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc).isoformat()


def _default_expiry_from_created_at(record):
    created_at = _parse_datetime(record.get("created_at")) or _utc_now()
    return created_at + datetime.timedelta(days=LISTING_EXPIRY_DAYS)


def _compute_listing_lifecycle(record):
    now = _utc_now()
    expires_at = _parse_datetime(
        record.get("expires_at")
    ) or _default_expiry_from_created_at(record)
    expired_at = _parse_datetime(record.get("expired_at"))

    if not expired_at and now >= expires_at:
        expired_at = expires_at

    retention_expires_at = _parse_datetime(record.get("retention_expires_at"))
    if not retention_expires_at:
        retention_anchor = expired_at or expires_at
        retention_expires_at = retention_anchor + datetime.timedelta(
            days=LISTING_RETENTION_DAYS
        )

    is_archived = bool(record.get("is_archived")) or now >= retention_expires_at
    is_expired = now >= expires_at

    if is_archived:
        state = "archived"
    elif is_expired:
        state = "expired"
    else:
        state = "active"

    return {
        "expires_at": expires_at,
        "expired_at": expired_at,
        "retention_expires_at": retention_expires_at,
        "is_expired": is_expired,
        "is_archived": is_archived,
        "state": state,
        "days_until_expiry": max((expires_at - now).days, 0) if not is_expired else 0,
        "days_until_deletion": max((retention_expires_at - now).days, 0)
        if not is_archived
        else 0,
    }


def _apply_listing_lifecycle_metadata(record):
    if not isinstance(record, dict):
        return record

    lifecycle = _compute_listing_lifecycle(record)
    record["listing_state"] = lifecycle["state"]
    record["is_expired"] = lifecycle["is_expired"]
    record["is_archived"] = lifecycle["is_archived"]
    record["expires_at"] = _isoformat_utc(lifecycle["expires_at"])
    record["expired_at"] = _isoformat_utc(lifecycle["expired_at"])
    record["retention_expires_at"] = _isoformat_utc(lifecycle["retention_expires_at"])
    record["days_until_expiry"] = lifecycle["days_until_expiry"]
    record["days_until_deletion"] = lifecycle["days_until_deletion"]
    record["can_extend"] = not lifecycle["is_archived"] and record.get(
        "status"
    ) not in {
        "deleted",
        "rejected",
    }
    return record


def _delete_listing_with_assets(table_name, listing_id):
    config = next(
        (cfg for cfg in LISTING_TABLE_CONFIG.values() if cfg["table"] == table_name),
        None,
    )
    if not config:
        return

    try:
        supabase_request(
            "delete",
            f"/rest/v1/{config['images_table']}",
            params={config["fk"]: f"eq.{listing_id}"},
            use_service_role=True,
        )
    except Exception as image_err:
        logger.warning(
            f"Failed deleting related images for {table_name}/{listing_id}: {image_err}"
        )

    supabase_request(
        "delete",
        f"/rest/v1/{table_name}",
        params={"id": f"eq.{listing_id}"},
        use_service_role=True,
    )


def _sync_listing_lifecycle(table_name, record, *, hard_delete_archived=False):
    if not isinstance(record, dict):
        return record

    lifecycle = _compute_listing_lifecycle(record)
    updates = {}

    if record.get("expires_at") is None:
        updates["expires_at"] = _isoformat_utc(lifecycle["expires_at"])
    if lifecycle["is_expired"] and record.get("expired_at") is None:
        updates["expired_at"] = _isoformat_utc(lifecycle["expired_at"])
    if record.get("retention_expires_at") is None:
        updates["retention_expires_at"] = _isoformat_utc(
            lifecycle["retention_expires_at"]
        )
    if lifecycle["is_archived"] and not record.get("is_archived"):
        updates["is_archived"] = True

    if updates:
        patch_response, patch_status = supabase_request(
            "patch",
            f"/rest/v1/{table_name}?id=eq.{record.get('id')}",
            data=updates,
            use_service_role=True,
        )
        if patch_status >= 400:
            logger.warning(
                f"Failed syncing lifecycle for {table_name}/{record.get('id')}: {patch_response}"
            )
        else:
            record.update(updates)

    _apply_listing_lifecycle_metadata(record)

    if hard_delete_archived and record.get("is_archived"):
        _delete_listing_with_assets(table_name, record.get("id"))
        return None

    return record


def _new_listing_lifecycle_fields():
    expires_at = _utc_now() + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
    return {
        "expires_at": _isoformat_utc(expires_at),
        "expired_at": None,
        "retention_expires_at": _isoformat_utc(
            expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
        ),
        "last_extended_at": None,
        "extension_count": 0,
        "is_archived": False,
    }


def _strip_lifecycle_fields(payload):
    if not isinstance(payload, dict):
        return payload
    lifecycle_keys = {
        "expires_at",
        "expired_at",
        "retention_expires_at",
        "last_extended_at",
        "extension_count",
        "is_archived",
    }
    return {key: value for key, value in payload.items() if key not in lifecycle_keys}


def _create_listing_with_lifecycle_fallback(path, payload, *, user_id):
    response, status_code = supabase_request(
        "post", path, data=payload, user_id=user_id
    )
    if status_code < 400:
        return response, status_code

    error_text = json.dumps(response).lower()
    if "expires_at" not in error_text and "retention_expires_at" not in error_text:
        return response, status_code

    logger.warning(
        f"Lifecycle columns missing for {path}. Retrying insert without lifecycle fields."
    )
    fallback_payload = _strip_lifecycle_fields(payload)
    return supabase_request("post", path, data=fallback_payload, user_id=user_id)


def _filter_public_listing_records(table_name, records):
    filtered = []
    for record in records or []:
        synced = _sync_listing_lifecycle(table_name, record, hard_delete_archived=True)
        if not synced:
            continue
        if synced.get("listing_state") != "active":
            continue
        filtered.append(synced)
    return filtered


def _collect_user_listing_records(current_user, item_type):
    config = LISTING_TABLE_CONFIG[item_type]
    records, status_code = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={
            "select": "*",
            "user_id": f"eq.{current_user}",
            "order": "created_at.desc",
        },
        user_id=current_user,
    )

    if status_code >= 400:
        return records, status_code

    hydrated_records = []
    for record in records or []:
        listing_id = record.get("id")
        images_data, images_status = supabase_request(
            "get",
            f"/rest/v1/{config['images_table']}",
            params={"select": "*", config["fk"]: f"eq.{listing_id}"},
            user_id=current_user,
        )
        record["images"] = images_data if images_status < 400 else []
        record["listing_type"] = item_type
        synced = _sync_listing_lifecycle(
            config["table"], record, hard_delete_archived=True
        )
        if synced:
            hydrated_records.append(synced)

    return hydrated_records, 200


def _delete_user_owned_listing(current_user, item_type, item_id):
    config = LISTING_TABLE_CONFIG[item_type]
    listing_data, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"select": "user_id", "id": f"eq.{item_id}", "limit": 1},
        user_id=current_user,
    )

    if listing_status >= 400:
        return listing_data, listing_status

    if not listing_data:
        return {"error": "Listing not found"}, 404

    if listing_data[0].get("user_id") != current_user:
        return {"error": "You do not have permission to delete this listing"}, 403

    supabase_request(
        "delete",
        f"/rest/v1/{config['images_table']}",
        params={config["fk"]: f"eq.{item_id}"},
        user_id=current_user,
    )
    delete_response, delete_status = supabase_request(
        "delete",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}"},
        user_id=current_user,
    )

    return delete_response, delete_status


def _to_int(value, field_name, *, minimum=None, maximum=None, allow_empty=True):
    if value is None:
        return None

    if isinstance(value, str):
        value = value.strip()
        if value == "":
            if allow_empty:
                return None
            raise ValueError(f"{field_name} is required")

    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a valid number")

    if minimum is not None and parsed < minimum:
        raise ValueError(f"{field_name} must be at least {minimum}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"{field_name} must be at most {maximum}")

    return parsed


def _normalize_regional_spec(value):
    if not value:
        return value
    normalized = REGIONAL_SPEC_NORMALIZATION.get(value, value)
    if isinstance(normalized, str) and normalized.endswith(" Specs"):
        return normalized.replace(" Specs", "").strip()
    return normalized


def _validate_description_word_count(description, *, field_name="description"):
    if not isinstance(description, str) or not description.strip():
        return
    words = re.findall(r"\S+", description)
    if len(words) > MAX_DESCRIPTION_WORDS:
        raise ValueError(f"{field_name} must be {MAX_DESCRIPTION_WORDS} words or fewer")


def _get_cors_origins():
    origins_env = os.getenv("CORS_ORIGINS", "")
    if origins_env:
        origins = [
            origin.strip() for origin in origins_env.split(",") if origin.strip()
        ]
        if origins:
            return origins

    if os.getenv("FLASK_ENV") == "production":
        return [
            "https://dphclassifieds.com",
            "https://www.dphclassifieds.com",
            "https://dphclassifieds.ae",
            "https://www.dphclassifieds.ae",
        ]

    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


# Enable CORS for all routes, with specific origins for security
CORS(
    app, resources={r"/*": {"origins": _get_cors_origins()}}, supports_credentials=True
)

# Configure a secret key for session management
# IMPORTANT: FLASK_SECRET_KEY must always be set via environment variable
flask_secret_key = os.getenv("FLASK_SECRET_KEY")
if not flask_secret_key:
    raise RuntimeError("FLASK_SECRET_KEY must be set in environment variables.")
app.secret_key = flask_secret_key


def _get_safe_frontend_origin(request_origin):
    allowed_origins = _get_cors_origins()
    if request_origin in allowed_origins:
        return request_origin
    return os.getenv(
        "FRONTEND_URL",
        allowed_origins[0] if allowed_origins else "http://localhost:3000",
    )


def _get_safe_redirect_url(request_origin, provided_url=None, fallback_path="/"):
    allowed_origins = _get_cors_origins()

    if provided_url:
        try:
            parsed = urlparse(provided_url)
            if parsed.scheme and parsed.netloc:
                origin = f"{parsed.scheme}://{parsed.netloc}"
                if origin in allowed_origins:
                    return provided_url
        except Exception as parse_err:
            logger.warning(f"Invalid redirect URL provided: {parse_err}")

    origin = _get_safe_frontend_origin(request_origin).rstrip("/")
    return f"{origin}{fallback_path}"


def _redact_headers(headers):
    if not headers:
        return {}
    redacted = dict(headers)
    for key in ["Authorization", "apikey", "X-Postgres-Role"]:
        if key in redacted:
            redacted[key] = "redacted"
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


def _auth_rate_limited(client_ip):
    """Rate limiter for authentication endpoints (login, signup, reset, etc.)"""
    if not client_ip:
        return False
    now = time.time()
    window_start = now - AUTH_RATE_LIMIT_WINDOW_SEC
    entries = AUTH_RATE_LIMIT[client_ip]
    while entries and entries[0] < window_start:
        entries.popleft()
    if len(entries) >= AUTH_RATE_LIMIT_MAX:
        return True
    entries.append(now)
    return False


# Create static directory for file uploads if it doesn't exist
os.makedirs(os.path.join("static", "uploads", "plates"), exist_ok=True)


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"
    )
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://*.railway.app; connect-src 'self' https://*.supabase.co https://dph-classifieds-production.up.railway.app https://dphclassifieds.com https://www.dphclassifieds.com https://challenges.cloudflare.com; frame-src 'none';",
    )
    return response


def _get_user_listing_count(user_id):
    tables = ["cars", "bikes", "license_plates", "car_parts"]
    total = 0

    for table in tables:
        data, status_code = supabase_request(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": "id",
                "user_id": f"eq.{user_id}",
                "limit": MAX_LISTINGS_PER_USER + 1,
            },
            use_service_role=True,
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
        return jsonify({"error": "Failed to verify listing limit"}), 500
    if total >= MAX_LISTINGS_PER_USER:
        return jsonify(
            {
                "error": f"Listing limit reached. You can only post {MAX_LISTINGS_PER_USER} ads.",
                "code": "listing_limit",
                "limit": MAX_LISTINGS_PER_USER,
                "current": total,
            }
        ), 403
    return None


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Add service role key to app config for easy access
app.config["SUPABASE_URL"] = SUPABASE_URL
app.config["SUPABASE_SERVICE_ROLE_KEY"] = SUPABASE_SERVICE_ROLE_KEY

logger.info(f"SUPABASE_URL: {SUPABASE_URL}")
logger.info(f"SUPABASE_KEY exists: {bool(SUPABASE_KEY)}")
logger.info(f"SUPABASE_JWT_SECRET exists: {bool(SUPABASE_JWT_SECRET)}")
logger.info(f"SUPABASE_SERVICE_ROLE_KEY exists: {bool(SUPABASE_SERVICE_ROLE_KEY)}")

BETA_PASSWORD = os.getenv("BETA_PASSWORD")
if BETA_PASSWORD:
    logger.info("✓ BETA_PASSWORD is configured")
else:
    logger.info("ℹ BETA_PASSWORD not configured - beta gate disabled")

# Check Turnstile configuration
TURNSTILE_SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY")


def _verify_turnstile_token(token):
    """Verify Cloudflare Turnstile CAPTCHA token"""
    if not TURNSTILE_SECRET_KEY:
        logger.warning("Turnstile secret key not configured, skipping verification")
        return True  # Allow if not configured (fail open for development)

    if not token:
        logger.warning("Turnstile token missing from request")
        return False

    try:
        response = requests.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={
                "secret": TURNSTILE_SECRET_KEY,
                "response": token,
            },
            timeout=5,
        )
        result = response.json()
        if result.get("success"):
            logger.info("Turnstile verification successful")
            return True
        else:
            logger.warning(
                f"Turnstile verification failed: {result.get('error-codes', [])}"
            )
            return False
    except Exception as e:
        logger.error(f"Turnstile verification error: {str(e)}")
        return False


if TURNSTILE_SECRET_KEY:
    logger.info(
        f"✓ TURNSTILE_SECRET_KEY is configured (length: {len(TURNSTILE_SECRET_KEY)})"
    )
else:
    logger.warning(
        "✗ TURNSTILE_SECRET_KEY is NOT configured - Captcha validation will be skipped!"
    )

# Import and register admin routes
try:
    from routes.admin import admin_bp

    app.register_blueprint(admin_bp)
    logger.info("Admin routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin routes: {e}")


@app.context_processor
def inject_current_year():
    return {"current_year": datetime.datetime.now().year}


# Initialize database tables
def ensure_tables_exist():
    try:
        logger.info("Checking if required tables exist")
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)

        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "X-Postgres-Role": "service_role",
        }

        # Check if users table exists by trying to query it
        users_check = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?limit=1", headers=headers
        )

        if (
            users_check.status_code == 404
            or "does not exist" in users_check.text.lower()
        ):
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
                },
            }

            rpc_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc", json=create_table_query, headers=headers
            )

            if rpc_response.status_code >= 400:
                logger.error(
                    f"Failed to create users table: {rpc_response.status_code} - {rpc_response.text}"
                )
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
        logger.info(
            "Using supabase_request for database operations instead of direct connection"
        )
        return None
    except Exception as e:
        logger.error(f"Error connecting to database: {str(e)}")
        raise e


# Authentication middleware
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        # First try Authorization header
        auth_header = request.headers.get("Authorization")

        # Fallback to cookie
        if not auth_header:
            token = request.cookies.get("access_token")
            if token:
                auth_header = f"Bearer {token}"

        logger.info("Checking authorization header")

        # Check if Authorization header exists and has correct format
        if not auth_header:
            logger.error("No Authorization header present")
            return jsonify({"message": "Authorization header is required"}), 401

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            logger.error("Invalid Authorization header format")
            return jsonify(
                {"message": "Invalid Authorization format. Use: Bearer <token>"}
            ), 401

        token = parts[1]

        try:
            # Validate token with Supabase
            url = f"{SUPABASE_URL}/auth/v1/user"
            headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {token}"}

            logger.info("Validating token with Supabase")
            response = requests.get(url, headers=headers, timeout=10)

            if response.status_code == 401:
                logger.error("Token expired or invalid")
                return jsonify({"message": "Token has expired or is invalid"}), 401
            elif response.status_code != 200:
                logger.error(f"Supabase validation failed: {response.status_code}")
                return jsonify(
                    {"message": "Token validation failed"}
                ), response.status_code

            # Get user data from response
            user_data = response.json()
            if not user_data or "id" not in user_data:
                logger.error("Invalid user data in token")
                return jsonify({"message": "Invalid user data"}), 401

            current_user = user_data["id"]
            logger.info(f"Token validated for user: {current_user}")

            # Add user data to request context
            request.user_id = current_user
            request.user_data = user_data
            request.supabase_token = token

            return f(current_user, *args, **kwargs)

        except requests.exceptions.RequestException as e:
            logger.error(f"Network error during token validation: {str(e)}")
            return jsonify({"message": "Error validating token"}), 503
        except Exception as e:
            logger.error(f"Unexpected error during token validation: {str(e)}")
            return jsonify({"message": "Internal server error"}), 500

    return decorated


@app.route("/api/auth/admin-check", methods=["GET"])
@token_required
def admin_check(current_user):
    """Check if current user is an admin - used by frontend AdminRoute component"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        response = requests.get(
            f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=is_admin",
            headers=headers,
            timeout=10,
        )

        if response.status_code == 200:
            users = response.json()
            if users and len(users) > 0:
                is_admin = users[0].get("is_admin", False)
                return jsonify({"is_admin": is_admin}), 200

        return jsonify({"is_admin": False}), 200
    except Exception as e:
        logger.error(f"Error checking admin status: {str(e)}")
        return jsonify({"is_admin": False}), 200


# Supabase REST API Helper
def supabase_request(
    method, path, data=None, params=None, user_id=None, use_service_role=False
):
    url = f"{SUPABASE_URL}{path}"

    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
    user_token = getattr(request, "supabase_token", None)

    if use_service_role or "admin" in path:
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "X-Client-Info": "backend-api",
            "X-Postgres-Role": "service_role",
        }
    elif user_id and user_token:
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {user_token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "X-Client-Info": "backend-api",
        }
    elif method.lower() in ["post", "put", "patch", "delete"]:
        if user_id:
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
                "X-Client-Info": "backend-api",
            }
        else:
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
                "X-Client-Info": "backend-api",
                "X-Postgres-Role": "service_role",
            }
    else:
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        }

    # Add Row Level Security (RLS) policy for authenticated users
    if user_id:
        headers["X-User-Id"] = user_id

    logger.info(f"Making {method.upper()} request to {url}")
    logger.debug(f"Headers: {_redact_headers(headers)}")
    if params:
        logger.debug(f"Params: {params}")

    try:
        if method.lower() == "get":
            response = requests.get(url, headers=headers, params=params)
        elif method.lower() == "post":
            response = requests.post(url, headers=headers, json=data)
        elif method.lower() == "put":
            response = requests.put(url, headers=headers, json=data)
        elif method.lower() == "patch":
            response = requests.patch(url, headers=headers, json=data)
        elif method.lower() == "delete":
            response = requests.delete(url, headers=headers, params=params)
        else:
            return {"error": "Invalid method"}, 400

        logger.info(f"Response status: {response.status_code}")

        if response.status_code >= 400:
            logger.error(f"Error response: {response.text}")
            return {"error": response.text}, response.status_code

        return response.json(), response.status_code

    except Exception as e:
        logger.error(f"Request error: {str(e)}")
        return {"error": str(e)}, 500


# Home endpoint
@app.route("/")
def home():
    logger.info("Root endpoint accessed")
    return jsonify(
        {
            "message": "Welcome to the Car Classifieds API",
            "status": "online",
            "version": "1.0.0",
        }
    )


# Get all cars (public)
@app.route("/api/cars", methods=["GET"])
def get_cars():
    try:
        # Get query parameters
        limit = request.args.get("limit", "50")
        offset = request.args.get("offset", "0")
        order = request.args.get("order", "created_at.desc")

        # Create parameters for Supabase query, excluding tracking parameters
        params = {
            "select": "*",
            "limit": limit,
            "offset": offset,
            "order": order,
            "status": "eq.approved",  # Only show approved cars on the frontend
            "is_approved": "eq.true",  # Double check with is_approved field
        }

        # Remove any parameters starting with underscore (like _t)
        filtered_params = {k: v for k, v in params.items() if not k.startswith("_")}

        # Define allowed filter fields that exist in the cars table
        allowed_filters = [
            "car_manufacturer",
            "car_model",
            "car_city",
            "make_year_from",
            "make_year_to",
            "price_from",
            "price_to",
            "body_type",
            "fuel_type",
            "transmission_type",
            "regional_spec",
            "kilometer_from",
            "kilometer_to",
            "steering_side",
            "seating_capacity",
            "horsepower",
            "engine_capacity",
        ]

        # Add additional filters from request args that are in the allowed list
        for key, value in request.args.items():
            if (
                not key.startswith("_")
                and key not in ["limit", "offset", "order", "extras"]
                and value
            ):
                if key in allowed_filters:
                    # Validate and normalize numeric filters before sending to Supabase
                    if key in ["price_from", "price_to"]:
                        try:
                            value = str(
                                _to_int(value, key, minimum=0, allow_empty=False)
                            )
                        except ValueError as validation_error:
                            return jsonify(
                                {"error": str(validation_error), "data": []}
                            ), 400
                    if key in ["kilometer_from", "kilometer_to"]:
                        try:
                            value = str(
                                _to_int(value, key, minimum=0, allow_empty=False)
                            )
                        except ValueError as validation_error:
                            return jsonify(
                                {"error": str(validation_error), "data": []}
                            ), 400
                    if key in ["make_year_from", "make_year_to"]:
                        try:
                            value = str(
                                _to_int(
                                    value,
                                    key,
                                    minimum=MIN_ALLOWED_YEAR,
                                    maximum=datetime.datetime.now().year + 1,
                                    allow_empty=False,
                                )
                            )
                        except ValueError as validation_error:
                            return jsonify(
                                {"error": str(validation_error), "data": []}
                            ), 400

                    # Handle range filters
                    if key.endswith("_from"):
                        base_field = key.replace("_from", "")
                        if base_field == "price":
                            filtered_params[f"expected_selling_price"] = f"gte.{value}"
                        elif base_field == "make_year":
                            filtered_params[f"make_year"] = f"gte.{value}"
                        elif base_field == "kilometer":
                            filtered_params[f"kilometer_driven"] = f"gte.{value}"
                    elif key.endswith("_to"):
                        base_field = key.replace("_to", "")
                        if base_field == "price":
                            filtered_params[f"expected_selling_price"] = f"lte.{value}"
                        elif base_field == "make_year":
                            filtered_params[f"make_year"] = f"lte.{value}"
                        elif base_field == "kilometer":
                            filtered_params[f"kilometer_driven"] = f"lte.{value}"
                    else:
                        filtered_params[f"{key}"] = f"eq.{value}"

        # Handle extras filtering - map frontend extras to database boolean columns
        if "extras" in request.args:
            extras_list = request.args.getlist("extras")

            # Mapping from frontend extras to database boolean columns
            extras_mapping = {
                "Keyless Entry": "keyless_entry",
                "DVD Player": "dvd_player",
                "Climate Control": "climate_control",
                "Navigation System": "navigation_system",
                "Premium Sound System": "premium_sound_system",
                "Cooled Seats": "cooled_seats",
                "Front Wheel Drive": "front_wheel_drive",
                "Leather Seats": "leather_seats",
                "Parking Sensors": "parking_sensors",
                "Rear View Camera": "rear_view_camera",
            }

            for extra in extras_list:
                db_field = extras_mapping.get(extra)
                if db_field:
                    filtered_params[db_field] = "eq.true"

        logger.info(f"Fetching cars with params: {filtered_params}")

        response, status_code = supabase_request(
            "get", "/rest/v1/cars", params=filtered_params
        )

        if status_code >= 400:
            logger.error(f"Error response from Supabase: {response}")
            return jsonify(
                {"error": response.get("error", "Unknown error"), "data": []}
            ), status_code

        # Ensure we always return a list, even if response is None or not a list
        if not response:
            response = []
        elif not isinstance(response, list):
            logger.warning(f"Unexpected response format: {type(response)}")
            response = []

        response = _filter_public_listing_records("cars", response)

        # Fetch images for each car
        try:
            for car in response:
                car_id = car.get("id")
                if car_id:
                    images_response, images_status = supabase_request(
                        "get",
                        "/rest/v1/car_images",
                        params={"select": "*", "car_id": f"eq.{car_id}"},
                        use_service_role=True,
                    )

                    if images_status < 400:
                        # Transform url to image_url for frontend compatibility
                        for image in images_response:
                            if "url" in image and "image_url" not in image:
                                image["image_url"] = image["url"]
                        car["images"] = images_response
                    else:
                        car["images"] = []
                else:
                    car["images"] = []
        except Exception as e:
            logger.warning(f"Error fetching car images: {e}")
            # Continue without images if fetching fails
            for car in response:
                if "images" not in car:
                    car["images"] = []

        # Fetch seller info for each car
        try:
            for car in response:
                user_id = car.get("user_id")
                if user_id:
                    user_response, user_status = supabase_request(
                        "get",
                        f"/rest/v1/users?id=eq.{user_id}&select=id,first_name,last_name,email,profile_photo_url,is_dealer",
                        use_service_role=True,
                    )
                    if user_status < 400 and user_response and len(user_response) > 0:
                        user = user_response[0]
                        full_name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
                        car["seller_name"] = full_name or user.get("email", "Unknown")
                        car["seller_id"] = user.get("id")
                        car["seller_profile_photo"] = user.get("profile_photo_url")
                        car["seller_verified"] = user.get("is_dealer", False)
        except Exception as e:
            logger.warning(f"Error fetching seller info: {e}")

        logger.info(f"Successfully fetched {len(response)} cars")
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error getting cars: {str(e)}")
        return jsonify({"error": str(e), "data": []}), 500


# Get car details by ID (public)
@app.route("/api/cars/<string:car_id>", methods=["GET"])
def get_car_by_id(car_id):
    try:
        logger.info(f"Fetching car details for ID: {car_id}")

        # Increment view count (async, don't wait for response)
        try:
            headers = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            }
            current_view_count = 0

            # Get current view count
            view_response = requests.get(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}&select=view_count",
                headers=headers,
                timeout=2,
            )
            if view_response.status_code == 200 and view_response.json():
                current_view_count = view_response.json()[0].get("view_count", 0) or 0

            # Increment view count
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                headers=headers,
                json={"view_count": current_view_count + 1, "last_viewed_at": "now()"},
                timeout=2,
            )
        except Exception as view_error:
            logger.warning(f"Failed to increment view count: {view_error}")

        # Get car details
        query = f"/rest/v1/cars?id=eq.{car_id}&select=*"
        car_response, car_status = supabase_request("get", query)

        if not car_response or len(car_response) == 0:
            logger.warning(f"Car not found with ID: {car_id}")
            return jsonify({"error": "Car not found"}), 404

        car = _sync_listing_lifecycle(
            "cars", car_response[0], hard_delete_archived=True
        )
        if not car or car.get("listing_state") != "active":
            return jsonify({"error": "Car not found"}), 404

        logger.info(
            f"Found car: {car.get('listing_title', 'Untitled')} (ID: {car['id']})"
        )

        # Get car images
        images_query = f"/rest/v1/car_images?car_id=eq.{car_id}&select=*"
        logger.info(f"Fetching images with query: {images_query}")
        images_response, images_status = supabase_request(
            "get", images_query, use_service_role=True
        )

        if images_status < 400:
            logger.info(f"Found {len(images_response)} images for car {car_id}")
            # Transform images for frontend compatibility
            for image in images_response:
                # Ensure both url and image_url fields are present
                if "url" in image and not image.get("image_url"):
                    image["image_url"] = image["url"]
                elif "image_url" in image and not image.get("url"):
                    image["url"] = image["image_url"]

            car["images"] = images_response
        else:
            logger.warning(
                f"Failed to fetch images for car {car_id}: status {images_status}"
            )
            car["images"] = []

        # Fetch seller profile photo
        user_id = car.get("user_id")
        if user_id:
            try:
                user_response, user_status = supabase_request(
                    "get",
                    f"/rest/v1/users?id=eq.{user_id}&select=profile_photo_url",
                    use_service_role=True,
                )
                if user_status < 400 and user_response and len(user_response) > 0:
                    car["seller_profile_photo"] = user_response[0].get(
                        "profile_photo_url"
                    )
            except Exception as user_err:
                logger.warning(f"Failed to fetch seller info: {user_err}")

        logger.info(
            f"Returning car with {len(car['images'])} images (Views: {car.get('view_count', 0)})"
        )
        return jsonify(car), 200
    except Exception as e:
        logger.error(f"Error fetching car details: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


def _increment_listing_view_count(table_name, listing_id):
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table_name}?id=eq.{listing_id}&select=view_count",
            headers=headers,
            timeout=5,
        )
        if response.status_code != 200 or not response.json():
            return False

        current_view_count = response.json()[0].get("view_count", 0) or 0
        update_response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table_name}?id=eq.{listing_id}",
            headers=headers,
            json={"view_count": current_view_count + 1},
            timeout=5,
        )
        return update_response.status_code in [200, 204]
    except Exception as view_error:
        logger.warning(
            f"Failed to increment view count for {table_name}/{listing_id}: {view_error}"
        )
        return False


@app.route("/api/cars/<string:car_id>/view", methods=["POST"])
def track_car_view(car_id):
    if _increment_listing_view_count("cars", car_id):
        return jsonify({"message": "View count updated"}), 200
    return jsonify({"message": "Unable to update view count"}), 400


@app.route("/api/bikes/<string:bike_id>/view", methods=["POST"])
def track_bike_view(bike_id):
    if _increment_listing_view_count("bikes", bike_id):
        return jsonify({"message": "View count updated"}), 200
    return jsonify({"message": "Unable to update view count"}), 400


@app.route("/api/plates/<string:plate_id>/view", methods=["POST"])
def track_plate_view(plate_id):
    if _increment_listing_view_count("license_plates", plate_id):
        return jsonify({"message": "View count updated"}), 200
    return jsonify({"message": "Unable to update view count"}), 400


# Get user's own cars (authenticated)
@app.route("/api/user/cars", methods=["GET"])
@token_required
def get_user_cars(current_user):
    data, status_code = _collect_user_listing_records(current_user, "car")
    if status_code >= 400:
        return jsonify(data), status_code

    for car in data:
        for image in car.get("images", []):
            if "url" in image and "image_url" not in image:
                image["image_url"] = image["url"]

    return jsonify(data), 200


# Create a new car listing (authenticated)
@app.route("/api/cars", methods=["POST"])
@token_required
def create_car(current_user):
    try:
        # Validate input
        if not request.json:
            return jsonify({"error": "Invalid request data"}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        car_data = request.json
        car_data["user_id"] = current_user
        car_data.update(_new_listing_lifecycle_fields())

        try:
            if "make_year" in car_data:
                car_data["make_year"] = _to_int(
                    car_data.get("make_year"),
                    "make_year",
                    minimum=MIN_ALLOWED_YEAR,
                    maximum=datetime.datetime.now().year + 1,
                    allow_empty=False,
                )
            if "kilometer_driven" in car_data:
                car_data["kilometer_driven"] = _to_int(
                    car_data.get("kilometer_driven"), "kilometer_driven", minimum=0
                )
            if "expected_selling_price" in car_data:
                car_data["expected_selling_price"] = _to_int(
                    car_data.get("expected_selling_price"),
                    "expected_selling_price",
                    minimum=0,
                    allow_empty=False,
                )
            if "regional_spec" in car_data:
                car_data["regional_spec"] = _normalize_regional_spec(
                    car_data.get("regional_spec")
                )
            if "transmission_type" in car_data and car_data.get("transmission_type"):
                if car_data["transmission_type"] not in CAR_TRANSMISSION_OPTIONS:
                    return jsonify(
                        {"error": "Transmission must be Automatic or Manual"}
                    ), 400

            _validate_description_word_count(
                car_data.get("car_description"), field_name="car_description"
            )
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Extract and transform extras array to individual boolean fields
        extras = car_data.pop("extras", [])

        # Mapping from extras array values to database boolean columns
        extras_mapping = {
            "Keyless Entry": "keyless_entry",
            "DVD Player": "dvd_player",
            "Climate Control": "climate_control",
            "Navigation System": "navigation_system",
            "Premium Sound System": "premium_sound_system",
            "Cooled Seats": "cooled_seats",
            "Front Wheel Drive": "front_wheel_drive",
            "Leather Seats": "leather_seats",
            "Parking Sensors": "parking_sensors",
            "Rear View Camera": "rear_view_camera",
        }

        # Set all extras boolean fields to False first
        for db_field in extras_mapping.values():
            car_data[db_field] = False

        # Set selected extras to True
        for extra in extras:
            if extra in extras_mapping:
                car_data[extras_mapping[extra]] = True

        # Extract images from the request
        images = car_data.pop("images", [])

        # Whitelist allowed columns for cars to avoid schema cache errors
        # Cars table schema (per cars_schema.sql) - keep only these fields
        allowed_fields = {
            "car_manufacturer",
            "car_model",
            "trim",
            "regional_spec",
            "make_year",
            "kilometer_driven",
            "body_type",
            "is_insured",
            "expected_selling_price",
            "car_owner_phone_number",
            "car_city",
            "listing_title",
            "tour_url",
            "car_description",
            "fuel_type",
            "transmission_type",
            "seating_capacity",
            "horsepower",
            "engine_capacity",
            "steering_side",
            "car_location",
            "vehicle_type",
            "is_approved",
            "user_id",
            "country_code",
            "vin_number",
            "latitude",
            "longitude",
            "is_dealer",
            "keyless_entry",
            "dvd_player",
            "climate_control",
            "navigation_system",
            "premium_sound_system",
            "cooled_seats",
            "front_wheel_drive",
            "leather_seats",
            "parking_sensors",
            "rear_view_camera",
            "expires_at",
            "expired_at",
            "retention_expires_at",
            "last_extended_at",
            "extension_count",
            "is_archived",
        }
        car_data = {k: v for k, v in car_data.items() if k in allowed_fields}

        # Enforce at least one image
        if not images or len(images) == 0:
            return jsonify(
                {"error": "At least one image is required for a car listing."}
            ), 400

        # Create the car
        data, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/cars", car_data, user_id=current_user
        )

        if status_code >= 400:
            return jsonify(data), status_code

        car_id = data[0]["id"]

        # Add images if any
        image_inserts = []
        for image_url in images:
            image_inserts.append(
                {
                    "car_id": car_id,
                    "url": image_url,
                    "image_url": image_url,  # Add image_url field for frontend compatibility
                }
            )
        images_data, images_status = supabase_request(
            "post", "/rest/v1/car_images", data=image_inserts, user_id=current_user
        )
        if images_status < 400:
            data[0]["images"] = images_data
        else:
            logger.error(
                f"Bulk image insert failed for car {car_id}: {images_status} - {images_data}"
            )
            inserted_images = []
            for image_insert in image_inserts:
                img_resp, img_status = supabase_request(
                    "post",
                    "/rest/v1/car_images",
                    data=image_insert,
                    user_id=current_user,
                )
                if img_status < 400 and img_resp:
                    if isinstance(img_resp, list):
                        inserted_images.extend(img_resp)
                    else:
                        inserted_images.append(img_resp)
                else:
                    logger.error(
                        f"Image insert failed for car {car_id}: {img_status} - {img_resp}"
                    )

            if not inserted_images:
                # Roll back the car listing if no images could be saved
                supabase_request(
                    "delete",
                    "/rest/v1/cars",
                    params={"id": f"eq.{car_id}"},
                    user_id=current_user,
                )
                return jsonify(
                    {"error": "Failed to save listing images. Please try again."}
                ), 500

            data[0]["images"] = inserted_images

        return jsonify(data[0]), 201
    except Exception as e:
        logger.error(f"Error creating car listing: {e}")
        return jsonify({"error": str(e)}), 500


# Handle OPTIONS preflight for car update
@app.route("/api/cars/<string:car_id>", methods=["OPTIONS"])
def update_car_options(car_id):
    response = make_response()
    origin = request.headers.get("Origin")
    if origin in _get_cors_origins():
        response.headers.add("Access-Control-Allow-Origin", origin)
        response.headers.add("Access-Control-Allow-Credentials", "true")
    response.headers.add(
        "Access-Control-Allow-Headers", "Content-Type, Authorization, Origin"
    )
    response.headers.add(
        "Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    )
    return response


# Update a car listing (authenticated)
@app.route("/api/cars/<string:car_id>", methods=["PUT"])
@token_required
def update_car(current_user, car_id):
    try:
        logger.info(f"Updating car {car_id} for user {current_user}")

        # Check if this is FormData or JSON
        is_form_data = (
            request.content_type and "multipart/form-data" in request.content_type
        )

        if not is_form_data and not request.json:
            return jsonify({"error": "Invalid request data"}), 400

        # Verify car ownership
        car_data, car_status = supabase_request(
            "get",
            f"/rest/v1/cars",
            params={"select": "user_id", "id": f"eq.{car_id}", "limit": 1},
            user_id=current_user,
        )

        if car_status >= 400:
            return jsonify(car_data), car_status

        if not car_data:
            return jsonify({"error": "Car not found"}), 404

        if car_data[0]["user_id"] != current_user:
            return jsonify(
                {"error": "You do not have permission to update this car"}
            ), 403

        # Extract data based on content type
        if is_form_data:
            logger.info("Processing FormData request")
            update_data = {}

            # Extract form fields
            for key in request.form.keys():
                value = request.form.get(key)
                if key not in ["keep_image_ids"] and value not in [
                    "",
                    "false",
                    "undefined",
                    "null",
                ]:
                    # Convert boolean strings
                    if value == "true":
                        update_data[key] = True
                    elif value == "false":
                        update_data[key] = False
                    # Convert numeric strings
                    elif (
                        key in ["make_year", "mileage", "expected_selling_price"]
                        and value.isdigit()
                    ):
                        update_data[key] = int(value)
                    else:
                        update_data[key] = value

            logger.info(f"Extracted form data: {update_data}")

            # Handle new images
            new_images = (
                request.files.getlist("images") if "images" in request.files else []
            )
            keep_image_ids = request.form.getlist("keep_image_ids")

        else:
            logger.info("Processing JSON request")
            update_data = request.json
            new_images = []
            keep_image_ids = []

        try:
            if "make_year" in update_data:
                update_data["make_year"] = _to_int(
                    update_data.get("make_year"),
                    "make_year",
                    minimum=MIN_ALLOWED_YEAR,
                    maximum=datetime.datetime.now().year + 1,
                    allow_empty=False,
                )
            if "mileage" in update_data and "kilometer_driven" not in update_data:
                update_data["kilometer_driven"] = _to_int(
                    update_data.get("mileage"), "kilometer_driven", minimum=0
                )
            if "kilometer_driven" in update_data:
                update_data["kilometer_driven"] = _to_int(
                    update_data.get("kilometer_driven"), "kilometer_driven", minimum=0
                )
            if "expected_selling_price" in update_data:
                update_data["expected_selling_price"] = _to_int(
                    update_data.get("expected_selling_price"),
                    "expected_selling_price",
                    minimum=0,
                )
            if "regional_spec" in update_data:
                update_data["regional_spec"] = _normalize_regional_spec(
                    update_data.get("regional_spec")
                )
            if "transmission_type" in update_data and update_data.get(
                "transmission_type"
            ):
                if update_data["transmission_type"] not in CAR_TRANSMISSION_OPTIONS:
                    return jsonify(
                        {"error": "Transmission must be Automatic or Manual"}
                    ), 400
            if "car_description" in update_data:
                _validate_description_word_count(
                    update_data.get("car_description"), field_name="car_description"
                )
            if "description" in update_data and "car_description" not in update_data:
                _validate_description_word_count(
                    update_data.get("description"), field_name="car_description"
                )
                update_data["car_description"] = update_data.pop("description")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Whitelist allowed columns (cars schema)
        allowed_fields = {
            "car_manufacturer",
            "car_model",
            "trim",
            "regional_spec",
            "make_year",
            "kilometer_driven",
            "body_type",
            "is_insured",
            "expected_selling_price",
            "car_owner_phone_number",
            "car_city",
            "listing_title",
            "tour_url",
            "car_description",
            "fuel_type",
            "transmission_type",
            "seating_capacity",
            "horsepower",
            "engine_capacity",
            "steering_side",
            "car_location",
            "vehicle_type",
            "is_approved",
            "country_code",
            "vin_number",
            "latitude",
            "longitude",
            "is_dealer",
            "keyless_entry",
            "dvd_player",
            "climate_control",
            "navigation_system",
            "premium_sound_system",
            "cooled_seats",
            "front_wheel_drive",
            "leather_seats",
            "parking_sensors",
            "rear_view_camera",
        }
        update_data = {k: v for k, v in update_data.items() if k in allowed_fields}

        # Update the car
        data, status_code = supabase_request(
            "put",
            f"/rest/v1/cars",
            params={"id": f"eq.{car_id}"},
            data=update_data,
            user_id=current_user,
        )

        if status_code >= 400:
            return jsonify(data), status_code

        # Handle image updates for FormData requests
        if is_form_data and (new_images or keep_image_ids):
            logger.info(
                f"Managing images: keeping {len(keep_image_ids)} existing, uploading {len(new_images)} new"
            )

            # Get all current images
            current_images_resp, current_images_status = supabase_request(
                "get",
                "/rest/v1/car_images",
                params={"select": "*", "car_id": f"eq.{car_id}"},
                user_id=current_user,
            )

            current_images = current_images_resp if current_images_status < 400 else []

            # Delete images not in keep_image_ids
            for img in current_images:
                if img["id"] not in keep_image_ids:
                    logger.info(f"Deleting image {img['id']}")
                    supabase_request(
                        "delete",
                        "/rest/v1/car_images",
                        params={"id": f"eq.{img['id']}"},
                        user_id=current_user,
                    )

            # Upload new images
            if new_images:
                upload_dir = os.path.join(
                    os.path.dirname(__file__), "static", "uploads"
                )
                os.makedirs(upload_dir, exist_ok=True)

                for file in new_images:
                    if file and file.filename:
                        # Generate unique filename
                        filename = secure_filename(file.filename)
                        timestamp = int(time.time())
                        file_extension = os.path.splitext(filename)[1]
                        unique_filename = (
                            f"{timestamp}_{uuid.uuid4().hex[:8]}{file_extension}"
                        )

                        # Save file
                        file_path = os.path.join(upload_dir, unique_filename)
                        file.save(file_path)
                        logger.info(f"Saved new image to {file_path}")

                        # Generate URL
                        image_url = f"/static/uploads/{unique_filename}"

                        # Save to database
                        image_data = {
                            "car_id": car_id,
                            "url": image_url,
                            "image_url": image_url,
                        }

                        supabase_request(
                            "post",
                            "/rest/v1/car_images",
                            data=image_data,
                            user_id=current_user,
                        )

        # Get updated car with images
        updated_car, updated_status = supabase_request(
            "get",
            f"/rest/v1/cars",
            params={"select": "*", "id": f"eq.{car_id}", "limit": 1},
            user_id=current_user,
        )

        if updated_status >= 400 or not updated_car:
            return jsonify({"message": "Car updated successfully"}), 200

        car = updated_car[0]

        # Get car images
        images_data, images_status = supabase_request(
            "get",
            "/rest/v1/car_images",
            params={"select": "*", "car_id": f"eq.{car_id}"},
            user_id=current_user,
        )

        if images_status < 400:
            # Transform url to image_url for frontend compatibility
            for image in images_data:
                if "url" in image and "image_url" not in image:
                    image["image_url"] = image["url"]
            car["images"] = images_data
        else:
            car["images"] = []

        return jsonify(car), 200
    except Exception as e:
        logger.error(f"Error updating car: {e}")
        return jsonify({"error": str(e)}), 500


# Delete a car listing (authenticated)
@app.route("/api/cars/<string:car_id>", methods=["DELETE"])
@token_required
def delete_car(current_user, car_id):
    try:
        # Verify car ownership
        car_data, car_status = supabase_request(
            "get",
            f"/rest/v1/cars",
            params={"select": "user_id", "id": f"eq.{car_id}", "limit": 1},
            user_id=current_user,
        )

        if car_status >= 400:
            return jsonify(car_data), car_status

        if not car_data:
            return jsonify({"error": "Car not found"}), 404

        if car_data[0]["user_id"] != current_user:
            return jsonify(
                {"error": "You do not have permission to delete this car"}
            ), 403

        # Delete car images first
        delete_images, delete_images_status = supabase_request(
            "delete",
            "/rest/v1/car_images",
            params={"car_id": f"eq.{car_id}"},
            user_id=current_user,
        )

        # Delete the car
        delete_car, delete_car_status = supabase_request(
            "delete",
            "/rest/v1/cars",
            params={"id": f"eq.{car_id}"},
            user_id=current_user,
        )

        if delete_car_status >= 400:
            return jsonify(delete_car), delete_car_status

        return jsonify({"message": "Car deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting car: {e}")
        return jsonify({"error": str(e)}), 500


# Upload car images (authenticated)
@app.route("/api/cars/<string:car_id>/images", methods=["POST"])
@token_required
def upload_car_images(current_user, car_id):
    try:
        # Verify the car belongs to the user
        verify_query = f"/rest/v1/cars?id=eq.{car_id}&user_id=eq.{current_user}"
        verify_response, verify_status = supabase_request("get", verify_query)

        if not verify_response or len(verify_response) == 0:
            # Try checking if the car has a null user_id (for demo purposes)
            null_verify_query = f"/rest/v1/cars?id=eq.{car_id}&user_id=is.null"
            null_verify_response, null_verify_status = supabase_request(
                "get", null_verify_query
            )

            if not null_verify_response or len(null_verify_response) == 0:
                return jsonify(
                    {"error": "Car not found or you don't have permission"}
                ), 403

        # Process the images (in a real implementation, you would handle file uploads)
        data = request.json
        image_urls = data.get("image_urls", [])

        # Save each image URL to the database
        for image_url in image_urls:
            image_data = {
                "car_id": car_id,
                "url": image_url,
                "image_url": image_url,  # Add image_url field for frontend compatibility
            }
            supabase_request(
                "post", "/rest/v1/car_images", data=image_data, user_id=current_user
            )

        return jsonify({"message": f"{len(image_urls)} images uploaded successfully"})
    except Exception as e:
        logger.error(f"Error uploading images: {e}")
        return jsonify({"error": str(e)}), 500


def upload_to_supabase_storage(file, bucket_name="listing-images", folder=""):
    """
    Upload a file to Supabase Storage and return the public URL.
    Uses image compression for faster loading.
    """
    try:
        if not file or not file.filename:
            return None, "No file provided"

        allowed_types = {
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/gif",
            "image/webp",
        }
        normalized_mimetype = (file.mimetype or "").lower()
        if normalized_mimetype not in allowed_types:
            return None, "Unsupported image type"

        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        if file_size > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
            return None, f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)"

        # Generate unique filename
        filename = secure_filename(file.filename)
        file_extension = os.path.splitext(filename)[1].lower()
        unique_filename = (
            f"{folder}/{uuid.uuid4().hex}{file_extension}"
            if folder
            else f"{uuid.uuid4().hex}{file_extension}"
        )

        # Read and compress image
        img = Image.open(file)
        img.verify()
        file.seek(0)
        img = Image.open(file)

        # Convert alpha-based images to RGB before saving as JPEG.
        if img.mode == "RGBA":
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background
        elif img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # Resize if too large (max 1920px width)
        max_width = 1920
        if img.width > max_width:
            ratio = max_width / img.width
            new_size = (max_width, int(img.height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        # Save to bytes with compression
        from io import BytesIO

        output = BytesIO()

        # Store listing images as optimized JPEGs except when the source is already WebP.
        if file_extension in [".jpg", ".jpeg", ".png", ".gif"]:
            img.save(output, format="JPEG", quality=85, optimize=True)
            unique_filename = unique_filename.rsplit(".", 1)[0] + ".jpg"
            content_type = "image/jpeg"
        else:
            img.save(output, format=img.format or "JPEG", quality=85)
            content_type = f"image/{img.format.lower()}" if img.format else "image/jpeg"

        output.seek(0)
        file_data = output.read()

        # Upload to Supabase Storage
        upload_url = f"{SUPABASE_URL}/storage/v1/object/{bucket_name}/{unique_filename}"
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": content_type,
        }

        response = requests.post(
            upload_url, headers=headers, data=file_data, timeout=30
        )

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


@app.route("/api/upload-images", methods=["POST"])
@token_required
def upload_images(current_user):
    try:
        logger.info(f"Image upload request received from user: {current_user}")

        # Check if files were uploaded
        if "images" not in request.files:
            logger.error("No images field in request")
            return jsonify({"error": "No images provided"}), 400

        files = request.files.getlist("images")
        if not files or all(file.filename == "" for file in files):
            logger.error("No image files selected")
            return jsonify({"error": "No images selected"}), 400

        logger.info(f"Processing {len(files)} images")
        image_urls = []
        errors = []

        for file in files:
            if file and file.filename:
                # Upload to Supabase Storage
                public_url, error = upload_to_supabase_storage(
                    file, bucket_name="listing-images", folder=current_user
                )

                if public_url:
                    image_urls.append(public_url)
                else:
                    errors.append(f"Failed to upload {file.filename}: {error}")
                    logger.error(f"Failed to upload {file.filename}: {error}")

        if not image_urls and errors:
            return jsonify(
                {"error": "All image uploads failed", "details": errors}
            ), 500

        logger.info(
            f"Successfully uploaded {len(image_urls)} images to Supabase Storage"
        )

        return jsonify(
            {
                "urls": image_urls,
                "absolute_urls": image_urls,  # Already absolute URLs from Supabase
                "count": len(image_urls),
                "errors": errors if errors else None,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error in upload_images: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


# Serve uploaded files
@app.route("/static/uploads/<filename>")
def uploaded_file(filename):
    """Serve uploaded files from the uploads directory."""
    try:
        upload_dir = os.path.join(os.path.dirname(__file__), "static", "uploads")
        return send_from_directory(upload_dir, filename)
    except Exception as e:
        logger.error(f"Error serving uploaded file {filename}: {e}")
        abort(404)


# Get privacy policy
@app.route("/api/privacy-policy", methods=["GET"])
def get_privacy_policy():
    try:
        query = "/rest/v1/privacy_policies?select=*&order=created_at.desc&limit=1"
        response, response_status = supabase_request("get", query)

        if not response or len(response) == 0:
            return jsonify({"privacy_policy": "Privacy policy not found"}), 404

        return jsonify(response[0])
    except Exception as e:
        logger.error(f"Error fetching privacy policy: {e}")
        return jsonify({"error": str(e)}), 500


# Get advertisements
@app.route("/api/advertisements", methods=["GET"])
def get_advertisements():
    try:
        query = "/rest/v1/advertisements?select=*&order=created_at.desc&limit=1"
        response, response_status = supabase_request("get", query)

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
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=10,
    )

    if response.status_code >= 400:
        return None, response.text
    return response.json(), None


def _format_auth_email_error(error_data, fallback_message):
    description = ""
    details = error_data

    if isinstance(error_data, dict):
        description = (
            error_data.get("error_description")
            or error_data.get("msg")
            or error_data.get("message")
            or ""
        )
    elif isinstance(error_data, str):
        description = error_data
        details = {"raw": error_data}

    lower_description = description.lower()
    guidance = None
    message = description or fallback_message

    if "email address not authorized" in lower_description:
        message = (
            "Authentication email delivery is not enabled for public recipients yet."
        )
        guidance = (
            "Configure custom SMTP or a Supabase Send Email Hook for Auth. "
            "The default Supabase sender only delivers to authorized project-team addresses."
        )
    elif "rate limit" in lower_description or "too many requests" in lower_description:
        message = "Too many authentication emails have been requested right now."
        guidance = (
            "Wait a few minutes before retrying, or increase the Supabase Auth email "
            "rate limit after you configure production email delivery."
        )
    elif "smtp" in lower_description or "mailer" in lower_description:
        message = "Authentication email delivery is not configured correctly."
        guidance = (
            "Check Supabase Auth SMTP settings or replace the built-in sender with "
            "a Send Email Hook for production delivery."
        )

    return {
        "message": message,
        "guidance": guidance,
        "details": details,
    }


def _build_listing_title(item_type, listing):
    if not listing:
        return "your listing"
    if item_type == "cars":
        return (
            listing.get("listing_title")
            or " ".join(
                part
                for part in [
                    str(listing.get("make_year", "")).strip(),
                    str(listing.get("car_manufacturer", "")).strip(),
                    str(listing.get("car_model", "")).strip(),
                ]
                if part
            )
            or "your car listing"
        )
    if item_type == "bikes":
        return (
            listing.get("title")
            or " ".join(
                part
                for part in [
                    str(listing.get("make_year", "")).strip(),
                    str(listing.get("make", "")).strip(),
                    str(listing.get("model", "")).strip(),
                ]
                if part
            )
            or "your bike listing"
        )
    if item_type == "plates":
        return (
            " ".join(
                part
                for part in [
                    str(listing.get("city", "")).strip(),
                    str(listing.get("code", "")).strip(),
                    str(listing.get("number", "")).strip(),
                ]
                if part
            )
            or "your plate listing"
        )
    if item_type == "parts":
        return (
            listing.get("name")
            or listing.get("part_name")
            or listing.get("title")
            or "your car part listing"
        )
    return "your listing"


def _build_listing_url(item_type, item_id, request_origin=None):
    base_url = _get_safe_frontend_origin(request_origin).rstrip("/")
    path_map = {
        "cars": "/cars",
        "bikes": "/bikes",
        "plates": "/plates",
        "parts": "/car-parts",
    }
    path = path_map.get(item_type)
    if not path:
        return None
    return f"{base_url}{path}/{item_id}"


def _send_listing_status_email(
    user_email, item_type, listing, status, request_origin=None
):
    if not user_email:
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    item_label_map = {
        "cars": "car",
        "bikes": "bike",
        "plates": "plate",
        "parts": "car part",
    }
    item_label = item_label_map.get(item_type, "listing")
    listing_title = _build_listing_title(item_type, listing)
    listing_url = _build_listing_url(
        item_type, listing.get("id") if listing else None, request_origin
    )

    subject = f"Your {item_label} listing has been {status}"
    lines = [
        f"Hi there,",
        "",
        f"Your {item_label} listing has been {status}.",
        f"Listing: {listing_title}",
    ]
    if listing_url:
        lines.append(f"View listing: {listing_url}")
    lines.extend(["", "Thanks,", "DPH Classifieds"])

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "text": "\n".join(lines),
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload)


def _send_dealer_status_email(
    user_email, status, request_origin=None, rejection_note=None
):
    if not user_email:
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    base_url = _get_safe_frontend_origin(request_origin).rstrip("/")
    profile_url = f"{base_url}/profile"

    subject = f"Your dealer verification has been {status}"
    lines = ["Hi there,", "", f"Your dealer verification request has been {status}."]
    if rejection_note and status == "rejected":
        lines.append(f"Reason: {rejection_note}")
    lines.extend(
        [f"Manage your account: {profile_url}", "", "Thanks,", "DPH Classifieds"]
    )

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "text": "\n".join(lines),
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload)


@app.route("/api/contact", methods=["POST"])
def send_contact_message():
    try:
        data = request.json or {}
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip()
        subject = (data.get("subject") or "").strip()
        message = (data.get("message") or "").strip()

        if not name or not email or not subject or not message:
            return jsonify({"error": "Missing required fields"}), 400

        if not EMAIL_REGEX.match(email):
            return jsonify({"error": "Invalid email address"}), 400

        if len(name) > 100 or len(subject) > 200 or len(message) > 5000:
            return jsonify({"error": "Message is too long"}), 400

        client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
        if _contact_rate_limited(client_ip):
            return jsonify({"error": "Too many requests. Please try again later."}), 429

        from_email = os.getenv("RESEND_FROM_EMAIL")
        to_email = os.getenv("RESEND_TO_EMAIL")
        if not from_email or not to_email:
            return jsonify({"error": "Email service is not configured"}), 500

        payload = {
            "from": from_email,
            "to": [to_email],
            "subject": f"[Contact] {subject}",
            "reply_to": email,
            "text": f"From: {name} <{email}>\nSubject: {subject}\n\n{message}",
        }

        result, error = _send_resend_email(payload)
        if error:
            logger.error(f"Resend email failed: {error}")
            return jsonify({"error": "Failed to send message"}), 502

        return jsonify({"message": "Message sent successfully"}), 200
    except Exception as e:
        logger.error(f"Error sending contact message: {str(e)}")
        return jsonify({"error": "Failed to send message"}), 500


# Get license plates
@app.route("/api/license-plates", methods=["GET"])
def get_license_plates():
    try:
        # Optional query parameters
        city = request.args.get("city")
        code = request.args.get("code")
        digits = request.args.get("digits")

        # Build query
        query = "/rest/v1/license_plates?select=*"

        # Add filters if provided
        if city and city != "All cities":
            query += f"&city=eq.{city}"
        if code and code != "All codes":
            query += f"&code=eq.{code}"
        if digits and digits != "Any digits":
            query += f"&digits=eq.{digits}"

        response, response_status = supabase_request("get", query)
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error fetching license plates: {e}")
        return jsonify({"error": str(e)}), 500


# Add a test endpoint that returns static data
@app.route("/api/test", methods=["GET"])
def test_data():
    logger.info("Test endpoint accessed")
    sample_data = [
        {
            "id": "1",
            "car_manufacturer": "Toyota",
            "car_model": "Camry",
            "make_year": 2020,
            "expected_selling_price": 25000,
            "listing_title": "2020 Toyota Camry LE",
        },
        {
            "id": "2",
            "car_manufacturer": "Honda",
            "car_model": "Civic",
            "make_year": 2019,
            "expected_selling_price": 22000,
            "listing_title": "2019 Honda Civic Sport",
        },
        {
            "id": "3",
            "car_manufacturer": "Ford",
            "car_model": "Mustang",
            "make_year": 2021,
            "expected_selling_price": 35000,
            "listing_title": "2021 Ford Mustang GT",
        },
    ]
    return jsonify(sample_data)


# User profile routes
@app.route("/api/user/profile", methods=["GET"])
@token_required
def get_user_profile(current_user):
    """Get complete user profile from users table"""
    logger.info(f"=" * 50)
    logger.info(f"GET USER PROFILE REQUEST")
    logger.info(f"User ID: {current_user}")

    try:
        # Fetch user data from the users table (not auth table)
        # This is where profile updates are stored
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get user from users table
        url = (
            f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=*"
        )

        logger.info(f"Fetching user profile from users table: {url}")
        response = requests.get(url, headers=headers, timeout=10)

        logger.info(f"Profile fetch response status: {response.status_code}")

        if response.status_code == 200:
            users = response.json()

            if users and len(users) > 0:
                user_data = users[0]
                logger.info(
                    f"✓ Successfully retrieved profile for: {user_data.get('email')}"
                )
                logger.info(f"Profile fields: {list(user_data.keys())}")
                logger.info(f"=" * 50)

                # Remove sensitive data
                sensitive_fields = ["password", "encrypted_password"]
                for field in sensitive_fields:
                    if field in user_data:
                        del user_data[field]

                return jsonify(user_data), 200
            else:
                logger.error(f"✗ No user found with ID: {current_user}")
                logger.info(f"=" * 50)
                return jsonify({"message": "User not found"}), 404
        else:
            logger.error(f"✗ Failed to get user profile: {response.status_code}")
            logger.error(f"Response: {response.text}")
            logger.info(f"=" * 50)
            return jsonify(
                {"message": "Failed to get user profile"}
            ), response.status_code

    except Exception as e:
        logger.error(f"✗ Exception in get_user_profile: {str(e)}", exc_info=True)
        logger.info(f"=" * 50)
        return jsonify({"error": str(e)}), 500


# Profile management routes
@app.route("/api/user/update-profile", methods=["PUT"])
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
            return jsonify({"message": "No data provided"}), 400

        # Map frontend field names to database field names
        field_mapping = {
            "email": "email",
            "firstName": "first_name",
            "lastName": "last_name",
            "username": "username",
            "displayName": "display_name",
            "phone": "phone",
            "countryCode": "country_code",
            "whatsappNumber": "whatsapp_number",
            "area": "area",
            "city": "area",  # Support legacy city field
            "emirate": "emirate",
            "country": "country",
            "postalCode": "postal_code",
            "address": "address",
            "bio": "bio",
            "companyName": "company_name",
            "companyRegistrationNumber": "company_registration_number",
            "tradeLicenseNumber": "trade_license_number",
            "taxRegistrationNumber": "tax_registration_number",
            "websiteUrl": "website_url",
            "facebookUrl": "facebook_url",
            "instagramUrl": "instagram_url",
            "twitterUrl": "twitter_url",
            "emailNotifications": "email_notifications",
            "smsNotifications": "sms_notifications",
            "marketingEmails": "marketing_emails",
            "profilePhotoUrl": "profile_photo_url",
        }

        # Prepare update data - only include fields that are provided and not empty
        update_payload = {}
        for frontend_field, db_field in field_mapping.items():
            if frontend_field in data:
                value = data[frontend_field]
                # Include the value if it's not an empty string, or if it's a required field
                if (
                    value or value is False or value == 0
                ):  # Include False and 0 but not empty strings
                    update_payload[db_field] = value

        if not update_payload:
            logger.warning("No valid fields to update")
            return jsonify({"message": "No valid fields to update"}), 400

        logger.info(f"Update payload: {json.dumps(update_payload, indent=2)}")

        # First, verify the user exists
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        # Check if user exists
        check_url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=id,email"
        check_response = requests.get(check_url, headers=headers, timeout=10)

        if check_response.status_code != 200 or not check_response.json():
            logger.error(f"User not found: {current_user}")
            return jsonify({"message": "User not found"}), 404

        logger.info(f"User exists, proceeding with update")

        # Update using the REST API with eq filter
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}"

        logger.info(f"Sending PATCH request to: {url}")
        logger.info(
            f"Headers: {json.dumps({k: v for k, v in headers.items() if k != 'Authorization'}, indent=2)}"
        )

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
                    logger.info(
                        f"✓ Profile updated successfully for: {updated_user.get('email')}"
                    )
                    logger.info(f"Updated fields: {list(update_payload.keys())}")
                    logger.info(f"=" * 50)

                    return jsonify(
                        {
                            "message": "Profile updated successfully",
                            "user": updated_user,
                            "updated_fields": list(update_payload.keys()),
                        }
                    ), 200
                else:
                    logger.error("No users returned after update")
                    return jsonify(
                        {"message": "Update succeeded but could not fetch user data"}
                    ), 500
            else:
                logger.error(
                    f"Failed to fetch updated user: {get_response.status_code}"
                )
                return jsonify(
                    {"message": "Update succeeded but could not fetch user data"}
                ), 500
        else:
            logger.error(f"✗ Failed to update profile: {response.status_code}")
            logger.error(f"Response: {response.text}")
            logger.info(f"=" * 50)

            error_data = {}
            try:
                error_data = response.json()
            except:
                error_data = {"detail": response.text}

            return jsonify(
                {
                    "message": "Failed to update profile",
                    "error": error_data,
                    "status": response.status_code,
                }
            ), response.status_code

    except Exception as e:
        logger.error(f"✗ Exception in update_user_profile: {str(e)}", exc_info=True)
        logger.info(f"=" * 50)
        return jsonify(
            {"error": str(e), "message": "Internal server error during profile update"}
        ), 500


@app.route("/api/user/upload-profile-photo", methods=["POST"])
@token_required
def upload_profile_photo(current_user):
    """Upload profile photo to Supabase Storage"""
    try:
        logger.info(f"Uploading profile photo for user ID: {current_user}")

        if "profile_photo" not in request.files:
            return jsonify({"message": "No file provided"}), 400

        file = request.files["profile_photo"]
        if file.filename == "":
            return jsonify({"message": "No file selected"}), 400

        public_url, upload_error = upload_to_supabase_storage(
            file, bucket_name="profile-photos", folder=str(current_user)
        )

        if upload_error:
            logger.error(f"Failed to upload profile photo: {upload_error}")
            status_code = (
                400
                if "type" in upload_error.lower() or "large" in upload_error.lower()
                else 500
            )
            return jsonify({"message": upload_error}), status_code

        logger.info(f"Profile photo uploaded successfully: {public_url}")
        return jsonify(
            {"message": "Photo uploaded successfully", "profile_photo_url": public_url}
        ), 200

    except Exception as e:
        logger.error(f"Error in upload_profile_photo: {str(e)}", exc_info=True)
        return jsonify(
            {"error": str(e), "message": "Failed to upload profile photo"}
        ), 500


@app.route("/api/user/statistics", methods=["GET"])
@token_required
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

        # Count cars
        cars_response = requests.get(
            f"{base_url}/rest/v1/cars?user_id=eq.{current_user}&select=id,status,view_count",
            headers=headers,
        )

        # Count bikes
        bikes_response = requests.get(
            f"{base_url}/rest/v1/bikes?user_id=eq.{current_user}&select=id,status,view_count",
            headers=headers,
        )

        # Count plates
        plates_response = requests.get(
            f"{base_url}/rest/v1/license_plates?user_id=eq.{current_user}&select=id,status,view_count",
            headers=headers,
        )

        # Count parts
        parts_response = requests.get(
            f"{base_url}/rest/v1/car_parts?user_id=eq.{current_user}&select=id,status",
            headers=headers,
        )

        # Process results
        cars = cars_response.json() if cars_response.status_code == 200 else []
        bikes = bikes_response.json() if bikes_response.status_code == 200 else []
        plates = plates_response.json() if plates_response.status_code == 200 else []
        parts = parts_response.json() if parts_response.status_code == 200 else []

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

        statistics = {
            "total_listings": total_listings,
            "active_listings": active_listings,
            "sold_listings": 0,  # Placeholder for future feature
            "pending_listings": pending_listings,
            "total_views": total_views,
            "member_since": member_since,
        }

        logger.debug(f"Statistics calculated for user: {statistics}")
        return jsonify(statistics), 200

    except Exception as e:
        logger.error(f"Error in get_user_statistics: {str(e)}")
        return jsonify({"error": str(e)}), 500


def find_user_email_by_username(username):
    """Find user's email by username for login"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Search for user by username
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?username=eq.{username}&select=email"
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            users = response.json()
            if users and len(users) > 0:
                return users[0].get("email")

        return None
    except Exception as e:
        logger.error(f"Error finding user by username: {str(e)}")
        return None


def user_exists_by_email(email):
    """Check whether a user exists for the provided email."""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?email=eq.{email}&select=id&limit=1"
        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code != 200:
            logger.warning(
                f"Unable to verify email existence for login: {response.status_code}"
            )
            return False

        users = response.json()
        return bool(users)
    except Exception as e:
        logger.error(f"Error finding user by email: {str(e)}")
        return False


# User authentication routes
@app.route("/api/auth/login", methods=["POST"])
def login():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if _auth_rate_limited(client_ip):
        logger.warning(f"[Login] Rate limit exceeded for IP: {client_ip}")
        return jsonify(
            {"message": "Too many login attempts. Please try again later."}
        ), 429

    data = request.json
    identifier = data.get("email", "")  # This can now be either email or username
    logger.info(f"[Login] Attempt for identifier: {identifier}")

    if not data or not identifier or not data.get("password"):
        logger.warning("[Login] Missing email/username or password in request.")
        return jsonify({"message": "Missing email/username or password"}), 400

    # Verify Turnstile CAPTCHA token
    turnstile_token = data.get("turnstileToken")
    if not _verify_turnstile_token(turnstile_token):
        return jsonify(
            {"message": "CAPTCHA verification failed. Please try again."}
        ), 400

    password = data.get("password")

    # Determine if the identifier is an email or username
    email = identifier
    is_username_login = "@" not in identifier
    email_exists = False
    if "@" not in identifier:
        # It's a username, find the corresponding email
        logger.info(f"[Login] Identifier appears to be username: {identifier}")
        email = find_user_email_by_username(identifier)
        if not email:
            logger.warning(f"[Login] No user found with username: {identifier}")
            return jsonify(
                {"message": "Invalid email or password. Please try again."}
            ), 401
        logger.info(f"[Login] Found email for username {identifier}: {email}")
        email_exists = True
    else:
        logger.info(f"[Login] Identifier appears to be email: {identifier}")
        email_exists = user_exists_by_email(email)
        if not email_exists:
            return jsonify(
                {"message": "Invalid email or password. Please try again."}
            ), 401

    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    payload = {"email": email, "password": password}

    try:
        logger.info(f"[Login] Sending login request to Supabase auth: {url}")
        response = requests.post(url, headers=headers, json=payload)

        logger.info(f"[Login] Supabase auth response status: {response.status_code}")
        if response.status_code == 200:
            resp_data = response.json()
            supabase_user_info = resp_data.get("user")
            token = resp_data.get("access_token")
            logger.info(
                f"[Login] Supabase auth successful. Token received. Supabase user info: {supabase_user_info}"
            )

            if supabase_user_info and token:
                user_id = supabase_user_info.get("id")
                logger.info(f"[Login] Extracted user_id from Supabase auth: {user_id}")

                user_details_for_session = _get_user_details_with_admin_status(user_id)
                logger.info(
                    f"[Login] Details from _get_user_details_with_admin_status: {user_details_for_session}"
                )

                if user_details_for_session:
                    resp_data["user"] = user_details_for_session

                    is_admin_flag = user_details_for_session.get("is_admin")
                    logger.info(
                        f"[Login] Checking 'is_admin' flag from user_details_for_session: {is_admin_flag} (Type: {type(is_admin_flag)})"
                    )

                    if is_admin_flag is True:
                        session["is_admin"] = True
                        session["admin_user_id"] = user_details_for_session.get("id")
                        logger.info(
                            f"[Login] !!! Admin session SET for user {user_details_for_session.get('id')}. Session data: {dict(session)}"
                        )
                    else:
                        session.pop("is_admin", None)
                        session.pop("admin_user_id", None)
                        logger.info(
                            f"[Login] Not an admin or is_admin flag is not True. User: {user_details_for_session.get('id')}. is_admin value: '{is_admin_flag}'. Session data: {dict(session)}"
                        )
                else:
                    logger.warning(
                        f"[Login] Could not fetch full user details for user ID {user_id} from _get_user_details_with_admin_status. Session not fully set."
                    )
                    resp_data["user"] = supabase_user_info

            # Set HttpOnly cookies for token storage
            response = make_response(jsonify(resp_data), 200)
            secure = os.getenv("FLASK_ENV") == "production"
            response.set_cookie(
                "access_token",
                token,
                httponly=True,
                secure=secure,
                samesite="Lax",
                max_age=3600 * 24 * 7,  # 7 days
            )
            refresh_token = resp_data.get("refresh_token")
            if refresh_token:
                response.set_cookie(
                    "refresh_token",
                    refresh_token,
                    httponly=True,
                    secure=secure,
                    samesite="Lax",
                    max_age=3600 * 24 * 30,  # 30 days
                )
            return response
        else:
            error_data = response.json()
            error_msg = error_data.get("error_description", "Login failed")
            logger.error(
                f"[Login] Supabase auth failed: {error_msg}. Response: {error_data}"
            )
            lowered = str(error_msg).lower()
            if (
                "invalid login credentials" in lowered
                or "invalid credentials" in lowered
            ):
                return jsonify(
                    {"message": "Invalid email or password. Please try again."}
                ), 401
            return jsonify(
                {"message": f"{error_msg}. If needed, use Forgot Password."}
            ), response.status_code

    except Exception as e:
        logger.error(f"[Login] Exception during login: {str(e)}", exc_info=True)
        return jsonify({"message": "An error occurred during login"}), 500


def _get_password_policy_errors(password):
    errors = []
    if not password:
        return ["Password is required"]

    if len(password) < 8:
        errors.append("Password must be at least 8 characters long")
    if not re.search(r"[0-9]", password):
        errors.append("Password must include a number")
    if not re.search(r"[^a-zA-Z0-9]", password):
        errors.append("Password must include a symbol")

    return errors


@app.route("/api/auth/signup", methods=["POST"])
def signup():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if _auth_rate_limited(client_ip):
        logger.warning(f"[Signup] Rate limit exceeded for IP: {client_ip}")
        return jsonify(
            {"message": "Too many signup attempts. Please try again later."}
        ), 429

    data = request.json
    if not data or not data.get("email") or not data.get("password"):
        return jsonify({"message": "Missing email or password"}), 400

    # Verify Turnstile CAPTCHA token
    turnstile_token = data.get("turnstileToken")
    if not _verify_turnstile_token(turnstile_token):
        return jsonify(
            {"message": "CAPTCHA verification failed. Please try again."}
        ), 400

    email = data.get("email")
    password = data.get("password")
    password_errors = _get_password_policy_errors(password)
    if password_errors:
        return jsonify(
            {
                "message": "Password does not meet requirements",
                "details": password_errors,
            }
        ), 400

    # Extract additional user metadata
    user_metadata = {
        "first_name": data.get("firstName", ""),
        "last_name": data.get("lastName", ""),
        "username": data.get("username", ""),
        "phone": data.get("phone", ""),
        "country_code": data.get("countryCode", "+971"),
        "city": data.get("city", ""),
        "emirate": data.get("emirate", ""),
        "is_dealer": data.get("isDealer", False),
        "company_name": data.get("companyName", ""),
        "company_registration_number": data.get("companyRegistrationNumber", ""),
        "display_name": data.get("displayName", ""),
        "email_notifications": data.get("emailNotifications", True),
        "sms_notifications": data.get("smsNotifications", True),
        "marketing_emails": data.get("marketingEmails", False),
    }

    # Remove empty strings so unique constraints (e.g., username) are not violated by blank values
    cleaned_metadata = {}
    for key, value in user_metadata.items():
        if isinstance(value, str) and value.strip() == "":
            continue
        cleaned_metadata[key] = value

    # Sign up with Supabase
    redirect_to = _get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirectTo") if data else None,
        fallback_path="/auth/callback",
    )
    url = f"{SUPABASE_URL}/auth/v1/signup?redirect_to={quote(redirect_to)}"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    payload = {
        "email": email,
        "password": password,
        "data": cleaned_metadata,  # This will be stored in raw_user_meta_data
        "redirect_to": redirect_to,
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
            return jsonify(
                {"message": "Signup failed", "details": response.text}
            ), response.status_code

        logger.error(f"Signup failed: {error_data}")
        normalized_error = _format_auth_email_error(error_data, "Signup failed")
        return jsonify(normalized_error), response.status_code

    except Exception as e:
        logger.error(f"Signup error: {str(e)}")
        return jsonify({"message": "An error occurred during signup"}), 500


@app.route("/api/auth/logout", methods=["POST"])
@token_required
def logout(current_user):
    response = make_response(jsonify({"message": "Successfully logged out"}), 200)
    response.set_cookie("access_token", "", expires=0)
    response.set_cookie("refresh_token", "", expires=0)
    return response


def get_user_admin_status(user_id):
    try:
        # Get user data from Supabase
        user_data, status_code = supabase_request(
            "get", f"/rest/v1/users?id=eq.{user_id}", user_id=user_id
        )

        if status_code >= 400 or not user_data:
            return False

        return user_data[0].get("is_admin", False)
    except Exception as e:
        logger.error(f"Error getting user admin status: {str(e)}")
        return False


def _get_user_details_with_admin_status(user_id_from_token):
    logger.info(
        f"[_get_user_details_with_admin_status] Called for user_id: {user_id_from_token}"
    )
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "X-Postgres-Role": "service_role",
    }
    logger.debug(
        f"[_get_user_details_with_admin_status] Using headers for Supabase requests: {_redact_headers(headers)}"
    )

    auth_email = None
    auth_user_data = None
    try:
        auth_response = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id_from_token}",
            headers=headers,
            timeout=10,  # Increased timeout slightly
        )
        logger.info(
            f"[_get_user_details_with_admin_status] Auth system response status: {auth_response.status_code}"
        )  # New Log
        if auth_response.status_code == 200:
            auth_user_data = auth_response.json()
            auth_email = auth_user_data.get("email")
            logger.info(
                f"[_get_user_details_with_admin_status] Found user in auth system. Email: {auth_email}, Data: {auth_user_data}"
            )
        else:
            logger.warning(
                f"[_get_user_details_with_admin_status] Could not get user from auth system: {auth_response.status_code} - {auth_response.text}"
            )
    except requests.exceptions.RequestException as e_auth:
        logger.error(
            f"[_get_user_details_with_admin_status] Error checking auth system: {e_auth}"
        )

    db_user_data = None
    is_admin_in_db = False
    try:
        rest_url_users = f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id_from_token}"
        logger.info(
            f"[_get_user_details_with_admin_status] Querying public.users table with URL: {rest_url_users}"
        )  # New Log
        users_response = requests.get(
            rest_url_users,
            headers=headers,
            timeout=10,  # Increased timeout slightly
        )
        logger.info(
            f"[_get_user_details_with_admin_status] public.users response status: {users_response.status_code}"
        )  # New Log
        logger.info(
            f"[_get_user_details_with_admin_status] public.users response text: {users_response.text}"
        )  # New Log

        parsed_json = None
        if users_response.status_code == 200:
            try:
                parsed_json = users_response.json()
                logger.info(
                    f"[_get_user_details_with_admin_status] public.users parsed_json: {parsed_json}"
                )  # New Log
            except requests.exceptions.JSONDecodeError as json_err:
                logger.error(
                    f"[_get_user_details_with_admin_status] Failed to parse JSON from public.users response: {json_err}"
                )

        if (
            users_response.status_code == 200 and parsed_json
        ):  # Check parsed_json directly
            db_user_data = parsed_json[0]  # Assumes non-empty list
            is_admin_in_db = db_user_data.get("is_admin", False)
            # Prefer email from users table if exists and auth_email was not retrieved
            if not auth_email and db_user_data.get("email"):
                auth_email = db_user_data.get("email")
            logger.info(
                f"[_get_user_details_with_admin_status] Found user in public.users table. Email: {db_user_data.get('email')}, Admin: {is_admin_in_db}, DB Data: {db_user_data}"
            )
        elif not auth_email:  # Only enter if auth_email is still None (i.e. auth lookup failed AND public.users lookup failed or was empty)
            logger.warning(
                f"[_get_user_details_with_admin_status] User {user_id_from_token} not found or empty in public.users (parsed_json: {parsed_json}) AND no email from auth system (auth_email: {auth_email})."
            )
            return None
        else:  # User not in public.users or parsed_json was empty, but we have auth_email from the auth system lookup
            logger.info(
                f"[_get_user_details_with_admin_status] User {user_id_from_token} not found or empty in public.users (parsed_json: {parsed_json}), but auth_email ({auth_email}) exists from auth system. Will attempt to create entry in public.users."
            )

    except requests.exceptions.RequestException as e_db:
        logger.error(
            f"[_get_user_details_with_admin_status] Error checking public.users table: {e_db}"
        )

    # ... (rest of the function for creating user if not db_user_data and auth_email, and for returning final details)
    # Ensure is_admin_in_db is correctly used for the final result if db_user_data was populated.
    # This part of the logic might need adjustment based on the above changes.

    if not db_user_data and auth_email:
        logger.info(
            f"[_get_user_details_with_admin_status] User {user_id_from_token} (Email: {auth_email}) was not in public.users. Creating entry."
        )
        try:
            create_payload = {
                "id": user_id_from_token,
                "email": auth_email,
                "is_admin": False,
            }
            logger.info(
                f"[_get_user_details_with_admin_status] Create payload for public.users: {create_payload}"
            )
            create_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/users",
                json=create_payload,
                headers=headers,
                timeout=5,
            )
            if create_response.status_code == 201 or create_response.status_code == 200:
                db_user_data_created = (
                    create_response.json()[0]
                    if create_response.json()
                    else create_payload
                )
                is_admin_in_db = db_user_data_created.get(
                    "is_admin", False
                )  # This will be False as per payload
                logger.info(
                    f"[_get_user_details_with_admin_status] Created user {user_id_from_token} in public.users table. Admin: {is_admin_in_db}, DB Data: {db_user_data_created}"
                )
                # Update db_user_data to use the newly created data for the final return object
                db_user_data = db_user_data_created
            else:
                logger.warning(
                    f"[_get_user_details_with_admin_status] Failed to create user {user_id_from_token} in public.users table: {create_response.status_code} - {create_response.text}"
                )
        except requests.exceptions.RequestException as e_create:
            logger.error(
                f"[_get_user_details_with_admin_status] Error creating user in public.users table: {e_create}"
            )

    final_email_to_use = None
    if db_user_data and db_user_data.get("email"):
        final_email_to_use = db_user_data.get("email")
    elif auth_email:  # Fallback to email from auth.users if not in db_user_data or db_user_data has no email
        final_email_to_use = auth_email

    if not final_email_to_use:
        logger.error(
            f"[_get_user_details_with_admin_status] Could not determine final email for user {user_id_from_token}. auth_email: {auth_email}, db_user_data: {db_user_data}"
        )
        return None

    # Determine final is_admin status primarily from db_user_data if it exists
    final_is_admin = False
    if db_user_data:
        final_is_admin = db_user_data.get("is_admin", False)
    # No else needed, defaults to False if db_user_data is None

    final_created_at = None
    if db_user_data and db_user_data.get("created_at"):
        final_created_at = db_user_data.get("created_at")
    elif auth_user_data and auth_user_data.get("created_at"):
        final_created_at = auth_user_data.get("created_at")

    email_verified = False
    phone_verified = False
    if db_user_data:
        email_verified = bool(db_user_data.get("email_verified", False))
        phone_verified = bool(db_user_data.get("phone_verified", False))

    auth_email_confirmed = None
    auth_phone_confirmed = None
    if auth_user_data:
        if isinstance(auth_user_data.get("user"), dict):
            auth_email_confirmed = auth_user_data["user"].get("email_confirmed_at")
            auth_phone_confirmed = auth_user_data["user"].get("phone_confirmed_at")
        else:
            auth_email_confirmed = auth_user_data.get("email_confirmed_at")
            auth_phone_confirmed = auth_user_data.get("phone_confirmed_at")

    email_verified = email_verified or bool(auth_email_confirmed)
    phone_verified = phone_verified or bool(auth_phone_confirmed)

    final_user_details = {}
    if db_user_data:
        final_user_details.update(db_user_data)

    final_user_details.update(
        {
            "id": user_id_from_token,
            "email": final_email_to_use,
            "is_admin": final_is_admin,
            "created_at": final_created_at,
            "is_dealer": bool(db_user_data.get("is_dealer", False))
            if db_user_data
            else False,
            "dealer_verified": bool(db_user_data.get("dealer_verified", False))
            if db_user_data
            else False,
            "email_verified": email_verified,
            "phone_verified": phone_verified,
        }
    )
    logger.info(
        f"[_get_user_details_with_admin_status] Returning final details: {final_user_details}"
    )
    return final_user_details


@app.route("/api/auth/me", methods=["GET"])
@token_required
def get_user_info(current_user):  # current_user is user_id from @token_required
    user_details = _get_user_details_with_admin_status(current_user)
    if user_details:
        return jsonify(user_details), 200
    else:
        return jsonify(
            {"error": "Failed to retrieve user details or user not found"}
        ), 404


@app.route("/api/auth/refresh", methods=["POST"])
def refresh_token():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if _auth_rate_limited(client_ip):
        logger.warning(f"[Refresh Token] Rate limit exceeded for IP: {client_ip}")
        return jsonify(
            {"message": "Too many refresh attempts. Please try again later."}
        ), 429

    # Extract refresh token from request
    data = request.json
    if not data or not data.get("refresh_token"):
        return jsonify({"message": "Missing refresh token"}), 400

    refresh_token = data.get("refresh_token")

    # Call Supabase refresh token endpoint
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    payload = {"refresh_token": refresh_token}

    try:
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 200:
            return jsonify(response.json()), 200
        else:
            error_data = response.json()
            return jsonify(
                {"message": error_data.get("error_description", "Token refresh failed")}
            ), response.status_code

    except Exception as e:
        logger.error(f"Token refresh error: {str(e)}")
        return jsonify({"message": "An error occurred during token refresh"}), 500


@app.route("/api/auth/reset-password", methods=["POST"])
def reset_password():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if _auth_rate_limited(client_ip):
        logger.warning(f"[Reset Password] Rate limit exceeded for IP: {client_ip}")
        return jsonify(
            {"message": "Too many password reset attempts. Please try again later."}
        ), 429

    data = request.json
    if not data or not data.get("email"):
        return jsonify({"message": "Missing email"}), 400

    email = data.get("email")

    # Request password reset from Supabase
    url = f"{SUPABASE_URL}/auth/v1/recover"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    redirect_to = _get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirectTo") if data else None,
        fallback_path="/reset-password",
    )
    payload = {"email": email, "redirect_to": redirect_to}

    try:
        response = requests.post(url, headers=headers, json=payload)

        if response.status_code == 200:
            return jsonify({"message": "Password reset email sent successfully"}), 200
        else:
            error_data = response.json()
            normalized_error = _format_auth_email_error(
                error_data, "Failed to send password reset email"
            )
            return jsonify(normalized_error), response.status_code

    except Exception as e:
        logger.error(f"Password reset error: {str(e)}")
        return jsonify({"message": "An error occurred during password reset"}), 500


@app.route("/api/auth/resend-confirmation", methods=["POST"])
def resend_confirmation():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if _auth_rate_limited(client_ip):
        logger.warning(f"[Resend Confirmation] Rate limit exceeded for IP: {client_ip}")
        return jsonify(
            {"message": "Too many confirmation email attempts. Please try again later."}
        ), 429

    data = request.json
    if not data or not data.get("email"):
        return jsonify({"message": "Missing email"}), 400

    email = data.get("email")
    redirect_to = _get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirectTo") if data else None,
        fallback_path="/auth/callback",
    )

    url = f"{SUPABASE_URL}/auth/v1/resend"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    payload = {"type": "signup", "email": email, "redirect_to": redirect_to}

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)

        if response.status_code == 200:
            return jsonify({"message": "Confirmation email resent successfully"}), 200

        try:
            error_data = response.json()
        except Exception:
            return jsonify(
                {
                    "message": "Failed to resend confirmation email",
                    "details": response.text,
                }
            ), response.status_code

        normalized_error = _format_auth_email_error(
            error_data, "Failed to resend confirmation email"
        )
        return jsonify(normalized_error), response.status_code
    except Exception as e:
        logger.error(f"Resend confirmation error: {str(e)}")
        return jsonify(
            {"message": "An error occurred while resending confirmation email"}
        ), 500


@app.route("/api/auth/update-password", methods=["POST"])
def update_password():
    data = request.json
    if not data or not data.get("password"):
        return jsonify({"message": "Missing password"}), 400

    password = data.get("password")
    password_errors = _get_password_policy_errors(password)
    if password_errors:
        return jsonify(
            {
                "message": "Password does not meet requirements",
                "details": password_errors,
            }
        ), 400
    access_token = data.get("access_token")
    hash_token = data.get("hash")

    if not access_token and hash_token:
        try:
            parsed = parse_qs(hash_token, keep_blank_values=True)
            access_token = (parsed.get("access_token") or [None])[0]
        except Exception as parse_err:
            logger.error(f"Failed to parse reset hash: {parse_err}")

    if not access_token:
        return jsonify({"message": "Missing or invalid reset token"}), 400

    # Update password with Supabase
    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    payload = {"password": password}

    try:
        response = requests.put(url, headers=headers, json=payload)

        if response.status_code == 200:
            return jsonify({"message": "Password updated successfully"}), 200
        else:
            error_data = response.json()
            return jsonify(
                {
                    "message": error_data.get(
                        "error_description", "Failed to update password"
                    )
                }
            ), response.status_code

    except Exception as e:
        logger.error(f"Password update error: {str(e)}")
        return jsonify({"message": "An error occurred during password update"}), 500


# Bike Endpoints (Similar to Car Endpoints)
def _normalize_bike_record(bike):
    """Normalize bike payload keys for frontend compatibility."""
    if not isinstance(bike, dict):
        return bike

    bike["make"] = bike.get("make") or bike.get("bike_brand")
    bike["model"] = bike.get("model") or bike.get("bike_model")
    bike["year"] = bike.get("year") or bike.get("make_year")
    bike["bike_type"] = bike.get("bike_type") or bike.get("bike_category")
    bike["engine_size"] = bike.get("engine_size") or bike.get("engine_capacity")
    bike["price"] = (
        bike.get("price")
        if bike.get("price") is not None
        else bike.get("expected_selling_price")
    )
    bike["mileage"] = (
        bike.get("mileage")
        if bike.get("mileage") is not None
        else bike.get("kilometer_driven")
    )
    return bike


def _enrich_listing_seller(item, headers=None):
    """Attach consistent seller metadata to listing payloads."""
    if not isinstance(item, dict):
        return item

    user_id = item.get("user_id")
    if not user_id:
        return item

    try:
        user = None
        user_fields = "id,first_name,last_name,email,profile_photo_url,is_dealer"

        if headers:
            user_url = (
                f"{app.config['SUPABASE_URL']}/rest/v1/users"
                f"?id=eq.{user_id}&select={user_fields}"
            )
            user_response = requests.get(user_url, headers=headers, timeout=5)
            if user_response.status_code == 200 and user_response.json():
                user = user_response.json()[0]
        else:
            user_response, user_status = supabase_request(
                "get",
                f"/rest/v1/users?id=eq.{user_id}&select={user_fields}",
                use_service_role=True,
            )
            if user_status < 400 and user_response:
                user = user_response[0]

        if user:
            full_name = (
                f"{user.get('first_name', '')} {user.get('last_name', '')}".strip()
            )
            item["seller_name"] = full_name or user.get("email", "Marketplace Seller")
            item["seller_id"] = user.get("id")
            item["seller_profile_photo"] = user.get("profile_photo_url")
            item["seller_verified"] = bool(user.get("is_dealer", False))
    except Exception as seller_err:
        logger.warning(
            f"Failed to enrich seller for listing {item.get('id')}: {seller_err}"
        )

    return item


@app.route("/api/bikes", methods=["GET"])
def get_bikes():
    try:
        # Get query parameters
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
        order = request.args.get("order", "created_at")

        # Construct parameters for Supabase query
        params = {
            "limit": limit,
            "offset": offset,
            "order": order,
            "status": "eq.approved",  # Only show approved bikes
            "is_approved": "eq.true",  # Ensure consistency
        }

        # Filter out any underscore parameters
        params = {k: v for k, v in params.items() if not k.startswith("_")}

        logger.info(f"Fetching bikes with params: {params}")

        try:
            # Use direct request with service role key for admin operations
            service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
            headers = {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
            }

            # Construct query string
            query_params = []
            for key, value in params.items():
                if key == "order":
                    query_params.append(f"order={value}")
                else:
                    query_params.append(f"{key}={value}")

            query_string = "&".join(query_params)
            url = f"{app.config['SUPABASE_URL']}/rest/v1/bikes?{query_string}"

            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)

            if response.status_code == 200:
                bikes = response.json()

                bikes = _filter_public_listing_records("bikes", bikes)

                # Fetch images for each bike
                for bike in bikes:
                    _normalize_bike_record(bike)
                    bike_id = bike["id"]
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/bike_images?bike_id=eq.{bike_id}"
                    image_response = requests.get(image_url, headers=headers)

                    if image_response.status_code == 200:
                        images = image_response.json()
                        normalized_images = []
                        for img in images:
                            image_url = img.get("image_url") or img.get("url")
                            if image_url:
                                normalized_images.append(
                                    {
                                        "id": img.get("id"),
                                        "image_url": image_url,
                                        "url": image_url,
                                    }
                                )
                        bike["images"] = normalized_images
                    else:
                        bike["images"] = []

                    _enrich_listing_seller(bike, headers=headers)

                return jsonify(bikes)
            else:
                logger.error(
                    f"Direct request failed: {response.status_code} - {response.text}"
                )
                # Fallback to regular method
                raise Exception("Direct request failed")

        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request(
                "get", "/rest/v1/bikes", params=params
            )
            if status_code < 400 and response:
                response = _filter_public_listing_records("bikes", response)
                # Fetch images for each bike in fallback
                for bike in response:
                    _normalize_bike_record(bike)
                    bike_id = bike["id"]
                    images_response, images_status = supabase_request(
                        "get",
                        "/rest/v1/bike_images",
                        params={"select": "*", "bike_id": f"eq.{bike_id}"},
                    )
                    if images_status < 400 and images_response:
                        for image in images_response:
                            if "url" in image and not image.get("image_url"):
                                image["image_url"] = image["url"]
                            if "image_url" in image and not image.get("url"):
                                image["url"] = image["image_url"]
                        bike["images"] = images_response
                    else:
                        bike["images"] = []

                    _enrich_listing_seller(bike)
                return jsonify(response)
            else:
                return jsonify([])

    except Exception as e:
        logger.error(f"Error fetching bikes: {str(e)}")
        return jsonify([]), 500


@app.route("/api/bikes/<string:bike_id>", methods=["GET"])
def get_bike_by_id(bike_id):
    try:
        logger.info(f"Fetching bike details for ID: {bike_id}")

        # Get bike details
        query = f"/rest/v1/bikes?id=eq.{bike_id}&select=*"
        bike_response, bike_status = supabase_request("get", query)

        if not bike_response or len(bike_response) == 0:
            logger.warning(f"Bike not found with ID: {bike_id}")
            return jsonify({"error": "Bike not found"}), 404

        bike = _sync_listing_lifecycle(
            "bikes", bike_response[0], hard_delete_archived=True
        )
        if not bike or bike.get("listing_state") != "active":
            return jsonify({"error": "Bike not found"}), 404
        _normalize_bike_record(bike)
        logger.info(
            f"Found bike: {bike.get('make')} {bike.get('model')} (ID: {bike['id']})"
        )

        # Get bike images
        images_query = f"/rest/v1/bike_images?bike_id=eq.{bike_id}&select=*"
        logger.info(f"Fetching images with query: {images_query}")
        images_response, images_status = supabase_request("get", images_query)

        if images_status < 400:
            logger.info(f"Found {len(images_response)} images for bike {bike_id}")
            # Transform images for frontend compatibility
            for image in images_response:
                logger.info(f"Processing image: {image}")
                # Ensure both url and image_url fields are present
                if "url" in image and not image.get("image_url"):
                    image["image_url"] = image["url"]
                    logger.info(f"Added image_url from url: {image['url']}")
                elif "image_url" in image and not image.get("url"):
                    image["url"] = image["image_url"]
                    logger.info(f"Added url from image_url: {image['image_url']}")
                # If neither field exists, create a placeholder
                elif not image.get("url") and not image.get("image_url"):
                    logger.warning(
                        f"Image {image.get('id', 'unknown')} has no URL fields"
                    )

            bike["images"] = images_response
            logger.info(f"Processed images: {bike['images']}")
        else:
            logger.warning(
                f"Failed to fetch images for bike {bike_id}: status {images_status}"
            )
            bike["images"] = []

        # Fetch seller profile photo
        user_id = bike.get("user_id")
        if user_id:
            try:
                user_response, user_status = supabase_request(
                    "get",
                    f"/rest/v1/users?id=eq.{user_id}&select=profile_photo_url",
                    use_service_role=True,
                )
                if user_status < 400 and user_response and len(user_response) > 0:
                    bike["seller_profile_photo"] = user_response[0].get(
                        "profile_photo_url"
                    )
            except Exception as user_err:
                logger.warning(f"Failed to fetch seller info: {user_err}")

        logger.info(f"Returning bike with {len(bike['images'])} images")
        return jsonify(bike), 200
    except Exception as e:
        logger.error(f"Error fetching bike details: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/user/bikes", methods=["GET"])
@token_required
def get_user_bikes(current_user):
    data, status_code = _collect_user_listing_records(current_user, "bike")
    if status_code >= 400:
        return jsonify(data), status_code

    for bike in data:
        _normalize_bike_record(bike)

    return jsonify(data), 200


@app.route("/api/user/plates", methods=["GET"])
@token_required
def get_user_plates(current_user):
    data, status_code = _collect_user_listing_records(current_user, "plate")
    if status_code >= 400:
        return jsonify(data), status_code
    return jsonify(data), 200


@app.route("/api/user/parts", methods=["GET"])
@token_required
def get_user_parts(current_user):
    data, status_code = _collect_user_listing_records(current_user, "part")
    if status_code >= 400:
        return jsonify(data), status_code
    return jsonify(data), 200


@app.route("/api/user/listings", methods=["GET"])
@token_required
def get_all_user_listings(current_user):
    categories = {}
    flattened = []

    for item_type in ["car", "bike", "part", "plate"]:
        category_items, status_code = _collect_user_listing_records(
            current_user, item_type
        )
        if status_code >= 400:
            return jsonify(category_items), status_code

        for item in category_items:
            item["listing_type"] = item_type
        categories[f"{item_type}s" if item_type != "part" else "parts"] = category_items
        flattened.extend(category_items)

    flattened.sort(
        key=lambda item: _parse_datetime(item.get("created_at")) or _utc_now(),
        reverse=True,
    )

    return jsonify({"listings": flattened, **categories}), 200


@app.route("/api/user/listings/<item_type>/<item_id>/extend", methods=["POST"])
@token_required
def extend_user_listing(current_user, item_type, item_id):
    config = LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return jsonify({"error": "Invalid listing type"}), 400

    listing_data, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"select": "*", "id": f"eq.{item_id}", "limit": 1},
        user_id=current_user,
    )

    if listing_status >= 400:
        return jsonify(listing_data), listing_status

    if not listing_data:
        return jsonify({"error": "Listing not found"}), 404

    listing = listing_data[0]
    if listing.get("user_id") != current_user:
        return jsonify(
            {"error": "You do not have permission to extend this listing"}
        ), 403

    listing = _sync_listing_lifecycle(
        config["table"], listing, hard_delete_archived=False
    )
    if not listing:
        return jsonify({"error": "Listing is no longer available"}), 410

    if listing.get("is_archived"):
        _delete_listing_with_assets(config["table"], item_id)
        return jsonify(
            {"error": "Listing has already passed its retention period"}
        ), 410

    if listing.get("status") in {"deleted", "rejected"}:
        return jsonify({"error": "This listing cannot be extended"}), 400

    now = _utc_now()
    expiry_anchor = _parse_datetime(listing.get("expires_at")) or now
    if expiry_anchor < now:
        expiry_anchor = now

    new_expires_at = expiry_anchor + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
    new_retention_expires_at = new_expires_at + datetime.timedelta(
        days=LISTING_RETENTION_DAYS
    )
    updates = {
        "expires_at": _isoformat_utc(new_expires_at),
        "expired_at": None,
        "retention_expires_at": _isoformat_utc(new_retention_expires_at),
        "last_extended_at": _isoformat_utc(now),
        "extension_count": int(listing.get("extension_count") or 0) + 1,
        "is_archived": False,
    }

    update_response, update_status = supabase_request(
        "patch",
        f"/rest/v1/{config['table']}?id=eq.{item_id}",
        data=updates,
        user_id=current_user,
    )

    if update_status >= 400:
        return jsonify(update_response), update_status

    refreshed_items, refreshed_status = _collect_user_listing_records(
        current_user, item_type
    )
    if refreshed_status >= 400:
        return jsonify({"message": "Listing extended successfully"}), 200

    refreshed_listing = next(
        (item for item in refreshed_items if str(item.get("id")) == str(item_id)), None
    )
    return jsonify(
        {
            "message": "Listing extended successfully",
            "listing": refreshed_listing,
        }
    ), 200


@app.route("/api/bikes", methods=["POST"])
@token_required
def create_bike(current_user):
    try:
        # Validate input
        if not request.json:
            return jsonify({"error": "Invalid request data"}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        bike_data = request.json
        bike_data["user_id"] = current_user
        bike_data["status"] = "pending"  # Set status as pending for admin approval
        bike_data.update(_new_listing_lifecycle_fields())

        try:
            if "year" in bike_data:
                bike_data["year"] = _to_int(
                    bike_data.get("year"),
                    "year",
                    minimum=MIN_ALLOWED_YEAR,
                    maximum=datetime.datetime.now().year + 1,
                    allow_empty=False,
                )
            if "price" in bike_data:
                bike_data["price"] = _to_int(
                    bike_data.get("price"), "price", minimum=0, allow_empty=False
                )
            if "mileage" in bike_data:
                bike_data["mileage"] = _to_int(
                    bike_data.get("mileage"), "mileage", minimum=0
                )
            if (
                "engine_capacity" in bike_data
                and str(bike_data.get("engine_capacity", "")).strip()
            ):
                raw_engine = str(bike_data.get("engine_capacity"))
                engine_numeric_match = re.search(r"\d+", raw_engine)
                if engine_numeric_match:
                    engine_capacity = int(engine_numeric_match.group())
                    if engine_capacity < 0:
                        raise ValueError("engine_capacity must be non-negative")
            _validate_description_word_count(
                bike_data.get("description"), field_name="description"
            )
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Extract images from the request
        images = bike_data.pop("images", [])
        if not images:
            return jsonify(
                {"error": "At least one image is required for a bike listing."}
            ), 400

        # Whitelist allowed fields for bikes
        bike_allowed_fields = {
            "bike_brand",
            "bike_model",
            "bike_type",
            "year",
            "mileage",
            "engine_size",
            "color",
            "price",
            "location",
            "contact_number",
            "description",
            "transmission",
            "fuel_type",
            "features",
            "cylinders",
            "wheels",
            "status",
            "user_id",
            "is_dealer",
            "expires_at",
            "expired_at",
            "retention_expires_at",
            "last_extended_at",
            "extension_count",
            "is_archived",
        }
        bike_data = {k: v for k, v in bike_data.items() if k in bike_allowed_fields}

        # Create the bike
        data, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/bikes", bike_data, user_id=current_user
        )

        if status_code >= 400:
            return jsonify(data), status_code

        bike_id = data[0]["id"]

        # Add images if any
        if images:
            image_inserts = []
            for image_url in images:
                image_inserts.append(
                    {
                        "bike_id": bike_id,
                        "url": image_url,
                        "image_url": image_url,  # Add image_url field for frontend compatibility
                    }
                )

            images_data, images_status = supabase_request(
                "post", "/rest/v1/bike_images", data=image_inserts, user_id=current_user
            )

            if images_status < 400:
                data[0]["images"] = images_data
            else:
                data[0]["images"] = []

        return jsonify(data[0]), 201
    except Exception as e:
        logger.error(f"Error creating bike listing: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bikes/<string:bike_id>", methods=["PUT"])
@token_required
def update_bike(current_user, bike_id):
    try:
        # Validate input
        if not request.json:
            return jsonify({"error": "Invalid request data"}), 400

        # Verify bike ownership
        bike_data, bike_status = supabase_request(
            "get",
            f"/rest/v1/bikes",
            params={"select": "user_id", "id": f"eq.{bike_id}", "limit": 1},
            user_id=current_user,
        )

        if bike_status >= 400:
            return jsonify(bike_data), bike_status

        if not bike_data:
            return jsonify({"error": "Bike not found"}), 404

        if bike_data[0]["user_id"] != current_user:
            return jsonify(
                {"error": "You do not have permission to update this bike"}
            ), 403

        update_data = request.json
        images = update_data.pop("images", None)

        try:
            if "year" in update_data:
                update_data["year"] = _to_int(
                    update_data.get("year"),
                    "year",
                    minimum=MIN_ALLOWED_YEAR,
                    maximum=datetime.datetime.now().year + 1,
                    allow_empty=False,
                )
            if "price" in update_data:
                update_data["price"] = _to_int(
                    update_data.get("price"), "price", minimum=0
                )
            if "mileage" in update_data:
                update_data["mileage"] = _to_int(
                    update_data.get("mileage"), "mileage", minimum=0
                )
            if "description" in update_data:
                _validate_description_word_count(
                    update_data.get("description"), field_name="description"
                )
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Whitelist allowed fields for bikes
        bike_allowed_fields = {
            "bike_brand",
            "bike_model",
            "bike_type",
            "year",
            "mileage",
            "engine_size",
            "color",
            "price",
            "location",
            "contact_number",
            "description",
            "transmission",
            "fuel_type",
            "features",
            "cylinders",
            "wheels",
            "status",
            "user_id",
            "is_dealer",
        }
        update_data = {k: v for k, v in update_data.items() if k in bike_allowed_fields}

        # Update the bike
        data, status_code = supabase_request(
            "put",
            f"/rest/v1/bikes",
            params={"id": f"eq.{bike_id}"},
            data=update_data,
            user_id=current_user,
        )

        if status_code >= 400:
            return jsonify(data), status_code

        # Update images if provided
        if images is not None:
            # First, delete all existing images
            delete_resp, delete_status = supabase_request(
                "delete",
                "/rest/v1/bike_images",
                params={"bike_id": f"eq.{bike_id}"},
                user_id=current_user,
            )

            # Add new images
            if images:
                image_inserts = []
                for image_url in images:
                    image_inserts.append(
                        {
                            "bike_id": bike_id,
                            "url": image_url,
                            "image_url": image_url,  # Add image_url field for frontend compatibility
                        }
                    )

                images_data, images_status = supabase_request(
                    "post",
                    "/rest/v1/bike_images",
                    data=image_inserts,
                    user_id=current_user,
                )

        # Get updated bike with images
        updated_bike, updated_status = supabase_request(
            "get",
            f"/rest/v1/bikes",
            params={"select": "*", "id": f"eq.{bike_id}", "limit": 1},
            user_id=current_user,
        )

        if updated_status >= 400 or not updated_bike:
            return jsonify({"message": "Bike updated successfully"}), 200

        bike = updated_bike[0]

        # Get bike images
        images_data, images_status = supabase_request(
            "get",
            "/rest/v1/bike_images",
            params={"select": "*", "bike_id": f"eq.{bike_id}"},
            user_id=current_user,
        )

        if images_status < 400:
            bike["images"] = images_data
        else:
            bike["images"] = []

        return jsonify(bike), 200
    except Exception as e:
        logger.error(f"Error updating bike: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bikes/<string:bike_id>", methods=["DELETE"])
@token_required
def delete_bike(current_user, bike_id):
    try:
        # Verify bike ownership
        bike_data, bike_status = supabase_request(
            "get",
            f"/rest/v1/bikes",
            params={"select": "user_id", "id": f"eq.{bike_id}", "limit": 1},
            user_id=current_user,
        )

        if bike_status >= 400:
            return jsonify(bike_data), bike_status

        if not bike_data:
            return jsonify({"error": "Bike not found"}), 404

        if bike_data[0]["user_id"] != current_user:
            return jsonify(
                {"error": "You do not have permission to delete this bike"}
            ), 403

        # Delete bike images first
        delete_images, delete_images_status = supabase_request(
            "delete",
            "/rest/v1/bike_images",
            params={"bike_id": f"eq.{bike_id}"},
            user_id=current_user,
        )

        # Delete the bike
        delete_resp, delete_status = supabase_request(
            "delete",
            "/rest/v1/bikes",
            params={"id": f"eq.{bike_id}"},
            user_id=current_user,
        )

        if delete_status >= 400:
            return jsonify(delete_resp), delete_status

        return jsonify({"message": "Bike listing deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting bike: {e}")
        return jsonify({"error": str(e)}), 500


# License Plate Endpoints
@app.route("/api/plates", methods=["GET"])
def get_plates():
    try:
        # Get query parameters
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))

        logger.info(f"Fetching plates with limit: {limit}, offset: {offset}")

        # Use direct request with service role key
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Build query - only get approved plates
        url = f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?status=eq.approved&order=created_at.desc&limit={limit}&offset={offset}&select=*"

        logger.info(f"Fetching plates from: {url}")
        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code == 200:
            plates = response.json()
            plates = _filter_public_listing_records("license_plates", plates)
            logger.info(f"Found {len(plates)} plates")

            # Fetch images for each plate
            for plate in plates:
                plate_id = plate.get("id")
                if plate_id:
                    try:
                        image_url = f"{app.config['SUPABASE_URL']}/rest/v1/plate_images?plate_id=eq.{plate_id}&select=*"
                        image_response = requests.get(
                            image_url, headers=headers, timeout=5
                        )

                        if image_response.status_code == 200:
                            images = image_response.json()
                            plate["images"] = [
                                {
                                    "id": img.get("id"),
                                    "url": img.get("url") or img.get("image_url"),
                                    "image_url": img.get("image_url") or img.get("url"),
                                }
                                for img in images
                                if img.get("url") or img.get("image_url")
                            ]
                        else:
                            plate["images"] = []
                    except Exception as img_error:
                        logger.error(
                            f"Error fetching images for plate {plate_id}: {str(img_error)}"
                        )
                        plate["images"] = []
                else:
                    plate["images"] = []

                _enrich_listing_seller(plate, headers=headers)

            return jsonify(plates), 200
        else:
            logger.error(
                f"Failed to fetch plates: {response.status_code} - {response.text}"
            )
            return jsonify([]), 200  # Return empty array instead of error

    except Exception as e:
        logger.error(f"Error fetching plates: {str(e)}", exc_info=True)
        return jsonify(
            []
        ), 200  # Return empty array instead of error to prevent frontend crash


@app.route("/api/plates/<plate_id>", methods=["GET"])
def get_plate_details(plate_id):
    """Get details for a specific plate by ID"""
    try:
        logger.info(f"Fetching plate details for ID: {plate_id}")

        try:
            # Use direct request with service role key
            service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
            headers = {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
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

                plate = _sync_listing_lifecycle(
                    "license_plates", plates[0], hard_delete_archived=True
                )
                if not plate or plate.get("listing_state") != "active":
                    return jsonify({"error": "Plate not found"}), 404
                logger.info(
                    f"Found plate: {plate.get('city')} {plate.get('code')} {plate.get('number')}"
                )

                # Fetch images for this plate
                try:
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/plate_images?plate_id=eq.{plate['id']}&select=*"
                    image_response = requests.get(image_url, headers=headers)

                    if image_response.status_code == 200:
                        images = image_response.json()
                        plate["images"] = images
                        logger.info(f"Found {len(images)} images for plate")
                    else:
                        plate["images"] = []
                        logger.warning(f"No images found for plate {plate_id}")
                except Exception as img_err:
                    logger.error(
                        f"Error fetching images for plate {plate['id']}: {img_err}"
                    )
                    plate["images"] = []

                # Fetch seller profile photo
                user_id = plate.get("user_id")
                if user_id:
                    try:
                        user_url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{user_id}&select=profile_photo_url"
                        user_response = requests.get(user_url, headers=headers)
                        if user_response.status_code == 200 and user_response.json():
                            plate["seller_profile_photo"] = user_response.json()[0].get(
                                "profile_photo_url"
                            )
                    except Exception as user_err:
                        logger.warning(f"Failed to fetch seller info: {user_err}")

                return jsonify(plate), 200
            else:
                logger.error(
                    f"Error fetching plate details: {response.status_code} - {response.text}"
                )
                return jsonify({"error": "Failed to fetch plate details"}), 500

        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request(
                "get",
                "/rest/v1/license_plates",
                params={"id": f"eq.{plate_id}", "select": "*"},
            )
            if status_code < 400 and response and len(response) > 0:
                plate = _sync_listing_lifecycle(
                    "license_plates", response[0], hard_delete_archived=True
                )
                if not plate or plate.get("listing_state") != "active":
                    return jsonify({"error": "Plate not found"}), 404

                # Fetch images for this plate in fallback
                images_response, images_status = supabase_request(
                    "get",
                    "/rest/v1/plate_images",
                    params={"select": "*", "plate_id": f"eq.{plate_id}"},
                )
                if images_status < 400 and images_response:
                    plate["images"] = images_response
                else:
                    plate["images"] = []

                return jsonify(plate), 200
            else:
                return jsonify({"error": "Plate not found"}), 404

    except Exception as e:
        logger.error(f"Error in get_plate_details: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/plates/<plate_id>", methods=["DELETE"])
@token_required
def delete_plate(current_user, plate_id):
    try:
        delete_response, delete_status = _delete_user_owned_listing(
            current_user, "plate", plate_id
        )
        if delete_status >= 400:
            return jsonify(delete_response), delete_status
        return jsonify({"message": "Plate listing deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting plate {plate_id}: {e}")
        return jsonify({"error": str(e)}), 500


# Car Parts Endpoints
@app.route("/api/parts", methods=["GET"])
def get_parts():
    try:
        # Get query parameters
        limit = int(request.args.get("limit", 50))
        offset = int(request.args.get("offset", 0))
        order = request.args.get("order", "created_at")

        # Construct parameters for Supabase query
        params = {
            "limit": limit,
            "offset": offset,
            "order": order,
            "status": "eq.approved",  # Only show approved parts
            "is_approved": "eq.true",  # Ensure consistency
        }

        # Filter out any underscore parameters
        params = {k: v for k, v in params.items() if not k.startswith("_")}

        logger.info(f"Fetching parts with params: {params}")

        try:
            # Use direct request with service role key for admin operations
            service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
            headers = {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
            }

            # Construct query string
            query_params = []
            for key, value in params.items():
                if key == "order":
                    query_params.append(f"order={value}")
                else:
                    query_params.append(f"{key}={value}")

            query_string = "&".join(query_params)
            url = f"{app.config['SUPABASE_URL']}/rest/v1/car_parts?{query_string}"

            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)

            if response.status_code == 200:
                parts = response.json()
                parts = _filter_public_listing_records("car_parts", parts)

                # Fetch images for each part
                for part in parts:
                    part_id = part["id"]
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/part_images?part_id=eq.{part_id}"
                    image_response = requests.get(image_url, headers=headers)

                    if image_response.status_code == 200:
                        images = image_response.json()
                        part["images"] = [
                            {
                                "id": img.get("id"),
                                "url": img.get("url") or img.get("image_url"),
                                "image_url": img.get("image_url") or img.get("url"),
                            }
                            for img in images
                            if img.get("url") or img.get("image_url")
                        ]
                    else:
                        part["images"] = []

                    _enrich_listing_seller(part, headers=headers)

                return jsonify(parts)
            else:
                logger.error(
                    f"Direct request failed: {response.status_code} - {response.text}"
                )
                # Fallback to regular method
                raise Exception("Direct request failed")

        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request(
                "get", "/rest/v1/car_parts", params=params
            )
            if status_code < 400 and response:
                response = _filter_public_listing_records("car_parts", response)
                # Fetch images for each part in fallback
                for part in response:
                    part_id = part["id"]
                    images_response, images_status = supabase_request(
                        "get",
                        "/rest/v1/part_images",
                        params={"select": "*", "part_id": f"eq.{part_id}"},
                    )
                    if images_status < 400 and images_response:
                        part["images"] = images_response
                    else:
                        part["images"] = []

                    _enrich_listing_seller(part)
                return jsonify(response)
            else:
                return jsonify([])

    except Exception as e:
        logger.error(f"Error fetching parts: {str(e)}")
        return jsonify({"error": str(e)}), 500


# Create a new car parts listing (authenticated)
@app.route("/api/parts", methods=["POST"])
@token_required
def create_part(current_user):
    try:
        logger.info("Creating new car part listing")

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        # Check if this is FormData or JSON
        is_form_data = (
            request.content_type and "multipart/form-data" in request.content_type
        )

        if is_form_data:
            # Handle FormData (with file uploads)
            part_data = {}

            # Get form fields
            for key, value in request.form.items():
                if key.startswith("image_"):
                    continue  # Skip image fields, handle separately
                elif key == "compatible_makes" or key == "compatible_models":
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
                if key.startswith("image_") and file and file.filename:
                    # Save the uploaded file
                    filename = secure_filename(file.filename)
                    timestamp = int(time.time())
                    random_suffix = secrets.token_hex(4)
                    file_extension = (
                        filename.rsplit(".", 1)[1].lower() if "." in filename else "jpg"
                    )
                    unique_filename = f"{timestamp}_{random_suffix}.{file_extension}"
                    file_path = os.path.join(
                        app.config["UPLOAD_FOLDER"], unique_filename
                    )

                    file.save(file_path)

                    # Store the URL for the database
                    file_url = f"/static/uploads/{unique_filename}"
                    uploaded_files.append(file_url)
                    logger.info(f"Saved part image: {unique_filename}")

        else:
            # Handle JSON data
            if not request.json:
                return jsonify({"error": "Invalid request data"}), 400
            part_data = request.json.copy()
            uploaded_files = part_data.pop("images", [])

        # Set required fields
        part_data["user_id"] = current_user
        part_data["status"] = "pending"  # Set status as pending for admin approval
        part_data.update(_new_listing_lifecycle_fields())

        # Whitelist allowed fields for car parts
        part_allowed_fields = {
            "name",
            "part_type",
            "condition",
            "compatible_makes",
            "compatible_models",
            "compatible_years",
            "price",
            "location",
            "area",
            "emirate",
            "contact_number",
            "description",
            "is_negotiable",
            "status",
            "user_id",
            "country_code",
            "is_dealer",
            "expires_at",
            "expired_at",
            "retention_expires_at",
            "last_extended_at",
            "extension_count",
            "is_archived",
        }
        part_data = {k: v for k, v in part_data.items() if k in part_allowed_fields}

        # Validate required fields
        required_fields = ["name", "part_type", "price"]
        for field in required_fields:
            if not part_data.get(field):
                return jsonify({"error": f"Missing required field: {field}"}), 400

        # Create the part entry
        logger.info(f"Creating part with data: {part_data}")
        data, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/car_parts", part_data, user_id=current_user
        )

        if status_code >= 400:
            logger.error(f"Error creating part: {data}")
            return jsonify(data), status_code

        part_id = data[0]["id"]
        logger.info(f"Created part with ID: {part_id}")

        # Add images if any
        if uploaded_files:
            image_inserts = []
            for image_url in uploaded_files:
                image_inserts.append(
                    {
                        "part_id": part_id,
                        "url": image_url,
                        "image_url": image_url,  # Add image_url field for frontend compatibility
                    }
                )

            images_data, images_status = supabase_request(
                "post", "/rest/v1/part_images", data=image_inserts, user_id=current_user
            )

            if images_status < 400:
                data[0]["images"] = images_data
                logger.info(f"Added {len(images_data)} images to part")
            else:
                data[0]["images"] = []
                logger.warning(f"Failed to add images: {images_data}")
        else:
            data[0]["images"] = []

        return jsonify(data[0]), 201

    except Exception as e:
        logger.error(f"Error creating car part listing: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/parts/<part_id>", methods=["GET"])
def get_part_details(part_id):
    """Get details for a specific car part by ID"""
    try:
        logger.info(f"Fetching part details for ID: {part_id}")

        try:
            # Use direct request with service role key
            service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
            headers = {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
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

                part = _sync_listing_lifecycle(
                    "car_parts", parts[0], hard_delete_archived=True
                )
                if not part or part.get("listing_state") != "active":
                    return jsonify({"error": "Part not found"}), 404
                logger.info(f"Found part: {part.get('name', 'Unknown part')}")

                # Fetch images for this part
                try:
                    image_url = f"{app.config['SUPABASE_URL']}/rest/v1/part_images?part_id=eq.{part['id']}&select=*"
                    image_response = requests.get(image_url, headers=headers)

                    if image_response.status_code == 200:
                        images = image_response.json()
                        part["images"] = images
                        logger.info(f"Found {len(images)} images for part")
                    else:
                        part["images"] = []
                        logger.warning(f"No images found for part {part_id}")
                except Exception as img_err:
                    logger.error(
                        f"Error fetching images for part {part['id']}: {img_err}"
                    )
                    part["images"] = []

                # Fetch seller profile photo
                user_id = part.get("user_id")
                if user_id:
                    try:
                        user_url = f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{user_id}&select=profile_photo_url"
                        user_response = requests.get(user_url, headers=headers)
                        if user_response.status_code == 200 and user_response.json():
                            part["seller_profile_photo"] = user_response.json()[0].get(
                                "profile_photo_url"
                            )
                    except Exception as user_err:
                        logger.warning(f"Failed to fetch seller info: {user_err}")

                return jsonify(part), 200
            else:
                logger.error(
                    f"Error fetching part details: {response.status_code} - {response.text}"
                )
                return jsonify({"error": "Failed to fetch part details"}), 500

        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client
            response, status_code = supabase_request(
                "get",
                "/rest/v1/car_parts",
                params={"id": f"eq.{part_id}", "select": "*"},
            )
            if status_code < 400 and response and len(response) > 0:
                part = _sync_listing_lifecycle(
                    "car_parts", response[0], hard_delete_archived=True
                )
                if not part or part.get("listing_state") != "active":
                    return jsonify({"error": "Part not found"}), 404

                # Fetch images for this part in fallback
                images_response, images_status = supabase_request(
                    "get",
                    "/rest/v1/part_images",
                    params={"select": "*", "part_id": f"eq.{part_id}"},
                )
                if images_status < 400 and images_response:
                    part["images"] = images_response
                else:
                    part["images"] = []

                return jsonify(part), 200
            else:
                return jsonify({"error": "Part not found"}), 404

    except Exception as e:
        logger.error(f"Error in get_part_details: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/parts/<part_id>", methods=["DELETE"])
@token_required
def delete_part(current_user, part_id):
    try:
        delete_response, delete_status = _delete_user_owned_listing(
            current_user, "part", part_id
        )
        if delete_status >= 400:
            return jsonify(delete_response), delete_status
        return jsonify({"message": "Part listing deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting part {part_id}: {e}")
        return jsonify({"error": str(e)}), 500


# Diagnostic endpoint to check if service role key is available
@app.route("/api/diagnostics/config", methods=["GET"])
@token_required
def check_config(current_user):
    try:
        if os.getenv("ENABLE_DIAGNOSTICS", "false").lower() != "true":
            return jsonify({"error": "Not found"}), 404

        if not get_user_admin_status(current_user):
            return jsonify({"error": "Unauthorized"}), 403

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

        return jsonify(
            {
                "service_key_available": service_key != "not-set",
                "service_key_preview": service_key_masked,
                "regular_key_preview": regular_key_masked,
                "using_same_key": keys_are_same,
                "postgres_role_header_present": True,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error in diagnostics endpoint: {str(e)}")
        return jsonify({"error": str(e)}), 500

        bootstrap_token = os.getenv("ADMIN_BOOTSTRAP_TOKEN")
        request_token = request.headers.get("X-Admin-Bootstrap-Token")
        if not bootstrap_token or request_token != bootstrap_token:
            return jsonify({"error": "Invalid admin bootstrap token"}), 403

        logger.info(f"Attempting to make user {current_user} an admin")

        # Get the service role key for admin operations
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not service_key:
            logger.warning(
                "SUPABASE_SERVICE_ROLE_KEY not set, falling back to SUPABASE_KEY"
            )
            service_key = SUPABASE_KEY

        if not service_key:
            logger.error("No Supabase API key available")
            return jsonify(
                {"error": "Server configuration error - no API key available"}
            ), 500

        logger.info("Using service key for admin bootstrap")

        # Create a simple users table if it doesn't exist
        try:
            # First, just try to directly set the user as admin by inserting/updating in the users table
            logger.info(f"Creating/updating admin record for user: {current_user}")

            # Create headers with service role
            headers = {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
                "X-Postgres-Role": "service_role",  # This bypasses RLS
            }

            # Get user email from token information (already validated in @token_required)
            user_email = (
                request.user_data.get("email", "unknown@example.com")
                if hasattr(request, "user_data")
                else "unknown@example.com"
            )
            logger.info(f"Using email from token: {user_email}")

            # Try to upsert the user record with PATCH
            update_response = requests.patch(
                f"{SUPABASE_URL}/rest/v1/users?id=eq.{current_user}",
                json={"id": current_user, "email": user_email, "is_admin": True},
                headers=headers,
                timeout=10,
            )

            # If PATCH fails with 404 (not found), try to create with POST
            if (
                update_response.status_code == 404
                or len(update_response.text.strip()) == 0
            ):
                logger.info("User not found in users table, creating new record")
                create_response = requests.post(
                    f"{SUPABASE_URL}/rest/v1/users",
                    json={"id": current_user, "email": user_email, "is_admin": True},
                    headers=headers,
                    timeout=10,
                )

                if create_response.status_code >= 400:
                    error_text = (
                        create_response.text
                        or f"Status code: {create_response.status_code}"
                    )
                    logger.error(f"Failed to create user record: {error_text}")
                    return jsonify(
                        {"error": "Failed to create user record", "details": error_text}
                    ), 500

                logger.info(f"Created new admin user record")
                return jsonify(
                    {"message": "You are now an admin", "success": True}
                ), 201
            elif update_response.status_code >= 400:
                error_text = (
                    update_response.text
                    or f"Status code: {update_response.status_code}"
                )
                logger.error(f"Failed to update user record: {error_text}")
                return jsonify(
                    {"error": "Failed to update user record", "details": error_text}
                ), 500

            logger.info(f"Updated user {current_user} to admin status")
            return jsonify({"message": "You are now an admin", "success": True}), 200

        except requests.exceptions.RequestException as e:
            logger.error(f"Network error in admin operation: {str(e)}")
            return jsonify(
                {
                    "error": "Service unavailable - could not connect to database service",
                    "details": str(e),
                }
            ), 503

    except Exception as e:
        logger.error(f"Unexpected error making user admin: {str(e)}")
        return jsonify({"error": f"Internal server error", "details": str(e)}), 500


@app.route("/api/users", methods=["GET"])
@token_required
def get_users(current_user):
    try:
        # Check if the current user is an admin
        user_data, status_code = supabase_request(
            "get", f"/rest/v1/users?id=eq.{current_user}", user_id=current_user
        )

        if status_code >= 400 or not user_data or not user_data[0].get("is_admin"):
            return jsonify({"error": "Unauthorized. Only admins can view users."}), 403

        # Get all users with the service role key to bypass RLS
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)

        # Create headers with service role
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "X-Client-Info": "backend-api",
            "X-Postgres-Role": "service_role",  # This bypasses RLS
        }

        # Fetch all users
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?select=*", headers=headers
        )

        if response.status_code != 200:
            logger.error(f"Failed to get users: {response.text}")
            return jsonify({"error": "Failed to fetch users"}), response.status_code

        return jsonify(response.json()), 200

    except Exception as e:
        logger.error(f"Error getting users: {str(e)}")
        return jsonify({"error": str(e)}), 500


def _get_service_role_headers():
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "X-Client-Info": "backend-api",
        "X-Postgres-Role": "service_role",
    }


def _require_admin_api_user(current_user):
    user_details = _get_user_details_with_admin_status(current_user)
    return user_details if user_details and user_details.get("is_admin") else None


@app.route("/api/admin/users", methods=["GET"])
@token_required
def get_admin_users(current_user):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        query = (
            "/rest/v1/users"
            "?select=id,email,first_name,last_name,display_name,username,phone,city,emirate,"
            "profile_photo_url,profile_completion_percentage,email_verified,phone_verified,"
            "is_dealer,dealer_verified,is_admin,account_status,created_at"
            "&order=created_at.desc"
        )
        response, status_code = supabase_request("get", query, use_service_role=True)

        if status_code >= 400:
            logger.error(f"Failed to fetch admin users: {response}")
            return jsonify({"error": "Failed to fetch users"}), status_code

        return jsonify(response if isinstance(response, list) else []), 200
    except Exception as e:
        logger.error(f"Error in get_admin_users: {str(e)}")
        return jsonify({"error": "An error occurred while fetching users"}), 500


@app.route("/api/admin/users/<user_id>/status", methods=["PATCH"])
@token_required
def update_admin_user_status(current_user, user_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        if user_id == current_user:
            return jsonify({"error": "You cannot change your own account status"}), 400

        data = request.get_json(silent=True) or {}
        next_status = (data.get("status") or "").strip().lower()
        if next_status not in {"active", "suspended"}:
            return jsonify({"error": "Status must be either active or suspended"}), 400

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{user_id}",
            data={"account_status": next_status},
            use_service_role=True,
        )

        if status_code not in [200, 204]:
            logger.error(f"Failed updating user status for {user_id}: {response}")
            return jsonify({"error": "Failed to update user status"}), status_code

        return jsonify(
            {"message": f"User marked as {next_status}", "status": next_status}
        ), 200
    except Exception as e:
        logger.error(f"Error updating admin user status: {str(e)}")
        return jsonify({"error": "An error occurred while updating user status"}), 500


@app.route("/api/admin/users/<user_id>/make-admin", methods=["POST"])
@token_required
def make_admin_user(current_user, user_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{user_id}",
            data={"is_admin": True, "account_status": "active"},
            use_service_role=True,
        )

        if status_code not in [200, 204]:
            logger.error(f"Failed promoting user {user_id}: {response}")
            return jsonify({"error": "Failed to promote user"}), status_code

        return jsonify({"message": "User promoted to admin"}), 200
    except Exception as e:
        logger.error(f"Error promoting user to admin: {str(e)}")
        return jsonify({"error": "An error occurred while promoting the user"}), 500


@app.route("/api/admin/users/<user_id>", methods=["DELETE"])
@token_required
def delete_admin_user(current_user, user_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        if user_id == current_user:
            return jsonify({"error": "You cannot delete your own account"}), 400

        headers = _get_service_role_headers()

        auth_response = requests.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers=headers,
            timeout=15,
        )
        if auth_response.status_code not in [200, 204, 404]:
            logger.error(
                f"Failed deleting auth user {user_id}: {auth_response.status_code} - {auth_response.text}"
            )
            return jsonify(
                {"error": "Failed to delete auth user"}
            ), auth_response.status_code

        db_response = requests.delete(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            timeout=15,
        )
        if db_response.status_code not in [200, 204]:
            logger.error(
                f"Failed deleting user row {user_id}: {db_response.status_code} - {db_response.text}"
            )
            return jsonify(
                {"error": "Failed to delete user record"}
            ), db_response.status_code

        return jsonify({"message": "User deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting admin user: {str(e)}")
        return jsonify({"error": "An error occurred while deleting the user"}), 500


def _create_plate_with_image_impl(current_user):
    try:
        logger.info("Creating plate listing with image upload")

        payload = (
            request.form if request.form else (request.get_json(silent=True) or {})
        )

        # Get form/json data
        city = payload.get("city")
        code = payload.get("code")
        digits = payload.get("digits")
        price = payload.get("price")
        number = payload.get("number")
        plate_format = payload.get("plate_format")
        contact_name = payload.get("contact_name")
        contact_phone = payload.get("contact_phone")
        description = payload.get("description")

        # Validate required fields
        if not city or not code or not digits or price in [None, ""]:
            return jsonify({"error": "Missing required fields"}), 400

        try:
            digits = _to_int(digits, "digits", minimum=1, maximum=5, allow_empty=False)
            price = _to_int(price, "price", minimum=0, allow_empty=False)
            if number is not None and str(number).strip() != "":
                if not str(number).isdigit():
                    return jsonify(
                        {"error": "Plate number must contain digits only"}
                    ), 400
            _validate_description_word_count(description, field_name="description")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        # Create plate entry
        plate_data = {
            "city": city,
            "code": code,
            "digits": digits,
            "price": price,
            "number": str(number).strip() if number is not None else "",
            "plate_format": plate_format,
            "contact_name": contact_name,
            "contact_phone": contact_phone,
            "description": description,
            "user_id": current_user,
            "user_email": get_user_email(current_user),
            "status": "pending",  # Set status as pending for admin approval
        }
        plate_data.update(_new_listing_lifecycle_fields())

        logger.info(f"Creating plate entry with data: {plate_data}")

        # Create plate in database
        response, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/license_plates", plate_data, user_id=current_user
        )

        if status_code >= 400:
            logger.error(f"Error creating plate: {response}")
            return jsonify(response), status_code

        plate_id = response[0]["id"]
        logger.info(f"Created plate with ID: {plate_id}")

        # Generate and save the plate image
        import os
        from PIL import Image, ImageDraw, ImageFont
        import uuid

        # Create directory for this plate if it doesn't exist
        plate_dir = os.path.join("static", "uploads", "plates", str(plate_id))
        os.makedirs(plate_dir, exist_ok=True)

        # Create a simple plate image
        plate_width, plate_height = 600, 200
        plate_img = Image.new("RGB", (plate_width, plate_height), color=(255, 255, 255))
        draw = ImageDraw.Draw(plate_img)

        # Add border
        draw.rectangle(
            [(0, 0), (plate_width - 1, plate_height - 1)], outline=(0, 0, 0), width=5
        )

        # Try to use a font, or fall back to default
        try:
            font_path = os.path.join("static", "fonts", "arial.ttf")
            if not os.path.exists(font_path):
                import matplotlib.font_manager as fm

                font_path = fm.findfont(fm.FontProperties(family="Arial"))
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
            font=font,
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
                "plate_id": plate_id,
                "url": image_url,
                "image_url": image_url,
                "is_primary": True,
            }

            image_response, image_status = supabase_request(
                "post", "/rest/v1/plate_images", data=image_data, user_id=current_user
            )

            if image_status >= 400:
                logger.error(f"Failed to add image: {image_response}")
        except Exception as img_err:
            logger.error(f"Error adding image: {str(img_err)}")

        # Return the created plate
        response[0]["image_url"] = image_url
        return jsonify(response[0]), 201

    except Exception as e:
        logger.error(f"Error creating plate with image: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/plates", methods=["POST"])
@token_required
def create_plate(current_user):
    return _create_plate_with_image_impl(current_user)


@app.route("/api/plates/with-image", methods=["POST"])
@token_required
def create_plate_with_image(current_user):
    return _create_plate_with_image_impl(current_user)


def get_user_email(user_id):
    try:
        # Try to get user info from our database first
        user_data, status_code = supabase_request(
            "get", f"/rest/v1/users?id=eq.{user_id}", user_id=user_id
        )

        if status_code < 400 and user_data:
            return user_data[0].get("email", "unknown@example.com")

        # If not found, fetch from auth users
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
        headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

        response = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}", headers=headers
        )

        if response.status_code == 200:
            user_info = response.json()
            return user_info.get("email", "unknown@example.com")

        return "unknown@example.com"
    except Exception as e:
        logger.error(f"Error getting user email: {str(e)}")
        return "unknown@example.com"


# Admin-only endpoints to fetch ALL listings (including pending) for admin dashboard
@app.route("/api/admin/cars", methods=["GET"])
@token_required
def admin_get_cars(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        # Get ALL cars regardless of status for admin review
        response, status_code = supabase_request(
            "get",
            "/rest/v1/cars",
            params={"select": "*", "order": "created_at.desc"},
            use_service_role=True,
        )

        if status_code >= 400:
            return jsonify({"error": "Failed to fetch cars"}), status_code

        if not response:
            response = []

        # Fetch images for each car
        for car in response:
            car_id = car.get("id")
            if car_id:
                images_response, images_status = supabase_request(
                    "get",
                    "/rest/v1/car_images",
                    params={"select": "*", "car_id": f"eq.{car_id}"},
                    use_service_role=True,
                )

                if images_status < 400:
                    for image in images_response:
                        if "url" in image and "image_url" not in image:
                            image["image_url"] = image["url"]
                    car["images"] = images_response
                else:
                    car["images"] = []
            else:
                car["images"] = []

        logger.info(f"Admin fetched {len(response)} cars (all statuses)")
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error in admin_get_cars: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/bikes", methods=["GET"])
@token_required
def admin_get_bikes(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        # Get ALL bikes regardless of status for admin review
        response, status_code = supabase_request(
            "get",
            "/rest/v1/bikes",
            params={"select": "*", "order": "created_at.desc"},
            use_service_role=True,
        )

        if status_code >= 400:
            return jsonify({"error": "Failed to fetch bikes"}), status_code

        if not response:
            response = []

        # Fetch images for each bike
        for bike in response:
            bike_id = bike.get("id")
            if bike_id:
                images_response, images_status = supabase_request(
                    "get",
                    "/rest/v1/bike_images",
                    params={"select": "*", "bike_id": f"eq.{bike_id}"},
                    use_service_role=True,
                )

                if images_status < 400:
                    for image in images_response:
                        if "url" in image and "image_url" not in image:
                            image["image_url"] = image["url"]
                    bike["images"] = images_response
                else:
                    bike["images"] = []
            else:
                bike["images"] = []

        logger.info(f"Admin fetched {len(response)} bikes (all statuses)")
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error in admin_get_bikes: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/parts", methods=["GET"])
@token_required
def admin_get_parts(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        # Get ALL parts regardless of status for admin review
        response, status_code = supabase_request(
            "get",
            "/rest/v1/car_parts",
            params={"select": "*", "order": "created_at.desc"},
            use_service_role=True,
        )

        if status_code >= 400:
            return jsonify({"error": "Failed to fetch parts"}), status_code

        if not response:
            response = []

        # Fetch images for each part
        for part in response:
            part_id = part.get("id")
            if part_id:
                images_response, images_status = supabase_request(
                    "get",
                    "/rest/v1/part_images",
                    params={"select": "*", "part_id": f"eq.{part_id}"},
                    use_service_role=True,
                )

                if images_status < 400:
                    for image in images_response:
                        if "url" in image and "image_url" not in image:
                            image["image_url"] = image["url"]
                    part["images"] = images_response
                else:
                    part["images"] = []
            else:
                part["images"] = []

        logger.info(f"Admin fetched {len(response)} parts (all statuses)")
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error in admin_get_parts: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/plates", methods=["GET"])
@token_required
def admin_get_plates(current_user):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        # Get ALL plates regardless of status for admin review
        response, status_code = supabase_request(
            "get",
            "/rest/v1/license_plates",
            params={"select": "*", "order": "created_at.desc"},
            use_service_role=True,
        )

        if status_code >= 400:
            return jsonify({"error": "Failed to fetch plates"}), status_code

        if not response:
            response = []

        # License plates may have images, but they're often generated
        for plate in response:
            if "images" not in plate:
                plate["images"] = []

        logger.info(f"Admin fetched {len(response)} plates (all statuses)")
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error in admin_get_plates: {str(e)}")
        return jsonify({"error": str(e)}), 500


# Generic API approval/rejection endpoints for admin dashboard
@app.route("/api/<item_type>/<item_id>/approve", methods=["POST"])
@token_required
def api_approve_item(current_user, item_type, item_id):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        # Map item types to table names
        valid_item_types = {
            "cars": "cars",
            "bikes": "bikes",
            "parts": "car_parts",
            "plates": "license_plates",
        }

        if item_type not in valid_item_types:
            return jsonify({"error": f"Invalid item type: {item_type}"}), 400

        table_name = valid_item_types[item_type]

        # Update the item status to approved
        patch_data = {"status": "approved"}
        if item_type == "cars":
            patch_data["is_approved"] = True

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/{table_name}?id=eq.{item_id}",
            data=patch_data,
            use_service_role=True,
        )

        if status_code >= 200 and status_code < 300:
            listing = None
            if isinstance(response, list) and response:
                listing = response[0]
            elif isinstance(response, dict) and response.get("id"):
                listing = response
            if not listing:
                listing_response, listing_status = supabase_request(
                    "get",
                    f"/rest/v1/{table_name}?id=eq.{item_id}&select=*",
                    use_service_role=True,
                )
                if listing_status < 400 and listing_response:
                    listing = listing_response[0]

            email_sent = False
            email_error = None
            if item_type == "cars":
                email_error = "Queued via Supabase email events"
            elif listing:
                user_email = listing.get("user_email") or listing.get("contact_email")
                if not user_email:
                    user_id = listing.get("user_id")
                    if user_id:
                        user_email = get_user_email(user_id)
                if user_email and EMAIL_REGEX.match(user_email):
                    _, email_error = _send_listing_status_email(
                        user_email,
                        item_type,
                        listing,
                        "approved",
                        request.headers.get("Origin"),
                    )
                    if email_error:
                        logger.error(
                            f"Approval email failed for {item_type} {item_id}: {email_error}"
                        )
                    else:
                        email_sent = True
                else:
                    email_error = "Missing or invalid recipient email"
                    logger.warning(
                        f"Approval email skipped for {item_type} {item_id}: {email_error}"
                    )
            else:
                email_error = "Listing not found for email notification"
                logger.warning(
                    f"Approval email skipped for {item_type} {item_id}: {email_error}"
                )

            logger.info(f"Admin {current_user} approved {item_type} {item_id}")
            payload = {
                "success": True,
                "message": f"{item_type} approved successfully",
                "email_sent": email_sent,
            }
            if email_error:
                payload["email_error"] = "Approval email was not sent"
            return jsonify(payload), 200
        else:
            logger.error(
                f"Error approving {item_type} {item_id}: {status_code} - {response}"
            )
            return jsonify({"error": f"Failed to approve {item_type}"}), status_code

    except Exception as e:
        logger.error(f"Exception in api_approve_item: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/<item_type>/<item_id>/reject", methods=["POST"])
@token_required
def api_reject_item(current_user, item_type, item_id):
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        # Map item types to table names
        valid_item_types = {
            "cars": "cars",
            "bikes": "bikes",
            "parts": "car_parts",
            "plates": "license_plates",
        }

        if item_type not in valid_item_types:
            return jsonify({"error": f"Invalid item type: {item_type}"}), 400

        table_name = valid_item_types[item_type]

        # Get rejection note from request if provided
        rejection_note = ""
        if request.is_json and request.json:
            rejection_note = request.json.get("rejection_note", "")

        # Update the item status to rejected and add rejection note
        patch_data = {"status": "rejected"}
        if rejection_note:
            patch_data["rejection_note"] = rejection_note

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/{table_name}?id=eq.{item_id}",
            data=patch_data,
            use_service_role=True,
        )

        if status_code >= 200 and status_code < 300:
            listing = None
            if isinstance(response, list) and response:
                listing = response[0]
            elif isinstance(response, dict) and response.get("id"):
                listing = response
            if not listing:
                listing_response, listing_status = supabase_request(
                    "get",
                    f"/rest/v1/{table_name}?id=eq.{item_id}&select=*",
                    use_service_role=True,
                )
                if listing_status < 400 and listing_response:
                    listing = listing_response[0]

            email_sent = False
            email_error = None
            if item_type == "cars":
                email_error = "Queued via Supabase email events"
            elif listing:
                user_email = listing.get("user_email") or listing.get("contact_email")
                if not user_email:
                    user_id = listing.get("user_id")
                    if user_id:
                        user_email = get_user_email(user_id)
                if user_email and EMAIL_REGEX.match(user_email):
                    _, email_error = _send_listing_status_email(
                        user_email,
                        item_type,
                        listing,
                        "rejected",
                        request.headers.get("Origin"),
                    )
                    if email_error:
                        logger.error(
                            f"Rejection email failed for {item_type} {item_id}: {email_error}"
                        )
                    else:
                        email_sent = True
                else:
                    email_error = "Missing or invalid recipient email"
                    logger.warning(
                        f"Rejection email skipped for {item_type} {item_id}: {email_error}"
                    )
            else:
                email_error = "Listing not found for email notification"
                logger.warning(
                    f"Rejection email skipped for {item_type} {item_id}: {email_error}"
                )

            logger.info(
                f"Admin {current_user} rejected {item_type} {item_id} with note: {rejection_note}"
            )
            payload = {
                "success": True,
                "message": f"{item_type} rejected successfully",
                "email_sent": email_sent,
            }
            if email_error:
                payload["email_error"] = "Rejection email was not sent"
            return jsonify(payload), 200
        else:
            logger.error(
                f"Error rejecting {item_type} {item_id}: {status_code} - {response}"
            )
            return jsonify({"error": f"Failed to reject {item_type}"}), status_code

    except Exception as e:
        logger.error(f"Exception in api_reject_item: {str(e)}")
        return jsonify({"error": str(e)}), 500


def admin_required(f):
    """Token-based admin authorization - validates JWT and checks is_admin in database"""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization")

        if not auth_header:
            flash("You must be logged in as an admin to access this page.", "danger")
            return redirect(url_for("admin.admin_login"))

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            flash("Invalid authorization format.", "danger")
            return redirect(url_for("admin.admin_login"))

        token = parts[1]

        try:
            auth_headers = {
                "apikey": os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY),
                "Authorization": f"Bearer {token}",
            }

            auth_response = requests.get(
                f"{SUPABASE_URL}/auth/v1/user", headers=auth_headers, timeout=5
            )

            if auth_response.status_code != 200:
                flash("Session expired. Please log in again.", "danger")
                return redirect(url_for("admin.admin_login"))

            user_data = auth_response.json()
            user_id = user_data.get("id")

            if not user_id:
                flash("Invalid user data.", "danger")
                return redirect(url_for("admin.admin_login"))

            service_headers = {
                "apikey": os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY),
                "Authorization": f"Bearer {os.getenv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_KEY)}",
                "Content-Type": "application/json",
            }

            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=is_admin",
                headers=service_headers,
                timeout=5,
            )

            if response.status_code == 200:
                users = response.json()
                if users and len(users) > 0 and users[0].get("is_admin"):
                    request.user_id = user_id
                    session["is_admin"] = True
                    session["admin_user_id"] = user_id
                    return f(*args, **kwargs)

            flash("Admin access required.", "danger")
            return redirect(url_for("admin.admin_login"))

        except Exception as e:
            logger.error(f"Error checking admin status: {e}")
            flash("Authorization check failed.", "danger")
            return redirect(url_for("admin.admin_login"))

    return decorated_function


# Admin Blueprint Setup
admin_bp = Blueprint(
    "admin_web",
    __name__,
    template_folder="templates/admin",  # Specifies that templates are in backend/templates/admin
    url_prefix="/admin",  # All routes in this blueprint will be prefixed with /admin
    static_folder="static/admin",  # Optional: if you have admin-specific static files
)


# Define a simple admin route here for now, will be expanded
@admin_bp.route("/")  # This is /admin/
@admin_required
def admin_dashboard():
    pending_counts = get_pending_counts()

    # Get dealer statistics
    dealer_stats = get_dealer_statistics()

    # Get user statistics
    user_stats = get_user_statistics_admin()

    # The template 'dashboard.html' is implicitly looked for in 'templates/admin/'
    # because of the admin_bp.template_folder setting.
    return render_template(
        "dashboard.html",
        pending_counts=pending_counts,
        dealer_stats=dealer_stats,
        user_stats=user_stats,
    )


@admin_bp.route("/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        email = request.form.get("email")
        password = request.form.get("password")
        logger.info(f"[Admin Login] Attempt for email: {email}")

        if not email or not password:
            flash("Email and password are required.", "warning")
            return render_template("admin_login.html"), 400

        # Authenticate with Supabase auth
        url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
        headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
        payload = {"email": email, "password": password}

        try:
            auth_response = requests.post(
                url, headers=headers, json=payload, timeout=10
            )
            logger.info(
                f"[Admin Login] Supabase auth response status: {auth_response.status_code}"
            )

            if auth_response.status_code == 200:
                resp_data = auth_response.json()
                supabase_user_info = resp_data.get("user")

                if supabase_user_info:
                    user_id = supabase_user_info.get("id")
                    logger.info(f"[Admin Login] Extracted user_id: {user_id}")

                    user_details = _get_user_details_with_admin_status(user_id)
                    logger.info(
                        f"[Admin Login] User details from _get_user_details_with_admin_status: {user_details}"
                    )

                    if user_details and user_details.get("is_admin") is True:
                        session["is_admin"] = True
                        session["admin_user_id"] = user_id
                        session["admin_user_email"] = user_details.get(
                            "email"
                        )  # Optional: store email for display
                        flash("Login successful!", "success")
                        logger.info(
                            f"[Admin Login] Admin session SET for user {user_id}. Session: {dict(session)}"
                        )
                        return redirect(url_for("admin.admin_dashboard"))
                    else:
                        logger.warning(
                            f"[Admin Login] User {user_id} is not an admin or details fetch failed."
                        )
                        flash("Access denied. Not an authorized admin.", "danger")
                else:
                    logger.warning(
                        "[Admin Login] Supabase user info missing in auth response."
                    )
                    flash("Authentication failed. Please try again.", "danger")
            else:
                error_data = auth_response.json()
                error_msg = error_data.get(
                    "error_description", "Invalid credentials or login failed"
                )
                logger.error(
                    f"[Admin Login] Supabase auth failed: {error_msg}. Response: {error_data}"
                )
                flash(error_msg, "danger")

        except requests.exceptions.RequestException as e:
            logger.error(f"[Admin Login] Network error: {e}", exc_info=True)
            flash("A network error occurred. Please try again.", "danger")
        except Exception as e:
            logger.error(f"[Admin Login] Unexpected error: {e}", exc_info=True)
            flash("An unexpected error occurred. Please try again.", "danger")

        return render_template("admin_login.html")  # Re-render login form with error

    # For GET request
    if session.get("is_admin") and session.get("admin_user_id"):
        # If already logged in as admin, redirect to dashboard
        return redirect(url_for("admin.admin_dashboard"))
    return render_template("admin_login.html")


@admin_bp.route("/logout")
@admin_required  # Ensure only logged-in admins can access logout, though it might be open too
def admin_logout():
    session.pop("is_admin", None)
    session.pop("admin_user_id", None)
    session.pop("admin_user_email", None)  # Clear optional email too
    flash("You have been successfully logged out.", "success")
    logger.info(f"[Admin Logout] Admin session cleared. Session: {dict(session)}")
    return redirect(url_for("admin.admin_login"))


# Move blueprint registration to after all routes are defined
# app.register_blueprint(admin_bp)  # Remove this line from here


def get_dealer_statistics():
    """Get dealer statistics for admin dashboard"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get total dealers
        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=id,dealer_verified",
            headers=headers,
        )

        if dealers_response.status_code == 200:
            dealers = dealers_response.json()
            total_dealers = len(dealers)
            verified_dealers = sum(1 for d in dealers if d.get("dealer_verified"))
            pending_dealers = total_dealers - verified_dealers

            return {
                "total": total_dealers,
                "verified": verified_dealers,
                "pending": pending_dealers,
            }
        return {"total": 0, "verified": 0, "pending": 0}
    except Exception as e:
        logger.error(f"Error getting dealer statistics: {str(e)}")
        return {"total": 0, "verified": 0, "pending": 0}


def get_user_statistics_admin():
    """Get user statistics for admin dashboard"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get total users
        users_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?select=id,created_at", headers=headers
        )

        if users_response.status_code == 200:
            users = users_response.json()
            total_users = len(users)

            # Count users from last 7 days
            from datetime import datetime, timedelta

            week_ago = datetime.now() - timedelta(days=7)
            new_users = sum(
                1
                for u in users
                if datetime.fromisoformat(u["created_at"].replace("Z", "+00:00"))
                > week_ago
            )

            return {"total": total_users, "new_this_week": new_users}
        return {"total": 0, "new_this_week": 0}
    except Exception as e:
        logger.error(f"Error getting user statistics: {str(e)}")
        return {"total": 0, "new_this_week": 0}


def get_pending_counts():
    counts = {}
    item_types_and_tables = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
    }
    for item_type, table_name in item_types_and_tables.items():
        try:
            # Using supabase_request to get count of items with status 'pending'
            # Ensure your supabase_request can handle count queries or adapt as needed.
            # Supabase PostgREST can do this with params `select=count` and a filter.
            # This requires `status` column on all these tables.
            response, status_code = supabase_request(
                "get",
                f"/rest/v1/{table_name}",
                params={"status": "eq.pending", "select": "count"},
                use_service_role=True,  # Admin actions might need service role
            )
            if (
                status_code == 200
                and response
                and isinstance(response, list)
                and "count" in response[0]
            ):
                counts[item_type] = response[0]["count"]
            elif (
                status_code == 200 and isinstance(response, list) and not response
            ):  # No pending items
                counts[item_type] = 0
            else:
                logger.error(
                    f"Error fetching pending count for {item_type}: {status_code} - {response}"
                )
                counts[item_type] = "Error"  # Or 0, or handle differently
        except Exception as e:
            logger.error(f"Exception fetching pending count for {item_type}: {e}")
            counts[item_type] = "Exception"
    return counts


# ... (inside admin_bp blueprint)


# Generic route for listing pending items
@admin_bp.route("/approve/<item_type>")
@admin_required
def list_pending_items(item_type):
    valid_item_types = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
    }
    if item_type not in valid_item_types:
        flash(f"Invalid item type: {item_type}", "danger")
        return redirect(url_for("admin.admin_dashboard"))

    table_name = valid_item_types[item_type]
    items = []
    error_message = None
    try:
        # Fetch items with status 'pending' (or any non-'approved' status if that makes more sense)
        # This assumes a 'status' column exists and non-approved items are 'pending'.
        response, status_code = supabase_request(
            "get",
            f"/rest/v1/{table_name}",
            params={
                "status": "eq.pending",
                "select": "*",
            },  # Select all columns for display
            use_service_role=True,
        )
        if status_code == 200:
            items = response
        else:
            error_message = (
                f"Error fetching pending {item_type}: {status_code} - {response}"
            )
            logger.error(error_message)
            flash(error_message, "danger")
    except Exception as e:
        error_message = f"Exception fetching pending {item_type}: {e}"
        logger.error(error_message)
        flash(error_message, "danger")

    return render_template(
        "approve_list.html",
        items=items,
        item_type=item_type,
        item_type_title=item_type.replace("_", " ").title(),
        error_message=error_message,
    )


# ... (rest of admin_bp routes)


@admin_bp.route("/approve/<item_type>/<item_id>/approve", methods=["POST"])
@admin_required
def approve_item(item_type, item_id):
    valid_item_types = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
    }
    if item_type not in valid_item_types:
        flash(f"Invalid item type: {item_type}", "danger")
        return redirect(url_for("admin.admin_dashboard"))

    table_name = valid_item_types[item_type]
    # Define item_type_title for flash messages
    item_type_display_name = item_type.replace("_", " ").title()
    if item_type_display_name.endswith("s"):
        item_type_display_name = item_type_display_name[:-1]

    try:
        # The existing API routes for approval already check admin status, but good to have @admin_required here too.
        # Those API routes use current_user from token. Here, session['admin_user_id'] is the admin.
        # We are calling supabase_request directly for simplicity now.
        patch_data = {"status": "approved"}
        if item_type == "cars":
            patch_data["is_approved"] = True
        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/{table_name}?id=eq.{item_id}",
            data=patch_data,
            use_service_role=True,  # Admin actions should use service role to bypass RLS if needed
        )
        if status_code >= 200 and status_code < 300:
            flash(
                f"{item_type_display_name} {item_id} approved successfully.", "success"
            )
        else:
            # Use item_type_display_name here as well
            flash(
                f"Error approving {item_type_display_name} {item_id}: {status_code} - {response}",
                "danger",
            )
            logger.error(
                f"Error approving {item_type} {item_id}: {status_code} - {response}"
            )
    except Exception as e:
        flash(f"Exception approving {item_type_display_name} {item_id}: {e}", "danger")
        logger.error(f"Exception approving {item_type} {item_id}: {e}")

    return redirect(url_for("admin.list_pending_items", item_type=item_type))


@admin_bp.route("/approve/<item_type>/<item_id>/reject", methods=["POST"])
@admin_required
def reject_item(item_type, item_id):
    valid_item_types = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
    }
    if item_type not in valid_item_types:
        flash(f"Invalid item type: {item_type}", "danger")
        return redirect(url_for("admin.admin_dashboard"))

    table_name = valid_item_types[item_type]
    item_type_title = item_type.replace("_", " ").title()
    try:
        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/{table_name}?id=eq.{item_id}",
            data={"status": "rejected"},
            use_service_role=True,
        )
        if status_code >= 200 and status_code < 300:
            flash(f"{item_type_title} {item_id} rejected successfully.", "success")
        else:
            flash(
                f"Error rejecting {item_type_title} {item_id}: {status_code} - {response}",
                "danger",
            )
            logger.error(
                f"Error rejecting {item_type} {item_id}: {status_code} - {response}"
            )
    except Exception as e:
        flash(f"Exception rejecting {item_type} {item_id}: {e}", "danger")
        logger.error(f"Exception rejecting {item_type} {item_id}: {e}")

    return redirect(url_for("admin.list_pending_items", item_type=item_type))


# Dealer Management Routes
@admin_bp.route("/dealers")
@admin_required
def list_dealers():
    """List all dealers with their status"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get all dealers
        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=*&order=created_at.desc",
            headers=headers,
        )

        if dealers_response.status_code == 200:
            dealers = dealers_response.json()
            return render_template("dealers.html", dealers=dealers)
        else:
            flash("Error loading dealers", "danger")
            return render_template("dealers.html", dealers=[])
    except Exception as e:
        logger.error(f"Error listing dealers: {str(e)}")
        flash(f"Error loading dealers: {str(e)}", "danger")
        return render_template("dealers.html", dealers=[])


@admin_bp.route("/dealers/pending")
@admin_required
def list_pending_dealers():
    """List dealers awaiting verification"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get pending dealers
        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&dealer_verified=eq.false&select=*&order=created_at.desc",
            headers=headers,
        )

        if dealers_response.status_code == 200:
            dealers = dealers_response.json()
            return render_template("pending_dealers.html", dealers=dealers)
        else:
            flash("Error loading pending dealers", "danger")
            return render_template("pending_dealers.html", dealers=[])
    except Exception as e:
        logger.error(f"Error listing pending dealers: {str(e)}")
        flash(f"Error loading pending dealers: {str(e)}", "danger")
        return render_template("pending_dealers.html", dealers=[])


@admin_bp.route("/dealers/<dealer_id>/verify", methods=["POST"])
@admin_required
def verify_dealer(dealer_id):
    """Verify a dealer account"""
    try:
        from datetime import datetime

        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Update dealer verification
        update_data = {
            "dealer_verified": True,
            "dealer_verified_at": datetime.utcnow().isoformat(),
            "dealer_verified_by": session.get("admin_user_id"),
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{dealer_id}",
            headers=headers,
            json=update_data,
        )

        if response.status_code in [200, 204]:
            try:
                dealer_lookup = requests.get(
                    f"{SUPABASE_URL}/rest/v1/users?id=eq.{dealer_id}&select=email",
                    headers=headers,
                )
                if dealer_lookup.status_code == 200 and dealer_lookup.json():
                    dealer_email = dealer_lookup.json()[0].get("email")
                    _, email_error = _send_dealer_status_email(
                        dealer_email, "approved", request.headers.get("Origin")
                    )
                    if email_error:
                        logger.error(
                            f"Dealer approval email failed for {dealer_id}: {email_error}"
                        )
            except Exception as email_err:
                logger.error(
                    f"Dealer approval email exception for {dealer_id}: {email_err}"
                )

            flash("Dealer verified successfully!", "success")
        else:
            flash(f"Error verifying dealer: {response.text}", "danger")

    except Exception as e:
        logger.error(f"Error verifying dealer: {str(e)}")
        flash(f"Error verifying dealer: {str(e)}", "danger")

    return redirect(url_for("admin.list_pending_dealers"))


@admin_bp.route("/dealers/<dealer_id>/reject", methods=["POST"])
@admin_required
def reject_dealer(dealer_id):
    """Reject a dealer verification request"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get rejection note from form
        rejection_note = request.form.get(
            "rejection_note", "Verification rejected by admin"
        )

        # Update user - set is_dealer to false or keep it but mark as not verified
        update_data = {
            "is_dealer": False,  # Remove dealer status
            "rejection_note": rejection_note,
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{dealer_id}",
            headers=headers,
            json=update_data,
        )

        if response.status_code in [200, 204]:
            try:
                dealer_lookup = requests.get(
                    f"{SUPABASE_URL}/rest/v1/users?id=eq.{dealer_id}&select=email",
                    headers=headers,
                )
                if dealer_lookup.status_code == 200 and dealer_lookup.json():
                    dealer_email = dealer_lookup.json()[0].get("email")
                    _, email_error = _send_dealer_status_email(
                        dealer_email,
                        "rejected",
                        request.headers.get("Origin"),
                        rejection_note=rejection_note,
                    )
                    if email_error:
                        logger.error(
                            f"Dealer rejection email failed for {dealer_id}: {email_error}"
                        )
            except Exception as email_err:
                logger.error(
                    f"Dealer rejection email exception for {dealer_id}: {email_err}"
                )

            flash("Dealer verification rejected", "warning")
        else:
            flash(f"Error rejecting dealer: {response.text}", "danger")

    except Exception as e:
        logger.error(f"Error rejecting dealer: {str(e)}")
        flash(f"Error rejecting dealer: {str(e)}", "danger")

    return redirect(url_for("admin.list_pending_dealers"))


@admin_bp.route("/users")
@admin_required
def list_users():
    """List all users"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Get all users
        users_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?select=*&order=created_at.desc",
            headers=headers,
        )

        if users_response.status_code == 200:
            users = users_response.json()
            return render_template("users.html", users=users)
        else:
            flash("Error loading users", "danger")
            return render_template("users.html", users=[])
    except Exception as e:
        logger.error(f"Error listing users: {str(e)}")
        flash(f"Error loading users: {str(e)}", "danger")
        return render_template("users.html", users=[])


# ... (End of admin_bp blueprint, before app.register_blueprint(admin_bp) if it was moved, or before if __name__ ...)

# =====================
# Reports API Routes
# =====================


@app.route("/api/reports", methods=["POST"])
@token_required
def create_report(current_user):
    """Submit a report for a listing"""
    try:
        data = request.json

        # Validate required fields
        if not data:
            return jsonify({"error": "No data provided"}), 400

        listing_id = data.get("listing_id")
        listing_type = data.get("listing_type")
        reason = data.get("reason")
        details = data.get("details", "")

        if not listing_id or not listing_type or not reason:
            return jsonify(
                {
                    "error": "Missing required fields: listing_id, listing_type, or reason"
                }
            ), 400

        # Validate listing_type
        valid_types = ["car", "bike", "plate", "part", "bug"]
        if listing_type not in valid_types:
            return jsonify(
                {
                    "error": f"Invalid listing_type. Must be one of: {', '.join(valid_types)}"
                }
            ), 400

        # Validate reason
        valid_reasons = [
            "spam",
            "fraud",
            "inappropriate",
            "wrong_category",
            "duplicate",
            "sold",
            "incorrect_info",
            "other",
            "bug",
        ]
        if reason not in valid_reasons:
            return jsonify(
                {"error": f"Invalid reason. Must be one of: {', '.join(valid_reasons)}"}
            ), 400

        # Create the report in Supabase
        report_data = {
            "listing_id": listing_id,
            "listing_type": listing_type,
            "reporter_id": current_user,
            "reason": reason,
            "details": details,
            "status": "pending",
        }

        response, status_code = supabase_request(
            "post", "/rest/v1/reports", data=report_data, user_id=current_user
        )

        if status_code >= 400:
            logger.error(f"Failed to create report: {response}")
            return jsonify({"error": "Failed to submit report"}), status_code

        logger.info(
            f"Report created successfully by user {current_user} for {listing_type} {listing_id}"
        )
        return jsonify(
            {"message": "Report submitted successfully", "report": response}
        ), 201

    except Exception as e:
        logger.error(f"Error creating report: {str(e)}")
        return jsonify({"error": "An error occurred while submitting the report"}), 500


@app.route("/api/reports", methods=["GET"])
@token_required
def get_reports(current_user):
    """Get reports - users see their own, admins see all"""
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        is_admin = user_details and user_details.get("is_admin", False)

        if is_admin:
            # Admins can see all reports
            response, status_code = supabase_request(
                "get", "/rest/v1/reports?order=created_at.desc", user_id=current_user
            )
        else:
            # Regular users can only see their own reports
            response, status_code = supabase_request(
                "get",
                f"/rest/v1/reports?reporter_id=eq.{current_user}&order=created_at.desc",
                user_id=current_user,
            )

        if status_code >= 400:
            logger.error(f"Failed to fetch reports: {response}")
            return jsonify({"error": "Failed to fetch reports"}), status_code

        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error fetching reports: {str(e)}")
        return jsonify({"error": "An error occurred while fetching reports"}), 500


@app.route("/api/admin/reports", methods=["GET"])
@token_required
def get_admin_reports(current_user):
    """Get all reports for admin dashboard"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        # Get query parameters for filtering
        status = request.args.get("status")
        listing_type = request.args.get("listing_type")

        # Build query
        query = "/rest/v1/reports?order=created_at.desc"

        if status:
            query += f"&status=eq.{status}"
        if listing_type:
            query += f"&listing_type=eq.{listing_type}"

        response, status_code = supabase_request("get", query, user_id=current_user)

        if status_code >= 400:
            logger.error(f"Failed to fetch admin reports: {response}")
            return jsonify({"error": "Failed to fetch reports"}), status_code

        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error fetching admin reports: {str(e)}")
        return jsonify({"error": "An error occurred while fetching reports"}), 500


@app.route("/api/admin/dealers", methods=["GET"])
@token_required
def get_admin_dealers(current_user):
    """Get all dealers for admin dashboard"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        # Get query parameters for filtering
        verified_only = request.args.get("verified")
        pending_only = request.args.get("pending")

        # Build query
        query = "/rest/v1/users?is_dealer=eq.true&order=created_at.desc"

        if verified_only == "true":
            query += "&dealer_verified=eq.true"
        elif pending_only == "true":
            query += "&dealer_verified=eq.false"

        # Add select to get relevant fields
        query += "&select=id,email,first_name,last_name,company_name,company_registration_number,trade_license_number,is_dealer,dealer_verified,dealer_verified_at,created_at,phone,city,emirate,profile_completion_percentage"

        response, status_code = supabase_request("get", query, use_service_role=True)

        if status_code >= 400:
            logger.error(f"Failed to fetch dealers: {response}")
            return jsonify({"error": "Failed to fetch dealers"}), status_code

        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error fetching dealers: {str(e)}")
        return jsonify({"error": "An error occurred while fetching dealers"}), 500


@app.route("/api/admin/dealers/<dealer_id>/verify", methods=["POST"])
@token_required
def api_verify_dealer(current_user, dealer_id):
    """Verify a dealer account"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        from datetime import datetime

        # Update dealer verification
        update_data = {
            "dealer_verified": True,
            "dealer_verified_at": datetime.utcnow().isoformat(),
        }

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{dealer_id}",
            data=update_data,
            use_service_role=True,
        )

        if status_code in [200, 204]:
            dealer_response, dealer_status = supabase_request(
                "get",
                f"/rest/v1/users?id=eq.{dealer_id}&select=email",
                use_service_role=True,
            )
            if dealer_status < 400 and dealer_response:
                dealer_email = dealer_response[0].get("email")
                _, email_error = _send_dealer_status_email(
                    dealer_email, "approved", request.headers.get("Origin")
                )
                if email_error:
                    logger.error(
                        f"Dealer approval email failed for {dealer_id}: {email_error}"
                    )

            logger.info(f"Admin {current_user} verified dealer {dealer_id}")
            return jsonify(
                {"success": True, "message": "Dealer verified successfully"}
            ), 200
        else:
            logger.error(
                f"Error verifying dealer {dealer_id}: {status_code} - {response}"
            )
            return jsonify({"error": "Failed to verify dealer"}), status_code

    except Exception as e:
        logger.error(f"Exception in api_verify_dealer: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/dealers/<dealer_id>/reject", methods=["POST"])
@token_required
def api_reject_dealer(current_user, dealer_id):
    """Reject a dealer verification request"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        # Get rejection note from request
        rejection_note = ""
        if request.is_json and request.json:
            rejection_note = request.json.get("rejection_note", "")

        # Update user - set is_dealer to false and add rejection note
        update_data = {"is_dealer": False, "rejection_note": rejection_note}

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{dealer_id}",
            data=update_data,
            use_service_role=True,
        )

        if status_code in [200, 204]:
            dealer_response, dealer_status = supabase_request(
                "get",
                f"/rest/v1/users?id=eq.{dealer_id}&select=email",
                use_service_role=True,
            )
            if dealer_status < 400 and dealer_response:
                dealer_email = dealer_response[0].get("email")
                _, email_error = _send_dealer_status_email(
                    dealer_email,
                    "rejected",
                    request.headers.get("Origin"),
                    rejection_note=rejection_note,
                )
                if email_error:
                    logger.error(
                        f"Dealer rejection email failed for {dealer_id}: {email_error}"
                    )

            logger.info(f"Admin {current_user} rejected dealer {dealer_id}")
            return jsonify(
                {"success": True, "message": "Dealer verification rejected"}
            ), 200
        else:
            logger.error(
                f"Error rejecting dealer {dealer_id}: {status_code} - {response}"
            )
            return jsonify({"error": "Failed to reject dealer"}), status_code

    except Exception as e:
        logger.error(f"Exception in api_reject_dealer: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/reports/<report_id>", methods=["PATCH"])
@token_required
def update_report(current_user, report_id):
    """Update a report (admin only)"""
    try:
        # Verify admin status
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Prepare update data
        update_data = {}
        if "status" in data:
            valid_statuses = ["pending", "reviewed", "resolved", "dismissed"]
            if data["status"] not in valid_statuses:
                return jsonify(
                    {
                        "error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
                    }
                ), 400
            update_data["status"] = data["status"]

        if "admin_note" in data:
            update_data["admin_note"] = data["admin_note"]

        if "status" in data and data["status"] in ["reviewed", "resolved", "dismissed"]:
            update_data["reviewed_by"] = current_user
            update_data["reviewed_at"] = "now()"

        # Update the report
        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/reports?id=eq.{report_id}",
            data=update_data,
            user_id=current_user,
        )

        if status_code >= 400:
            logger.error(f"Failed to update report: {response}")
            return jsonify({"error": "Failed to update report"}), status_code

        logger.info(f"Report {report_id} updated by admin {current_user}")
        return jsonify(
            {"message": "Report updated successfully", "report": response}
        ), 200

    except Exception as e:
        logger.error(f"Error updating report: {str(e)}")
        return jsonify({"error": "An error occurred while updating the report"}), 500


@app.route("/api/<item_type>/<item_id>/delete", methods=["DELETE"])
@token_required
def delete_listing(current_user, item_type, item_id):
    """Delete a listing (admin only)"""
    try:
        # Check if user is admin
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        # Validate item_type
        valid_types = ["car", "bike", "car-part", "plate"]
        if item_type not in valid_types:
            return jsonify({"error": "Invalid item type"}), 400

        # Map item_type to table name
        table_mapping = {
            "car": "cars",
            "bike": "bikes",
            "car-part": "car_parts",
            "plate": "license_plates",
        }

        table_name = table_mapping[item_type]

        # Delete the listing using service role
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        url = f"{app.config['SUPABASE_URL']}/rest/v1/{table_name}?id=eq.{item_id}"

        response = requests.delete(url, headers=headers)

        if response.status_code == 200 or response.status_code == 204:
            logger.info(f"Admin {current_user} deleted {item_type} {item_id}")
            return jsonify(
                {"message": f"{item_type.title()} deleted successfully"}
            ), 200
        else:
            logger.error(
                f"Failed to delete {item_type} {item_id}: {response.status_code}"
            )
            return jsonify({"error": "Failed to delete listing"}), response.status_code

    except Exception as e:
        logger.error(f"Error deleting {item_type} {item_id}: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/check-session", methods=["GET"])
@token_required
def check_session_route(current_user):
    if os.getenv("ENABLE_DIAGNOSTICS", "false").lower() != "true":
        return jsonify({"error": "Not found"}), 404

    if not get_user_admin_status(current_user):
        return jsonify({"error": "Unauthorized"}), 403

    is_admin_in_session = session.get("is_admin", False)
    admin_id_in_session = session.get("admin_user_id")
    return jsonify(
        {
            "message": "Session check",
            "is_admin_flag_from_session": is_admin_in_session,
            "admin_id_from_session": admin_id_in_session,
        }
    ), 200


# Admin routes are registered at the top of the file (after imports)
# No need to register again here

if __name__ == "__main__":
    logger.info("Starting Flask application on port 8000")
    debug_mode = os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    if debug_mode:
        logger.warning("!!! FLASK DEBUG MODE IS ENABLED - NOT FOR PRODUCTION !!!")
    app.run(debug=debug_mode, host="127.0.0.1", port=8000)


# Beta gate endpoint - verify password server-side
@app.route("/api/auth/beta-verify", methods=["POST"])
def beta_verify():
    if not BETA_PASSWORD:
        return jsonify({"success": True}), 200

    data = request.json
    if not data or not data.get("password"):
        return jsonify({"success": False}), 401

    if data.get("password") == BETA_PASSWORD:
        return jsonify({"success": True}), 200

    return jsonify({"success": False}), 401
