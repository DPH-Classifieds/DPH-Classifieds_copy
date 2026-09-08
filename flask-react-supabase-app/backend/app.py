from flask import (
    Flask,
    jsonify,
    request,
    has_request_context,
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
import atexit
import datetime
import io
import hashlib
import threading
import logging
import json
import math
import uuid
import os
import re
import unicodedata
import requests
import secrets
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import ContextVar
from collections import defaultdict, deque
from functools import wraps
from urllib.parse import urlparse, quote, parse_qs
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from flask_cors import CORS
from PIL import Image
from posthog import Posthog
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix
from xml.sax.saxutils import escape as xml_escape
from analytics_metrics import build_platform_metrics, classify_platform_path
from application.bike_create_routes import (
    BikeCreateDependencies,
    register_bike_create_route,
)
from application.bike_read_routes import BikeReadDependencies, register_bike_read_routes
from application.car_create_routes import (
    CarCreateDependencies,
    register_car_create_route,
)
from application.car_read_routes import CarReadDependencies, register_car_read_route
from application.http_runtime import register_http_runtime
from application.health_routes import register_health_routes
from application.listing_count_routes import register_listing_count_route
from application.part_read_routes import (
    PartReadDependencies,
    register_part_read_route,
)
from application.part_create_routes import (
    PartCreateDependencies,
    register_part_create_route,
)
from application.plate_create_routes import (
    PlateCreateDependencies,
    register_plate_create_route,
)
from application.plate_read_routes import PlateReadDependencies, register_plate_read_route
from services.analytics_events import AnalyticsEventError, normalize_analytics_event
from services.contact_analytics import build_contact_analytics, build_vin_listing_activity
from services.featured_listings import (
    ALLOWED_LISTING_TYPES,
    is_listing_active_featured,
    validate_featured_input,
)
from expo_push import send_expo_push, dead_push_tokens, is_valid_expo_token

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs):
        return False

try:
    import redis
except ImportError:
    redis = None

load_dotenv()

from health_monitoring import (  # noqa: E402
    HEALTH_TABLE,
    build_health_snapshot,
    check_backend_health,
    check_frontend_health,
    check_redis_health,
    fetch_latest_health_snapshot,
    get_worker_heartbeat,
    record_worker_heartbeat,
    send_health_alert,
    store_health_snapshot,
)

app = Flask(__name__, static_folder="static")
_trusted_proxy_hops = int(os.getenv("TRUSTED_PROXY_HOPS", "0"))
if _trusted_proxy_hops:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=_trusted_proxy_hops, x_proto=_trusted_proxy_hops)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV") == "production"
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25MB max request size

logger = logging.getLogger(__name__)

POSTHOG_PROJECT_TOKEN = os.getenv("POSTHOG_PROJECT_TOKEN")
POSTHOG_HOST = os.getenv("POSTHOG_HOST")
posthog_client = None
if POSTHOG_PROJECT_TOKEN and POSTHOG_HOST:
    posthog_client = Posthog(
        POSTHOG_PROJECT_TOKEN,
        host=POSTHOG_HOST,
        enable_exception_autocapture=True,
    )
    atexit.register(posthog_client.shutdown)
else:
    logger.warning("PostHog is not configured; analytics events will not be sent")


def capture_posthog_event(event_name, distinct_id, properties=None):
    """Capture an analytics event without allowing tracking failures to affect requests."""
    if posthog_client is None or not distinct_id:
        return
    try:
        posthog_client.capture(
            event_name,
            distinct_id=str(distinct_id),
            properties=properties or {},
        )
    except Exception:
        logger.exception("PostHog capture failed for %s", event_name)


# Flask-Mail configuration
try:
    from flask_mail import Mail, Message as MailMessage

    app.config["MAIL_SERVER"] = os.getenv("MAIL_SERVER", "smtp.gmail.com")
    app.config["MAIL_PORT"] = int(os.getenv("MAIL_PORT", "587"))
    app.config["MAIL_USE_TLS"] = os.getenv("MAIL_USE_TLS", "true").lower() == "true"
    app.config["MAIL_USERNAME"] = os.getenv("MAIL_USERNAME")
    app.config["MAIL_PASSWORD"] = os.getenv("MAIL_PASSWORD")
    app.config["MAIL_DEFAULT_SENDER"] = os.getenv("MAIL_DEFAULT_SENDER") or os.getenv(
        "MAIL_USERNAME"
    )
    mail = Mail(app)
    MAIL_ENABLED = bool(os.getenv("MAIL_USERNAME") and os.getenv("MAIL_PASSWORD"))
except ImportError:
    mail = None
    MAIL_ENABLED = False
    logger.warning("Flask-Mail not installed; email notifications disabled")
MAX_LISTINGS_PER_USER = int(os.getenv("MAX_LISTINGS_PER_USER", "4"))
MAX_LISTINGS_PER_USER_PER_TYPE = int(
    os.getenv("MAX_LISTINGS_PER_USER_PER_TYPE", str(MAX_LISTINGS_PER_USER))
)
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "20"))
Image.MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "25000000"))
CONTACT_RATE_LIMIT_WINDOW_SEC = int(os.getenv("CONTACT_RATE_LIMIT_WINDOW_SEC", "3600"))
CONTACT_RATE_LIMIT_MAX = int(os.getenv("CONTACT_RATE_LIMIT_MAX", "5"))
CONTACT_RATE_LIMIT = defaultdict(deque)

# Anonymous phone/WhatsApp taps are public (no login) — this limiter is the
# anti-scraper backstop: generous enough that a real buyer comparing many
# listings never hits it, tight enough to stop a bot harvesting numbers in bulk.
# Keyed on IP and visitor_id separately so a fingerprint-reusing, IP-rotating
# scraper still trips. Distinct namespace from CONTACT_RATE_LIMIT so it never
# cross-contaminates the (much tighter) contact-message limit.
CONTACT_LEAD_RATE_LIMIT_WINDOW_SEC = int(os.getenv("CONTACT_LEAD_RATE_LIMIT_WINDOW_SEC", "3600"))
CONTACT_LEAD_RATE_LIMIT_MAX = int(os.getenv("CONTACT_LEAD_RATE_LIMIT_MAX", "40"))
CONTACT_LEAD_RATE_LIMIT = defaultdict(deque)
AUTH_RATE_LIMIT_WINDOW_SEC = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SEC", "300"))
AUTH_RATE_LIMIT_MAX = int(os.getenv("AUTH_RATE_LIMIT_MAX", "5"))
AUTH_RATE_LIMIT = defaultdict(deque)
_RATE_LIMIT_LOCK = threading.Lock()
REQUEST_POOL_CONNECTIONS = int(os.getenv("REQUEST_POOL_CONNECTIONS", "100"))
REQUEST_POOL_MAXSIZE = int(os.getenv("REQUEST_POOL_MAXSIZE", "100"))
HTTP_DEFAULT_TIMEOUT_SECONDS = float(os.getenv("HTTP_DEFAULT_TIMEOUT_SECONDS", "15"))
HTTP_RETRY_TOTAL = int(os.getenv("HTTP_RETRY_TOTAL", "2"))
DEFAULT_LIST_LIMIT = max(1, int(os.getenv("DEFAULT_LIST_LIMIT", "50")))
MAX_LIST_LIMIT = max(DEFAULT_LIST_LIMIT, int(os.getenv("MAX_LIST_LIMIT", "100")))
CSP_ALLOW_UNSAFE_EVAL = os.getenv("CSP_ALLOW_UNSAFE_EVAL", "false").lower() == "true"
STORAGE_BUCKET_CACHE_TTL_SECONDS = int(
    os.getenv("STORAGE_BUCKET_CACHE_TTL_SECONDS", "300")
)
_STORAGE_BUCKET_CACHE = {}
_STORAGE_BUCKET_CACHE_LOCK = threading.Lock()
PHONE_VERIFICATION_PURPOSES = {"signup", "phone_change", "profile_verify", "vin_reveal"}
PHONE_VERIFICATION_CODE_LENGTH = int(os.getenv("PHONE_VERIFICATION_CODE_LENGTH", "6"))
PHONE_VERIFICATION_TTL_MINUTES = int(os.getenv("PHONE_VERIFICATION_TTL_MINUTES", "10"))
PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS = int(
    os.getenv("PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS", "60")
)
PHONE_VERIFICATION_MAX_ATTEMPTS = int(os.getenv("PHONE_VERIFICATION_MAX_ATTEMPTS", "5"))
PHONE_VERIFICATION_MAX_SENDS = int(os.getenv("PHONE_VERIFICATION_MAX_SENDS", "6"))
# Per-phone-number cap on MSG91 widget sends. The widget sends client-side (browser/app
# talks to MSG91 directly), so this is the only server-side chokepoint that can throttle
# it — enforced in start_phone_verification() before the client is told to call the widget.
OTP_SEND_RATE_LIMIT_WINDOW_SEC = int(os.getenv("OTP_SEND_RATE_LIMIT_WINDOW_SEC", "600"))
OTP_SEND_RATE_LIMIT_MAX = int(os.getenv("OTP_SEND_RATE_LIMIT_MAX", "3"))
USERNAME_AVAILABILITY_CACHE_TTL_SECONDS = int(
    os.getenv("USERNAME_AVAILABILITY_CACHE_TTL_SECONDS", "30")
)
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")
USERNAME_BLOCKLIST = {
    "fuck",
    "shit",
    "bitch",
    "asshole",
    "bastard",
    "cunt",
    "dick",
    "pussy",
    "slut",
    "whore",
    "porn",
    "pornhub",
    "rape",
    "nigger",
    "faggot",
    "cock",
    "cum",
    "nazi",
    "blowjob",
    "handjob",
    "hentai",
    "onlyfans",
    "xnxx",
    "xvideos",
    "redtube",
    "4chan",
}
PRIMARY_SUPER_ADMIN_EMAIL = (
    os.getenv("PRIMARY_SUPER_ADMIN_EMAIL", "admin@dphclassifieds.com").strip().lower()
)
PRIMARY_SUPER_ADMIN_USERNAME = (
    os.getenv("PRIMARY_SUPER_ADMIN_USERNAME", "DPHClassifieds").strip().lower()
)
PRIMARY_SUPER_ADMIN_USER_ID = os.getenv("PRIMARY_SUPER_ADMIN_USER_ID", "").strip()


def _build_content_security_policy():
    script_sources = ["'self'", "'unsafe-inline'"]
    if os.getenv("FLASK_ENV", "").lower() != "production" or CSP_ALLOW_UNSAFE_EVAL:
        script_sources.append("'unsafe-eval'")
    script_sources.extend(
        [
            "https://challenges.cloudflare.com",
            "https://www.googletagmanager.com",
        ]
    )
    return (
        "default-src 'self'; "
        f"script-src {' '.join(script_sources)}; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: blob: https://*.supabase.co https://*.railway.app; "
        "connect-src 'self' https://*.supabase.co https://dph-classifieds-production.up.railway.app "
        "https://dphclassifieds.com https://www.dphclassifieds.com https://challenges.cloudflare.com; "
        "frame-src https://challenges.cloudflare.com;"
    )


def _redis_rate_limit_key(prefix, client_ip, window_seconds):
    normalized_ip = str(client_ip or "").replace(":", "_")
    window_bucket = int(time.time() // max(1, window_seconds))
    return f"rate_limit:{prefix}:{normalized_ip}:{window_bucket}"


def _redis_fixed_window_rate_limited(prefix, client_ip, window_seconds, max_attempts):
    redis_client = _get_redis_cache_client()
    if redis_client is None or not client_ip:
        return None

    key = _redis_rate_limit_key(prefix, client_ip, window_seconds)
    try:
        count = redis_client.incr(key)
        if count == 1:
            redis_client.expire(key, window_seconds + 5)
        return count > max_attempts
    except Exception as exc:
        logger.warning("Redis rate limit check failed for %s: %s", prefix, exc)
        return None


def _normalize_base_url(value, default_scheme="https"):
    raw_value = str(value or "").strip().strip('"').strip("'").rstrip("/")
    if not raw_value:
        return ""
    if "://" not in raw_value:
        return f"{default_scheme}://{raw_value}"
    return raw_value


# MSG91 OTP widget: the client-side widget sends & verifies the OTP and hands the
# frontend a JWT; the backend validates that JWT here before trusting it.
MSG91_AUTHKEY = os.getenv("MSG91_AUTHKEY")
MSG91_VERIFY_TOKEN_URL = os.getenv(
    "MSG91_VERIFY_TOKEN_URL",
    "https://control.msg91.com/api/v5/widget/verifyAccessToken",
)
# When true, server-issued verification flows (profile phone-change, /start) STOP
# sending Infobip SMS for MSG91-routed numbers and let the client widget do the
# send+verify (matching the frontend). Opt-in so nothing changes until set.
# MSG91 handles OTP whenever the authkey is present (Infobip is retired for UAE and
# never delivers). Kept as an explicit off-switch, defaulting ON when authkey is set.
MSG91_OTP_ENABLED = str(
    os.getenv("MSG91_OTP_ENABLED", "true" if MSG91_AUTHKEY else "")
).lower() == "true"
# Every UAE number goes through MSG91. Prefix env intentionally ignored so a stale
# value can't route traffic back to dead Infobip.
MSG91_OTP_PREFIXES = ("971",)
EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MIN_ALLOWED_YEAR = 1886
MAX_DESCRIPTION_WORDS = 300

# Simple profanity filter: server-side source of truth.
# Notes:
# - We avoid short substrings (e.g. "ass") to reduce false positives.
# - We normalize common leetspeak and punctuation so "f.u.c.k" or "f u c k" is caught.
PROFANITY_BLOCKLIST_TOKENS = {
    "fuck",
    "fucking",
    "fucked",
    "shit",
    "shitty",
    "bitch",
    "bastard",
    "asshole",
    "cunt",
    "dick",
    "cock",
    "pussy",
    "whore",
    "slut",
    "porn",
    "nigger",
    "faggot",
    "retard",
}

PROFANITY_BLOCKLIST_PHRASES = {
    "motherfucker",
    "son of a bitch",
}

# For spaced-out / punctuated variants ("f u c k", "f.u.c.k")
PROFANITY_BLOCKLIST_COLLAPSED = {
    "fuck",
    "shit",
    "bitch",
    "asshole",
    "cunt",
    "nigger",
    "faggot",
    "motherfucker",
}
LISTING_EXPIRY_DAYS = 60
LISTING_RETENTION_DAYS = 30
LISTING_SOLD_RESPONSE_WINDOW_HOURS = int(
    os.getenv("LISTING_SOLD_RESPONSE_WINDOW_HOURS", "168")
)
LISTING_DISPLAY_WIDTH = int(os.getenv("LISTING_DISPLAY_WIDTH", "1600"))
LISTING_DISPLAY_HEIGHT = int(os.getenv("LISTING_DISPLAY_HEIGHT", "1000"))
LISTING_DISPLAY_RATIO = LISTING_DISPLAY_WIDTH / LISTING_DISPLAY_HEIGHT
LISTING_IMAGE_ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
]
LISTING_IMAGE_FILE_SIZE_LIMIT_BYTES = (
    int(os.getenv("LISTING_IMAGE_FILE_SIZE_LIMIT_MB", "20")) * 1024 * 1024
)
PART_IMAGE_MAX_COUNT = int(os.getenv("PART_IMAGE_MAX_COUNT", "10"))
PART_IMAGE_MAX_TOTAL_BYTES = int(
    os.getenv("PART_IMAGE_MAX_TOTAL_MB", "20")
) * 1024 * 1024
PROFILE_PHOTO_FILE_SIZE_LIMIT_BYTES = (
    int(os.getenv("PROFILE_PHOTO_FILE_SIZE_LIMIT_MB", "5")) * 1024 * 1024
)
DEALER_DOCUMENT_ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "application/pdf",
]
DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES = (
    int(os.getenv("DEALER_DOCUMENT_FILE_SIZE_LIMIT_MB", "10")) * 1024 * 1024
)
DEALER_INFO_REQUEST_MAX_UPLOADS = int(
    os.getenv("DEALER_INFO_REQUEST_MAX_UPLOADS", "10")
)
DEALER_INFO_REQUEST_MAX_TOTAL_BYTES = int(
    os.getenv("DEALER_INFO_REQUEST_MAX_TOTAL_MB", "20")
) * 1024 * 1024
REGISTRATION_DOCUMENT_ALLOWED_MIME_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
]
REGISTRATION_DOCUMENT_FILE_SIZE_LIMIT_BYTES = (
    int(os.getenv("REGISTRATION_DOCUMENT_FILE_SIZE_LIMIT_MB", "10")) * 1024 * 1024
)
LEAD_EVENT_ACTIONS = {"call_click", "whatsapp_click", "vin_open", "vin_reveal"}
# A genuine "lead" is a buyer-intent contact action only: a phone-call tap or a
# WhatsApp tap. VIN opens/reveals are spec/detail reveals (surfaced separately as
# vin_open/vin_reveal counts), NOT leads. (form_submit is a generic UX event — any
# form, e.g. login/post/search — not a listing contact, so it is not a lead.)
CONTACT_LEAD_ACTIONS = {"call_click", "whatsapp_click"}
# Events written on and after this migration are the canonical, idempotent
# source. ``lead_events`` remains only as a pre-cutover history fallback so a
# single contact cannot be counted once in each table.
CANONICAL_ANALYTICS_CUTOVER_AT = datetime.datetime(2026, 7, 20, tzinfo=datetime.timezone.utc)
LISTING_OUTCOME_OPTIONS = {
    "sold_on_dph",
    "sold_elsewhere",
    "not_sold_renew",
    "move_to_draft",
}
LISTING_EXPIRY_NOTICE_REASON = "expiry_notice"
LISTING_EXPIRY_EMAILS_ENABLED = os.getenv(
    "LISTING_EXPIRY_EMAILS_ENABLED", "true"
).strip().lower() in {"1", "true", "yes", "on"}
LISTING_ACTIVE_STATUSES = {"approved", "active"}
LISTING_TERMINAL_STATUSES = {"deleted", "rejected", "sold"}
WHATSAPP_PREFILL_TEMPLATE = (
    "Hi, I saw your listing on DPHClassifieds and I am interested. "
    "Listing: {{LISTING_URL}}"
)

LISTING_TABLE_CONFIG = {
    "car": {"table": "cars", "images_table": "car_images", "fk": "car_id"},
    "bike": {"table": "bikes", "images_table": "bike_images", "fk": "bike_id"},
    "part": {"table": "car_parts", "images_table": "part_images", "fk": "part_id"},
    "plate": {
        "table": "license_plates",
        "images_table": "plate_images",
        "fk": "plate_id",
    },
    "buying_request": {
        "table": "buying_requests",
        "images_table": "buying_request_images",
        "fk": "buying_request_id",
    },
}
ADMIN_ITEM_TYPE_TO_TABLE = {
    "cars": "cars",
    "bikes": "bikes",
    "parts": "car_parts",
    "plates": "license_plates",
}
API_ITEM_TYPE_TO_TABLE = {
    "car": "cars",
    "bike": "bikes",
    "part": "car_parts",
    "plate": "license_plates",
    "buying_request": "buying_requests",
}
LISTING_IMAGE_SELECTS = {
    "cars": "id,car_id,image_url,url,display_url,focal_x,focal_y,crop_meta,uploaded_at,is_primary",
    "bikes": "id,bike_id,image_url,url,display_url,focal_x,focal_y,crop_meta,uploaded_at,is_primary",
    "car_parts": "id,part_id,image_url,url,display_url,focal_x,focal_y,crop_meta,uploaded_at,is_primary",
    # plate_images may only have url/is_primary/uploaded_at in older DB setups;
    # image_url, display_url, focal_* are added by add_plate_images_columns migration.
    "license_plates": "id,plate_id,url,uploaded_at",
}
LISTING_LIFECYCLE_SELECT = (
    "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
    "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,auto_removed_at"
)
PUBLIC_CAR_PREVIEW_SELECT = (
    "id,user_id,car_manufacturer,car_model,trim,make_year,car_city,"
    "expected_selling_price,kilometer_driven,created_at,status,is_approved,view_count,"
    "source_platform,source_url,"  # needed for the Reddit badge + 'View Reddit' card CTA
    "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
    "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
    "car_images("
    + LISTING_IMAGE_SELECTS["cars"]
    + ")"
)
ADMIN_LISTING_SELECTS = {
    "car": (
        "id,user_id,user_email,listing_title,car_manufacturer,car_model,"
        "trim,make_year,expected_selling_price,created_at,updated_at,status,is_approved,"
        "view_count,renewal_nudge_sent_at,is_dealer,source_platform,source_url,"
        + LISTING_LIFECYCLE_SELECT
        + ",car_images("
        + LISTING_IMAGE_SELECTS["cars"]
        + ")"
    ),
    "bike": (
        "id,user_id,user_email,bike_brand,bike_model,year,"
        "bike_type,price,created_at,updated_at,status,is_approved,"
        "view_count,renewal_nudge_sent_at,is_dealer,source_platform,source_url,"
        + LISTING_LIFECYCLE_SELECT
        + ",bike_images("
        + LISTING_IMAGE_SELECTS["bikes"]
        + ")"
    ),
    "part": (
        "id,user_id,user_email,name,part_type,price,created_at,updated_at,status,is_approved,"
        "view_count,renewal_nudge_sent_at,is_dealer,source_platform,source_url,"
        + LISTING_LIFECYCLE_SELECT
        + ",part_images("
        + LISTING_IMAGE_SELECTS["car_parts"]
        + ")"
    ),
    "plate": (
        "id,user_id,user_email,listing_title,city,code,digits,number,"
        "price,contact_name,contact_phone,created_at,updated_at,status,is_approved,view_count,renewal_nudge_sent_at,"
        "is_dealer,source_platform,source_url,"
        + LISTING_LIFECYCLE_SELECT
    ),
    "buying_request": (
        "id,user_id,user_email,listing_title,item_name,item_type,car_manufacturer,car_model,"
        "trim,budget,created_at,updated_at,status,is_approved,"
        + LISTING_LIFECYCLE_SELECT
    ),
}
ADMIN_REPORT_TYPE_CONFIG = {
    "car": {
        "table": "cars",
        "select": "id,car_model,car_manufacturer,make_year,expected_selling_price,user_id",
        "img_table": "car_images",
        "img_fk": "car_id",
        "public_prefix": "/cars",
    },
    "bike": {
        "table": "bikes",
        "select": "id,bike_model,bike_brand,year,price,expected_selling_price,user_id",
        "img_table": "bike_images",
        "img_fk": "bike_id",
        "public_prefix": "/bikes",
    },
    "plate": {
        "table": "license_plates",
        "select": "id,number,code,city,price,user_id",
        "img_table": "plate_images",
        "img_fk": "plate_id",
        "public_prefix": "/plates",
    },
    "part": {
        "table": "car_parts",
        "select": "id,name,part_name,category,price,user_id",
        "img_table": "part_images",
        "img_fk": "part_id",
        "public_prefix": "/car-parts",
    },
}


def _build_http_session():
    retry = Retry(
        total=HTTP_RETRY_TOTAL,
        connect=HTTP_RETRY_TOTAL,
        read=HTTP_RETRY_TOTAL,
        backoff_factor=0.3,
        status_forcelist=[429, 500, 502, 503, 504],
        # A transport retry of a POST can run after Supabase has persisted the
        # first request but before its response reaches us.  That is harmless
        # only when every endpoint is explicitly idempotent; listing creation
        # and analytics ingestion are not universally so.  Keep retries to
        # safe read requests and let the caller surface/retry writes instead.
        allowed_methods={"GET", "HEAD", "OPTIONS"},
        raise_on_status=False,
    )
    adapter = HTTPAdapter(
        pool_connections=REQUEST_POOL_CONNECTIONS,
        pool_maxsize=REQUEST_POOL_MAXSIZE,
        max_retries=retry,
    )
    http_session = requests.Session()
    http_session.mount("https://", adapter)
    http_session.mount("http://", adapter)
    return http_session


HTTP_SESSION = _build_http_session()
_request_start_time = ContextVar("request_start_time", default=None)
_request_supabase_durations_ms = ContextVar(
    "request_supabase_durations_ms", default=None
)
REDIS_URL = os.getenv("REDIS_URL")
API_CACHE_TTL_SECONDS = int(os.getenv("API_CACHE_TTL_SECONDS", "300"))
_MEMORY_API_CACHE = {}
_MEMORY_API_CACHE_LOCK = threading.Lock()
_REDIS_CACHE_CLIENT = None


def _get_redis_cache_client():
    global _REDIS_CACHE_CLIENT
    if _REDIS_CACHE_CLIENT is not None:
        return _REDIS_CACHE_CLIENT
    if not REDIS_URL or redis is None:
        return None
    try:
        _REDIS_CACHE_CLIENT = redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_timeout=1.5,
            socket_connect_timeout=1.5,
            retry_on_timeout=True,
        )
        _REDIS_CACHE_CLIENT.ping()
        logger.info("Redis cache client initialized")
        return _REDIS_CACHE_CLIENT
    except Exception as cache_err:
        logger.warning(f"Redis unavailable, using memory cache fallback: {cache_err}")
        _REDIS_CACHE_CLIENT = None
        return None


def _build_api_cache_key():
    if request.method != "GET":
        return None
    query = request.query_string.decode("utf-8") if request.query_string else ""
    return f"api-cache:{request.path}?{query}"


def _api_cache_get(key):
    if not key:
        return None
    redis_client = _get_redis_cache_client()
    redis_responded = False
    if redis_client:
        try:
            cached = redis_client.get(key)
            redis_responded = True
            if cached:
                logger.info("API_CACHE_HIT backend=redis key=%s", key)
                return json.loads(cached)
            logger.info("API_CACHE_MISS backend=redis key=%s", key)
        except Exception as cache_err:
            global _REDIS_CACHE_CLIENT
            _REDIS_CACHE_CLIENT = None
            logger.warning(f"Redis cache read failed: {cache_err}")
    # When Redis is healthy and returned a miss, that means the cache was
    # intentionally invalidated. Don't fall through to stale per-worker memory
    # in that case — only use memory when Redis itself is unavailable.
    if redis_responded:
        return None
    logger.info("API_CACHE_MISS backend=memory key=%s", key)
    now_ts = time.time()
    with _MEMORY_API_CACHE_LOCK:
        hit = _MEMORY_API_CACHE.get(key)
        if hit and hit.get("expires_at", 0) > now_ts:
            logger.info("API_CACHE_HIT backend=memory key=%s", key)
            return hit.get("payload")
        if hit:
            _MEMORY_API_CACHE.pop(key, None)
    return None


def _api_cache_set(key, payload, ttl_seconds=API_CACHE_TTL_SECONDS):
    if not key:
        return
    redis_client = _get_redis_cache_client()
    if redis_client:
        try:
            redis_client.setex(
                key, ttl_seconds, json.dumps(payload, ensure_ascii=False)
            )
            logger.info(
                "API_CACHE_SET backend=redis key=%s ttl_seconds=%s payload_count=%s",
                key,
                ttl_seconds,
                len(payload) if isinstance(payload, list) else 1,
            )
        except Exception as cache_err:
            global _REDIS_CACHE_CLIENT
            _REDIS_CACHE_CLIENT = None
            logger.warning(f"Redis cache write failed: {cache_err}")
    with _MEMORY_API_CACHE_LOCK:
        _MEMORY_API_CACHE[key] = {
            "payload": payload,
            "expires_at": time.time() + ttl_seconds,
        }
        # Evict expired entries and cap size at 500 keys to prevent unbounded growth.
        if len(_MEMORY_API_CACHE) > 500:
            now_ts = time.time()
            expired = [k for k, v in _MEMORY_API_CACHE.items() if v.get("expires_at", 0) <= now_ts]
            for k in expired:
                _MEMORY_API_CACHE.pop(k, None)
            if len(_MEMORY_API_CACHE) > 500:
                # Evict oldest-expiring 100 keys
                oldest = sorted(_MEMORY_API_CACHE, key=lambda k: _MEMORY_API_CACHE[k].get("expires_at", 0))[:100]
                for k in oldest:
                    _MEMORY_API_CACHE.pop(k, None)
    logger.info(
        "API_CACHE_SET backend=memory key=%s ttl_seconds=%s payload_count=%s",
        key,
        ttl_seconds,
        len(payload) if isinstance(payload, list) else 1,
    )


def _invalidate_api_cache_prefixes(prefixes):
    normalized_prefixes = []
    for prefix in prefixes or []:
        normalized = str(prefix or "").strip()
        if not normalized:
            continue
        normalized_prefixes.append(f"api-cache:{normalized}")

    if not normalized_prefixes:
        return

    redis_client = _get_redis_cache_client()
    if redis_client:
        try:
            keys_to_delete = []
            for prefix in normalized_prefixes:
                keys_to_delete.extend(list(redis_client.scan_iter(match=f"{prefix}*")))
            if keys_to_delete:
                redis_client.delete(*keys_to_delete)
            logger.info(
                "API_CACHE_INVALIDATE backend=redis prefixes=%s deleted=%s",
                normalized_prefixes,
                len(keys_to_delete),
            )
        except Exception as cache_err:
            logger.warning(f"Redis cache invalidation failed: {cache_err}")

    with _MEMORY_API_CACHE_LOCK:
        for key in list(_MEMORY_API_CACHE.keys()):
            if any(key.startswith(prefix) for prefix in normalized_prefixes):
                _MEMORY_API_CACHE.pop(key, None)
    logger.info("API_CACHE_INVALIDATE backend=memory prefixes=%s", normalized_prefixes)


def _invalidate_public_inventory_cache(item_type):
    # Normalize table names and singular forms to the plural API type key
    _alias_map = {
        "car": "cars", "car_parts": "parts", "part": "parts",
        "bike": "bikes", "license_plates": "plates", "plate": "plates",
        "buying_request": "buying_requests",
    }
    item_type = _alias_map.get(item_type, item_type)
    public_prefixes = {
        "cars": ["/api/cars", "/api/homepage/preview", "/api/recommendations", "/api/sitemap.xml"],
        "bikes": ["/api/bikes", "/api/sitemap.xml"],
        "parts": ["/api/parts", "/api/sitemap.xml"],
        "plates": ["/api/plates", "/api/license-plates", "/api/sitemap.xml"],
        "buying_requests": ["/api/buying-requests"],
    }
    _invalidate_api_cache_prefixes(public_prefixes.get(item_type, [f"/api/{item_type}"]))


def _cached_json_response(payload, status_code=200, ttl_seconds=API_CACHE_TTL_SECONDS):
    response = make_response(jsonify(payload), status_code)
    # no-store: server-side Redis/memory cache handles performance;
    # browser must always re-fetch so admin approvals appear immediately.
    response.headers["Cache-Control"] = "no-store"
    return response


def _attach_page_headers(response, items, limit):
    """Advertise keyset-pagination state for callers using ?cursor= instead of
    ?offset=; harmless to ignore for callers that don't."""
    response.headers["X-Has-More"] = "true" if len(items) >= limit else "false"
    if items:
        response.headers["X-Next-Cursor"] = str(items[-1].get("created_at") or "")
    return response


def _cache_lock_acquire(cache_key, ttl_seconds=5):
    """Try to acquire a short-lived Redis recompute lock (SETNX).

    Returns True if the lock was acquired (caller should compute).
    Returns False if another worker holds the lock (caller should wait then re-read).
    Always returns True when Redis is unavailable so callers never deadlock.
    """
    redis_client = _get_redis_cache_client()
    if not redis_client:
        return True
    try:
        return bool(redis_client.set(f"{cache_key}:lock", "1", nx=True, ex=ttl_seconds))
    except Exception:
        global _REDIS_CACHE_CLIENT
        _REDIS_CACHE_CLIENT = None
        return True


def _with_cache(cache_key, compute_fn, ttl_seconds):
    """Cache-aside helper with stampede protection.

    compute_fn() must return a JSON-serialisable value (dict or list).
    Returns the cached value, or the freshly-computed one after storing it.
    Does not cache None — callers that need to cache 'no result' should return
    an explicit sentinel dict instead.
    """
    cached = _api_cache_get(cache_key)
    if cached is not None:
        return cached

    if not _cache_lock_acquire(cache_key):
        # Another worker is recomputing; wait briefly then re-read.
        time.sleep(0.15)
        cached = _api_cache_get(cache_key)
        if cached is not None:
            return cached
        # Lock holder may have died — fall through and compute.

    result = compute_fn()
    if result is not None:
        _api_cache_set(cache_key, result, ttl_seconds)
    return result


def _parse_pagination_args():
    raw_limit = request.args.get("limit")
    raw_offset = request.args.get("offset")
    try:
        limit = int(raw_limit) if raw_limit is not None else DEFAULT_LIST_LIMIT
    except (TypeError, ValueError):
        limit = DEFAULT_LIST_LIMIT
    try:
        offset = int(raw_offset) if raw_offset is not None else 0
    except (TypeError, ValueError):
        offset = 0

    limit = max(1, min(limit, MAX_LIST_LIMIT))
    offset = max(0, offset)
    return limit, offset


def _collect_listing_filter_pairs(eq_fields, range_fields=None):
    """Read request.args for allow-listed listing filters (mirrors /api/cars'
    allowed_filters pattern for bikes/parts/plates). Returns a list of
    (db_field, postgrest_value) pairs rather than a dict — a dict would let a
    _to value silently overwrite a _from value set on the same column when both
    bounds of a range filter are supplied together.
    eq_fields: {url_param: db_column} for exact-match filters.
    range_fields: {url_prefix: db_column} for {prefix}_from/{prefix}_to filters."""
    pairs = []
    for url_param, db_column in eq_fields.items():
        value = request.args.get(url_param)
        if value:
            pairs.append((db_column, f"eq.{value}"))
    for prefix, db_column in (range_fields or {}).items():
        from_value = request.args.get(f"{prefix}_from")
        if from_value:
            pairs.append((db_column, f"gte.{from_value}"))
        to_value = request.args.get(f"{prefix}_to")
        if to_value:
            pairs.append((db_column, f"lte.{to_value}"))
    return pairs


def _search_or_group(fields, url_encode=False):
    """Build the body of a PostgREST `or(...)` group for `?q=<term>` free-text
    search across the given columns, or None if no search term was supplied.
    Strips characters that are syntactically significant to PostgREST's filter
    grammar so a search term can't inject extra filter clauses of its own.
    url_encode=True is for callers that splice the result into a manually-built
    URL string rather than passing it through requests' own params= encoding —
    a raw space in the term would otherwise break the request."""
    term = request.args.get("q", "").strip()
    if not term:
        return None
    safe_term = re.sub(r"[,()*]", "", term)[:100]
    if not safe_term:
        return None
    if url_encode:
        safe_term = quote(safe_term, safe="")
    return ",".join(f"{field}.ilike.*{safe_term}*" for field in fields)


def _combine_or_groups(*or_group_bodies):
    """Each argument is the inside-parens body of one `or(...)` group (no
    'or' keyword, no parens) or None. PostgREST only allows a single top-level
    `or=` filter, so combining more than one group (e.g. the reddit-exclusion
    group and the free-text search group) requires nesting them under a single
    `and=(or(...),or(...))`. Returns a {param_name: value} dict to merge into
    the query params, or {} if no group was supplied."""
    groups = [g for g in or_group_bodies if g]
    if not groups:
        return {}
    if len(groups) == 1:
        return {"or": f"({groups[0]})"}
    return {"and": "(" + ",".join(f"or({g})" for g in groups) + ")"}


def _cursor_filter(order_column="created_at"):
    """Optional keyset pagination: ?cursor=<ISO timestamp of the last row's
    created_at> switches the query from offset to `created_at < cursor`, which
    stays O(page size) instead of the database re-walking every already-skipped
    row as offset grows on a deep feed.
    ponytail: no id tie-break for created_at collisions — two listings created
    at the exact same microsecond is not realistic at this write rate. Add a
    composite (created_at,id) or-filter if that ever stops being true."""
    cursor = request.args.get("cursor", "").strip()
    if not cursor:
        return None
    return (order_column, f"lt.{cursor}")


def _extract_request_path(path):
    return path.split("?", 1)[0] if isinstance(path, str) else "unknown"


def _extract_payload_size_bytes(payload):
    try:
        if payload is None:
            return 0
        if isinstance(payload, (dict, list)):
            return len(json.dumps(payload, ensure_ascii=False))
        return len(str(payload))
    except Exception:
        return 0


def _batch_fetch_seller_map(user_ids, headers=None):
    unique_ids = sorted({uid for uid in user_ids if uid})
    if not unique_ids:
        return {}

    user_fields = "id,first_name,last_name,email,username,profile_photo_url,is_dealer,dealer_verified,company_name,legal_business_name"
    id_filter = ",".join(unique_ids)
    seller_map = {}
    try:
        if headers:
            user_url = (
                f"{app.config['SUPABASE_URL']}/rest/v1/users"
                f"?id=in.({id_filter})&select={user_fields}"
            )
            user_response = HTTP_SESSION.get(
                user_url, headers=headers, timeout=HTTP_DEFAULT_TIMEOUT_SECONDS
            )
            if user_response.status_code == 200:
                rows = user_response.json() or []
                seller_map = {row.get("id"): row for row in rows if row.get("id")}
        else:
            user_response, user_status = supabase_request(
                "get",
                f"/rest/v1/users?id=in.({id_filter})&select={user_fields}",
                use_service_role=True,
            )
            if user_status < 400 and isinstance(user_response, list):
                seller_map = {
                    row.get("id"): row for row in user_response if row.get("id")
                }
    except Exception as seller_err:
        logger.warning(f"Failed batch seller fetch: {seller_err}")
    return seller_map


def _apply_seller_to_listing(item, seller):
    if not isinstance(item, dict) or not isinstance(seller, dict):
        return item
    full_name = f"{seller.get('first_name', '')} {seller.get('last_name', '')}".strip()
    username = str(seller.get("username") or "").strip()
    # Public listings should prefer username over real names.
    seller_name = username or full_name or seller.get("email", "Marketplace Seller")
    item["seller_name"] = seller_name
    item["seller_id"] = seller.get("id")
    item["seller_profile_photo"] = seller.get("profile_photo_url")
    item["seller_verified"] = bool(seller.get("is_dealer", False))
    item["seller_dealer_verified"] = bool(
        seller.get("is_dealer", False) and seller.get("dealer_verified", False)
    )
    item["seller_company_name"] = (
        seller.get("legal_business_name") or seller.get("company_name") or ""
    ) or None
    return item


CAR_TRANSMISSION_OPTIONS = {"Automatic", "Manual"}
CAR_FUEL_OPTIONS = {"Petrol", "Diesel", "Electric", "Hybrid", "Other"}
STEERING_SIDE_OPTIONS = {"Left", "Right"}
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
    if isinstance(value, str):
        parsed = _parse_datetime(value)
        return parsed.astimezone(datetime.timezone.utc).isoformat() if parsed else value
    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc).isoformat()


# Reminder send-window. Reminders used to fire at whatever (night-time) UTC hour a
# row crossed its 24h/48h eligibility cutoff. Gate every reminder job to an evening
# window in local time (~7pm) so email + push land at a sane hour for the UAE
# audience (Asia/Dubai, UTC+4, no DST). All three knobs are env-tunable.
# ponytail: single fixed offset; add a per-user tz column only if you go multi-region.
REMINDER_TZ_OFFSET_HOURS = int(os.getenv("REMINDER_TZ_OFFSET_HOURS", "4"))
REMINDER_SEND_HOUR_START = int(os.getenv("REMINDER_SEND_HOUR_START", "18"))  # 6pm
REMINDER_SEND_HOUR_END = int(os.getenv("REMINDER_SEND_HOUR_END", "20"))      # 8pm (target ~7pm)


def _reminder_window_open(now=None):
    """True if the local wall clock is inside the evening reminder window."""
    now = now or _utc_now()
    local_hour = (now + datetime.timedelta(hours=REMINDER_TZ_OFFSET_HOURS)).hour
    return REMINDER_SEND_HOUR_START <= local_hour < REMINDER_SEND_HOUR_END


def _listing_type_for_table(table_name):
    return next(
        (
            key
            for key, cfg in LISTING_TABLE_CONFIG.items()
            if cfg["table"] == table_name
        ),
        None,
    )


def _is_listing_deleted(record):
    return bool(
        record and (record.get("status") == "deleted" or record.get("deleted_at"))
    )


def _default_expiry_from_created_at(record):
    created_at = _parse_datetime(record.get("created_at")) or _utc_now()
    return created_at + datetime.timedelta(days=LISTING_EXPIRY_DAYS)


def _renewal_timestamp(record):
    if not isinstance(record, dict):
        return None
    candidates = [
        _parse_datetime(record.get("last_extended_at")),
        _parse_datetime(record.get("sold_status_set_at")),
    ]
    candidates = [value for value in candidates if value is not None]
    if not candidates:
        return None
    return max(candidates)


def _stale_renewal_repair_fields(record):
    if not isinstance(record, dict):
        return None
    if record.get("status") in LISTING_TERMINAL_STATUSES or record.get("deleted_at"):
        return None
    if record.get("sold_status") != "not_sold_renew":
        return None

    renewal_at = _renewal_timestamp(record)
    if renewal_at is None:
        return None

    current_expires_at = _parse_datetime(record.get("expires_at")) or _default_expiry_from_created_at(record)
    min_expected_expiry = renewal_at + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
    if current_expires_at >= min_expected_expiry:
        return None

    repaired_expires_at = max(current_expires_at, renewal_at) + datetime.timedelta(
        days=LISTING_EXPIRY_DAYS
    )
    return {
        "expires_at": _isoformat_utc(repaired_expires_at),
        "expired_at": None,
        "retention_expires_at": _isoformat_utc(
            repaired_expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
        ),
        "sold_response_deadline": None,
        "auto_removed_at": None,
        "is_archived": False,
        "status": "approved",
    }


def _compute_listing_lifecycle(record):
    now = _utc_now()
    expires_at = _parse_datetime(
        record.get("expires_at")
    ) or _default_expiry_from_created_at(record)
    last_extended_at = _parse_datetime(record.get("last_extended_at"))
    renewal_repaired = False
    stale_renewal_repair = _stale_renewal_repair_fields(record)
    if stale_renewal_repair:
        repaired_expires_at = _parse_datetime(stale_renewal_repair.get("expires_at"))
        if repaired_expires_at:
            expires_at = repaired_expires_at
            renewal_repaired = True
    if (
        last_extended_at
        and expires_at <= last_extended_at
        and record.get("status") == "approved"
    ):
        repaired_expires_at = last_extended_at + datetime.timedelta(
            days=LISTING_EXPIRY_DAYS
        )
        if repaired_expires_at > expires_at:
            expires_at = repaired_expires_at
            renewal_repaired = True
    expired_at = _parse_datetime(record.get("expired_at"))
    if renewal_repaired:
        expired_at = None

    if not expired_at and now >= expires_at:
        expired_at = expires_at

    retention_expires_at = _parse_datetime(record.get("retention_expires_at"))
    if renewal_repaired:
        retention_expires_at = None
    if not retention_expires_at:
        retention_anchor = expired_at or expires_at
        retention_expires_at = retention_anchor + datetime.timedelta(
            days=LISTING_RETENTION_DAYS
        )

    sold_response_deadline = _parse_datetime(record.get("sold_response_deadline"))
    if renewal_repaired:
        sold_response_deadline = None
    if not sold_response_deadline and expired_at:
        sold_response_deadline = expired_at + datetime.timedelta(
            hours=LISTING_SOLD_RESPONSE_WINDOW_HOURS
        )

    is_deleted = _is_listing_deleted(record)
    is_archived = bool(record.get("is_archived")) or now >= retention_expires_at
    is_expired = now >= expires_at

    # An admin explicitly approved this listing — never auto-archive/expire it
    # based on stale legacy timestamps. The approval is authoritative; the
    # lifecycle worker will set a real expires_at via _sync_listing_lifecycle.
    admin_approved = (
        record.get("is_approved") is True
        and str(record.get("status") or "").lower() == "approved"
        and not record.get("deleted_at")
    )
    if admin_approved:
        is_archived = False
        is_expired = False

    if is_deleted:
        state = "deleted"
    elif is_archived:
        state = "archived"
    elif is_expired:
        state = "expired"
    else:
        state = "active"

    return {
        "expires_at": expires_at,
        "expired_at": expired_at,
        "retention_expires_at": retention_expires_at,
        "sold_response_deadline": sold_response_deadline,
        "is_expired": is_expired,
        "is_archived": is_archived,
        "is_deleted": is_deleted,
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
    record["sold_response_deadline"] = _isoformat_utc(
        lifecycle["sold_response_deadline"]
    )
    record["deleted_at"] = _isoformat_utc(record.get("deleted_at"))
    record["days_until_expiry"] = lifecycle["days_until_expiry"]
    record["days_until_deletion"] = lifecycle["days_until_deletion"]
    record["can_extend"] = not lifecycle["is_archived"] and record.get(
        "status"
    ) not in {
        "deleted",
        "rejected",
    }
    return record


_PUBLIC_STRIP_FIELDS = frozenset({
    "registration_document_url",
    "registration_doc_url",
    "proof_document_url",
})


def _preview_listing_record(record):
    if not isinstance(record, dict):
        return None
    preview = dict(record)
    _apply_listing_lifecycle_metadata(preview)
    for field in _PUBLIC_STRIP_FIELDS:
        preview.pop(field, None)
    return preview


def _listing_visible_to_requester(record, requesting_user=None):
    """Apply the shared approval/lifecycle/owner rule to detail reads."""
    if not isinstance(record, dict):
        return False, False
    is_owner = bool(requesting_user and record.get("user_id") == requesting_user)
    lifecycle = _compute_listing_lifecycle(record)
    is_public = (
        str(record.get("status") or "").lower() == "approved"
        and record.get("is_approved") is True
        and lifecycle["state"] == "active"
    )
    return is_public or is_owner, is_public


def _request_client_ip():
    """Return the peer IP; ProxyFix supplies forwarded IPs only when trusted."""
    return request.remote_addr or ""


def _fetch_listing_lifecycle_rows():
    rows_by_type = {}

    def _load_rows(label, table_name):
        # Page through every row: a single request caps at PostgREST's
        # db-max-rows (typically 1000), which silently truncated the lifecycle
        # totals (cars_total, active/pending/sold counts) once any listing
        # table crossed 1000 rows.
        rows, status_code = _fetch_all_rows(
            f"/rest/v1/{table_name}",
            {
                "select": "id,status,is_approved," + LISTING_LIFECYCLE_SELECT,
            },
        )
        if status_code >= 400:
            logger.warning(
                "Failed to fetch lifecycle rows for %s: %s",
                table_name,
                rows,
            )
            return label, []
        return label, rows or []

    with ThreadPoolExecutor(max_workers=len(LIFECYCLE_SUMMARY_TABLES)) as executor:
        future_map = {
            executor.submit(_load_rows, label, table_name): label
            for label, table_name in LIFECYCLE_SUMMARY_TABLES.items()
        }
        for future in as_completed(future_map):
            label, rows = future.result()
            rows_by_type[label] = rows

    for label in LIFECYCLE_SUMMARY_TABLES:
        rows_by_type.setdefault(label, [])
    return rows_by_type


def _build_listing_lifecycle_summary_from_rows(rows_by_type, draft_total=0):
    totals = defaultdict(int)
    by_type = {}

    for label in LIFECYCLE_SUMMARY_TABLES:
        counts = {
            "active": 0,
            "pending": 0,
            "draft": 0,
            "expired": 0,
            "sold_on_dph": 0,
            "sold_elsewhere": 0,
            "no_response": 0,
            "deleted": 0,
            "total": 0,
        }
        for row in rows_by_type.get(label, []) or []:
            preview = _preview_listing_record(row)
            if not preview:
                continue
            counts["total"] += 1

            status = str(preview.get("status") or "").strip().lower()
            state = str(preview.get("listing_state") or "").strip().lower()
            sold_status = str(preview.get("sold_status") or "").strip().lower()

            if status == "approved" and state == "active":
                counts["active"] += 1
            if status in ("pending", "pending_auto_review"):
                counts["pending"] += 1
            if status == "deleted":
                counts["deleted"] += 1
            if sold_status == "sold_on_dph":
                counts["sold_on_dph"] += 1
            if sold_status == "sold_elsewhere":
                counts["sold_elsewhere"] += 1
            if sold_status == "no_response":
                counts["no_response"] += 1
            if state in {"expired", "archived"} or (
                preview.get("auto_removed_at") and preview.get("is_expired")
            ):
                counts["expired"] += 1

        counts["sold_total"] = counts["sold_on_dph"] + counts["sold_elsewhere"]
        by_type[label] = counts
        for key, value in counts.items():
            totals[key] += value

    totals["draft"] = draft_total
    by_type["drafts"] = {"draft": draft_total, "total": draft_total}
    return {"totals": dict(totals), "by_type": by_type}


def _cached_cropped_at_pct():
    cache_key = "api-cache:admin-stats:cropped-at-pct"
    cached_value = _api_cache_get(cache_key)
    if cached_value is not None:
        return cached_value

    cropped_at_pct = None
    try:
        total_all = 0
        cropped_all = 0
        for table in ("car_images", "bike_images", "plate_images", "part_images"):
            total_all += _supabase_count(table)
            cropped_all += _supabase_count(table, {"cropped_at": "not.is.null"})
        if total_all > 0:
            cropped_at_pct = round(100.0 * cropped_all / total_all, 2)
    except Exception as exc:
        logger.warning("cropped_at_pct calculation failed: %s", exc)

    _api_cache_set(cache_key, cropped_at_pct, ttl_seconds=3600)
    return cropped_at_pct


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


def _record_listing_deletion_event(
    *,
    listing_id,
    listing_type,
    reason,
    deleted_by_role,
    deleted_by=None,
    metadata=None,
):
    payload = {
        "listing_id": str(listing_id),
        "listing_type": str(listing_type),
        "reason": reason or "Deleted",
        "deleted_by_role": deleted_by_role,
        "deleted_by": deleted_by,
        "metadata": metadata or {},
    }
    response, status_code = supabase_request(
        "post",
        "/rest/v1/listing_deletion_events",
        data=payload,
        use_service_role=True,
    )
    if status_code >= 400:
        logger.warning(
            f"Failed to record listing deletion event for {listing_type}/{listing_id}: {response}"
        )


def _record_listing_expiry_notice_event(
    *,
    listing_id,
    listing_type,
    metadata=None,
):
    _record_listing_deletion_event(
        listing_id=listing_id,
        listing_type=listing_type,
        reason=LISTING_EXPIRY_NOTICE_REASON,
        deleted_by_role="system",
        deleted_by=None,
        metadata=metadata or {},
    )


def _log_listing_expiry_decision(event, **fields):
    payload = {"event": event}
    payload.update(fields)
    try:
        logger.info(json.dumps(payload, default=str, sort_keys=True))
    except TypeError:
        logger.info("%s %s", event, payload)


def _claim_listing_expiry_email(
    table_name,
    listing_id,
    expires_at,
    email_field,
    *,
    mark_expired=False,
):
    expires_at_iso = _isoformat_utc(_parse_datetime(expires_at))
    if not listing_id or not expires_at_iso:
        _log_listing_expiry_decision(
            "listing_expiry_claim_skipped",
            listingId=listing_id,
            emailField=email_field,
            reason="missing_listing_or_expires_at",
        )
        return None

    now_iso = _isoformat_utc(_utc_now())
    updates = {email_field: now_iso}
    if mark_expired:
        updates["expired_at"] = expires_at_iso

    response, status = supabase_request(
        "patch",
        f"/rest/v1/{table_name}",
        params={
            "id": f"eq.{listing_id}",
            "status": "in.(approved,active)",
            "deleted_at": "is.null",
            "is_archived": "eq.false",
            "expires_at": f"eq.{expires_at_iso}",
            email_field: "is.null",
        },
        data=updates,
        use_service_role=True,
    )
    if status >= 400:
        _log_listing_expiry_decision(
            "listing_expiry_claim_failed",
            listingId=listing_id,
            table=table_name,
            emailField=email_field,
            expiresAt=expires_at_iso,
            status=status,
            response=response,
        )
        return None
    if not response:
        _log_listing_expiry_decision(
            "listing_expiry_claim_skipped",
            listingId=listing_id,
            table=table_name,
            emailField=email_field,
            expiresAt=expires_at_iso,
            reason="atomic_claim_failed",
        )
        return None

    claimed = response[0] if isinstance(response, list) else response
    _log_listing_expiry_decision(
        "listing_expiry_claimed",
        listingId=listing_id,
        table=table_name,
        emailField=email_field,
        expiresAt=expires_at_iso,
    )
    return claimed


def _soft_delete_listing(
    table_name,
    listing_id,
    *,
    deleted_by_role="user",
    deleted_by=None,
    reason="Deleted",
    metadata=None,
):
    now_iso = _isoformat_utc(_utc_now())
    response, status = supabase_request(
        "patch",
        f"/rest/v1/{table_name}",
        params={"id": f"eq.{listing_id}"},
        data={
            "status": "deleted",
            "deleted_at": now_iso,
            "auto_removed_at": now_iso if deleted_by_role == "system" else None,
        },
        use_service_role=True,
    )
    if status < 400 and not response:
        return {"error": "Listing not found"}, 404
    if status < 400:
        listing_type = _listing_type_for_table(table_name)
        if listing_type:
            _record_listing_deletion_event(
                listing_id=listing_id,
                listing_type=listing_type,
                reason=reason,
                deleted_by_role=deleted_by_role,
                deleted_by=deleted_by,
                metadata=metadata or {},
            )
        _log_listing_expiry_decision(
            "listing_deleted",
            listingId=listing_id,
            table=table_name,
            deletedAt=now_iso,
            deletedByRole=deleted_by_role,
        )
    return response, status


def _get_recent_listing_expiry_notice_dates(listing_type, cutoff):
    response, status_code = supabase_request(
        "get",
        "/rest/v1/listing_deletion_events",
        params={
            "select": "listing_id,created_at,metadata",
            "listing_type": f"eq.{listing_type}",
            "reason": f"eq.{LISTING_EXPIRY_NOTICE_REASON}",
            "created_at": f"gte.{_isoformat_utc(cutoff)}",
            "order": "created_at.desc",
            "limit": "1000",
        },
        use_service_role=True,
    )
    if status_code >= 400 or not response:
        return set()
    notices = set()
    for row in response:
        listing_id = row.get("listing_id")
        if not listing_id:
            continue
        metadata = row.get("metadata") or {}
        notice_date = metadata.get("notice_date")
        created_at = _parse_datetime(row.get("created_at"))
        if not notice_date and created_at:
            notice_date = created_at.date().isoformat()
        if notice_date:
            notices.add((str(listing_id), str(notice_date)))
    return notices


def _sync_listing_lifecycle(
    table_name, record, *, hard_delete_archived=False, persist=True
):
    if not isinstance(record, dict):
        return record
    if _is_listing_deleted(record):
        _apply_listing_lifecycle_metadata(record)
        if persist:
            _log_listing_expiry_decision(
                "skipping_listing_expiry_job",
                listingId=record.get("id"),
                table=table_name,
                status=record.get("status"),
                deletedAt=record.get("deleted_at"),
                reason="listing_deleted",
            )
        return record

    repaired = {}
    stale_renewal_repair = _stale_renewal_repair_fields(record)
    if stale_renewal_repair:
        repaired.update(stale_renewal_repair)
        record = {**record, **stale_renewal_repair}

    last_extended_at = _parse_datetime(record.get("last_extended_at"))
    expires_at = _parse_datetime(record.get("expires_at"))
    if (
        last_extended_at
        and expires_at
        and last_extended_at > expires_at
        and record.get("status") not in {"deleted", "rejected"}
        and not record.get("deleted_at")
    ):
        repaired_expires_at = last_extended_at + datetime.timedelta(
            days=LISTING_EXPIRY_DAYS
        )
        if repaired_expires_at > expires_at:
            repaired = {
                "expires_at": _isoformat_utc(repaired_expires_at),
                "expired_at": None,
                "retention_expires_at": _isoformat_utc(
                    repaired_expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
                ),
                "sold_response_deadline": None,
                "auto_removed_at": None,
                "is_archived": False,
            }
            if record.get("status") != "approved":
                repaired["status"] = "approved"
            record = {**record, **repaired}

    lifecycle = _compute_listing_lifecycle(record)
    updates = {}

    if repaired:
        updates.update(repaired)
    if record.get("expires_at") is None:
        updates["expires_at"] = _isoformat_utc(lifecycle["expires_at"])
    if lifecycle["is_expired"] and record.get("expired_at") is None:
        updates["expired_at"] = _isoformat_utc(lifecycle["expired_at"])
    if record.get("retention_expires_at") is None:
        updates["retention_expires_at"] = _isoformat_utc(
            lifecycle["retention_expires_at"]
        )
    if record.get("sold_response_deadline") is None and lifecycle.get(
        "sold_response_deadline"
    ):
        updates["sold_response_deadline"] = _isoformat_utc(
            lifecycle["sold_response_deadline"]
        )

    sold_response_deadline = lifecycle.get("sold_response_deadline")
    sold_status_set_at = _parse_datetime(record.get("sold_status_set_at"))
    if (
        lifecycle["is_expired"]
        and sold_response_deadline
        and _utc_now() >= sold_response_deadline
        and not sold_status_set_at
        and record.get("status") not in LISTING_TERMINAL_STATUSES
        and not record.get("deleted_at")
    ):
        updates["status"] = "deleted"
        updates["deleted_at"] = _isoformat_utc(_utc_now())
        updates["auto_removed_at"] = _isoformat_utc(_utc_now())
        updates["sold_status"] = record.get("sold_status") or "no_response"
        updates["sold_status_set_at"] = _isoformat_utc(_utc_now())

    if lifecycle["is_archived"] and not record.get("is_archived"):
        updates["is_archived"] = True

    if updates and persist:
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
            if updates.get("status") == "deleted" and updates.get("auto_removed_at"):
                listing_type = _listing_type_for_table(table_name)
                if listing_type:
                    window_label = (
                        f"{LISTING_SOLD_RESPONSE_WINDOW_HOURS // 24} days"
                        if LISTING_SOLD_RESPONSE_WINDOW_HOURS % 24 == 0
                        else f"{LISTING_SOLD_RESPONSE_WINDOW_HOURS} hours"
                    )
                    _record_listing_deletion_event(
                        listing_id=record.get("id"),
                        listing_type=listing_type,
                        reason=f"No listing outcome selected within {window_label} of expiry",
                        deleted_by_role="system",
                        metadata={
                            "expired_at": record.get("expired_at"),
                            "sold_response_deadline": record.get(
                                "sold_response_deadline"
                            ),
                        },
                    )

    _apply_listing_lifecycle_metadata(record)

    if not persist:
        return record

    _log_listing_expiry_decision(
        "processing_listing_expiry_job",
        listingId=record.get("id"),
        jobExpiresAt=_isoformat_utc(lifecycle.get("expires_at")),
        dbExpiresAt=record.get("expires_at"),
        status=record.get("status"),
        deletedAt=record.get("deleted_at"),
        expiryReminderSentAt=record.get("expiry_reminder_sent_at"),
        expiredEmailSentAt=record.get("expired_email_sent_at"),
    )

    # Expired emails are claimed in the database before sending so retries,
    # scanner loops, and multiple worker instances cannot duplicate delivery.
    owner_email = _resolve_listing_owner_email(record)
    last_extended_at = _parse_datetime(record.get("last_extended_at"))
    renewed_recently = bool(
        last_extended_at
        and lifecycle["expired_at"]
        and last_extended_at >= lifecycle["expired_at"]
    )
    if (
        LISTING_EXPIRY_EMAILS_ENABLED
        and lifecycle["is_expired"]
        and not record.get("expired_email_sent_at")
        and owner_email
        and not renewed_recently
        and record.get("status") in LISTING_ACTIVE_STATUSES
        and not record.get("deleted_at")
    ):
        claimed_record = _claim_listing_expiry_email(
            table_name,
            record.get("id"),
            lifecycle["expires_at"],
            "expired_email_sent_at",
            mark_expired=not bool(record.get("expired_at")),
        )
        if not claimed_record:
            _log_listing_expiry_decision(
                "skipping_listing_expiry_job",
                listingId=record.get("id"),
                table=table_name,
                reason="atomic_claim_failed",
                emailField="expired_email_sent_at",
            )
            return record
        record.update(claimed_record)
        try:
            _, expiry_email_error = _send_listing_expired_email(
                owner_email,
                _listing_display_title(record),
                table_name,
                record.get("id"),
                record.get("days_until_deletion", 30),
            )
            if not expiry_email_error:
                listing_type = next(
                    (
                        key
                        for key, cfg in LISTING_TABLE_CONFIG.items()
                        if cfg["table"] == table_name
                    ),
                    None,
                )
                if listing_type:
                    _record_listing_expiry_notice_event(
                        listing_id=record.get("id"),
                        listing_type=listing_type,
                        metadata={
                            "table": table_name,
                            "state": "expired",
                            "expires_at": _isoformat_utc(lifecycle["expires_at"]),
                            "retention_expires_at": _isoformat_utc(
                                lifecycle["retention_expires_at"]
                            ),
                        },
                    )
        except Exception as email_err:
            logger.warning(f"Failed sending expiry email: {email_err}")
    elif lifecycle["is_expired"] and record.get("expired_email_sent_at"):
        _log_listing_expiry_decision(
            "skipping_listing_expiry_job",
            listingId=record.get("id"),
            table=table_name,
            reason="email_already_sent",
            emailField="expired_email_sent_at",
        )

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
        "sold_status": None,
        "sold_status_set_at": None,
        "sold_response_deadline": None,
        "auto_removed_at": None,
        "deleted_at": None,
        "renewed_at": None,
        "expiry_reminder_sent_at": None,
        "expired_email_sent_at": None,
        "reminder_job_id": None,
        "expiration_job_id": None,
    }


def _resubmission_listing_lifecycle_fields():
    """Return fresh lifecycle fields for listings being re-submitted."""
    now = _utc_now()
    expires_at = now + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
    return {
        "expires_at": _isoformat_utc(expires_at),
        "expired_at": None,
        "retention_expires_at": _isoformat_utc(
            expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
        ),
        "last_extended_at": _isoformat_utc(now),
        "sold_status": None,
        "sold_status_set_at": None,
        "sold_response_deadline": None,
        "auto_removed_at": None,
        "deleted_at": None,
        "renewed_at": _isoformat_utc(now),
        "expiry_reminder_sent_at": None,
        "expired_email_sent_at": None,
        "reminder_job_id": None,
        "expiration_job_id": None,
        "is_archived": False,
    }


def _build_renewed_listing_updates(listing, *, now=None):
    now = now or _utc_now()
    expiry_anchor = _parse_datetime((listing or {}).get("expires_at")) or now
    if expiry_anchor < now:
        expiry_anchor = now
    new_expires_at = expiry_anchor + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
    return {
        "status": "approved",
        "sold_status": "not_sold_renew",
        "sold_status_set_at": _isoformat_utc(now),
        "last_extended_at": _isoformat_utc(now),
        "renewed_at": _isoformat_utc(now),
        "extension_count": int((listing or {}).get("extension_count") or 0) + 1,
        "expires_at": _isoformat_utc(new_expires_at),
        "expired_at": None,
        "expiry_reminder_sent_at": None,
        "expired_email_sent_at": None,
        "retention_expires_at": _isoformat_utc(
            new_expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
        ),
        "sold_response_deadline": None,
        "auto_removed_at": None,
        # Clear deleted_at so a system auto-removal (sold_response_deadline lapsed)
        # is reversed when the owner explicitly says "not sold, renew it."
        "deleted_at": None,
        "reminder_job_id": (
            f"listing:{(listing or {}).get('id')}:reminder:"
            f"{int(new_expires_at.timestamp() * 1000)}"
        ),
        "expiration_job_id": (
            f"listing:{(listing or {}).get('id')}:expire:"
            f"{int(new_expires_at.timestamp() * 1000)}"
        ),
        "is_archived": False,
    }


def _listing_needs_renewal_repair(record):
    return bool(_stale_renewal_repair_fields(record))


def _fetch_listing_by_id(table_name, listing_id, *, current_user=None, use_service_role=False):
    params = {"select": "*", "id": f"eq.{listing_id}", "limit": 1}
    response, status_code = supabase_request(
        "get",
        f"/rest/v1/{table_name}",
        params=params,
        user_id=current_user,
        use_service_role=use_service_role,
    )
    if status_code >= 400:
        return None, status_code
    if not response:
        return None, 404
    return response[0], 200


def _renew_listing_and_verify(table_name, listing_id, listing, *, current_user=None):
    # System auto-removed listings (sold_response_deadline lapsed, no owner action)
    # are recoverable: clearing deleted_at + auto_removed_at brings them back live.
    # Owner-intended sold/rejected outcomes and admin-initiated deletes are not.
    record = listing or {}
    auto_removed = bool(record.get("auto_removed_at"))
    is_recoverable_auto_delete = (
        auto_removed
        and record.get("status") == "deleted"
        and record.get("sold_status") in (None, "sold_elsewhere", "not_sold_renew")
    )

    if (
        _is_listing_deleted(listing)
        or record.get("status") in LISTING_TERMINAL_STATUSES
    ) and not is_recoverable_auto_delete:
        return None, 400, {"error": "This listing cannot be renewed"}

    renewal_updates = _build_renewed_listing_updates(listing)
    patch_response, patch_status = supabase_request(
        "patch",
        f"/rest/v1/{table_name}?id=eq.{listing_id}",
        data=renewal_updates,
        use_service_role=True,
    )
    if patch_status >= 400:
        logger.error(
            "Renewal PATCH failed table=%s id=%s status=%s response=%s",
            table_name, listing_id, patch_status, patch_response,
        )
        # PostgREST returns "PGRST204" / "column ... does not exist" when a column
        # in our payload isn't present on the target table. Retry without optional
        # idempotency columns so renewal still succeeds on older schemas; the worker
        # backfills these on its next sweep.
        message = ""
        if isinstance(patch_response, dict):
            message = str(patch_response.get("message") or patch_response.get("hint") or "")
        elif isinstance(patch_response, str):
            message = patch_response
        message_lc = message.lower()

        optional_keys = {
            "renewed_at", "reminder_job_id", "expiration_job_id",
            "expired_email_sent_at", "expiry_reminder_sent_at",
            "auto_removed_at", "retention_expires_at", "sold_response_deadline",
            "is_archived",
        }
        if patch_status == 400 and ("does not exist" in message_lc or "schema cache" in message_lc):
            stripped = {k: v for k, v in renewal_updates.items() if k not in optional_keys}
            logger.warning(
                "Renewal retry without optional columns table=%s id=%s remaining=%s",
                table_name, listing_id, list(stripped.keys()),
            )
            patch_response, patch_status = supabase_request(
                "patch",
                f"/rest/v1/{table_name}?id=eq.{listing_id}",
                data=stripped,
                use_service_role=True,
            )
        if patch_status >= 400:
            error_payload = {
                "error": "Failed to renew listing",
                "detail": patch_response if isinstance(patch_response, (dict, str)) else None,
            }
            return None, patch_status, error_payload

    refreshed_listing, refreshed_status = _fetch_listing_by_id(
        table_name,
        listing_id,
        use_service_role=True,
    )
    if refreshed_status >= 400 or not refreshed_listing:
        return None, refreshed_status, {"error": "Failed to reload renewed listing"}

    if _listing_needs_renewal_repair(refreshed_listing):
        repair_updates = _stale_renewal_repair_fields(refreshed_listing) or {}
        if repair_updates:
            repair_updates["sold_status"] = "not_sold_renew"
            repair_updates["sold_status_set_at"] = renewal_updates["sold_status_set_at"]
            repair_updates["last_extended_at"] = renewal_updates["last_extended_at"]
            repair_updates["extension_count"] = renewal_updates["extension_count"]
            repair_response, repair_status = supabase_request(
                "patch",
                f"/rest/v1/{table_name}?id=eq.{listing_id}",
                data=repair_updates,
                use_service_role=True,
            )
            if repair_status >= 400:
                return None, repair_status, repair_response
            refreshed_listing, refreshed_status = _fetch_listing_by_id(
                table_name,
                listing_id,
                use_service_role=True,
            )
            if refreshed_status >= 400 or not refreshed_listing:
                return None, refreshed_status, {
                    "error": "Failed to reload repaired renewed listing"
                }

    synced_listing = _sync_listing_lifecycle(
        table_name,
        refreshed_listing,
        hard_delete_archived=False,
    )
    if not synced_listing:
        return None, 410, {"error": "Listing is no longer available"}
    if _listing_needs_renewal_repair(synced_listing):
        return None, 500, {"error": "Listing renewal did not persist correctly"}
    return synced_listing, 200, None


def _strip_lifecycle_fields(payload):
    if not isinstance(payload, dict):
        return payload
    lifecycle_keys = {
        # Original lifecycle columns (add_lifecycle_columns.sql)
        "expires_at",
        "expired_at",
        "retention_expires_at",
        "last_extended_at",
        "extension_count",
        "is_archived",
        # Expiry/idempotency columns (add_listing_expiry_idempotency_columns.sql)
        "renewed_at",
        "deleted_at",
        "expiry_reminder_sent_at",
        "expired_email_sent_at",
        "reminder_job_id",
        "expiration_job_id",
        # Lead-tracking / sold-outcome columns (add_lead_tracking_and_listing_outcomes)
        "sold_status",
        "sold_status_set_at",
        "sold_response_deadline",
        "auto_removed_at",
        # Auto-review columns (add_auto_review_columns.sql)
        "auto_review_state",
        "auto_review_reasons",
        "auto_review_decided_at",
        # Draft-reminder columns (add_reminder_system_48h_20260619.sql)
        "draft_reminder_sent_at",
        "draft_reminder_claimed_at",
        "draft_reminder_count",
        # Other fields that newer schemas add
        "extras",
        "user_email",
        # Plates-specific columns added by later migrations
        "listing_title",
        "whatsapp_number",
    }
    return {key: value for key, value in payload.items() if key not in lifecycle_keys}


def _create_listing_with_lifecycle_fallback(path, payload, *, user_id):
    response, status_code = supabase_request(
        "post", path, data=payload, user_id=user_id
    )
    if status_code < 400:
        return response, status_code

    error_text = json.dumps(response).lower()
    # Any column that lives in _strip_lifecycle_fields is a lifecycle column.
    # If the DB is missing one (migration not yet applied), the insert fails with
    # 42703 and we retry without it rather than surfacing a config error.
    lifecycle_error_keywords = [
        "expires_at", "retention_expires_at", "expired_at", "last_extended_at",
        "extension_count", "is_archived",
        "renewed_at", "deleted_at", "expiry_reminder_sent_at", "expired_email_sent_at",
        "reminder_job_id", "expiration_job_id",
        "sold_status", "sold_status_set_at", "sold_response_deadline", "auto_removed_at",
        "auto_review_state", "auto_review_reasons", "auto_review_decided_at",
        "draft_reminder_sent_at", "draft_reminder_claimed_at", "draft_reminder_count",
        "user_email",
        # Plates/bikes columns added by later migrations — strip on fallback if missing
        "listing_title", "whatsapp_number",
    ]
    has_lifecycle_error = any(
        keyword in error_text for keyword in lifecycle_error_keywords
    )

    if not has_lifecycle_error:
        return response, status_code

    logger.warning(
        f"Lifecycle columns missing for {path}. Retrying insert without lifecycle fields."
    )
    fallback_payload = _strip_lifecycle_fields(payload)
    return supabase_request("post", path, data=fallback_payload, user_id=user_id)


def _friendly_db_error(raw_data, status_code, listing_type="listing"):
    """Translate a raw PostgREST error into a user-safe message and log the original."""
    if isinstance(raw_data, dict):
        raw_message = raw_data.get("message") or raw_data.get("error") or str(raw_data)
        raw_code = str(raw_data.get("code") or "")
    else:
        raw_message = str(raw_data)
        raw_code = ""

    logger.error(
        "listing_create_failed type=%s status=%s code=%s msg=%s",
        listing_type, status_code, raw_code, raw_message[:500],
    )

    msg = raw_message.lower()
    if raw_code == "42501" or "row-level security" in msg or "rls" in msg:
        friendly = "We could not save your listing due to a permissions issue. Please try again or contact support."
    elif raw_code == "23505" or "duplicate" in msg or "unique" in msg:
        friendly = "A similar listing already exists."
    elif raw_code == "23502" or "null value" in msg or "not-null" in msg:
        friendly = "Some required information is missing. Please check all fields and try again."
    elif raw_code in ("42P01", "42703", "PGRST204", "PGRST205") or "schema cache" in msg:
        friendly = "A configuration error prevented saving. Please contact support."
    elif raw_code == "23514" or "violates check constraint" in msg:
        friendly = "One of the submitted values is not allowed. Please contact support if this persists."
    elif raw_code == "22P02" or "malformed array literal" in msg or "invalid input syntax" in msg:
        friendly = "One of the submitted values has an unexpected format. Please check your inputs and try again."
    else:
        friendly = "We could not save your listing. Please try again."

    return {"error": friendly}, status_code


SITE_NAME = os.getenv("SITE_NAME", "UAE Classifieds")
SITE_URL = os.getenv("SITE_URL", "https://www.dphclassifieds.com")


def _send_email(to_address, subject, html_body):
    """Send an email if Flask-Mail is configured."""
    if not MAIL_ENABLED or not mail:
        logger.info(f"Email skipped (not configured): {subject} -> {to_address}")
        return False
    try:
        with app.app_context():
            msg = MailMessage(subject=subject, recipients=[to_address], html=html_body)
            mail.send(msg)
        logger.info(f"Email sent: {subject} -> {to_address}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_address}: {e}")
        return False


def _send_listing_expiry_reminder(
    user_email, listing_title, listing_type, listing_id, days_left
):
    if not user_email:
        return None, f"{user_email}"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    detail_paths = {
        "cars": "cars",
        "bikes": "bikes",
        "car_parts": "car-parts",
        "license_plates": "plates",
    }
    path = detail_paths.get(listing_type, listing_type)
    my_listings_url = f"{SITE_URL}/my-listings"

    subject = f"Your listing '{listing_title}' expires in {days_left} day{'s' if days_left != 1 else ''} - DPH Classifieds"

    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #8bd6b4; letter-spacing: -0.02em;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
        </div>
        
        <div style="background: rgba(255, 255, 255, 0.03); border-radius: 20px; padding: 32px; border: 1px solid rgba(255, 255, 255, 0.05); margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 16px;">Action Required: Listing Expiring</h2>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">
                Hi there, your listing <strong>"{listing_title}"</strong> is set to expire in <strong>{days_left} day{"s" if days_left != 1 else ""}</strong>.
            </p>
            
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">
                To keep your listing visible to potential buyers, please visit your dashboard and choose an action:
            </p>
            
            <div style="background: rgba(139, 214, 180, 0.05); border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px dashed rgba(139, 214, 180, 0.2);">
                <ul style="margin: 0; padding-left: 20px; color: #8bd6b4;">
                    <li style="margin-bottom: 8px;"><strong>Renew Listing:</strong> Extend visibility for another 15 days.</li>
                    <li style="margin-bottom: 8px;"><strong>Mark as Sold:</strong> Let us know if you sold it on DPH or elsewhere.</li>
                </ul>
            </div>

            <a href="{my_listings_url}" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; transition: transform 0.2s;">Go to My Listings</a>
        </div>
        
        <div style="text-align: center; color: #64748b; font-size: 14px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="listing_expiry_reminder")


def _send_listing_expired_email(
    user_email, listing_title, listing_type, listing_id, days_until_deletion
):
    if not user_email:
        return None, f"{user_email}"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    my_listings_url = f"{SITE_URL}/my-listings"
    subject = f"Your listing '{listing_title}' has expired – action needed"

    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #8bd6b4; letter-spacing: -0.02em;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
        </div>
        <div style="background: rgba(239, 68, 68, 0.08); border-radius: 20px; padding: 32px; border: 1px solid rgba(239, 68, 68, 0.2); margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 16px;">Your Listing Has Expired</h2>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 16px;">
                Hi there, your listing <strong style="color: #f0fdf4;">"{listing_title}"</strong> has expired and is no longer visible to buyers.
            </p>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">
                You have <strong style="color: #ef4444;">{days_until_deletion} day{"s" if days_until_deletion != 1 else ""}</strong> to take action before it is permanently removed.
            </p>
            <div style="background: rgba(139, 214, 180, 0.05); border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px dashed rgba(139, 214, 180, 0.2);">
                <ul style="margin: 0; padding-left: 20px; color: #8bd6b4;">
                    <li style="margin-bottom: 8px;"><strong>Renew Listing:</strong> Extend visibility for another 15 days.</li>
                    <li style="margin-bottom: 8px;"><strong>Sold on DPH:</strong> Mark it as sold via our platform.</li>
                    <li style="margin-bottom: 8px;"><strong>Sold Elsewhere:</strong> Let us know it sold outside DPH.</li>
                </ul>
            </div>
            <a href="{my_listings_url}" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">Go to My Listings</a>
        </div>
        <div style="text-align: center; color: #64748b; font-size: 14px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="listing_expired")


def _listing_display_title(record):
    record = record or {}
    return (
        record.get("listing_title")
        or record.get("item_name")
        or f"{record.get('city', '')} {record.get('code', '')} {record.get('number', '')}".strip()
        or record.get("name")
        or "Your listing"
    )


_RENEW_PATH_MAP = {
    "cars": "cars",
    "bikes": "bikes",
    "car_parts": "parts",
    "license_plates": "plates",
    "car": "cars",
    "bike": "bikes",
    "part": "parts",
    "plate": "plates",
    "parts": "parts",
    "plates": "plates",
}


def _renewal_landing_url(item_type, item_id):
    slug = _RENEW_PATH_MAP.get(item_type, item_type)
    return f"{SITE_URL}/listings/{slug}/{item_id}/renew?utm_source=admin_nudge"


def _send_renewal_nudge_email(user_email, listing_title, item_type, item_id):
    if not user_email:
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    renew_url = _renewal_landing_url(item_type, item_id)
    subject = "Your listing has expired — please renew it"

    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #8bd6b4; letter-spacing: -0.02em;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.03); border-radius: 20px; padding: 32px; border: 1px solid rgba(255, 255, 255, 0.05); margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 16px;">Hey — your listing has expired</h2>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 16px;">
                Your listing <strong style="color: #f0fdf4;">"{listing_title}"</strong> is no longer visible to buyers.
            </p>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">
                Please tap below to renew it — or let us know if you've already sold it.
            </p>
            <a href="{renew_url}" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">Renew my listing</a>
            <p style="color: #64748b; font-size: 12px; margin-top: 20px;">If the button doesn't work, paste this link into your browser:<br/><a href="{renew_url}" style="color: #8bd6b4; word-break: break-all;">{renew_url}</a></p>
        </div>
        <div style="text-align: center; color: #64748b; font-size: 14px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="renewal_nudge")


def _send_renewal_nudge_sms(to_phone, item_type, item_id, country_code):
    """Return an explicit unavailable result for the retired SMS channel."""
    return False, {"message": "SMS channel not configured"}


def _send_renewal_nudge_whatsapp(to_phone, item_type, item_id, country_code):
    """Return an explicit unavailable result for the optional WhatsApp channel."""
    return False, {"message": "WhatsApp channel not configured"}


def _resolve_listing_owner_email(record, fallback_user_id=None):
    record = record or {}
    for key in ("user_email", "contact_email"):
        email = record.get(key)
        if email and EMAIL_REGEX.match(str(email)):
            return email

    owner_id = record.get("user_id") or fallback_user_id
    if owner_id:
        try:
            email = get_user_email(owner_id)
        except Exception as exc:
            logger.warning(f"Failed to resolve owner email for {owner_id}: {exc}")
            return None
        if email and EMAIL_REGEX.match(str(email)):
            return email

    return None


def _filter_public_listing_records(table_name, records):
    filtered = []
    for record in records or []:
        # Public browse reads should stay read-only. Compute lifecycle metadata
        # in-process so stale timestamps do not leak to the UI, but do not
        # patch listings or send emails from a hot listing page request.
        preview = _preview_listing_record(record)
        if not preview:
            continue
        if preview.get("listing_state") != "active":
            continue
        filtered.append(preview)
    return filtered


def _normalize_preview_images(record, relation_key):
    relation_images = record.pop(relation_key, []) if isinstance(record, dict) else []
    normalized_images = []
    for image in relation_images or []:
        image_url = (
            image.get("display_url") or image.get("image_url") or image.get("url")
        )
        if image_url:
            normalized_images.append(
                {
                    "id": image.get("id"),
                    "url": image_url,
                    "image_url": image_url,
                }
            )

    if not normalized_images and isinstance(record, dict):
        main_url = (
            record.get("display_url") or record.get("image_url") or record.get("url")
        )
        if main_url:
            normalized_images.append(
                {"id": "main", "url": main_url, "image_url": main_url}
            )

    if isinstance(record, dict):
        record["images"] = normalized_images
    return record


def _fetch_plate_image_map(plate_ids, headers):
    """Fetch plate photos separately because the plates table has no exposed
    PostgREST relationship in all deployed schemas."""
    ids = [str(value) for value in plate_ids if value]
    if not ids:
        return {}
    image_map = {}
    for start in range(0, len(ids), 100):
        chunk = ids[start:start + 100]
        image_params = {
            "select": "id,plate_id,image_url,display_url,uploaded_at,is_primary",
            "plate_id": f"in.({','.join(chunk)})",
            "order": "is_primary.desc,uploaded_at.asc",
        }
        response = requests.get(
            f"{app.config['SUPABASE_URL']}/rest/v1/plate_images",
            headers=headers, params=image_params, timeout=10,
        )
        if response.status_code >= 400:
            # Older deployments may expose only the legacy `url` column.
            image_params["select"] = "id,plate_id,url,uploaded_at,is_primary"
            response = requests.get(
                f"{app.config['SUPABASE_URL']}/rest/v1/plate_images",
                headers=headers, params=image_params, timeout=10,
            )
        if response.status_code >= 400:
            logger.warning("Failed to fetch plate images: %s", response.status_code)
            continue
        payload = response.json()
        rows = payload if isinstance(payload, list) else []
        for image in rows:
            image_url = image.get("display_url") or image.get("image_url") or image.get("url")
            if image_url:
                image_map.setdefault(str(image.get("plate_id")), []).append({
                    "id": image.get("id"),
                    "url": image_url,
                    "image_url": image_url,
                    "uploaded_at": image.get("uploaded_at"),
                    "is_primary": image.get("is_primary"),
                })
    return image_map


def _sort_listing_images(images):
    def _sort_key(image):
        if not isinstance(image, dict):
            return (True, True, None, 0, "", "")
        # is_primary=True always comes first regardless of sort_index
        not_primary = not image.get("is_primary", False)
        crop_meta = image.get("crop_meta")
        sort_index = None
        if isinstance(crop_meta, dict):
            raw_sort_index = crop_meta.get("sort_index")
            try:
                sort_index = int(raw_sort_index)
            except (TypeError, ValueError):
                sort_index = None
        uploaded_at = image.get("uploaded_at")
        return (
            not_primary,
            sort_index is None,
            sort_index if sort_index is not None else 0,
            str(uploaded_at or ""),
            str(image.get("id") or ""),
        )

    return sorted(images or [], key=_sort_key)


def _fetch_public_preview_records(table_name, params, relation_key, normalize=None):
    response, status = supabase_request(
        "get",
        f"/rest/v1/{table_name}",
        params=params,
        use_service_role=True,
    )

    if status >= 400:
        logger.warning(f"Failed to fetch {table_name} preview records: {status}")
        return []

    records = response or []
    if not isinstance(records, list):
        return []

    records = _filter_public_listing_records(table_name, records)
    seller_map = _batch_fetch_seller_map([record.get("user_id") for record in records])

    for record in records:
        if callable(normalize):
            normalize(record)
        _normalize_preview_images(record, relation_key)
        _apply_seller_to_listing(record, seller_map.get(record.get("user_id")))

    return records


def _fetch_homepage_preview_payload():
    _LIFECYCLE_FIELDS = (
        "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
        "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
    )

    car_params = {
        "select": (
            "id,user_id,car_manufacturer,car_model,trim,make_year,car_city,"
            "expected_selling_price,kilometer_driven,car_description,created_at,updated_at,"
            "status,is_approved,view_count,lady_driven,"
            "whatsapp_number,whatsapp_prefill_text,"
            + _LIFECYCLE_FIELDS
            + "car_images("
            + LISTING_IMAGE_SELECTS["cars"]
            + ")"
        ),
        # 8 (not 4): HomePage.js merges this with a separate featured-listings
        # call via applyFeaturedPlacement before slicing to the 4 it displays —
        # it needs the same buffer of normal cars the old /api/cars?limit=8
        # call gave it, or featured placement would crowd out normal cars.
        "limit": "8",
        "order": "created_at.desc",
        "status": "eq.approved",
        "is_approved": "eq.true",
    }

    bike_params = {
        "select": (
            "id,user_id,bike_brand,bike_model,make_year,bike_category,engine_capacity,"
            "expected_selling_price,kilometer_driven,description,created_at,updated_at,image_url,url,"
            "display_url,status,is_approved,featured,views,"
            + _LIFECYCLE_FIELDS
            + "bike_images("
            + LISTING_IMAGE_SELECTS["bikes"]
            + ")"
        ),
        "limit": "3",
        "order": "created_at.desc",
        "status": "eq.approved",
        "is_approved": "eq.true",
    }

    part_params = {
        "select": (
            "id,user_id,category,part_type,brand,model,condition,price,description,city,"
            "created_at,updated_at,image_url,url,display_url,status,is_approved,featured,views,"
            + _LIFECYCLE_FIELDS
            + "part_images(" + LISTING_IMAGE_SELECTS["car_parts"] + ")"
        ),
        "limit": "3",
        "order": "created_at.desc",
        "status": "eq.approved",
        "is_approved": "eq.true",
    }

    plate_params = {
        "select": (
            "id,user_id,city,code,digits,price,number,plate_format,"
            "description,created_at,updated_at,image_url,url,display_url,status,is_approved,featured,views,"
            + _LIFECYCLE_FIELDS
            + "plate_images(" + LISTING_IMAGE_SELECTS["license_plates"] + ")"
        ),
        "limit": "3",
        "order": "created_at.desc",
        "status": "eq.approved",
        "is_approved": "eq.true",
    }

    categories = [
        ("cars", "cars", car_params, "car_images", None),
        ("bikes", "bikes", bike_params, "bike_images", _normalize_bike_record),
        ("parts", "car_parts", part_params, "part_images", None),
        ("plates", "license_plates", plate_params, "plate_images", None),
    ]

    preview_payload = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {}
        for category, table_name, params, relation_key, normalize in categories:
            future_map[
                executor.submit(
                    _fetch_public_preview_records,
                    table_name,
                    params,
                    relation_key,
                    normalize,
                )
            ] = category

        for future in as_completed(future_map):
            category = future_map[future]
            try:
                preview_payload[category] = future.result()
            except Exception as preview_err:
                logger.warning(
                    f"Failed to build {category} homepage preview: {preview_err}"
                )
                preview_payload[category] = []

    return preview_payload


@app.route("/api/homepage/preview", methods=["GET"])
def get_homepage_preview():
    try:
        cache_key = _build_api_cache_key()
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return _cached_json_response(cached_payload)

        payload = _fetch_homepage_preview_payload()
        _api_cache_set(cache_key, payload, ttl_seconds=90)
        return _cached_json_response(payload, ttl_seconds=90)
    except Exception as e:
        logger.error(f"Error building homepage preview: {e}")
        return jsonify(
            {
                "error": "Unable to load homepage preview right now",
                "cars": [],
                "bikes": [],
                "parts": [],
                "plates": [],
            }
        ), 500


def _collect_user_listing_records(current_user, item_type):
    config = LISTING_TABLE_CONFIG[item_type]
    records, status_code = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={
            "select": "*",
            "user_id": f"eq.{current_user}",
            "user_dismissed_at": "is.null",
            "order": "created_at.desc",
        },
        user_id=current_user,
    )

    # If the query failed because user_dismissed_at doesn't exist yet (migration
    # not yet applied), retry without that filter so existing listings are shown.
    if status_code >= 400 and isinstance(records, dict):
        error_hint = json.dumps(records).lower()
        if "user_dismissed_at" in error_hint or str(records.get("code", "")) in {
            "PGRST116", "42703", "PGRST204",
        }:
            logger.warning(
                "[listings] user_dismissed_at filter failed for %s (migration pending), retrying without it",
                config["table"],
            )
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
        if record.get("status") == "rejected":
            # Keep rejected listings editable in the user's account view.
            record["moderation_status"] = "rejected"
            record["status"] = "draft"
        try:
            synced = _sync_listing_lifecycle(
                config["table"], record, hard_delete_archived=False
            )
        except Exception as sync_err:
            logger.error(
                "[listings] _sync_listing_lifecycle failed for %s/%s: %s",
                config["table"],
                listing_id,
                sync_err,
                exc_info=True,
            )
            synced = record
        if synced:
            hydrated_records.append(synced)

    return hydrated_records, 200


def _listing_matches_status_filter(record, status_filter):
    if not status_filter or status_filter in {"all", "any"}:
        return True

    normalized_status = str(status_filter).strip().lower()
    record_status = str(record.get("status") or "").strip().lower()
    listing_state = str(record.get("listing_state") or "").strip().lower()

    if normalized_status == "active":
        return listing_state == "active"
    if normalized_status == "expired":
        return listing_state == "expired"
    if normalized_status == "deleted":
        return record_status == "deleted" or listing_state == "deleted"
    if normalized_status == "sold":
        return record_status == "sold"
    if normalized_status in {"draft", "drafts"}:
        return record_status in {"draft", "pending", "rejected"}
    return True


def _filter_user_listing_records(records, status_filter):
    return [
        record
        for record in records or []
        if _listing_matches_status_filter(record, status_filter)
    ]


def _delete_user_owned_listing(current_user, item_type, item_id):
    config = LISTING_TABLE_CONFIG[item_type]
    listing_data, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={
            "select": "user_id,status,deleted_at",
            "id": f"eq.{item_id}",
            "limit": 1,
        },
        user_id=current_user,
    )

    if listing_status >= 400:
        return listing_data, listing_status

    if not listing_data:
        return {"error": "Listing not found"}, 404

    if listing_data[0].get("user_id") != current_user:
        return {"error": "You do not have permission to delete this listing"}, 403

    if _is_listing_deleted(listing_data[0]):
        return {"message": "Listing already deleted"}, 200

    delete_response, delete_status = _soft_delete_listing(
        config["table"],
        item_id,
        deleted_by_role="user",
        deleted_by=current_user,
        reason="Deleted by user",
        metadata={"endpoint": "user_delete", "item_type": item_type},
    )

    return delete_response, delete_status


SAVED_LISTING_TYPE_CONFIG = {
    "car": {
        "table": "cars",
        "images_table": "car_images",
        "fk": "car_id",
        "route_prefix": "cars",
        "category_label": "Car",
    },
    "bike": {
        "table": "bikes",
        "images_table": "bike_images",
        "fk": "bike_id",
        "route_prefix": "bikes",
        "category_label": "Bike",
    },
    "part": {
        "table": "car_parts",
        "images_table": "part_images",
        "fk": "part_id",
        "route_prefix": "car-parts",
        "category_label": "Car Part",
    },
    "plate": {
        "table": "license_plates",
        "images_table": "plate_images",
        "fk": "plate_id",
        "route_prefix": "plates",
        "category_label": "Plate",
    },
}


def _normalize_saved_listing_type(value):
    normalized = str(value or "").strip().lower()
    mapping = {
        "car": "car",
        "cars": "car",
        "bike": "bike",
        "bikes": "bike",
        "part": "part",
        "parts": "part",
        "car-part": "part",
        "car-parts": "part",
        "plate": "plate",
        "plates": "plate",
        "license_plate": "plate",
        "license_plates": "plate",
    }
    return mapping.get(normalized)


def _saved_listing_config(listing_type):
    normalized = _normalize_saved_listing_type(listing_type)
    if not normalized:
        return None, None
    return normalized, SAVED_LISTING_TYPE_CONFIG.get(normalized)


def _format_saved_listing_price(value):
    if value in (None, ""):
        return "Price on request"
    try:
        return f"AED {int(float(value)):,}"
    except (TypeError, ValueError):
        return f"AED {value}"


def _looks_like_missing_table(response_payload):
    """Best-effort detect PostgREST missing-table errors (HTTP 404/400 with 42P01)."""
    if not isinstance(response_payload, dict):
        return False
    message = str(response_payload.get("message") or "").lower()
    code = str(response_payload.get("code") or "")
    details = str(response_payload.get("details") or "").lower()
    hint = str(response_payload.get("hint") or "").lower()
    return (
        code == "42P01"
        or "does not exist" in message
        or "does not exist" in details
        or "does not exist" in hint
    )


def _looks_like_missing_column(response_payload, *columns):
    if not isinstance(response_payload, dict):
        return False
    haystack = " ".join(
        str(response_payload.get(key) or "")
        for key in ("message", "details", "hint", "code")
    ).lower()
    if "schema cache" in haystack or "column" in haystack or "pgrst" in haystack:
        return any(str(column).lower() in haystack for column in columns)
    return False


def _saved_listing_route_prefix(listing_type):
    normalized, config = _saved_listing_config(listing_type)
    if not normalized or not config:
        return None
    return config["route_prefix"]


def _saved_listing_route(listing_type, listing_id):
    prefix = _saved_listing_route_prefix(listing_type)
    if not prefix or not listing_id:
        return "/"
    return f"/{prefix}/{listing_id}"


def _saved_listing_title(listing_type, listing):
    listing = listing or {}
    if listing_type == "car":
        parts = [
            listing.get("make_year") or listing.get("year"),
            listing.get("car_manufacturer") or listing.get("make"),
            listing.get("car_model") or listing.get("model"),
            listing.get("trim") or listing.get("car_trim"),
        ]
        title = " ".join(str(part).strip() for part in parts if part)
        return (
            title
            or listing.get("listing_title")
            or listing.get("title")
            or "Untitled car"
        )

    if listing_type == "bike":
        parts = [
            listing.get("year") or listing.get("make_year"),
            listing.get("make") or listing.get("bike_brand"),
            listing.get("model") or listing.get("bike_model"),
        ]
        title = " ".join(str(part).strip() for part in parts if part)
        return (
            title
            or listing.get("listing_title")
            or listing.get("title")
            or "Untitled bike"
        )

    if listing_type == "part":
        return (
            listing.get("name")
            or listing.get("part_name")
            or listing.get("listing_title")
            or "Untitled part"
        )

    if listing_type == "plate":
        parts = [listing.get("city"), listing.get("code"), listing.get("number")]
        title = " ".join(str(part).strip() for part in parts if part)
        return title or listing.get("listing_title") or "Premium plate"

    return listing.get("listing_title") or listing.get("title") or "Saved listing"


def _saved_listing_location(listing_type, listing):
    listing = listing or {}
    if listing_type == "car":
        return (
            listing.get("car_city")
            or listing.get("city")
            or listing.get("location")
            or listing.get("emirate")
            or "UAE"
        )
    if listing_type == "bike":
        return listing.get("location") or listing.get("city") or "UAE"
    if listing_type == "part":
        return (
            listing.get("location")
            or listing.get("city")
            or listing.get("emirate")
            or "UAE"
        )
    if listing_type == "plate":
        return listing.get("city") or "UAE"
    return listing.get("location") or "UAE"


def _saved_listing_subtitle(listing_type, listing):
    listing = listing or {}
    if listing_type == "car":
        mileage = (
            listing.get("kilometer_driven")
            or listing.get("kilometer")
            or listing.get("mileage")
        )
        parts = []
        if mileage not in (None, ""):
            try:
                parts.append(f"{int(float(mileage)):,} km")
            except (TypeError, ValueError):
                parts.append(f"{mileage} km")
        parts.append(listing.get("fuel_type") or listing.get("fuel") or "Specs pending")
        parts.append(_saved_listing_location(listing_type, listing))
        return " • ".join(part for part in parts if part)

    if listing_type == "bike":
        parts = [
            listing.get("bike_type")
            or listing.get("type")
            or listing.get("bike_category")
            or "Bike",
            listing.get("engine_size") or listing.get("engine_capacity"),
            _saved_listing_location(listing_type, listing),
        ]
        return " • ".join(str(part).strip() for part in parts if part)

    if listing_type == "part":
        parts = [
            listing.get("category") or listing.get("part_type") or "Parts",
            _saved_listing_location(listing_type, listing),
        ]
        return " • ".join(str(part).strip() for part in parts if part)

    if listing_type == "plate":
        digits = listing.get("digits")
        if digits in (None, ""):
            number = str(listing.get("number") or "")
            digits = len(number) if number else "N/A"
        parts = [f"{digits} digits", _saved_listing_location(listing_type, listing)]
        return " • ".join(str(part).strip() for part in parts if part)

    return _saved_listing_location(listing_type, listing)


def _saved_listing_description(listing_type, listing):
    listing = listing or {}
    defaults = {
        "car": listing.get("car_description")
        or listing.get("description")
        or "Freshly listed vehicle in the UAE marketplace.",
        "bike": listing.get("description") or "Motorcycle listing ready to view.",
        "part": listing.get("description") or "Part listing ready to compare.",
        "plate": listing.get("description") or "Premium plate listing ready to view.",
    }
    return defaults.get(listing_type, listing.get("description") or "Saved listing")


def _saved_listing_price(listing_type, listing):
    listing = listing or {}
    if listing_type == "car":
        return listing.get("expected_selling_price") or listing.get("price")
    if listing_type in {"bike", "part", "plate"}:
        return listing.get("price") or listing.get("expected_selling_price")
    return listing.get("price") or listing.get("expected_selling_price")


def _saved_listing_seller_name(listing):
    listing = listing or {}
    return (
        listing.get("seller_name")
        or listing.get("display_name")
        or listing.get("user_name")
        or listing.get("username")
        or listing.get("dealer_name")
        or listing.get("email")
        or "Marketplace Seller"
    )


def resolve_media_url(url):
    """Resolve a media URL/path to a full accessible URL.

    Handles Supabase storage paths, relative paths, and passthrough for
    URLs that are already absolute.
    """
    if not url:
        return ""
    url = str(url).strip()
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/storage/v1/"):
        return f"{SUPABASE_URL}{url}"
    if url.startswith("object/public/"):
        return f"{SUPABASE_URL}/storage/v1/{url}"
    return url


def _saved_listing_seller_photo(listing):
    listing = listing or {}
    return resolve_media_url(
        listing.get("seller_profile_photo")
        or listing.get("profile_photo_url")
        or listing.get("user_profile_photo")
    )


def _saved_listing_image(listing):
    listing = listing or {}
    images = listing.get("images") or []
    if images and isinstance(images, list):
        first = images[0] or {}
        return resolve_media_url(
            first.get("display_url") or first.get("image_url") or first.get("url")
        )
    return resolve_media_url(
        listing.get("display_url") or listing.get("image_url") or listing.get("url")
    )


def _build_saved_listing_card(listing_type, listing, saved_row=None):
    normalized_type = _normalize_saved_listing_type(listing_type)
    if not normalized_type:
        return None

    _, config = _saved_listing_config(normalized_type)
    listing = listing or {}
    if not listing:
        return None
    listing_id = listing.get("id") or (saved_row or {}).get("listing_id")
    card = {
        "id": listing_id,
        "categoryKey": config["route_prefix"] if config else "cars",
        "categoryLabel": config["category_label"] if config else "Listing",
        "listingType": normalized_type,
        "route": _saved_listing_route(normalized_type, listing_id),
        "title": _saved_listing_title(normalized_type, listing),
        "priceLabel": _format_saved_listing_price(
            _saved_listing_price(normalized_type, listing)
        ),
        "subtitle": _saved_listing_subtitle(normalized_type, listing),
        "image": _saved_listing_image(listing),
        "createdAt": listing.get("created_at") or (saved_row or {}).get("created_at"),
        "description": _saved_listing_description(normalized_type, listing),
        "sellerName": _saved_listing_seller_name(listing),
        "sellerPhoto": _saved_listing_seller_photo(listing),
        "location": _saved_listing_location(normalized_type, listing),
        "savedAt": (saved_row or {}).get("created_at"),
        "isSaved": True,
        "isUnavailable": False,
    }
    if listing and _is_listing_deleted(listing):
        return None
    return card


def _fetch_saved_listing_cards(current_user):
    saved_rows, status_code = supabase_request(
        "get",
        "/rest/v1/saved_listings",
        params={
            "select": "id,user_id,listing_id,listing_type,created_at",
            "user_id": f"eq.{current_user}",
            "order": "created_at.desc",
        },
        user_id=current_user,
    )

    if status_code >= 400:
        if _looks_like_missing_table(saved_rows):
            return {
                "items": [],
                "saved_ids": [],
                "counts": {key: 0 for key in SAVED_LISTING_TYPE_CONFIG.keys()},
                "total": 0,
                "error": "Supabase table saved_listings is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_ecosystem_tables.sql",
            }, 501
        return saved_rows, status_code

    saved_rows = saved_rows or []
    grouped = defaultdict(list)
    for row in saved_rows:
        listing_type = _normalize_saved_listing_type(row.get("listing_type"))
        if listing_type:
            grouped[listing_type].append(row)

    records_by_type = {}
    for listing_type, rows in grouped.items():
        config = SAVED_LISTING_TYPE_CONFIG.get(listing_type)
        if not config:
            continue

        listing_ids = [row.get("listing_id") for row in rows if row.get("listing_id")]
        if not listing_ids:
            continue

        listing_id_query = ",".join(str(listing_id) for listing_id in listing_ids)
        records, records_status = supabase_request(
            "get",
            f"/rest/v1/{config['table']}",
            params={"select": "*", "id": f"in.({listing_id_query})"},
            use_service_role=True,
        )
        if records_status >= 400:
            records_by_type[listing_type] = {}
            continue

        records = records or []
        record_map = {
            record.get("id"): record for record in records if isinstance(record, dict)
        }

        image_rows, image_status = supabase_request(
            "get",
            f"/rest/v1/{config['images_table']}",
            params={"select": "*", config["fk"]: f"in.({listing_id_query})"},
            use_service_role=True,
        )
        images_by_listing = defaultdict(list)
        if image_status < 400:
            for image in image_rows or []:
                images_by_listing[image.get(config["fk"])].append(image)

        if listing_type == "bike":
            for record in record_map.values():
                _normalize_bike_record(record)

        for record_id, record in record_map.items():
            record["images"] = images_by_listing.get(record_id, [])
            try:
                _apply_listing_lifecycle_metadata(record)
            except Exception as lifecycle_err:
                logger.warning(
                    "Failed to annotate saved listing lifecycle for %s/%s: %s",
                    config["table"],
                    record_id,
                    lifecycle_err,
                )

        records_by_type[listing_type] = record_map

    cards = []
    saved_ids = []
    counts = {key: 0 for key in SAVED_LISTING_TYPE_CONFIG.keys()}

    for row in saved_rows:
        listing_type = _normalize_saved_listing_type(row.get("listing_type"))
        if not listing_type:
            continue
        record = records_by_type.get(listing_type, {}).get(row.get("listing_id"))
        status = (record or {}).get("status")
        # Permanently removed (deleted / sold / rejected): purge the orphaned save
        # so it's gone from the list AND the saved count on web + mobile. Best-effort.
        if record and (_is_listing_deleted(record) or status in LISTING_TERMINAL_STATUSES):
            row_id = row.get("id")
            if row_id:
                try:
                    supabase_request(
                        "delete",
                        f"/rest/v1/saved_listings?id=eq.{row_id}",
                        use_service_role=True,
                    )
                except Exception:
                    pass
            continue
        # Not currently available (missing/expired/pending): hide from saved but
        # keep the save row — an expired listing may be renewed later.
        if not record or status not in ("approved", "active"):
            continue
        card = _build_saved_listing_card(listing_type, record, row)
        if not card:
            continue
        saved_ids.append(f"{listing_type}:{row.get('listing_id')}")
        counts[listing_type] = counts.get(listing_type, 0) + 1
        cards.append(card)

    cards = [card for card in cards if card]
    return {
        "items": cards,
        "saved_ids": saved_ids,
        "counts": counts,
        "total": len(cards),
    }, 200


def _load_saved_listing_card(current_user, listing_type, listing_id, saved_row=None):
    normalized_type = _normalize_saved_listing_type(listing_type)
    if not normalized_type:
        return None, {"error": "Invalid listing type"}, 400

    config = SAVED_LISTING_TYPE_CONFIG.get(normalized_type)
    if not config:
        return None, {"error": "Invalid listing type"}, 400

    record, record_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"select": "*", "id": f"eq.{listing_id}", "limit": 1},
        use_service_role=True,
    )
    listing = record[0] if record and isinstance(record, list) else {}
    if listing and normalized_type == "bike":
        _normalize_bike_record(listing)

    if listing:
        images, image_status = supabase_request(
            "get",
            f"/rest/v1/{config['images_table']}",
            params={"select": "*", config["fk"]: f"eq.{listing_id}"},
            use_service_role=True,
        )
        listing["images"] = images if image_status < 400 else []
    else:
        listing = {}

    try:
        _apply_listing_lifecycle_metadata(listing)
    except Exception as lifecycle_err:
        logger.warning(
            "Failed to annotate saved listing lifecycle for %s/%s: %s",
            config["table"],
            listing_id,
            lifecycle_err,
        )
    return _build_saved_listing_card(normalized_type, listing, saved_row), None, 200


def _decode_supabase_jwt_secret(raw_secret):
    """Return the HMAC key bytes for verifying a Supabase JWT.

    Supabase JWT secrets are sometimes base64-encoded raw keys, and sometimes
    they are the raw key string itself.  This function tries the raw string
    **first** (the more common case for newer Supabase projects), then falls
    back to base64-decoded variants.
    """
    import base64 as _b64

    if not raw_secret:
        return None

    # Attempt 1: use the raw string bytes directly (works for many Supabase projects)
    raw_bytes = raw_secret.encode("utf-8")
    if len(raw_bytes) >= 16:
        yield raw_bytes, "raw string"

    # Attempt 2: base64-decode with correct padding
    padded = raw_secret + "=" * (-len(raw_secret) % 4)
    try:
        decoded = _b64.b64decode(padded, validate=True)
        if len(decoded) >= 16 and decoded != raw_bytes:
            yield decoded, "base64-decoded"
    except Exception:
        pass

    # Attempt 3: lenient decode (handles whitespace / extra padding)
    try:
        cleaned = "".join(raw_secret.split())
        cleaned += "=" * (-len(cleaned) % 4)
        decoded = _b64.b64decode(cleaned)
        if len(decoded) >= 16 and decoded != raw_bytes:
            yield decoded, "base64-lenient"
    except Exception:
        pass


_AUTH_REVOCATION_PREFIX = "auth:revoked-user:"
_MEMORY_AUTH_REVOCATIONS = set()
_AUTH_REVOCATION_LOCK = threading.Lock()


def _auth_revocation_key(user_id):
    return f"{_AUTH_REVOCATION_PREFIX}{user_id}"


def revoke_user_sessions(user_id):
    """Record a cutoff so tokens issued before it are rejected everywhere."""
    if not user_id:
        return False
    client = _get_redis_cache_client()
    if client:
        try:
            # JWT ``iat`` values are second-resolution; move the cutoff one
            # second into the future so a token minted in the same second is
            # never accidentally retained.
            client.set(_auth_revocation_key(user_id), str(int(time.time()) + 1))
            return True
        except Exception as exc:
            logger.error("Global auth revocation write failed: %s", exc)
            return False
    if REDIS_URL:
        return False
    with _AUTH_REVOCATION_LOCK:
        _MEMORY_AUTH_REVOCATIONS.add(str(user_id))
    return True


def _clear_user_session_revocation(user_id):
    if not user_id:
        return False
    client = _get_redis_cache_client()
    if client:
        try:
            client.delete(_auth_revocation_key(user_id))
            return True
        except Exception as exc:
            logger.error("Global auth revocation clear failed: %s", exc)
            return False
    if REDIS_URL:
        return False
    with _AUTH_REVOCATION_LOCK:
        _MEMORY_AUTH_REVOCATIONS.discard(str(user_id))
    return True


def _user_session_revocation_state(user_id):
    """Return cutoff epoch, ``0`` when clear, or ``None`` when unavailable."""
    client = _get_redis_cache_client()
    if client:
        try:
            value = client.get(_auth_revocation_key(user_id))
            return int(value) if value else 0
        except Exception as exc:
            logger.error("Global auth revocation read failed: %s", exc)
            return None
    if REDIS_URL:
        return None
    with _AUTH_REVOCATION_LOCK:
        return 1 if str(user_id) in _MEMORY_AUTH_REVOCATIONS else 0


def _revocation_auth_response(user_id, token_iat=None):
    state = _user_session_revocation_state(user_id)
    if state is None:
        return jsonify({"message": "Authentication state unavailable"}), 503
    if state and (token_iat is None or int(token_iat) < state):
        return jsonify({"message": "Session has been revoked"}), 401
    return None


def token_required(f):
    """Validate Supabase JWT (header/cookie) and inject `current_user` (user id).

    This decorator must be defined before any ``@token_required`` usage.  It reads
    env vars at request-time so import order cannot break Gunicorn deploys.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization")

        if not auth_header:
            cookie_token = request.cookies.get("access_token")
            if cookie_token:
                auth_header = f"Bearer {cookie_token}"

        if not auth_header:
            return jsonify({"message": "Authorization header is required"}), 401

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return (
                jsonify(
                    {"message": "Invalid Authorization format. Use: Bearer <token>"}
                ),
                401,
            )

        token = parts[1]

        # ── 1) Try local JWT validation when secret is available. ──────────
        jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
        if jwt_secret:
            try:
                import jwt as pyjwt

                for secret_bytes, _method in _decode_supabase_jwt_secret(jwt_secret):
                    try:
                        payload = pyjwt.decode(
                            token,
                            secret_bytes,
                            algorithms=["HS256"],
                            options={"verify_aud": False},
                        )
                        current_user = payload.get("sub")
                        if not current_user:
                            return jsonify(
                                {"message": "Invalid token: missing user ID"}
                            ), 401

                        revoked_response = _revocation_auth_response(current_user, payload.get("iat"))
                        if revoked_response:
                            return revoked_response

                        request.user_id = current_user
                        request.user_data = {
                            "id": current_user,
                            "email": payload.get("email", ""),
                            "role": payload.get("role", "authenticated"),
                        }
                        request.supabase_token = token
                        return f(current_user, *args, **kwargs)
                    except Exception:
                        continue

                logger.warning(
                    "[auth] All local JWT key attempts failed"
                )
            except Exception as local_error:
                logger.warning(
                    "[auth] Local JWT validation failed: %s", local_error
                )
        else:
            logger.warning(
                "[auth] No SUPABASE_JWT_SECRET configured – skipping local JWT validation"
            )

        # ── 2) Fallback: validate token via Supabase Auth API. ─────────────
        supabase_url = os.getenv("SUPABASE_URL")
        # Prefer the anon key for auth API calls (service_role key may not work here)
        supabase_anon_key = os.getenv("SUPABASE_KEY")
        supabase_service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        supabase_key = supabase_anon_key or supabase_service_key

        if not supabase_url or not supabase_key:
            logger.error(
                f"[auth] Missing SUPABASE_URL ({bool(supabase_url)}) or "
                f"SUPABASE_KEY ({bool(supabase_key)}) for auth fallback."
            )
            return jsonify({"message": "Server misconfigured for authentication"}), 500

        try:
            auth_headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
            auth_url = f"{supabase_url}/auth/v1/user"
            auth_response = requests.get(auth_url, headers=auth_headers, timeout=10)

            if auth_response.status_code != 200:
                logger.warning(
                    f"[auth] Supabase auth API returned {auth_response.status_code} "
                    "; response=%s", auth_response.text[:200]
                )
                return jsonify({"message": "Token has expired or is invalid"}), 401

            supabase_user = auth_response.json()
            current_user = supabase_user.get("id")
            if not current_user:
                logger.warning(
                    f"[auth] Supabase returned 200 but no user ID: {supabase_user}"
                )
                return jsonify({"message": "Invalid token"}), 401

            # The Auth API has already verified this token. Decode only its
            # non-authoritative ``iat`` claim to compare against our cutoff;
            # never use this decode as authentication.
            token_iat = None
            try:
                import base64 as _base64
                token_payload = token.split(".")[1]
                token_payload += "=" * (-len(token_payload) % 4)
                token_iat = json.loads(_base64.urlsafe_b64decode(token_payload)).get("iat")
            except Exception:
                pass
            revoked_response = _revocation_auth_response(current_user, token_iat)
            if revoked_response:
                return revoked_response

            request.user_id = current_user
            request.user_data = {
                "id": current_user,
                "email": supabase_user.get("email", ""),
                "role": supabase_user.get("role", "authenticated"),
            }
            request.supabase_token = token
        except requests.Timeout:
            logger.error("[auth] Supabase auth API timeout")
            return jsonify({"message": "Authentication service timeout"}), 503
        except Exception as fallback_error:
            logger.error(
                "[auth] Fallback token validation error: %s", fallback_error
            )
            return jsonify({"message": "Token has expired or is invalid"}), 401

        return f(current_user, *args, **kwargs)

    return decorated


def token_required_optional(f):
    """Like `token_required` but injects `None` when missing/invalid."""

    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            cookie_token = request.cookies.get("access_token")
            if cookie_token:
                auth_header = f"Bearer {cookie_token}"

        if not auth_header:
            return f(None, *args, **kwargs)

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return f(None, *args, **kwargs)

        token = parts[1]

        jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
        if jwt_secret:
            try:
                import jwt as pyjwt

                for secret_bytes, _method in _decode_supabase_jwt_secret(jwt_secret):
                    try:
                        payload = pyjwt.decode(
                            token,
                            secret_bytes,
                            algorithms=["HS256"],
                            options={"verify_aud": False},
                        )
                        current_user = payload.get("sub")
                        if current_user:
                            revocation_cutoff = _user_session_revocation_state(current_user)
                            if revocation_cutoff is None or (
                                revocation_cutoff and int(payload.get("iat") or 0) < revocation_cutoff
                            ):
                                return f(None, *args, **kwargs)
                            request.user_id = current_user
                            request.user_data = {
                                "id": current_user,
                                "email": payload.get("email", ""),
                                "role": payload.get("role", "authenticated"),
                            }
                            request.supabase_token = token
                            return f(current_user, *args, **kwargs)
                    except Exception:
                        continue
            except Exception as local_error:
                logger.info(f"Optional local token validation skipped: {local_error}")

        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY") or os.getenv(
            "SUPABASE_SERVICE_ROLE_KEY"
        )
        if not supabase_url or not supabase_key:
            return f(None, *args, **kwargs)

        try:
            auth_headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
            auth_response = requests.get(
                f"{supabase_url}/auth/v1/user", headers=auth_headers, timeout=10
            )
            if auth_response.status_code == 200:
                supabase_user = auth_response.json()
                current_user = supabase_user.get("id")
                if current_user:
                    if _user_session_revocation_state(current_user) is None:
                        return f(None, *args, **kwargs)
                    request.user_id = current_user
                    request.user_data = {
                        "id": current_user,
                        "email": supabase_user.get("email", ""),
                        "role": supabase_user.get("role", "authenticated"),
                    }
                    request.supabase_token = token
                    return f(current_user, *args, **kwargs)
        except Exception as fallback_error:
            logger.info(f"Optional Supabase token validation skipped: {fallback_error}")

        return f(None, *args, **kwargs)

    return decorated


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


def _normalize_for_profanity(value: str) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = text.translate(
        str.maketrans(
            {
                "@": "a",
                "$": "s",
                "0": "o",
                "1": "i",
                "3": "e",
                "4": "a",
                "5": "s",
                "7": "t",
                "!": "i",
            }
        )
    )
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _validate_no_profanity(value, *, field_name="text"):
    if not isinstance(value, str) or not value.strip():
        return

    normalized = _normalize_for_profanity(value)
    if not normalized:
        return

    tokens = normalized.split()
    token_set = set(tokens)

    for blocked in PROFANITY_BLOCKLIST_TOKENS:
        if blocked in token_set:
            raise ValueError(f"{field_name} contains blocked language")

    for phrase in PROFANITY_BLOCKLIST_PHRASES:
        if phrase in normalized:
            raise ValueError(f"{field_name} contains blocked language")

    collapsed = normalized.replace(" ", "")
    for blocked in PROFANITY_BLOCKLIST_COLLAPSED:
        if blocked in collapsed:
            raise ValueError(f"{field_name} contains blocked language")


def _is_valid_car_fuel_type(value):
    if value in CAR_FUEL_OPTIONS:
        return True
    if not isinstance(value, str):
        return False
    return (
        value.lower().startswith("other - ") and len(value.split("-", 1)[1].strip()) > 0
    )


def _get_cors_origins():
    origins_env = os.getenv("CORS_ORIGINS", "")
    if origins_env:
        origins = [
            origin.strip() for origin in origins_env.split(",") if origin.strip()
        ]
        if origins:
            return origins

    # FLASK_ENV=production OR Railway sets RAILWAY_ENVIRONMENT automatically
    if os.getenv("FLASK_ENV") == "production" or os.getenv("RAILWAY_ENVIRONMENT"):
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

# OCR runs on the standalone PaddleOCR microservice (see ../ocr-service); no
# in-process model to pre-warm here anymore.

# Enable compression for better performance.
# - Algorithm order: brotli first (smaller), gzip fallback.
# - Only text/JSON types are listed; image/* and other binary types are
#   intentionally absent so already-compressed payloads are never recompressed.
# - The library also skips responses that already carry Content-Encoding,
#   providing a second guard against double-compression.
# - Vary: Accept-Encoding is injected automatically by flask-compress.
try:
    from flask_compress import Compress

    app.config.setdefault("COMPRESS_MIMETYPES", [
        "application/json",
        "text/css",
        "text/javascript",  # RFC 9239 canonical type (application/javascript is obsolete)
        "text/plain",
        "text/xml",
    ])
    app.config.setdefault("COMPRESS_ALGORITHM", ["br", "gzip"])
    app.config.setdefault("COMPRESS_MIN_SIZE", 500)   # bytes; skip tiny responses
    app.config.setdefault("COMPRESS_LEVEL", 6)        # gzip compression level
    app.config.setdefault("COMPRESS_BR_LEVEL", 4)     # brotli quality (0-11)
    Compress(app)
    logger.info(
        "Flask-Compress enabled: algorithms=%s min_size=%dB",
        app.config["COMPRESS_ALGORITHM"],
        app.config["COMPRESS_MIN_SIZE"],
    )
except ImportError:
    logger.warning("flask-compress not installed, skipping compression")
except Exception as e:
    logger.warning(f"Failed to enable compression: {e}")

# Configure a secret key for session management.
# In production this must be set explicitly so sessions remain stable across
# restarts and a deployment cannot silently run with an ephemeral key.
flask_secret_key = os.getenv("FLASK_SECRET_KEY")
if not flask_secret_key or flask_secret_key.startswith("your-"):
    if (
        os.getenv("FLASK_ENV", "").lower() == "production"
        or os.getenv("RAILWAY_ENVIRONMENT")
    ):
        raise RuntimeError(
            "FLASK_SECRET_KEY must be a real secret in production deployments"
        )
    flask_secret_key = secrets.token_hex(32)
    logger.warning(
        "FLASK_SECRET_KEY is not set; using an ephemeral in-memory secret. "
        "Set FLASK_SECRET_KEY in the deployment environment to avoid session invalidation on restart."
    )
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
    redis_limited = _redis_fixed_window_rate_limited(
        "contact", client_ip, CONTACT_RATE_LIMIT_WINDOW_SEC, CONTACT_RATE_LIMIT_MAX
    )
    if redis_limited is not None:
        return redis_limited
    with _RATE_LIMIT_LOCK:
        now = time.time()
        window_start = now - CONTACT_RATE_LIMIT_WINDOW_SEC
        entries = CONTACT_RATE_LIMIT[client_ip]
        while entries and entries[0] < window_start:
            entries.popleft()
        if len(entries) >= CONTACT_RATE_LIMIT_MAX:
            return True
        entries.append(now)
        return False


def _contact_lead_rate_limited(rl_key):
    """Anti-scraper limiter for anonymous phone/WhatsApp click tracking. `rl_key`
    is a namespaced key ('ip:1.2.3.4' or 'vid:<visitor_id>'), not just an IP, so
    the same limiter guards both dimensions independently."""
    if not rl_key:
        return False
    redis_limited = _redis_fixed_window_rate_limited(
        "contact_lead", rl_key, CONTACT_LEAD_RATE_LIMIT_WINDOW_SEC, CONTACT_LEAD_RATE_LIMIT_MAX
    )
    if redis_limited is not None:
        return redis_limited
    with _RATE_LIMIT_LOCK:
        now = time.time()
        window_start = now - CONTACT_LEAD_RATE_LIMIT_WINDOW_SEC
        entries = CONTACT_LEAD_RATE_LIMIT[rl_key]
        while entries and entries[0] < window_start:
            entries.popleft()
        if len(entries) >= CONTACT_LEAD_RATE_LIMIT_MAX:
            return True
        entries.append(now)
        return False


# Non-browser clients (curl/python-requests/headless) are the bulk-scraper case.
# A real buyer's browser UA never contains these tokens, so this is a cheap,
# zero-friction bot signal stored on every anonymous contact click for detection
# — we rate-limit on it too weakly to false-block, so it's a marker, not a gate.
_PROBABLE_BOT_UA_RE = re.compile(
    r"(headlesschrome|phantomjs|puppeteer|playwright|selenium|python-requests|"
    r"python-urllib|scrapy|go-http|okhttp|libwww|axios/|node-fetch|curl/|wget/|"
    r"httpie|bot\b|spider|crawler|scraper)",
    re.IGNORECASE,
)


def _probable_bot_user_agent(user_agent):
    """True when the User-Agent looks like a script/headless client rather than a
    real browser. Absent UA is treated as suspicious (browsers always send one)."""
    if not user_agent or not user_agent.strip():
        return True
    return bool(_PROBABLE_BOT_UA_RE.search(user_agent))


def _auth_rate_limited(client_ip):
    """Rate limiter for authentication endpoints (login, signup, reset, etc.)"""
    if not client_ip:
        return False
    redis_limited = _redis_fixed_window_rate_limited(
        "auth", client_ip, AUTH_RATE_LIMIT_WINDOW_SEC, AUTH_RATE_LIMIT_MAX
    )
    if redis_limited is not None:
        return redis_limited
    with _RATE_LIMIT_LOCK:
        now = time.time()
        window_start = now - AUTH_RATE_LIMIT_WINDOW_SEC
        entries = AUTH_RATE_LIMIT[client_ip]
        while entries and entries[0] < window_start:
            entries.popleft()
        if len(entries) >= AUTH_RATE_LIMIT_MAX:
            return True
        entries.append(now)
        return False


def _normalize_phone_number(phone, country_code=None):
    if phone is None:
        return None

    phone_str = str(phone).strip()
    if not phone_str:
        return None

    if phone_str.startswith("+"):
        digits = re.sub(r"[^\d]", "", phone_str)
        return f"+{digits}" if digits else None

    digits = re.sub(r"[^\d]", "", phone_str)
    if not digits:
        return None

    prefix = str(country_code or "").strip()
    prefix_digits = re.sub(r"[^\d]", "", prefix)
    if prefix and not prefix.startswith("+"):
        prefix = f"+{prefix_digits}"
    if not prefix:
        prefix = "+971"
        if not prefix_digits:
            prefix_digits = "971"

    if prefix_digits and len(digits) > 10 and digits.startswith(prefix_digits):
        return f"+{digits}"

    normalized_digits = digits.lstrip("0") or digits
    return f"{prefix}{normalized_digits}"


def _is_uae_phone(phone):
    normalized = _normalize_phone_number(phone, "+971")
    digits = re.sub(r"[^\d]", "", normalized or "")
    return digits.startswith("971") and len(digits) == 12


def _require_whatsapp_prefill_and_phone_alignment(payload, listing_type):
    if not isinstance(payload, dict):
        return
    payload["whatsapp_prefill_text"] = WHATSAPP_PREFILL_TEMPLATE

    if listing_type == "cars":
        contact_phone = payload.get("contact_phone") or payload.get(
            "car_owner_phone_number"
        )
        normalized = _normalize_phone_number(contact_phone, payload.get("country_code"))
        if not normalized:
            raise ValueError("A valid contact phone number is required")
        payload["car_owner_phone_number"] = normalized
        # cars has no contact_phone column (car_owner_phone_number is canonical).
        # Setting it here leaked into any cars write that isn't column-whitelisted,
        # producing PGRST204 "Could not find the 'contact_phone' column of 'cars'".
        payload.pop("contact_phone", None)
        payload["whatsapp_number"] = _normalize_phone_number(
            payload.get("whatsapp_number") or normalized,
            payload.get("country_code"),
        )
    elif listing_type == "bikes":
        contact_phone = payload.get("contact_phone") or payload.get("contact_number")
        normalized = _normalize_phone_number(contact_phone, payload.get("country_code"))
        if not normalized:
            raise ValueError("A valid contact phone number is required")
        payload["contact_phone"] = normalized
        payload["contact_number"] = normalized
        if payload.get("whatsapp_number"):
            payload["whatsapp_number"] = _normalize_phone_number(
                payload.get("whatsapp_number"), payload.get("country_code")
            )

    elif listing_type == "plates":
        contact_phone = payload.get("contact_phone")
        normalized = _normalize_phone_number(contact_phone, payload.get("country_code"))
        if not normalized:
            raise ValueError("A valid contact phone number is required")
        payload["contact_phone"] = normalized
        if payload.get("whatsapp_number"):
            payload["whatsapp_number"] = _normalize_phone_number(
                payload.get("whatsapp_number"), payload.get("country_code")
            )

    elif listing_type == "parts":
        contact_phone = payload.get("contact_phone") or payload.get("contact_number")
        normalized = _normalize_phone_number(contact_phone, payload.get("country_code"))
        if not normalized:
            raise ValueError("A valid contact phone number is required")
        payload["contact_phone"] = normalized
        payload["contact_number"] = normalized
        if payload.get("whatsapp_number"):
            payload["whatsapp_number"] = _normalize_phone_number(
                payload.get("whatsapp_number"), payload.get("country_code")
            )


def _normalize_listing_vin(payload):
    if not isinstance(payload, dict):
        return
    for key in ("vin_number", "vin"):
        if key in payload and payload.get(key) not in (None, ""):
            payload[key] = re.sub(r"[^A-Z0-9]", "", str(payload[key]).upper())


def _sync_gate_error(listing_type, payload, photo_count):
    from services.auto_review.sync_gate import validate_required_fields

    result = validate_required_fields(
        listing_type,
        payload,
        photo_count=photo_count,
        min_year=MIN_ALLOWED_YEAR,
        max_year=datetime.datetime.now().year + 1,
    )
    if result.ok:
        return None
    return jsonify(
        {
            "error": "Please complete all required listing fields before submitting.",
            "code": "missing_required_fields",
            "missing": result.missing,
        }
    ), 400


def _mask_phone_number(phone):
    if not phone:
        return None
    normalized = re.sub(r"[^\d+]", "", str(phone))
    if len(normalized) <= 5:
        return normalized
    return f"{normalized[:4]}***{normalized[-2:]}"


def _generate_phone_verification_code():
    alphabet = "0123456789"
    return "".join(
        secrets.choice(alphabet) for _ in range(PHONE_VERIFICATION_CODE_LENGTH)
    )


def _hash_phone_verification_code(code, salt):
    return hashlib.sha256(f"{salt}:{code}".encode("utf-8")).hexdigest()


def _send_infobip_sms(to_phone, message):
    # Infobip has been removed — it no longer delivers to UAE. Phone OTP now runs
    # entirely through the MSG91 widget (client-side send + /api/phone-verifications/
    # verify-token). There is no server-side SMS provider; this stub only exists so
    # the retired server-side OTP fallback fails loudly instead of silently.
    raise RuntimeError(
        "SMS provider removed — phone verification is handled by the MSG91 widget."
    )


def _extract_msg91_identifier(body):
    """Pull the verified phone/email out of an MSG91 verifyAccessToken response.

    MSG91's success shape isn't strongly documented, so walk the common places
    (top-level and nested under 'message'/'data') for an 'identifier' field.
    Returns None if absent — callers fall back to the account phone.
    """
    if not isinstance(body, dict):
        return None
    for container in (body, body.get("message"), body.get("data")):
        if isinstance(container, dict):
            ident = container.get("identifier") or container.get("mobile")
            if ident:
                return str(ident)
    return None


def _verify_msg91_access_token(access_token):
    """Validate an MSG91 OTP-widget JWT server-side. Returns (ok: bool, data: dict)."""
    if not MSG91_AUTHKEY:
        return False, {"message": "MSG91_AUTHKEY is not configured"}
    if not access_token:
        return False, {"message": "access token is required"}
    try:
        response = requests.post(
            MSG91_VERIFY_TOKEN_URL,
            headers={"Content-Type": "application/json"},
            json={"authkey": MSG91_AUTHKEY, "access-token": access_token},
            timeout=15,
        )
        body = response.json() if response.content else {}
    except Exception as exc:
        logger.error(f"MSG91 verifyAccessToken error: {exc}", exc_info=True)
        return False, {"message": str(exc)}
    # MSG91 returns HTTP 200 with type:'error' for a bad/expired token (e.g. code
    # 701) and type:'success' when valid. Trust the type field, not the HTTP code.
    if response.status_code >= 400 or str(body.get("type", "")).lower() == "error":
        logger.warning(f"MSG91 token rejected: {body}")
        return False, body
    return True, body


def _msg91_handles_phone(phone, country_code=None):
    """True when this number should be verified by the MSG91 client widget instead
    of a server-issued Infobip SMS. Gated by MSG91_OTP_ENABLED + prefix match."""
    if not (MSG91_OTP_ENABLED and MSG91_AUTHKEY):
        return False
    normalized = _normalize_phone_number(phone, country_code)
    digits = re.sub(r"[^\d]", "", normalized or "")
    return any(digits.startswith(prefix) for prefix in MSG91_OTP_PREFIXES)


def _msg91_pending_verification(phone, country_code, purpose, listing_id=None):
    """Payload telling the frontend a verification is required but NOT server-sent —
    the widget performs the send. Deliberately carries no verification_id so the
    client widget owns the flow (verify lands on /verify-token)."""
    normalized = _normalize_phone_number(phone, country_code) or str(phone or "")
    digits = re.sub(r"[^\d]", "", normalized)
    masked = f"***{digits[-4:]}" if len(digits) >= 4 else None
    return {
        "verification_id": None,
        "status": "pending",
        "phone": normalized,
        "masked_phone": masked,
        "purpose": purpose,
        "listing_id": listing_id,
        "provider": "msg91_widget",
    }


def _get_user_profile_for_verification(user_id):
    if not user_id:
        return None

    select_fields = [
        "id",
        "email",
        "email_verified",
        "phone",
        "country_code",
        "phone_verified",
        "phone_verified_at",
    ]
    if _users_table_has_column("email_verified_at"):
        select_fields.insert(3, "email_verified_at")

    resp, status = supabase_request(
        "get",
        f"/rest/v1/users?id=eq.{user_id}&select={','.join(select_fields)}",
        use_service_role=True,
    )
    if status >= 400 or not resp:
        return None

    profile = resp[0]
    auth_user = _fetch_supabase_auth_user(user_id)
    auth_email_confirmed, auth_phone_confirmed = _extract_auth_confirmation_fields(
        auth_user
    )

    if auth_user and auth_user.get("email") and not profile.get("email"):
        profile["email"] = auth_user.get("email")

    if auth_email_confirmed:
        profile["email_verified"] = True
        profile["email_verified_at"] = auth_email_confirmed
        if not bool(resp[0].get("email_verified")):
            _sync_user_verification_flags(
                user_id,
                email_verified=True,
                email_verified_at=auth_email_confirmed,
            )

    if auth_phone_confirmed:
        profile["phone_verified"] = True
        profile["phone_verified_at"] = auth_phone_confirmed
        if auth_user and auth_user.get("phone") and not profile.get("phone"):
            profile["phone"] = auth_user.get("phone")
        if not bool(resp[0].get("phone_verified")):
            _sync_user_verification_flags(
                user_id,
                phone_verified=True,
                phone_verified_at=auth_phone_confirmed,
                phone=profile.get("phone"),
                country_code=profile.get("country_code"),
            )

    return profile


def _supabase_admin_headers():
    service_key = SUPABASE_SERVICE_ROLE_KEY or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not service_key:
        service_key = SUPABASE_KEY
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "X-Postgres-Role": "service_role",
    }


_USERS_TABLE_COLUMN_CACHE = {}


def _users_table_has_column(column_name):
    cached = _USERS_TABLE_COLUMN_CACHE.get(column_name)
    if cached is not None:
        return cached

    response, status = supabase_request(
        "get",
        "/rest/v1/users",
        params={"select": f"id,{column_name}", "limit": 1},
        use_service_role=True,
    )
    exists = status < 400 and not _looks_like_missing_column(response, column_name)
    _USERS_TABLE_COLUMN_CACHE[column_name] = exists
    return exists


def _fetch_supabase_auth_user(user_id):
    if not user_id or not SUPABASE_URL:
        return None

    try:
        response = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers=_supabase_admin_headers(),
            timeout=10,
        )
        if response.status_code != 200:
            return None
        payload = response.json()
        if isinstance(payload, dict) and isinstance(payload.get("user"), dict):
            return payload.get("user")
        return payload if isinstance(payload, dict) else None
    except requests.exceptions.RequestException as exc:
        logger.warning("Failed to fetch auth user %s: %s", user_id, exc)
        return None


def _extract_auth_confirmation_fields(auth_user):
    if not isinstance(auth_user, dict):
        return None, None
    return auth_user.get("email_confirmed_at"), auth_user.get("phone_confirmed_at")


def _infer_country_code_from_phone(phone):
    normalized_phone = _normalize_phone_number(phone)
    digits = re.sub(r"[^\d]", "", normalized_phone or "")
    if not digits:
        return None
    if digits.startswith("971"):
        return "+971"
    return None


def _sync_user_verification_flags(
    user_id,
    *,
    email_verified=False,
    email_verified_at=None,
    phone_verified=False,
    phone_verified_at=None,
    phone=None,
    country_code=None,
):
    if not user_id:
        return

    payload = {"updated_at": _isoformat_utc(_utc_now())}
    if email_verified:
        payload["email_verified"] = True
        if _users_table_has_column("email_verified_at"):
            payload["email_verified_at"] = email_verified_at or payload["updated_at"]
    if phone_verified:
        payload["phone_verified"] = True
        payload["phone_verified_at"] = phone_verified_at or payload["updated_at"]
    normalized_phone = _normalize_phone_number(phone, country_code)
    if normalized_phone:
        payload["phone"] = normalized_phone
        payload["country_code"] = (
            country_code
            or _infer_country_code_from_phone(normalized_phone)
            or "+971"
        )

    supabase_request(
        "patch",
        f"/rest/v1/users?id=eq.{user_id}",
        data=payload,
        use_service_role=True,
    )


def _lookup_phone_verification(
    *, verification_id=None, user_id=None, purpose=None, listing_id=None
):
    params = {"select": "*", "order": "created_at.desc", "limit": 1}
    if verification_id:
        params["id"] = f"eq.{verification_id}"
    if user_id:
        params["user_id"] = f"eq.{user_id}"
    if purpose:
        params["purpose"] = f"eq.{purpose}"
    if listing_id:
        params["listing_id"] = f"eq.{listing_id}"

    response, status = supabase_request(
        "get",
        "/rest/v1/phone_verifications",
        params=params,
        use_service_role=True,
    )
    if status >= 400 or not response:
        return None
    return response[0]


def _expire_active_phone_verifications(user_id, purpose, listing_id=None):
    params = {
        "user_id": f"eq.{user_id}",
        "purpose": f"eq.{purpose}",
        "status": "eq.pending",
    }
    if listing_id:
        params["listing_id"] = f"eq.{listing_id}"

    records, status = supabase_request(
        "get",
        "/rest/v1/phone_verifications",
        params={"select": "id", **params},
        use_service_role=True,
    )
    if status >= 400 or not records:
        return

    for record in records:
        supabase_request(
            "patch",
            f"/rest/v1/phone_verifications?id=eq.{record.get('id')}",
            data={
                "status": "expired",
                "updated_at": _isoformat_utc(_utc_now()),
            },
            use_service_role=True,
        )


def _issue_phone_verification(
    *, user_id, phone, purpose, country_code=None, listing_id=None, metadata=None
):
    normalized_phone = _normalize_phone_number(phone, country_code)
    if not normalized_phone:
        raise ValueError("A valid phone number is required")
    if not _is_uae_phone(normalized_phone):
        raise ValueError("Only UAE phone numbers are supported for OTP verification")
    if purpose not in PHONE_VERIFICATION_PURPOSES:
        raise ValueError("Invalid verification purpose")

    _expire_active_phone_verifications(user_id, purpose, listing_id)

    code = _generate_phone_verification_code()
    salt = secrets.token_hex(16)
    now = _utc_now()
    expires_at = now + datetime.timedelta(minutes=PHONE_VERIFICATION_TTL_MINUTES)
    record_payload = {
        "user_id": user_id,
        "phone": normalized_phone,
        "purpose": purpose,
        "listing_id": listing_id,
        "status": "pending",
        "code_hash": _hash_phone_verification_code(code, salt),
        "code_salt": salt,
        "attempt_count": 0,
        "send_count": 1,
        "expires_at": _isoformat_utc(expires_at),
        "verified_at": None,
        "last_sent_at": _isoformat_utc(now),
        "last_error": None,
        "metadata": {
            **(metadata or {}),
            "country_code": country_code
            or _infer_country_code_from_phone(normalized_phone)
            or "+971",
        },
        "updated_at": _isoformat_utc(now),
    }

    insert_response, insert_status = supabase_request(
        "post",
        "/rest/v1/phone_verifications",
        data=record_payload,
        use_service_role=True,
    )
    if insert_status >= 400:
        raise RuntimeError(f"Failed to create phone verification: {insert_response}")

    verification = (
        insert_response[0]
        if isinstance(insert_response, list) and insert_response
        else insert_response
    )

    message = (
        f"Your DPH Classifieds verification code is {code}. "
        f"It expires in {PHONE_VERIFICATION_TTL_MINUTES} minutes."
    )
    sent, send_result = _send_infobip_sms(normalized_phone, message)
    if not sent:
        supabase_request(
            "patch",
            f"/rest/v1/phone_verifications?id=eq.{verification.get('id')}",
            data={
                "status": "failed",
                "last_error": "sms_send_failed",
                "updated_at": _isoformat_utc(_utc_now()),
                "metadata": {"send_error": send_result},
            },
            use_service_role=True,
        )
        raise RuntimeError(
            "Failed to send verification SMS. Please try again in a moment."
        )

    return {
        "verification": verification,
        "code": code,
        "expires_at": _isoformat_utc(expires_at),
        "send_result": send_result,
    }


def _resend_phone_verification(verification_record):
    if not verification_record:
        raise ValueError("Verification record not found")

    if verification_record.get("status") != "pending":
        raise ValueError("Verification is no longer active")

    expires_at = _parse_datetime(verification_record.get("expires_at"))
    if expires_at and _utc_now() >= expires_at:
        supabase_request(
            "patch",
            f"/rest/v1/phone_verifications?id=eq.{verification_record.get('id')}",
            data={
                "status": "expired",
                "updated_at": _isoformat_utc(_utc_now()),
            },
            use_service_role=True,
        )
        raise ValueError("Verification code has expired")

    send_count = int(verification_record.get("send_count") or 0)
    if send_count >= PHONE_VERIFICATION_MAX_SENDS:
        raise ValueError("Too many resend attempts")

    code = _generate_phone_verification_code()
    salt = secrets.token_hex(16)
    now = _utc_now()
    expires_at = now + datetime.timedelta(minutes=PHONE_VERIFICATION_TTL_MINUTES)
    patch_payload = {
        "code_hash": _hash_phone_verification_code(code, salt),
        "code_salt": salt,
        "attempt_count": 0,
        "send_count": send_count + 1,
        "expires_at": _isoformat_utc(expires_at),
        "last_sent_at": _isoformat_utc(now),
        "last_error": None,
        "status": "pending",
        "updated_at": _isoformat_utc(now),
    }

    patch_response, patch_status = supabase_request(
        "patch",
        f"/rest/v1/phone_verifications?id=eq.{verification_record.get('id')}",
        data=patch_payload,
        use_service_role=True,
    )
    if patch_status >= 400:
        raise RuntimeError(f"Failed to refresh verification: {patch_response}")

    message = (
        f"Your DPH Classifieds verification code is {code}. "
        f"It expires in {PHONE_VERIFICATION_TTL_MINUTES} minutes."
    )
    sent, send_result = _send_infobip_sms(verification_record.get("phone"), message)
    if not sent:
        raise RuntimeError(
            f"Failed to send verification SMS: {send_result.get('message') or send_result.get('details')}"
        )

    verification = (
        patch_response[0]
        if isinstance(patch_response, list) and patch_response
        else patch_response
    )
    verification["expires_at"] = _isoformat_utc(expires_at)
    return {"verification": verification, "code": code, "send_result": send_result}


def _sync_phone_to_listings(user_id, new_phone):
    """Sync a verified phone number to all of the user's listings across all types."""
    # Each list must name ONLY columns that exist on that table — this helper
    # writes them verbatim with no whitelist, so a stray column 400s the whole
    # PATCH (PGRST204) and silently drops the real phone update. cars has no
    # contact_phone (car_owner_phone_number is canonical); car_parts has no
    # contact_phone either (contact_number is canonical).
    tables_and_fields = [
        ("cars", ["car_owner_phone_number"]),
        ("bikes", ["contact_number", "contact_phone"]),
        ("license_plates", ["contact_phone"]),
        ("car_parts", ["contact_number"]),
    ]
    for table, phone_fields in tables_and_fields:
        try:
            update_data = {field: new_phone for field in phone_fields}
            supabase_request(
                "patch",
                f"/rest/v1/{table}?user_id=eq.{user_id}",
                data=update_data,
                use_service_role=True,
            )
            logger.info(f"Synced phone to {table} for user {user_id}")
        except Exception as e:
            logger.error(f"Failed to sync phone to {table}: {e}")


def _finalize_phone_verification(
    verification_record, code, *, ip_address=None, user_agent=None
):
    if not verification_record:
        raise ValueError("Verification record not found")

    if verification_record.get("status") != "pending":
        raise ValueError("Verification is no longer active")

    expires_at = _parse_datetime(verification_record.get("expires_at"))
    if expires_at and _utc_now() >= expires_at:
        supabase_request(
            "patch",
            f"/rest/v1/phone_verifications?id=eq.{verification_record.get('id')}",
            data={
                "status": "expired",
                "updated_at": _isoformat_utc(_utc_now()),
            },
            use_service_role=True,
        )
        raise ValueError("Verification code has expired")

    attempt_count = int(verification_record.get("attempt_count") or 0)
    if attempt_count >= PHONE_VERIFICATION_MAX_ATTEMPTS:
        supabase_request(
            "patch",
            f"/rest/v1/phone_verifications?id=eq.{verification_record.get('id')}",
            data={
                "status": "failed",
                "last_error": "max_attempts_reached",
                "updated_at": _isoformat_utc(_utc_now()),
            },
            use_service_role=True,
        )
        raise ValueError("Too many verification attempts")

    expected_hash = _hash_phone_verification_code(
        code, verification_record.get("code_salt") or ""
    )
    if expected_hash != verification_record.get("code_hash"):
        next_attempts = attempt_count + 1
        update_payload = {
            "attempt_count": next_attempts,
            "last_error": "invalid_code",
            "updated_at": _isoformat_utc(_utc_now()),
        }
        if next_attempts >= PHONE_VERIFICATION_MAX_ATTEMPTS:
            update_payload["status"] = "failed"
        supabase_request(
            "patch",
            f"/rest/v1/phone_verifications?id=eq.{verification_record.get('id')}",
            data=update_payload,
            use_service_role=True,
        )
        raise ValueError("Invalid verification code")

    now = _utc_now()
    supabase_request(
        "patch",
        f"/rest/v1/phone_verifications?id=eq.{verification_record.get('id')}",
        data={
            "status": "verified",
            "attempt_count": attempt_count + 1,
            "verified_at": _isoformat_utc(now),
            "verified_ip": ip_address,
            "verified_user_agent": user_agent,
            "last_error": None,
            "updated_at": _isoformat_utc(now),
        },
        use_service_role=True,
    )

    verification_metadata = verification_record.get("metadata") or {}
    _sync_user_verification_flags(
        verification_record.get("user_id"),
        phone_verified=True,
        phone_verified_at=_isoformat_utc(now),
        phone=verification_record.get("phone"),
        country_code=verification_metadata.get("country_code"),
    )

    # Sync verified phone number to all user's listings
    try:
        user_id = verification_record.get("user_id")
        new_phone = verification_record.get("phone")
        if user_id and new_phone:
            _sync_phone_to_listings(user_id, new_phone)
    except Exception as sync_err:
        logger.error(f"Failed to sync phone to listings after verification: {sync_err}")

    return {
        "verification_id": verification_record.get("id"),
        "status": "verified",
        "phone": verification_record.get("phone"),
        "purpose": verification_record.get("purpose"),
        "listing_id": verification_record.get("listing_id"),
        "verified_at": _isoformat_utc(now),
    }


def _require_verified_user_for_listing(user_id):
    profile = _get_user_profile_for_verification(user_id) or {}

    if not bool(profile.get("email_verified")):
        return jsonify(
            {
                "error": "Please verify your email before posting a listing.",
                "code": "email_not_verified",
                "email_verified": False,
                "phone_verified": bool(profile.get("phone_verified")),
            }
        ), 403

    if not bool(profile.get("phone_verified")):
        return jsonify(
            {
                "error": "Please verify your phone number before posting a listing.",
                "code": "phone_not_verified",
                "email_verified": True,
                "phone_verified": False,
            }
        ), 403

    return None


def _phone_verification_response(record):
    if not record:
        return None
    expires_at = _parse_datetime(record.get("expires_at"))
    resend_available_at = None
    if record.get("last_sent_at"):
        resend_available_at = _parse_datetime(
            record.get("last_sent_at")
        ) + datetime.timedelta(seconds=PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS)
    return {
        "verification_id": record.get("id"),
        "phone": record.get("phone"),
        "purpose": record.get("purpose"),
        "listing_id": record.get("listing_id"),
        "status": record.get("status"),
        "attempt_count": int(record.get("attempt_count") or 0),
        "send_count": int(record.get("send_count") or 0),
        "expires_at": _isoformat_utc(expires_at)
        if expires_at
        else record.get("expires_at"),
        "resend_available_at": _isoformat_utc(resend_available_at)
        if resend_available_at
        else None,
        "masked_phone": _mask_phone_number(record.get("phone")),
        "last_error": record.get("last_error"),
        "verified_at": record.get("verified_at"),
    }


# Create static directory for file uploads if it doesn't exist
os.makedirs(os.path.join("static", "uploads", "plates"), exist_ok=True)


register_http_runtime(
    app,
    logger=logger,
    posthog_client=posthog_client,
    build_content_security_policy=_build_content_security_policy,
    request_start_time=_request_start_time,
    request_supabase_durations_ms=_request_supabase_durations_ms,
)


def _get_user_listing_count(user_id):
    """Total listings across all listing types (cars/bikes/plates/parts)."""
    tables = ["cars", "bikes", "license_plates", "car_parts"]
    total = 0

    for table in tables:
        data, status_code = supabase_request(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": "id",
                "user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "limit": MAX_LISTINGS_PER_USER + 1,
            },
            use_service_role=True,
        )

        if status_code >= 400:
            # If schema doesn't have deleted_at yet, fall back to counting all rows.
            if isinstance(data, dict) and str(data.get("code") or "") == "PGRST204":
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

        total += len(data or [])
        if total >= MAX_LISTINGS_PER_USER:
            break

    return total, None


def _get_user_listing_counts_by_table(user_id, limit=None):
    """Counts listings per core listing table, excluding deleted rows when possible."""
    tables = ["cars", "bikes", "license_plates", "car_parts"]
    counts = {}
    effective_limit = limit if limit is not None else MAX_LISTINGS_PER_USER_PER_TYPE + 50

    for table in tables:
        data, status_code = supabase_request(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": "id",
                "user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "limit": effective_limit,
            },
            use_service_role=True,
        )
        if (
            status_code >= 400
            and isinstance(data, dict)
            and str(data.get("code") or "") == "PGRST204"
        ):
            # deleted_at column not present yet; fall back to counting all rows.
            data, status_code = supabase_request(
                "get",
                f"/rest/v1/{table}",
                params={
                    "select": "id",
                    "user_id": f"eq.{user_id}",
                    "limit": effective_limit,
                },
                use_service_role=True,
            )
        if status_code >= 400:
            return None, data
        counts[table] = len(data or [])

    return counts, None


def _enforce_listing_limit(user_id):
    if _is_super_admin_user(user_id):
        return None

    # Verified dealers use the per-dealer cap (active listings across all four
    # tables). Non-dealers and unverified dealers continue to use the per-type
    # cap. Unverified dealers also have a separate verification gate elsewhere.
    dealer_info = _fetch_dealer_listing_policy(user_id)
    if dealer_info and dealer_info.get("verified"):
        counts, error = _get_user_listing_counts_by_table(user_id, limit=2000)
        if error is not None or counts is None:
            return jsonify({"error": "Failed to verify listing limit"}), 500
        total_active = sum(counts.values())
        limit = dealer_info["limit"]
        if total_active >= limit:
            return jsonify({
                "error": (
                    f"You've reached your ad limit ({limit} active listings). "
                    "Contact us to request an increase."
                ),
                "code": "dealer_listing_limit",
                "limit": limit,
                "total_active": total_active,
                "counts": counts,
            }), 403
        # Block posting if a required dealer document has expired.
        expired_docs = _dealer_expired_required_documents(user_id)
        if expired_docs:
            return jsonify({
                "error": (
                    f"Your {expired_docs[0]} has expired. "
                    "Please re-upload it before posting new listings."
                ),
                "code": "dealer_doc_expired",
                "expired_documents": expired_docs,
            }), 403
        return None

    counts, error = _get_user_listing_counts_by_table(user_id)
    if error is not None or counts is None:
        return jsonify({"error": "Failed to verify listing limit"}), 500

    over = {
        table: count
        for table, count in (counts or {}).items()
        if count >= MAX_LISTINGS_PER_USER_PER_TYPE
    }
    if over:
        # Keep response explicit so frontend can show per-category messaging.
        return jsonify(
            {
                "error": f"Listing limit reached. You can only post {MAX_LISTINGS_PER_USER_PER_TYPE} ads per category.",
                "code": "listing_limit",
                "limit_per_type": MAX_LISTINGS_PER_USER_PER_TYPE,
                "counts": counts,
                "over": over,
            }
        ), 403
    return None


_DEFAULT_DEALER_LISTING_LIMIT = int(os.getenv("DEFAULT_DEALER_LISTING_LIMIT", "4"))
_DEALER_REQUIRED_DOCS = (
    "trade_license",
    "tax_registration",
)
_DEALER_DOCUMENT_LABELS = {
    "trade_license": "Trade License",
    "tax_registration": "Tax Registration (TRN)",
}
# A dealer can only request a limit increase once they have used at least
# this fraction of their current cap. Prevents spam requests from idle dealers.
_DEALER_UPGRADE_REQUEST_MIN_USAGE_RATIO = float(
    os.getenv("DEALER_UPGRADE_REQUEST_MIN_USAGE_RATIO", "0.8")
)
_DEALER_UPGRADE_REQUEST_REASON_MIN = 10
_DEALER_UPGRADE_REQUEST_REASON_MAX = 1000
_DEALER_UPGRADE_REQUEST_MAX_LIMIT = 1000


def validate_upgrade_request(current_limit, requested_limit, reason):
    """Pure validator for a dealer-initiated listing-upgrade request.

    Returns None on success, or {code, message} for the first failure. Codes:
      - invalid_requested_limit (non-int, <=current, >max)
      - reason_required         (not a string)
      - reason_too_short        (<REASON_MIN)
      - reason_too_long         (>REASON_MAX)
    """
    try:
        rl = int(requested_limit)
    except (TypeError, ValueError):
        return {"code": "invalid_requested_limit",
                "message": "requested_limit must be a number"}
    if rl <= int(current_limit):
        return {"code": "invalid_requested_limit",
                "message": "requested_limit must be greater than your current limit"}
    if rl > _DEALER_UPGRADE_REQUEST_MAX_LIMIT:
        return {"code": "invalid_requested_limit",
                "message": f"requested_limit cannot exceed {_DEALER_UPGRADE_REQUEST_MAX_LIMIT}"}
    if not isinstance(reason, str):
        return {"code": "reason_required", "message": "reason is required"}
    r = reason.strip()
    if len(r) < _DEALER_UPGRADE_REQUEST_REASON_MIN:
        return {"code": "reason_too_short",
                "message": f"reason must be at least {_DEALER_UPGRADE_REQUEST_REASON_MIN} characters"}
    if len(r) > _DEALER_UPGRADE_REQUEST_REASON_MAX:
        return {"code": "reason_too_long",
                "message": f"reason must be at most {_DEALER_UPGRADE_REQUEST_REASON_MAX} characters"}
    return None


def _compute_dealer_listing_limit_summary(limit, counts):
    """Return a single payload summarising the dealer's limit position.

    `counts` is the per-table active-listing count from
    `_get_user_listing_counts_by_table()` (or any dict mapping table name to
    integer count). The summary is consumed by the dealer panel UI and the
    upgrade-request validation path.
    """
    used = sum(int(v or 0) for v in (counts or {}).values())
    cap = int(limit)
    remaining = max(0, cap - used)
    can_request = used >= cap * _DEALER_UPGRADE_REQUEST_MIN_USAGE_RATIO
    return {
        "limit": cap,
        "used": used,
        "remaining": remaining,
        "can_request": bool(can_request),
        "default_limit": _DEFAULT_DEALER_LISTING_LIMIT,
    }


def _evaluate_dealer_application(user, documents):
    """Return the single source of truth for dealer application readiness.

    `documents` must contain only active document rows. This helper is deliberately
    side-effect free so submission, approval, listing access, and status screens
    cannot drift into different interpretations of a complete application.
    """
    user = user or {}
    active_docs = [doc for doc in (documents or []) if not doc.get("replaced_at")]
    by_type = {}
    for doc in active_docs:
        doc_type = doc.get("document_type")
        if doc_type in _DEALER_REQUIRED_DOCS and doc_type not in by_type:
            by_type[doc_type] = doc

    missing_fields = []
    if not (user.get("company_name") or "").strip():
        missing_fields.append("Trading Name")
    if not (user.get("legal_business_name") or "").strip():
        missing_fields.append("Legal Business Name")
    trn = re.sub(r"\D", "", str(user.get("trn") or ""))
    if len(trn) != 15:
        missing_fields.append("15-digit TRN")

    missing_uploads = [
        doc_type for doc_type in _DEALER_REQUIRED_DOCS if doc_type not in by_type
    ]
    denied = [
        doc_type for doc_type, doc in by_type.items() if doc.get("status") == "denied"
    ]
    pending = [
        doc_type for doc_type, doc in by_type.items() if doc.get("status") == "pending"
    ]
    approved = [
        doc_type for doc_type, doc in by_type.items() if doc.get("status") == "approved"
    ]
    today = datetime.datetime.utcnow().date().isoformat()
    trade_license = by_type.get("trade_license")
    expired = []
    if trade_license and trade_license.get("expires_at") and str(trade_license["expires_at"]) <= today:
        expired.append("trade_license")

    ready_to_submit = not missing_fields and not missing_uploads and not expired
    ready_to_approve = (
        ready_to_submit
        and not denied
        and not pending
        and set(approved) == set(_DEALER_REQUIRED_DOCS)
    )
    return {
        "required_documents": list(_DEALER_REQUIRED_DOCS),
        "document_labels": _DEALER_DOCUMENT_LABELS,
        "missing_fields": missing_fields,
        "missing_uploads": missing_uploads,
        "pending_documents": pending,
        "denied_documents": denied,
        "expired_documents": expired,
        "approved_documents": approved,
        "ready_to_submit": ready_to_submit,
        "ready_to_approve": ready_to_approve,
    }


def _get_dealer_application_readiness(user_id):
    """Fetch active dealer evidence and evaluate it consistently for every flow."""
    user_rows, user_status = supabase_request(
        "get",
        "/rest/v1/users",
        params={
            "id": f"eq.{user_id}",
            "select": "id,is_dealer,company_name,legal_business_name,trn,dealer_application_status,dealer_verified",
            "limit": 1,
        },
        use_service_role=True,
    )
    if user_status >= 400 or not user_rows:
        return None, "Dealer not found"
    user = user_rows[0]
    docs, docs_status = supabase_request(
        "get",
        "/rest/v1/dealer_documents",
        params={
            "user_id": f"eq.{user_id}",
            "replaced_at": "is.null",
            "select": "id,document_type,status,expires_at,replaced_at,uploaded_at,denial_reason,denial_fix",
        },
        use_service_role=True,
    )
    if docs_status >= 400:
        return None, "Could not load dealer documents"
    readiness = _evaluate_dealer_application(user, docs or [])
    readiness.update({
        "application_status": user.get("dealer_application_status") or "draft",
        "dealer_verified": bool(user.get("dealer_verified")),
        "documents": docs or [],
    })
    return readiness, None


def _fetch_dealer_listing_policy(user_id):
    """Return the full listing-limit summary for a dealer user, or None.

    Shape: {verified, limit, used, remaining, can_request, default_limit}.
    Non-dealers get None. The summary is single-call and is what the dealer
    panel renders on the Listings tab and the request-more-listings modal.
    """
    try:
        user_resp, user_status = supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{user_id}&select=is_dealer,dealer_verified,dealer_listing_limit",
            use_service_role=True,
        )
    except Exception as exc:
        logger.warning(f"dealer policy fetch failed for {user_id}: {exc}")
        return None
    if user_status >= 400 or not user_resp:
        return None
    row = user_resp[0]
    if not row.get("is_dealer"):
        return None
    limit = row.get("dealer_listing_limit")
    if limit is None:
        limit = _DEFAULT_DEALER_LISTING_LIMIT
    limit = int(limit)
    # Pull active counts so the panel can render X / limit in one round-trip.
    counts, _err = _get_user_listing_counts_by_table(user_id, limit=2000)
    summary = _compute_dealer_listing_limit_summary(limit, counts or {})
    return {
        "verified": bool(row.get("dealer_verified")),
        **summary,
    }


def _dealer_expired_required_documents(user_id):
    """Return human-readable names of required dealer documents that are expired."""
    today_iso = datetime.datetime.utcnow().date().isoformat()
    expired = []
    for doc_type in _DEALER_REQUIRED_DOCS:
        rows, status = supabase_request(
            "get",
            (
                f"/rest/v1/dealer_documents?user_id=eq.{user_id}"
                f"&document_type=eq.{doc_type}"
                f"&replaced_at=is.null"
                f"&select=expires_at"
                f"&order=uploaded_at.desc&limit=1"
            ),
            use_service_role=True,
        )
        if status >= 400 or not rows:
            continue
        exp = rows[0].get("expires_at")
        if exp and str(exp) <= today_iso:
            expired.append(doc_type.replace("_", " "))
    return expired


def _require_dealer_verified(user_id):
    """Block unverified dealers from creating listings. Returns error response or None."""
    try:
        rows, status = supabase_request(
            "get",
            "/rest/v1/users",
            params={"id": f"eq.{user_id}", "select": "is_dealer,dealer_verified"},
            use_service_role=True,
        )
        if status >= 400:
            return jsonify({"error": "Dealer verification is temporarily unavailable", "code": "dealer_verification_unavailable"}), 503
        if not rows:
            return jsonify({"error": "Dealer verification could not be confirmed", "code": "dealer_verification_unavailable"}), 503
        if rows and rows[0].get("is_dealer") and not rows[0].get("dealer_verified"):
            return jsonify(
                {
                    "error": "We're still verifying your documents — usually under a minute.",
                    "code": "dealer_not_verified",
                }
            ), 403

        # Check the same active-document readiness rule used by submission and approval.
        if rows and rows[0].get("is_dealer") and rows[0].get("dealer_verified"):
            readiness, readiness_error = _get_dealer_application_readiness(user_id)
            if readiness_error:
                return jsonify({"error": readiness_error}), 500
            if not readiness["ready_to_approve"]:
                blocked = (
                    readiness["missing_uploads"]
                    + readiness["pending_documents"]
                    + readiness["denied_documents"]
                    + readiness["expired_documents"]
                )
                labels = [
                    _DEALER_DOCUMENT_LABELS.get(doc_type, doc_type)
                    for doc_type in dict.fromkeys(blocked)
                ]
                return jsonify({
                    "error": "Your dealer verification needs attention before you can post listings.",
                    "code": "dealer_documents_missing",
                    "missing": list(dict.fromkeys(blocked)),
                    "missing_labels": labels,
                }), 403
    except Exception as e:
        logger.error(f"Error checking dealer verification: {e}")
        return jsonify({"error": "Dealer verification is temporarily unavailable", "code": "dealer_verification_unavailable"}), 503


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
        return True

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
    logger.info("Admin API routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin API routes: {e}")

# Import and register OCR routes
try:
    from routes.ocr import ocr_bp

    app.register_blueprint(ocr_bp)
    logger.info("OCR API routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register OCR API routes: {e}")

# Import and register authenticated user routes.  The compatibility imports
# keep existing internal callers stable while URL ownership lives in the
# dedicated blueprint.
try:
    from routes.user import (
        SAVED_SEARCH_CATEGORIES,
        _build_saved_search_key,
        _clean_saved_search_filters,
        _normalize_saved_search_category,
        _saved_search_missing_table_response,
        _delete_supabase_auth_user,
        _delete_user_scoped_table_rows,
        _soft_delete_user_listing_table,
        delete_push_token,
        delete_user_account,
        delete_user_saved_listing,
        delete_user_saved_search,
        get_user_saved_listings,
        get_user_saved_searches,
        register_push_token,
        save_user_search,
        create_user_saved_listing,
        user_bp,
    )

    app.register_blueprint(user_bp)
    logger.info("Authenticated user routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register authenticated user routes: {e}")

# Session and recovery handlers use the same runtime dependency boundary as
# the user routes. Compatibility imports keep existing internal callers stable.
try:
    from routes.auth import (
        auth_bp,
        get_user_info,
        logout,
        refresh_token,
        resend_confirmation,
        reset_password,
        update_password,
        update_user_email,
    )

    app.register_blueprint(auth_bp)
    logger.info("Authentication session routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register authentication session routes: {e}")

logger.info("Admin web routes registered successfully")


@app.context_processor
def inject_current_year():
    return {"current_year": datetime.datetime.now().year}


# Initialize database tables
def ensure_tables_exist():
    try:
        logger.info("Checking if required tables exist")
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)

        if not SUPABASE_URL or not service_key:
            logger.info(
                "Skipping startup table check because Supabase config is missing"
            )
            return

        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "X-Postgres-Role": "service_role",
        }

        # Check if users table exists by trying to query it
        users_check = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?limit=1", headers=headers, timeout=10
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
                f"{SUPABASE_URL}/rest/v1/rpc",
                json=create_table_query,
                headers=headers,
                timeout=10,
            )

            if rpc_response.status_code >= 400:
                logger.error(
                    f"Failed to create users table: {rpc_response.status_code} - {rpc_response.text}"
                )
            else:
                logger.info("Successfully created users table")
        else:
            logger.info("Users table already exists")

        ensure_platform_events_table(headers=headers)

    except Exception as e:
        logger.error(f"Error checking/creating tables: {str(e)}")


def ensure_platform_events_table(headers=None):
    try:
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
        if not SUPABASE_URL or not service_key:
            logger.info(
                "Skipping platform events table check because Supabase config is missing"
            )
            return False

        active_headers = headers or {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "X-Postgres-Role": "service_role",
        }

        platform_check = requests.get(
            f"{SUPABASE_URL}/rest/v1/platform_events?limit=1",
            headers=active_headers,
            timeout=10,
        )
        if (
            platform_check.status_code != 404
            and "does not exist" not in platform_check.text.lower()
        ):
            return True

        logger.error(
            "Platform analytics table is missing. Apply backend/migrations/add_platform_analytics_tracking.sql to the live Supabase project."
        )
        return False
    except Exception as exc:
        logger.error(f"Error ensuring platform events table exists: {exc}")
        return False


# Only run the table check when explicitly enabled. Running this at import time
# under Gunicorn preload can fork after a live background thread starts, which
# is fragile in production and can destabilize deploys.
if os.getenv("ENABLE_STARTUP_DB_CHECK", "false").lower() == "true":
    threading.Thread(target=ensure_tables_exist, daemon=True).start()
else:
    logger.info("Startup table check disabled")


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


def _get_optional_user_id_from_auth_header():
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1]
    try:
        import jwt as pyjwt

        for secret_bytes, _method in _decode_supabase_jwt_secret(SUPABASE_JWT_SECRET):
            try:
                payload = pyjwt.decode(
                    token,
                    secret_bytes,
                    algorithms=["HS256"],
                    options={"verify_aud": False},
                )
                uid = payload.get("sub")
                if uid:
                    return uid
            except Exception:
                continue
    except Exception:
        pass

    try:
        auth_headers = {
            "apikey": SUPABASE_KEY or os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        auth_response = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers=auth_headers,
            timeout=10,
        )
        if auth_response.status_code == 200:
            supabase_user = auth_response.json()
            current_user = supabase_user.get("id")
            if current_user:
                return current_user
    except Exception as fallback_error:
        logger.info(f"Optional Supabase token validation skipped: {fallback_error}")

    return None


def _resolve_listing_table(item_type):
    return API_ITEM_TYPE_TO_TABLE.get(item_type) or ADMIN_ITEM_TYPE_TO_TABLE.get(
        item_type
    )


def _normalize_identity(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _is_super_admin_record(user_data=None, user_id=None):
    if not user_data and not user_id:
        return False

    if (
        PRIMARY_SUPER_ADMIN_USER_ID
        and str(user_id or "") == PRIMARY_SUPER_ADMIN_USER_ID
    ):
        return True

    if bool((user_data or {}).get("is_super_admin")):
        return True

    email = _normalize_identity((user_data or {}).get("email"))
    username = _normalize_identity((user_data or {}).get("username"))
    return email == _normalize_identity(
        PRIMARY_SUPER_ADMIN_EMAIL
    ) or username == _normalize_identity(PRIMARY_SUPER_ADMIN_USERNAME)


def _is_super_admin_user(user_id):
    user_data, status_code = supabase_request(
        "get",
        f"/rest/v1/users?id=eq.{user_id}",
        params={"select": "id,email,username,is_admin,account_status"},
        user_id=user_id,
        use_service_role=True,
    )
    if status_code >= 400 or not user_data:
        return False
    return _is_super_admin_record(user_data[0], user_id=user_id)


def _user_listing_limit_info(user_id, listing_count=None):
    if _is_super_admin_user(user_id):
        return {
            "current": int(listing_count or 0),
            "max": None,
            "remaining": None,
            "unlimited": True,
        }
    # Prefer per-type counts (cars/bikes/plates). Fall back to legacy aggregate.
    counts, error = _get_user_listing_counts_by_table(user_id)
    per_type = None
    if error is None and counts is not None:
        cars_current = int((counts or {}).get("cars") or 0)
        bikes_current = int((counts or {}).get("bikes") or 0)
        plates_current = int((counts or {}).get("license_plates") or 0)
        parts_current = int((counts or {}).get("car_parts") or 0)
        per_type = {
            "car": {
                "current": cars_current,
                "max": MAX_LISTINGS_PER_USER_PER_TYPE,
                "remaining": max(0, MAX_LISTINGS_PER_USER_PER_TYPE - cars_current),
            },
            "bike": {
                "current": bikes_current,
                "max": MAX_LISTINGS_PER_USER_PER_TYPE,
                "remaining": max(0, MAX_LISTINGS_PER_USER_PER_TYPE - bikes_current),
            },
            "plate": {
                "current": plates_current,
                "max": MAX_LISTINGS_PER_USER_PER_TYPE,
                "remaining": max(0, MAX_LISTINGS_PER_USER_PER_TYPE - plates_current),
            },
            "part": {
                "current": parts_current,
                "max": MAX_LISTINGS_PER_USER_PER_TYPE,
                "remaining": max(0, MAX_LISTINGS_PER_USER_PER_TYPE - parts_current),
            },
        }

    current = int(listing_count or 0)
    return {
        "current": current,
        "max": MAX_LISTINGS_PER_USER,
        "remaining": max(0, MAX_LISTINGS_PER_USER - current),
        "unlimited": False,
        "per_type": per_type,
    }


def _protect_super_admin_target(user_id, action_label="perform this action on"):
    if _is_super_admin_user(user_id):
        return jsonify(
            {
                "error": f"The main super admin account cannot be used to {action_label}.",
                "code": "super_admin_protected",
            }
        ), 403
    return None


# Supabase REST API Helper
def _supabase_count(table: str, params: dict | None = None) -> int:
    """Return row count via Content-Range header. Cheaper than SELECT *.

    params is a dict of PostgREST filter expressions, e.g. {"status": "eq.pending"}.
    """
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    request_token = getattr(request, "supabase_token", None) if has_request_context() else None
    use_request_token = bool(request_token and not service_key)
    bearer_token = request_token if use_request_token else (service_key or SUPABASE_KEY)
    apikey = SUPABASE_KEY if use_request_token else (service_key or SUPABASE_KEY)
    headers = {
        "apikey": apikey,
        "Authorization": f"Bearer {bearer_token}",
        "Range-Unit": "items",
        "Range": "0-0",
        "Prefer": "count=exact",
    }
    if use_request_token:
        headers["X-Postgres-Role"] = "authenticated"
    try:
        resp = requests.head(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=headers,
            params=params or {},
            timeout=8,
        )
        if resp.status_code not in (200, 206):
            logger.warning(
                "supabase count failed for %s: status=%s body=%s",
                table, resp.status_code, getattr(resp, "text", "")[:200],
            )
            return 0
        content_range = resp.headers.get("Content-Range", "")
        if "/" in content_range:
            total = content_range.rsplit("/", 1)[1]
            if total.isdigit():
                return int(total)
        return 0
    except Exception as exc:
        logger.warning("supabase count failed for %s: %s", table, exc)
    return 0


def supabase_request(
    method, path, data=None, params=None, user_id=None, use_service_role=False
):
    url = f"{SUPABASE_URL}{path}"

    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    user_token = None
    if has_request_context():
        user_token = getattr(request, "supabase_token", None)

    has_service_role = bool(service_key)
    fallback_to_user_token = bool(use_service_role and not has_service_role and user_token)
    auth_apikey = SUPABASE_KEY if fallback_to_user_token else (service_key or SUPABASE_KEY)
    auth_bearer = user_token if fallback_to_user_token else (service_key or SUPABASE_KEY)

    if use_service_role or "admin" in path:
        headers = {
            "apikey": auth_apikey,
            "Authorization": f"Bearer {auth_bearer}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
            "X-Client-Info": "backend-api",
        }
        headers["X-Postgres-Role"] = "service_role" if has_service_role else "authenticated"
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
                "apikey": auth_apikey,
                "Authorization": f"Bearer {auth_bearer}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
                "X-Client-Info": "backend-api",
            }
            headers["X-Postgres-Role"] = "service_role" if has_service_role else "authenticated"
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

    started_at = time.perf_counter()
    supabase_path = _extract_request_path(path)
    request_payload_bytes = _extract_payload_size_bytes(data)

    try:
        if method.lower() in {"get", "post", "put", "patch", "delete"}:
            response = HTTP_SESSION.request(
                method=method.upper(),
                url=url,
                headers=headers,
                params=params,
                json=data if method.lower() in {"post", "put", "patch"} else None,
                timeout=HTTP_DEFAULT_TIMEOUT_SECONDS,
            )
        else:
            return {"error": "Invalid method"}, 400

        logger.info(f"Response status: {response.status_code}")
        duration_ms = (time.perf_counter() - started_at) * 1000
        response_bytes = len(response.content or b"")
        logger.info(
            "SUPABASE_PERF method=%s path=%s status=%s duration_ms=%.2f request_bytes=%s response_bytes=%s",
            method.upper(),
            supabase_path,
            response.status_code,
            duration_ms,
            request_payload_bytes,
            response_bytes,
        )
        timings = _request_supabase_durations_ms.get() or []
        timings.append(
            {
                "method": method.upper(),
                "path": supabase_path,
                "status": response.status_code,
                "duration_ms": round(duration_ms, 2),
            }
        )
        _request_supabase_durations_ms.set(timings)

        if response.status_code >= 400:
            # PostgREST errors are often JSON; return structured data when possible so
            # callers/clients can surface the real message/code instead of a string blob.
            raw_text = response.text or ""
            logger.error(f"Error response: {raw_text[:2000]}")
            parsed_error = None
            try:
                parsed_error = response.json()
            except Exception:
                parsed_error = None

            if isinstance(parsed_error, dict):
                if "status" not in parsed_error:
                    parsed_error["status"] = response.status_code
                return parsed_error, response.status_code
            if parsed_error is not None:
                return {"error": parsed_error, "status": response.status_code}, response.status_code

            return {"error": raw_text, "status": response.status_code}, response.status_code

        return response.json(), response.status_code

    except Exception as e:
        logger.error(f"Request error: {str(e)}")
        return {"error": str(e)}, 500


def record_app_error(
    context,
    message,
    *,
    error_code=None,
    user_id=None,
    details=None,
    source="backend",
    url=None,
    user_agent=None,
):
    """Best-effort insert into app_errors. NEVER raises — recording an error
    must not itself create one. Surfaces in the admin "Errors" tab; precursor
    to Sentry. Silent failures across the app funnel here."""
    try:
        supabase_request(
            "post",
            "/rest/v1/app_errors",
            data={
                "context": str(context or "unknown")[:200],
                "message": str(message or "")[:2000],
                "error_code": (str(error_code)[:200] if error_code else None),
                "user_id": (str(user_id) if user_id else None),
                "details": details if isinstance(details, (dict, list)) else None,
                "source": str(source or "backend")[:20],
                "url": (str(url)[:500] if url else None),
                "user_agent": (str(user_agent)[:500] if user_agent else None),
            },
            use_service_role=True,
        )
    except Exception:
        logger.warning("record_app_error failed for context=%s", context, exc_info=True)


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


# Debug endpoint to test JSON parsing
@app.route("/api/debug/json", methods=["POST"])
def debug_json():
    if os.getenv("FLASK_ENV", "production").lower() == "production":
        return jsonify({"error": "Not found"}), 404
    logger.info(f"DEBUG: Content-Type: {request.content_type}")
    logger.info(f"DEBUG: Content-Length: {request.content_length}")
    logger.info(f"DEBUG: Raw data: {request.data[:500] if request.data else 'None'}")
    logger.info(f"DEBUG: request.json: {request.json}")
    return jsonify(
        {
            "content_type": request.content_type,
            "content_length": request.content_length,
            "raw_data_preview": str(request.data[:200]) if request.data else None,
            "json_parsed": request.json is not None,
            "json_keys": list(request.json.keys()) if request.json else None,
        }
    ), 200


_LISTING_COUNT_TABLES = {
    "cars": "cars",
    "bikes": "bikes",
    "parts": "car_parts",
    "plates": "license_plates",
}


# Mirror of the filter pairs each data route accepts. Kept in sync with the
# _collect_listing_filter_pairs() call inside get_bikes / get_plates /
# get_parts / get_cars — chip counts must reflect the active selection, so
# both code paths read the same whitelist. Reddit + buying_requests counts
# keep their existing behavior (those don't use the per-category spec).
_LISTING_FILTER_SPECS = {
    "cars": (
        {
            "car_manufacturer": "car_manufacturer",
            "car_model": "car_model",
            "car_city": "car_city",
            "body_type": "body_type",
            "fuel_type": "fuel_type",
            "transmission_type": "transmission_type",
            "regional_spec": "regional_spec",
            "steering_side": "steering_side",
            "seating_capacity": "seating_capacity",
            "horsepower": "horsepower",
            "engine_capacity": "engine_capacity",
            "source_platform": "source_platform",
        },
        {
            "expected_selling_price": "expected_selling_price",
            "make_year": "make_year",
            "kilometer_driven": "kilometer_driven",
        },
    ),
    "bikes": (
        {
            "bike_brand": "bike_brand",
            "bike_type": "bike_type",
            "area": "area",
            "engine_size": "engine_size",
            "condition": "condition",
        },
        {"price": "price", "year": "year"},
    ),
    "parts": (
        {
            "condition": "condition",
            "part_type": "part_type",
            "area": "area",
        },
        {"price": "price"},
    ),
    "plates": (
        {
            "city": "city",
            "digits": "digits",
            "code": "code",
            "area": "area",
        },
        {"price": "price"},
    ),
}


def _table_count(table, filters):
    """HEAD-style count via PostgREST's Prefer: count=exact, read off the
    Content-Range response header. Doesn't fetch any rows, so it's cheap
    enough to run on every /api/listings/counts call within its cache TTL."""
    try:
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        auth = service_key or SUPABASE_KEY
        resp = HTTP_SESSION.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={
                "apikey": auth,
                "Authorization": f"Bearer {auth}",
                "Prefer": "count=exact",
            },
            params={"select": "id", "limit": "1", **filters},
            timeout=HTTP_DEFAULT_TIMEOUT_SECONDS,
        )
        total = (resp.headers.get("Content-Range") or "").split("/")[-1]
        return int(total) if total.isdigit() else 0
    except Exception as e:
        logger.warning(f"Error counting {table}: {e}")
        return 0


def _approved_table_count(table):
    return _table_count(table, {"status": "eq.approved", "is_approved": "eq.true"})


def _filtered_count(table, category, args):
    """Apply the category's filter spec to a count query. The caller passes
    request.args explicitly so the helper is hermetic and testable in
    isolation (test_request_context establishes the args)."""
    eq_fields, range_fields = _LISTING_FILTER_SPECS[category]
    pairs = _collect_listing_filter_pairs(eq_fields, range_fields)
    params = {"status": "eq.approved", "is_approved": "eq.true"}
    for db_col, postgrest_val in pairs:
        params[db_col] = postgrest_val
    # `args` is currently unused directly — _collect_listing_filter_pairs
    # reads the live request.args. Kept in the signature for explicit
    # testability and for any future expansion (e.g. min-clamping).
    _ = args
    return _table_count(table, params)


def _approved_reddit_table_count(table):
    return _table_count(
        table,
        {"status": "eq.approved", "is_approved": "eq.true", "source_platform": "eq.reddit"},
    )


register_listing_count_route(
    app,
    build_cache_key=_build_api_cache_key,
    cache_get=_api_cache_get,
    cache_set=_api_cache_set,
    filtered_count=_filtered_count,
    approved_reddit_count=_approved_reddit_table_count,
    table_count=_table_count,
    count_tables=_LISTING_COUNT_TABLES,
)


def _car_read_dependencies():
    return CarReadDependencies(
        build_cache_key=lambda: _build_api_cache_key(),
        cache_get=lambda key: _api_cache_get(key),
        cache_set=lambda *args, **kwargs: _api_cache_set(*args, **kwargs),
        cached_json_response=lambda *args, **kwargs: _cached_json_response(
            *args, **kwargs
        ),
        parse_pagination_args=lambda: _parse_pagination_args(),
        getenv=lambda name: os.getenv(name),
        reddit_on_explore=lambda: _reddit_on_explore(),
        should_hide_reddit=lambda *args: _should_hide_reddit(*args),
        search_or_group=lambda fields: _search_or_group(fields),
        combine_or_groups=lambda *groups: _combine_or_groups(*groups),
        cursor_filter=lambda: _cursor_filter(),
        to_int=lambda *args, **kwargs: _to_int(*args, **kwargs),
        current_year=lambda: datetime.datetime.now().year,
        minimum_year=MIN_ALLOWED_YEAR,
        public_car_preview_select=PUBLIC_CAR_PREVIEW_SELECT,
        supabase_request=lambda *args, **kwargs: supabase_request(*args, **kwargs),
        filter_public_listing_records=lambda table, records: (
            _filter_public_listing_records(table, records)
        ),
        sort_listing_images=lambda images: _sort_listing_images(images),
        batch_fetch_seller_map=lambda user_ids: _batch_fetch_seller_map(user_ids),
        apply_seller_to_listing=lambda item, seller: _apply_seller_to_listing(
            item, seller
        ),
        attach_page_headers=lambda response, items, limit: _attach_page_headers(
            response, items, limit
        ),
        logger=logger,
    )


# Get all cars (public)
get_cars = register_car_read_route(app, dependencies=_car_read_dependencies)


# Get car details by ID (public)
def _optional_user_id():
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1]

    try:
        import jwt as pyjwt

        for secret_bytes, _method in _decode_supabase_jwt_secret(SUPABASE_JWT_SECRET):
            try:
                payload = pyjwt.decode(
                    token,
                    secret_bytes,
                    algorithms=["HS256"],
                    options={"verify_aud": False},
                )
                uid = payload.get("sub")
                if uid:
                    request.supabase_token = token
                    return uid
            except Exception:
                continue
    except Exception:
        pass

    try:
        auth_headers = {
            "apikey": SUPABASE_KEY or os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        auth_response = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers=auth_headers,
            timeout=5,
        )
        if auth_response.status_code == 200:
            uid = auth_response.json().get("id")
            if uid:
                request.supabase_token = token
                return uid
    except Exception:
        pass

    return None


def _resolve_car_listing_id(identifier):
    """Accept a legacy UUID or the public SEO slug ending in its 8-char prefix."""
    value = str(identifier or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", value):
        return value

    match = re.search(r"(?:^|-)([0-9a-f]{8})$", value)
    if not match:
        return None
    prefix = match.group(1)
    lower_bound = f"{prefix}-0000-0000-0000-000000000000"
    # UUID columns support ordered comparisons but not `LIKE`. The next prefix
    # is the exclusive upper bound for all UUIDs beginning with `prefix`.
    # (The all-`f` prefix has no representable upper bound, so it is safely
    # handled by the lower bound plus the two-row ambiguity guard.)
    next_prefix = int(prefix, 16) + 1
    # `requests` supports repeated query-string keys when given tuples. That
    # is how PostgREST combines the lower and upper `id` filters with AND.
    params = [("select", "id"), ("id", f"gte.{lower_bound}"), ("limit", "2")]
    if next_prefix <= 0xFFFFFFFF:
        upper_bound = f"{next_prefix:08x}-0000-0000-0000-000000000000"
        params.insert(2, ("id", f"lt.{upper_bound}"))
    rows, status = supabase_request(
        "get",
        "/rest/v1/cars",
        params=params,
        use_service_role=True,
    )
    if status >= 400 or not isinstance(rows, list) or len(rows) != 1:
        return None
    return str(rows[0].get("id") or "") or None


def _requester_can_view_vin(requesting_user, is_owner):
    """VIN is PII; gate it the same way the frontend does (phone-verified
    account), not just 'not the owner'. Owners/admins always see it."""
    if is_owner:
        return True
    if not requesting_user:
        return False
    try:
        resp, status = supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{requesting_user}&select=phone_verified,is_admin",
            use_service_role=True,
        )
        if status < 400 and resp:
            return bool(resp[0].get("phone_verified") or resp[0].get("is_admin"))
    except Exception as vin_gate_err:
        logger.warning(f"Failed to resolve VIN visibility for {requesting_user}: {vin_gate_err}")
    return False



def _legacy_listing_view_response(listing_type, listing_id):
    """Accept deprecated view pings without creating a second metric source.

    Listing views are now recorded as idempotent ``listing_view`` events. The
    old read-then-write counter was race-prone and made its value disagree
    with the admin dashboard, so it must never mutate listing rows again.
    """
    logger.info("Ignored deprecated %s view counter ping for %s", listing_type, listing_id)
    return jsonify({"message": "Listing views are tracked by canonical analytics events"}), 202


@app.route("/api/cars/<string:car_id>/view", methods=["POST"])
def track_car_view(car_id):
    return _legacy_listing_view_response("car", car_id)


@app.route("/api/bikes/<string:bike_id>/view", methods=["POST"])
def track_bike_view(bike_id):
    return _legacy_listing_view_response("bike", bike_id)


@app.route("/api/plates/<string:plate_id>/view", methods=["POST"])
def track_plate_view(plate_id):
    return _legacy_listing_view_response("plate", plate_id)


@app.route("/api/parts/<string:part_id>/view", methods=["POST"])
def track_part_view(part_id):
    return _legacy_listing_view_response("part", part_id)


# Handle OPTIONS preflight for /api/cars
@app.route("/api/cars", methods=["OPTIONS"])
def cars_options():
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


def _car_create_dependencies():
    return CarCreateDependencies(
        require_verified_user_for_listing=lambda user_id: (
            _require_verified_user_for_listing(user_id)
        ),
        enforce_listing_limit=lambda user_id: _enforce_listing_limit(user_id),
        require_dealer_verified=lambda user_id: _require_dealer_verified(user_id),
        new_listing_lifecycle_fields=lambda: _new_listing_lifecycle_fields(),
        normalize_listing_vin=lambda payload: _normalize_listing_vin(payload),
        require_whatsapp_prefill_and_phone_alignment=lambda payload, listing_type: (
            _require_whatsapp_prefill_and_phone_alignment(payload, listing_type)
        ),
        to_int=lambda *args, **kwargs: _to_int(*args, **kwargs),
        current_year=lambda: datetime.datetime.now().year,
        minimum_allowed_year=MIN_ALLOWED_YEAR,
        normalize_regional_spec=lambda value: _normalize_regional_spec(value),
        car_transmission_options=CAR_TRANSMISSION_OPTIONS,
        is_valid_car_fuel_type=lambda value: _is_valid_car_fuel_type(value),
        steering_side_options=STEERING_SIDE_OPTIONS,
        validate_description_word_count=lambda *args, **kwargs: (
            _validate_description_word_count(*args, **kwargs)
        ),
        validate_no_profanity=lambda *args, **kwargs: _validate_no_profanity(
            *args, **kwargs
        ),
        sync_gate_error=lambda listing_type, payload, photo_count: (
            _sync_gate_error(listing_type, payload, photo_count)
        ),
        get_user_email=lambda user_id: get_user_email(user_id),
        initial_listing_status=lambda: _initial_listing_status(),
        create_listing_with_lifecycle_fallback=lambda *args, **kwargs: (
            _create_listing_with_lifecycle_fallback(*args, **kwargs)
        ),
        friendly_db_error=lambda data, status_code, listing_type: (
            _friendly_db_error(data, status_code, listing_type)
        ),
        normalize_crop_settings=lambda settings: _normalize_crop_settings(settings),
        isoformat_utc=lambda value: _isoformat_utc(value),
        utc_now=lambda: _utc_now(),
        supabase_request=lambda *args, **kwargs: supabase_request(*args, **kwargs),
        sort_listing_images=lambda images: _sort_listing_images(images),
        get_user_email_by_id=lambda user_id: _get_user_email_by_id(user_id),
        send_new_listing_admin_notification=lambda item_type, listing, user_email: (
            _send_new_listing_admin_notification(item_type, listing, user_email)
        ),
        send_new_listing_user_confirmation=lambda user_email, item_type, listing: (
            _send_new_listing_user_confirmation(user_email, item_type, listing)
        ),
        invalidate_public_inventory_cache=lambda item_type: (
            _invalidate_public_inventory_cache(item_type)
        ),
        trigger_auto_review_async=lambda: _trigger_auto_review_async(),
        capture_posthog_event=lambda event_name, distinct_id, properties: (
            capture_posthog_event(event_name, distinct_id, properties)
        ),
        logger=logger,
    )


# Create a new car listing (authenticated)
create_car = register_car_create_route(
    app,
    token_required=token_required,
    dependencies=_car_create_dependencies,
)


# Handle OPTIONS preflight for car update
@app.route("/api/cars/<string:car_id>/update", methods=["OPTIONS"])
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


# Delete a car listing (authenticated)
@app.route("/api/cars/<string:car_id>", methods=["DELETE"])
@token_required
def delete_car(current_user, car_id):
    try:
        delete_response, delete_status = _delete_user_owned_listing(
            current_user, "car", car_id
        )
        if delete_status >= 400:
            return jsonify(delete_response), delete_status

        _invalidate_public_inventory_cache("cars")
        _invalidate_api_cache_prefixes([f"/api/cars/{car_id}"])
        return jsonify({"message": "Car deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting car: {e}")
        return jsonify({"error": str(e)}), 500


# Upload car images (authenticated)
def ensure_storage_bucket(bucket_name="listing-images"):
    """Ensure a storage bucket exists with its intended public/private policy."""
    now_ts = time.time()
    with _STORAGE_BUCKET_CACHE_LOCK:
        cached_until = _STORAGE_BUCKET_CACHE.get(bucket_name, 0)
        if cached_until > now_ts:
            return True

    try:
        # Check if bucket exists
        check_url = f"{SUPABASE_URL}/storage/v1/bucket/{bucket_name}"
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        }

        response = requests.get(check_url, headers=headers, timeout=10)

        if response.status_code == 200:
            logger.info(f"Bucket '{bucket_name}' exists")
            bucket_data = response.json() or {}
            desired_config = None
            if bucket_name == "listing-images":
                desired_config = {
                    "id": bucket_name,
                    "name": bucket_name,
                    "public": True,
                    "file_size_limit": LISTING_IMAGE_FILE_SIZE_LIMIT_BYTES,
                    "allowed_mime_types": LISTING_IMAGE_ALLOWED_MIME_TYPES,
                }
            elif bucket_name == "profile-photos":
                desired_config = {
                    "id": bucket_name,
                    "name": bucket_name,
                    "public": True,
                    "file_size_limit": PROFILE_PHOTO_FILE_SIZE_LIMIT_BYTES,
                    "allowed_mime_types": LISTING_IMAGE_ALLOWED_MIME_TYPES,
                }
            elif bucket_name == "dealer-documents":
                desired_config = {
                    "id": bucket_name,
                    "name": bucket_name,
                    "public": False,
                    "file_size_limit": DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES,
                    "allowed_mime_types": DEALER_DOCUMENT_ALLOWED_MIME_TYPES,
                }
            elif bucket_name == "registration-documents":
                desired_config = {
                    "id": bucket_name,
                    "name": bucket_name,
                    "public": False,
                    "file_size_limit": REGISTRATION_DOCUMENT_FILE_SIZE_LIMIT_BYTES,
                    "allowed_mime_types": REGISTRATION_DOCUMENT_ALLOWED_MIME_TYPES,
                }

            if desired_config and (
                bucket_data.get("public") != desired_config["public"]
                or bucket_data.get("file_size_limit")
                != desired_config["file_size_limit"]
                or sorted(bucket_data.get("allowed_mime_types") or [])
                != sorted(desired_config["allowed_mime_types"])
            ):
                update_url = f"{SUPABASE_URL}/storage/v1/bucket/{bucket_name}"
                update_response = requests.put(
                    update_url,
                    headers={**headers, "Content-Type": "application/json"},
                    json=desired_config,
                    timeout=10,
                )
                if update_response.status_code not in [200, 204]:
                    logger.error(
                        f"Failed to update bucket config: {update_response.status_code} - "
                        f"{update_response.text}"
                    )
                    return False
            with _STORAGE_BUCKET_CACHE_LOCK:
                _STORAGE_BUCKET_CACHE[bucket_name] = (
                    time.time() + STORAGE_BUCKET_CACHE_TTL_SECONDS
                )
            return True
        else:
            # Storage API deployments can encode a missing bucket as HTTP 400
            # while returning NoSuchBucket/statusCode 404 in the JSON body.
            # Treat only that precise response as absent; other 400s (for
            # example a bad service key) must remain visible as real errors.
            bucket_missing = response.status_code == 404
            if response.status_code == 400:
                try:
                    error_body = response.json() or {}
                    bucket_missing = (
                        str(error_body.get("code") or "") == "NoSuchBucket"
                        or int(error_body.get("statusCode") or 0) == 404
                    )
                except (TypeError, ValueError):
                    bucket_missing = False

            if bucket_missing:
                # Create the bucket
                logger.info(f"Bucket '{bucket_name}' not found, creating...")
                create_url = f"{SUPABASE_URL}/storage/v1/bucket"
                create_data = {"id": bucket_name, "name": bucket_name, "public": True}
                if bucket_name == "listing-images":
                    create_data["file_size_limit"] = LISTING_IMAGE_FILE_SIZE_LIMIT_BYTES
                    create_data["allowed_mime_types"] = LISTING_IMAGE_ALLOWED_MIME_TYPES
                elif bucket_name == "profile-photos":
                    create_data["file_size_limit"] = PROFILE_PHOTO_FILE_SIZE_LIMIT_BYTES
                    create_data["allowed_mime_types"] = LISTING_IMAGE_ALLOWED_MIME_TYPES
                elif bucket_name == "dealer-documents":
                    create_data["public"] = False
                    create_data["file_size_limit"] = DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES
                    create_data["allowed_mime_types"] = DEALER_DOCUMENT_ALLOWED_MIME_TYPES
                elif bucket_name == "registration-documents":
                    create_data["public"] = False
                    create_data["file_size_limit"] = REGISTRATION_DOCUMENT_FILE_SIZE_LIMIT_BYTES
                    create_data["allowed_mime_types"] = REGISTRATION_DOCUMENT_ALLOWED_MIME_TYPES
                create_response = requests.post(
                    create_url,
                    headers={**headers, "Content-Type": "application/json"},
                    json=create_data,
                    timeout=10,
                )

                if create_response.status_code in [200, 201]:
                    logger.info(f"Bucket '{bucket_name}' created successfully")
                    with _STORAGE_BUCKET_CACHE_LOCK:
                        _STORAGE_BUCKET_CACHE[bucket_name] = (
                            time.time() + STORAGE_BUCKET_CACHE_TTL_SECONDS
                        )
                    return True
                logger.error(
                    f"Failed to create bucket: {create_response.status_code} - {create_response.text}"
                )
                return False

            logger.error(
                f"Error checking bucket: {response.status_code} - {response.text}"
            )
            return False
    except Exception as e:
        logger.error(f"Error ensuring storage bucket: {str(e)}")
        return False


def _clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def _normalize_crop_settings(crop_settings):
    if not isinstance(crop_settings, dict):
        crop_settings = {}

    focal_x_raw = crop_settings.get("focal_x", crop_settings.get("focalX", 50))
    focal_y_raw = crop_settings.get("focal_y", crop_settings.get("focalY", 50))
    zoom_raw = crop_settings.get("zoom", 1)

    try:
        focal_x = float(focal_x_raw)
    except (TypeError, ValueError):
        focal_x = 50.0
    try:
        focal_y = float(focal_y_raw)
    except (TypeError, ValueError):
        focal_y = 50.0
    try:
        zoom = float(zoom_raw)
    except (TypeError, ValueError):
        zoom = 1.0

    return {
        "focal_x": _clamp(focal_x, 0.0, 100.0),
        "focal_y": _clamp(focal_y, 0.0, 100.0),
        "zoom": _clamp(zoom, 1.0, 3.0),
    }


def _parse_crop_data_payload(raw_crop_data, expected_count):
    if not raw_crop_data:
        return [{} for _ in range(expected_count)]

    try:
        parsed = json.loads(raw_crop_data)
    except (TypeError, ValueError):
        logger.warning("Invalid crop_data payload; using defaults")
        return [{} for _ in range(expected_count)]

    if not isinstance(parsed, list):
        logger.warning("crop_data payload must be an array; using defaults")
        return [{} for _ in range(expected_count)]

    crop_data = []
    for idx in range(expected_count):
        item = parsed[idx] if idx < len(parsed) else {}
        crop_data.append(item if isinstance(item, dict) else {})
    return crop_data


def _build_display_variant(base_image, crop_settings):
    if base_image.width <= 0 or base_image.height <= 0:
        return None, None

    focal_x = (crop_settings["focal_x"] / 100.0) * base_image.width
    focal_y = (crop_settings["focal_y"] / 100.0) * base_image.height
    zoom = crop_settings["zoom"]

    if (base_image.width / base_image.height) >= LISTING_DISPLAY_RATIO:
        base_crop_height = base_image.height
        base_crop_width = int(round(base_crop_height * LISTING_DISPLAY_RATIO))
    else:
        base_crop_width = base_image.width
        base_crop_height = int(round(base_crop_width / LISTING_DISPLAY_RATIO))

    crop_width = max(1, int(round(base_crop_width / zoom)))
    crop_height = max(1, int(round(base_crop_height / zoom)))

    left = int(
        round(_clamp(focal_x - (crop_width / 2), 0, base_image.width - crop_width))
    )
    top = int(
        round(_clamp(focal_y - (crop_height / 2), 0, base_image.height - crop_height))
    )
    right = left + crop_width
    bottom = top + crop_height

    display_image = base_image.crop((left, top, right, bottom)).resize(
        (LISTING_DISPLAY_WIDTH, LISTING_DISPLAY_HEIGHT), Image.Resampling.LANCZOS
    )
    if display_image.mode not in ("RGB", "L"):
        display_image = display_image.convert("RGB")

    crop_meta = {
        "source_width": base_image.width,
        "source_height": base_image.height,
        "crop_box": {"left": left, "top": top, "right": right, "bottom": bottom},
        "zoom": zoom,
        "display_width": LISTING_DISPLAY_WIDTH,
        "display_height": LISTING_DISPLAY_HEIGHT,
    }
    return display_image, crop_meta


def _upload_bytes_to_supabase_storage(
    file_data, bucket_name, object_path, content_type
):
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{bucket_name}/{object_path}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": content_type,
    }
    response = requests.post(upload_url, headers=headers, data=file_data, timeout=30)
    if response.status_code in [200, 201]:
        public_url = (
            f"{SUPABASE_URL}/storage/v1/object/public/{bucket_name}/{object_path}"
        )
        return public_url, None

    error_msg = (
        f"Supabase Storage upload failed: {response.status_code} - {response.text}"
    )
    return None, error_msg


def _get_public_storage_object_url(bucket_name, object_path):
    return f"{SUPABASE_URL}/storage/v1/object/public/{bucket_name}/{object_path}"


def _safe_generated_object_path(object_path, user_id):
    """Validate the client-generated path without allowing path confusion."""
    value = str(object_path or "")
    if not value or len(value) > 300 or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return False
    if "\\" in value or "?" in value or "#" in value or value.startswith("/"):
        return False
    parts = value.split("/")
    if len(parts) not in (2, 3) or parts[0] != str(user_id) or any(
        not part or part in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?", part)
        for part in parts
    ):
        return False
    filename = parts[-1]
    if "." not in filename:
        return False
    stem, extension = filename.rsplit(".", 1)
    if len(stem) < 1 or len(stem) > 128 or extension.lower() not in {
        "jpg", "jpeg", "png", "gif", "webp", "pdf"
    }:
        return False
    return True


def _validate_listing_image_reference(value, user_id):
    """Allow only this user's public listing-image objects, never arbitrary URLs."""
    if not isinstance(value, str) or not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    if parsed.scheme or parsed.netloc:
        expected_host = urlparse(SUPABASE_URL).netloc if SUPABASE_URL else ""
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or not expected_host
            or parsed.netloc != expected_host
            or "?" in value
            or "#" in value
        ):
            return False
        path = parsed.path
    else:
        path = value
    prefix = f"/storage/v1/object/public/listing-images/{user_id}/"
    if not path.startswith(prefix):
        return False
    object_path = path[len("/storage/v1/object/public/listing-images/"):]
    return _safe_generated_object_path(object_path, user_id) and object_path.rsplit(
        ".", 1
    )[-1].lower() in {"jpg", "jpeg", "png", "gif", "webp"}


_LISTING_CROP_META_MAX_BYTES = 8 * 1024
_LISTING_CROP_META_MAX_DEPTH = 5
_LISTING_CROP_META_MAX_MEMBERS = 64


def _is_valid_listing_focal_coordinate(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    if isinstance(value, float) and not math.isfinite(value):
        return False
    return 0 <= value <= 100


def _is_bounded_json_value(value, *, depth, remaining_members):
    if depth > _LISTING_CROP_META_MAX_DEPTH:
        return False
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        if len(value) > remaining_members[0]:
            return False
        remaining_members[0] -= len(value)
        return all(
            _is_bounded_json_value(
                item,
                depth=depth + 1,
                remaining_members=remaining_members,
            )
            for item in value
        )
    if isinstance(value, dict):
        if len(value) > remaining_members[0] or not all(
            isinstance(key, str) for key in value
        ):
            return False
        remaining_members[0] -= len(value)
        return all(
            _is_bounded_json_value(
                item,
                depth=depth + 1,
                remaining_members=remaining_members,
            )
            for item in value.values()
        )
    return False


def _is_valid_listing_crop_meta(value):
    if not isinstance(value, dict) or not _is_bounded_json_value(
        value,
        depth=0,
        remaining_members=[_LISTING_CROP_META_MAX_MEMBERS],
    ):
        return False
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except UnicodeEncodeError:
        return False
    except (OverflowError, RecursionError, TypeError, ValueError):
        return False
    return len(encoded) <= _LISTING_CROP_META_MAX_BYTES


def _validate_listing_image_entry(entry, user_id):
    if isinstance(entry, dict):
        references = [
            entry[key]
            for key in ("url", "image_url", "display_url")
            if key in entry and entry[key] is not None
        ]
        if not references or not all(
            _validate_listing_image_reference(ref, user_id) for ref in references
        ):
            return False
        if any(
            field in entry
            and entry[field] is not None
            and not _is_valid_listing_focal_coordinate(entry[field])
            for field in ("focal_x", "focal_y")
        ):
            return False
        if (
            "crop_meta" in entry
            and entry["crop_meta"] is not None
            and not _is_valid_listing_crop_meta(entry["crop_meta"])
        ):
            return False
        return True
    return _validate_listing_image_reference(entry, user_id)


def _validate_private_document_path(value, user_id, required_prefix=None):
    """Accept only a server-issued private object path for document fields."""
    if not isinstance(value, str) or not value:
        return False
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:
        return False
    if not _safe_generated_object_path(value, user_id):
        return False
    if required_prefix and not value.startswith(f"{user_id}/{required_prefix}/"):
        return False
    return True


def _with_private_listing_document_urls(listing, requesting_user=None, is_admin=False):
    """Add ephemeral document reads for an already-authorized listing view."""
    item = dict(listing or {})
    owner_id = str(item.get("user_id") or "")
    if not is_admin and (not requesting_user or str(requesting_user) != owner_id):
        return item

    for field, signed_field, required_prefix in (
        ("proof_document_url", "proof_document_signed_url", "plate-proofs"),
        ("registration_doc_url", "registration_doc_signed_url", None),
        ("registration_document_url", "registration_document_signed_url", None),
    ):
        object_path = item.get(field)
        if not object_path:
            continue
        if _validate_private_document_path(object_path, owner_id, required_prefix):
            signed_url, _ = _create_signed_storage_read_url(
                "registration-documents", object_path
            )
            if signed_url:
                item[signed_field] = signed_url
        item.pop(field, None)
    return item


def _validate_raster_upload(file, max_bytes=None):
    """Return (raw bytes, PIL image) only for bounded, decodable raster bytes."""
    if not file or not file.filename:
        raise ValueError("No file provided")
    content_type = (getattr(file, "mimetype", None) or getattr(file, "content_type", None) or "").lower()
    if content_type not in set(LISTING_IMAGE_ALLOWED_MIME_TYPES):
        ext_mime = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp",
        }
        content_type = ext_mime.get(os.path.splitext(file.filename or "")[1].lower(), content_type)
    if content_type not in set(LISTING_IMAGE_ALLOWED_MIME_TYPES):
        raise ValueError("Unsupported image type")
    file.seek(0)
    raw = file.read((max_bytes or LISTING_IMAGE_FILE_SIZE_LIMIT_BYTES) + 1)
    if len(raw) > (max_bytes or LISTING_IMAGE_FILE_SIZE_LIMIT_BYTES):
        raise ValueError("File too large")
    try:
        image = Image.open(io.BytesIO(raw))
        if image.format not in {"JPEG", "PNG", "GIF", "WEBP"}:
            raise ValueError("Unsupported image type")
        image.verify()
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise ValueError("File is not a valid raster image") from exc
    file.seek(0)
    return raw, image


def extension_to_mime(filename):
    """Return the allow-listed MIME type for a document extension."""
    extension = os.path.splitext(str(filename or ""))[1].lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".pdf": "application/pdf",
    }.get(extension)


def _validate_info_request_document(file):
    """Validate document bytes by signature; multipart MIME is not authoritative."""
    if not file or not file.filename:
        raise ValueError("No file selected")
    content_type = (file.content_type or "").lower()
    if content_type not in set(DEALER_DOCUMENT_ALLOWED_MIME_TYPES):
        content_type = extension_to_mime(file.filename) or content_type
    if content_type not in set(DEALER_DOCUMENT_ALLOWED_MIME_TYPES):
        raise ValueError("Invalid file type. Allowed: JPG, PNG, PDF")
    file.seek(0)
    raw = file.read(DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES + 1)
    if len(raw) > DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES:
        raise ValueError("File too large")
    if content_type == "application/pdf":
        valid = raw.startswith(b"%PDF-")
    else:
        try:
            image = Image.open(io.BytesIO(raw))
            valid = image.format in {"JPEG", "PNG"}
            image.verify()
        except Exception:
            valid = False
    if not valid:
        raise ValueError("File content does not match an allowed document")
    file.seek(0)
    return raw


def _create_signed_upload_url(bucket_name, object_path, upsert=False):
    if not bucket_name or not object_path:
        return None, "bucket_name and object_path are required"
    path_parts = str(object_path).split("/")
    if not _safe_generated_object_path(object_path, path_parts[0] if path_parts else ""):
        return None, "object_path must be a safe generated path"

    upload_url = (
        f"{SUPABASE_URL}/storage/v1/object/upload/sign/{bucket_name}/{object_path}"
    )
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    if upsert:
        headers["x-upsert"] = "true"

    response = requests.post(upload_url, headers=headers, json={}, timeout=20)
    if response.status_code not in [200, 201]:
        return (
            None,
            f"Signed upload URL creation failed: {response.status_code} - {response.text}",
        )

    payload = response.json() or {}
    relative_url = payload.get("url")
    if not relative_url:
        return None, "Signed upload URL response missing url"

    signed_url = f"{SUPABASE_URL}/storage/v1{relative_url}"
    token = urlparse(signed_url).query.replace("token=", "", 1)
    if not token:
        return None, "Signed upload URL response missing token"

    signed_upload = {
        "signed_url": signed_url,
        "token": token,
        "path": object_path,
    }
    # Listing and profile-image buckets are intentionally public.  The browser
    # needs the final stable URL to persist alongside the listing after the
    # bytes have reached Storage.  Previously this endpoint returned only the
    # upload token; the UI therefore submitted images with undefined URLs and
    # the listing endpoint rejected them as missing.
    if bucket_name in {"listing-images", "profile-photos"}:
        signed_upload["public_url"] = _get_public_storage_object_url(
            bucket_name, object_path
        )
    return signed_upload, None


def _create_signed_storage_read_url(bucket_name, object_path, expires_in=300):
    """Create a short-lived private URL; dealer evidence must never be public."""
    if not bucket_name or not object_path:
        return None, "bucket_name and object_path are required"
    response = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/sign/{bucket_name}/{object_path}",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        },
        json={"expiresIn": expires_in},
        timeout=20,
    )
    if response.status_code not in (200, 201):
        return None, "Could not create private document link"
    relative_url = (response.json() or {}).get("signedURL") or (response.json() or {}).get("signedUrl")
    if not relative_url:
        return None, "Private document link was unavailable"
    return f"{SUPABASE_URL}/storage/v1{relative_url}", None


def _with_private_dealer_document_url(document):
    """Expose an ephemeral access URL only after an authenticated ownership/admin check."""
    item = dict(document or {})
    object_path = item.get("storage_path")
    item.pop("url", None)
    if object_path:
        signed_url, _ = _create_signed_storage_read_url("dealer-documents", object_path)
        item["download_url"] = signed_url
    return item


def _with_private_dealer_attachment_url(attachment):
    """Expose a short-lived link for an admin-only request attachment.

    Info-request uploads live in the same private bucket as KYC documents; a
    stored object path is never a browser URL and must not escape to the public
    token endpoint.
    """
    item = dict(attachment or {})
    object_path = item.get("storage_path") or item.get("url")
    item.pop("url", None)
    item.pop("storage_path", None)
    if object_path:
        signed_url, _ = _create_signed_storage_read_url("dealer-documents", object_path)
        item["download_url"] = signed_url
    return item


def _sanitize_dealer_document_bytes(raw_bytes, content_type):
    """Remove image EXIF/XMP metadata before private KYC storage.

    PDFs are intentionally left byte-for-byte intact because rasterizing them
    would lose pages and reduce document fidelity; their storage remains private.
    """
    if not raw_bytes or not str(content_type or "").lower().startswith("image/"):
        return raw_bytes
    try:
        from PIL import ImageOps

        with Image.open(io.BytesIO(raw_bytes)) as image:
            image = ImageOps.exif_transpose(image)
            output = io.BytesIO()
            image_format = "PNG" if content_type.lower() == "image/png" else "JPEG"
            if image_format == "JPEG" and image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            image.save(output, format=image_format, exif=b"", optimize=True)
            return output.getvalue()
    except Exception as exc:
        raise ValueError("Unable to sanitize dealer document") from exc


def upload_to_supabase_storage(
    file,
    bucket_name="listing-images",
    folder="",
    return_metadata=False,
    crop_settings=None,
):
    """
    Upload a file to Supabase Storage and return the public URL.
    Uses image compression for faster loading.
    """
    try:
        if not file or not file.filename:
            return None, "No file provided"

        allowed_types = set(LISTING_IMAGE_ALLOWED_MIME_TYPES)
        normalized_mimetype = (file.mimetype or "").lower()
        # Browsers/desktop drag-and-drop sometimes send an empty or generic
        # "application/octet-stream" content type for a perfectly valid image.
        # Fall back to the file extension so those aren't wrongly rejected.
        _ext_mime = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".gif": "image/gif", ".webp": "image/webp",
        }
        if normalized_mimetype not in allowed_types:
            ext = os.path.splitext(file.filename or "")[1].lower()
            normalized_mimetype = _ext_mime.get(ext, normalized_mimetype)
        if normalized_mimetype not in allowed_types:
            return None, "Unsupported image type"

        try:
            _raw_bytes, img = _validate_raster_upload(
                file, max_bytes=MAX_UPLOAD_SIZE_MB * 1024 * 1024
            )
        except ValueError as validation_error:
            return None, str(validation_error)

        # Generate unique filename
        filename = secure_filename(file.filename)
        file_extension = os.path.splitext(filename)[1].lower()
        unique_filename = (
            f"{folder}/{uuid.uuid4().hex}{file_extension}"
            if folder
            else f"{uuid.uuid4().hex}{file_extension}"
        )

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

        logger.info(
            f"Uploading to Supabase Storage: bucket={bucket_name}, filename={unique_filename}, size={len(file_data)} bytes"
        )
        public_url, upload_error = _upload_bytes_to_supabase_storage(
            file_data=file_data,
            bucket_name=bucket_name,
            object_path=unique_filename,
            content_type=content_type,
        )
        if upload_error:
            logger.error(upload_error)
            return None, upload_error

        if not return_metadata:
            logger.info(f"Image uploaded successfully: {public_url}")
            return public_url, None

        normalized_crop = _normalize_crop_settings(crop_settings)
        display_url = public_url
        crop_meta = None

        if bucket_name == "listing-images":
            display_image, crop_meta = _build_display_variant(img, normalized_crop)
            if display_image is not None:
                display_buffer = BytesIO()
                display_image.save(
                    display_buffer, format="JPEG", quality=88, optimize=True
                )
                display_buffer.seek(0)
                display_data = display_buffer.read()
                display_filename = unique_filename.rsplit(".", 1)[0] + "_display.jpg"

                uploaded_display_url, display_error = _upload_bytes_to_supabase_storage(
                    file_data=display_data,
                    bucket_name=bucket_name,
                    object_path=display_filename,
                    content_type="image/jpeg",
                )
                if display_error:
                    logger.warning(
                        f"Display variant upload failed for {unique_filename}: {display_error}"
                    )
                elif uploaded_display_url:
                    display_url = uploaded_display_url

        metadata = {
            "url": public_url,
            "image_url": public_url,
            "display_url": display_url,
            "focal_x": normalized_crop["focal_x"],
            "focal_y": normalized_crop["focal_y"],
            "crop_meta": crop_meta,
        }
        return metadata, None

    except Exception as e:
        logger.error(f"Error uploading to Supabase Storage: {str(e)}", exc_info=True)
        return None, str(e)


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
        response, response_status = supabase_request(
            "get", query, use_service_role=True
        )

        if not response or len(response) == 0:
            return jsonify({"error": "Advertisements not found"}), 404

        return jsonify(response[0])
    except Exception as e:
        logger.error(f"Error fetching advertisements: {e}")
        return jsonify({"error": str(e)}), 500


def _send_resend_email(payload, email_type=None, user_id=None):
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
        _log_email_event(
            email_type=email_type or "unknown",
            user_id=user_id,
            to_email=(payload.get("to") or [""])[0] if isinstance(payload.get("to"), list) else str(payload.get("to", "")),
            subject=payload.get("subject"),
            resend_email_id=None,
            error_message=response.text[:500],
        )
        return None, response.text

    data = response.json()
    _log_email_event(
        email_type=email_type or "unknown",
        user_id=user_id,
        to_email=(payload.get("to") or [""])[0] if isinstance(payload.get("to"), list) else str(payload.get("to", "")),
        subject=payload.get("subject"),
        resend_email_id=data.get("id"),
    )
    return data, None


def _log_email_event(email_type, to_email, subject=None, resend_email_id=None,
                     user_id=None, error_message=None):
    """Insert a row into outbound_emails. Best-effort — never raises."""
    try:
        supabase_request(
            "post",
            "/rest/v1/outbound_emails",
            data={
                "email_type": str(email_type or "unknown"),
                "user_id": str(user_id) if user_id else None,
                "to_email": str(to_email or ""),
                "subject": str(subject or "")[:500] if subject else None,
                "resend_email_id": str(resend_email_id) if resend_email_id else None,
                "error_message": str(error_message)[:500] if error_message else None,
            },
            use_service_role=True,
        )
    except Exception:
        pass


def _get_user_push_tokens(user_id):
    """Return a user's enabled Expo push tokens. Best-effort — [] on any error."""
    if not user_id:
        return []
    rows, status_code = supabase_request(
        "get",
        "/rest/v1/push_tokens",
        params={
            "select": "expo_push_token",
            "user_id": f"eq.{user_id}",
            "enabled": "eq.true",
        },
        use_service_role=True,
    )
    if status_code >= 400 or not isinstance(rows, list):
        return []
    return [r.get("expo_push_token") for r in rows if r.get("expo_push_token")]


def _prune_dead_push_tokens(tokens):
    """Delete tokens Expo has told us are permanently dead so they don't
    accumulate (Expo throttles senders that keep hitting dead tokens)."""
    for token in tokens or []:
        supabase_request(
            "delete",
            "/rest/v1/push_tokens",
            params={"expo_push_token": f"eq.{token}"},
            use_service_role=True,
        )


def _notify_user_push(user_id, title, body, data=None):
    """Fan a push out to all of a user's devices. Best-effort — never raises,
    so it can sit next to email sends without guarding every caller."""
    try:
        tokens = _get_user_push_tokens(user_id)
        if not tokens:
            return
        resp, err = send_expo_push(tokens, title, body, data=data)
        if err:
            logger.info("Push send failed user=%s err=%s", user_id, str(err)[:200])
            return
        _prune_dead_push_tokens(dead_push_tokens(tokens, resp))
    except Exception as e:
        logger.debug("push notify error: %s", e)


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
                    str(listing.get("year") or listing.get("make_year", "")).strip(),
                    str(listing.get("bike_brand") or listing.get("make", "")).strip(),
                    str(listing.get("bike_model") or listing.get("model", "")).strip(),
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
    # Use the caller's origin only when it is a known frontend; otherwise the
    # canonical site (SITE_URL, www). Do NOT fall back to _get_safe_frontend_origin
    # here — on the web service allowed_origins[0] is http://localhost:3000 (first
    # CORS_ORIGINS entry) and FRONTEND_URL is unset, so approval-email "View
    # Listing" links pointed at localhost; on the worker it is the apex (no-www).
    if request_origin and request_origin in _get_cors_origins():
        base_url = request_origin.rstrip("/")
    else:
        base_url = SITE_URL.rstrip("/")
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


def _build_listing_manage_url(item_type, item_id):
    """Return the owner-only edit URL for a newly submitted listing.

    A pending listing is intentionally not publicly viewable yet, so its
    confirmation email must not point at a public detail route. The edit route
    is both the exact listing and a useful destination while it is in review.
    """
    if not item_id:
        return None
    normalized = {"cars": "car", "bikes": "bike", "parts": "part", "plates": "plate"}.get(
        str(item_type or "").strip().lower(), str(item_type or "").strip().lower()
    )
    if normalized not in {"car", "bike", "part", "plate"}:
        return None
    return f"{SITE_URL.rstrip('/')}/edit/{normalized}/{item_id}"


def _send_listing_status_email(
    user_email, item_type, listing, status, request_origin=None, rejection_fix=None
):
    if not user_email:
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    # Normalize singular → plural so callers can pass either form.
    _to_plural = {"car": "cars", "bike": "bikes", "plate": "plates", "part": "parts"}
    item_type = _to_plural.get(item_type, item_type)

    item_label_map = {
        "cars": "Car",
        "bikes": "Bike",
        "plates": "Plate",
        "parts": "Car Part",
    }
    item_label = item_label_map.get(item_type, "Listing")
    listing_title = _build_listing_title(item_type, listing)
    listing_url = _build_listing_url(
        item_type, listing.get("id") if listing else None, request_origin
    )

    status_colors = {
        "approved": "#10b981",
        "rejected": "#ef4444",
        "updated": "#3b82f6",
        "renewed": "#8b5cf6",
    }
    status_color = status_colors.get(status, "#3b82f6")

    subject = f"Your {item_label} listing has been {status} - DPH Classifieds"

    rejection_note = listing.get("rejection_note", "") if listing else ""
    rejection_block = ""
    if status == "rejected" and rejection_note:
        rejection_block = f'<div style="background: rgba(239,68,68,0.08); border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid rgba(239,68,68,0.2);"><p style="margin: 0; color: #fca5a5; font-size: 14px;"><strong>Reason:</strong> {rejection_note}</p></div>'
    if status == "rejected" and rejection_fix:
        rejection_block += f'<div style="background: rgba(59,130,246,0.08); border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid rgba(59,130,246,0.2);"><p style="margin: 0; color: #93c5fd; font-size: 14px;"><strong>How to fix:</strong> {rejection_fix}</p></div>'

    action_label_map = {
        "approved": "approved and is now live",
        "rejected": "rejected",
        "updated": "updated successfully",
        "renewed": "renewed for another 15 days",
    }
    action_label = action_label_map.get(status, status)

    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #8bd6b4; letter-spacing: -0.02em;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.03); border-radius: 20px; padding: 32px; border: 1px solid rgba(255, 255, 255, 0.05); margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 16px;">Listing {status.capitalize()}</h2>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 20px;">
                Hi there, your <strong style="color: #f0fdf4;">{item_label}</strong> listing for <strong style="color: #f0fdf4;">"{listing_title}"</strong> has been <strong style="color: {status_color};">{action_label}</strong>.
            </p>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
                <div style="width: 4px; height: 40px; background-color: {status_color}; border-radius: 2px;"></div>
                <div style="padding-left: 12px;">
                    <div style="font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Status</div>
                    <div style="font-size: 18px; font-weight: 600; color: {status_color};">{status.capitalize()}</div>
                </div>
            </div>
            {rejection_block}
            {f'<a href="{listing_url}" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">View Your Listing</a>' if listing_url and status == "approved" else ""}
            {f'<a href="{SITE_URL}/my-listings" style="display: inline-block; background-color: rgba(255,255,255,0.05); color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px; border: 1px solid rgba(255,255,255,0.1);">Manage Listings</a>' if status != "approved" else ""}
        </div>
        <div style="text-align: center; color: #64748b; font-size: 14px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
            <p>If you have any questions, please reply to this email.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="listing_status")


def _send_dealer_status_email(
    user_email, status, request_origin=None, rejection_note=None, rejection_fix=None
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
    settings_url = f"{base_url}/settings"

    subject = f"Your dealer verification has been {status}"

    status_colors = {
        "approved": "#10b981",
        "rejected": "#ef4444",
    }
    status_color = status_colors.get(status, "#3b82f6")

    rejection_reason_block = ""
    if rejection_note and status == "rejected":
        rejection_reason_block = f'<div style="background: rgba(239,68,68,0.08); border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid rgba(239,68,68,0.2);"><p style="margin: 0; color: #fca5a5; font-size: 14px;"><strong>Reason:</strong> {rejection_note}</p></div>'
    if rejection_fix and status == "rejected":
        rejection_reason_block += f'<div style="background: rgba(59,130,246,0.08); border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid rgba(59,130,246,0.2);"><p style="margin: 0; color: #93c5fd; font-size: 14px;"><strong>How to fix:</strong> {rejection_fix}</p></div>'

    cta_url = settings_url if status == "rejected" else profile_url
    cta_label = "Update Your Profile" if status == "rejected" else "View Your Profile"

    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #8bd6b4; letter-spacing: -0.02em;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.03); border-radius: 20px; padding: 32px; border: 1px solid rgba(255, 255, 255, 0.05); margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 16px;">Dealer Verification {status.capitalize()}</h2>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 20px;">
                Hi there, your dealer verification request has been <strong style="color: {status_color};">{status}</strong>.
            </p>
            {rejection_reason_block}
            <a href="{cta_url}" style="display: inline-block; background: #8bd6b4; color: #041008; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">{cta_label}</a>
        </div>
        <div style="text-align: center; color: #64748b; font-size: 14px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
            <p>If you have any questions, please reply to this email.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="dealer_status")


def _fetch_all_admin_emails():
    """Return email addresses for every user with is_admin=true."""
    resp, status = supabase_request(
        "get",
        "/rest/v1/users",
        params={"select": "email", "is_admin": "eq.true"},
        use_service_role=True,
    )
    if status >= 400 or not resp:
        return []
    return [r["email"] for r in resp if r.get("email")]


def _send_new_listing_admin_notification(item_type, listing, user_email):
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    admin_emails = _fetch_all_admin_emails()
    fallback = os.getenv("RESEND_TO_EMAIL") or PRIMARY_SUPER_ADMIN_EMAIL
    if not admin_emails:
        admin_emails = [fallback]

    to_email = admin_emails  # Resend accepts a list

    item_label_map = {
        "car": "Car",
        "bike": "Bike",
        "part": "Car Part",
        "plate": "Plate",
    }
    item_label = item_label_map.get(item_type, "Listing")
    listing_title = _build_listing_title(
        f"{item_type}s" if not item_type.endswith("s") else item_type, listing
    )
    admin_url = f"{SITE_URL}/admin/listings"
    listing_id = listing.get("id", "N/A")

    subject = f"[New {item_label}] {listing_title} – Pending Review"
    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #8bd6b4;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
            <div style="font-size: 13px; color: #64748b; margin-top: 4px;">Admin Notification</div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border-radius: 20px; padding: 32px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 16px;">New {item_label} Listing Submitted</h2>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">A new <strong style="color: #8bd6b4;">{item_label}</strong> listing is pending your review.</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #64748b; font-size: 14px; width: 40%;">Title</td><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #f0fdf4; font-weight: 600;">{listing_title}</td></tr>
                <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #64748b; font-size: 14px;">Submitted by</td><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #f0fdf4;">{user_email or "Unknown"}</td></tr>
                <tr><td style="padding: 10px 0; color: #64748b; font-size: 14px;">Listing ID</td><td style="padding: 10px 0; color: #8bd6b4; font-family: monospace;">{listing_id}</td></tr>
            </table>
            <a href="{admin_url}" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">Review in Admin Panel</a>
        </div>
        <div style="text-align: center; color: #64748b; font-size: 13px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. Admin notification – do not reply.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": to_email,
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="admin_new_listing")


def _send_auto_approved_admin_notification(item_type, listing, user_email):
    """Email admins when the auto-review worker approves a listing — informational only."""
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    admin_emails = _fetch_all_admin_emails()
    fallback = os.getenv("RESEND_TO_EMAIL") or PRIMARY_SUPER_ADMIN_EMAIL
    if not admin_emails:
        admin_emails = [fallback]

    item_label = {"car": "Car", "bike": "Bike", "part": "Car Part", "plate": "Plate"}.get(item_type, "Listing")
    listing_title = _build_listing_title(
        f"{item_type}s" if not item_type.endswith("s") else item_type, listing
    )
    listing_id = listing.get("id", "N/A")
    admin_url = f"{SITE_URL}/admin/listings"

    subject = f"[Auto-Approved] {listing_title} — No action needed"
    html_content = f"""
    <div style="font-family:'Inter',-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background-color:#041008;color:#f0fdf4;border-radius:24px;border:1px solid rgba(139,214,180,0.1);">
        <div style="text-align:center;margin-bottom:32px;">
            <div style="font-size:28px;font-weight:800;color:#8bd6b4;">DPH<span style="color:#ffffff;">CLASSIFIEDS</span></div>
            <div style="font-size:13px;color:#64748b;margin-top:4px;">Auto-Review Notification</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border-radius:20px;padding:32px;border:1px solid rgba(255,255,255,0.05);margin-bottom:24px;">
            <h2 style="margin-top:0;color:#8bd6b4;font-size:22px;font-weight:700;margin-bottom:16px;">&#10003; Listing Auto-Approved</h2>
            <p style="color:#94a3b8;line-height:1.6;margin-bottom:24px;">This <strong style="color:#8bd6b4;">{item_label}</strong> listing passed all auto-review checks and is now live. No action needed.</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
                <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);color:#64748b;font-size:14px;width:40%;">Title</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);color:#f0fdf4;font-weight:600;">{listing_title}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);color:#64748b;font-size:14px;">Submitted by</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);color:#f0fdf4;">{user_email or "Unknown"}</td></tr>
                <tr><td style="padding:10px 0;color:#64748b;font-size:14px;">Listing ID</td><td style="padding:10px 0;color:#8bd6b4;font-family:monospace;">{listing_id}</td></tr>
            </table>
            <a href="{admin_url}" style="display:inline-block;background-color:rgba(139,214,180,0.15);color:#8bd6b4;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;border:1px solid rgba(139,214,180,0.3);">View in Admin Panel</a>
        </div>
        <div style="text-align:center;color:#64748b;font-size:13px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. Auto-review notification.</p>
        </div>
    </div>
    """
    payload = {"from": from_email, "to": admin_emails, "subject": subject, "html": html_content}
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to
    return _send_resend_email(payload, email_type="admin_auto_approved")


def _send_new_listing_user_confirmation(user_email, item_type, listing):
    if not user_email:
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    item_label_map = {
        "car": "Car",
        "bike": "Bike",
        "part": "Car Part",
        "plate": "Plate",
    }
    item_label = item_label_map.get(item_type, "Listing")
    item_label_lower = item_label.lower()
    listing_title = _build_listing_title(
        f"{item_type}s" if not item_type.endswith("s") else item_type, listing
    )
    manage_listing_url = _build_listing_manage_url(item_type, listing.get("id") if listing else None)

    subject = f"Your {item_label} listing has been submitted – DPH Classifieds"
    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
        <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #8bd6b4; letter-spacing: -0.02em;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
        </div>
        <div style="background: rgba(255,255,255,0.03); border-radius: 20px; padding: 32px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 24px;">
            <h2 style="margin-top: 0; color: #ffffff; font-size: 22px; font-weight: 700; margin-bottom: 16px;">Listing Submitted Successfully</h2>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 16px;">
                Hi there, your <strong style="color: #f0fdf4;">{item_label}</strong> listing for <strong style="color: #f0fdf4;">"{listing_title}"</strong> has been received and is now <strong style="color: #f59e0b;">pending review</strong>.
            </p>
            <p style="color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">
                Our team typically reviews listings within 24 hours. You will receive another email as soon as your listing is approved and goes live.
            </p>
            <div style="background: rgba(139,214,180,0.05); border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px dashed rgba(139,214,180,0.2);">
                <p style="margin: 0; color: #8bd6b4; font-size: 14px;">💡 <strong>Tip:</strong> You can track the status of all your listings anytime from your dashboard.</p>
            </div>
            {f'<a href="{manage_listing_url}" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">Manage This Listing</a>' if manage_listing_url else f'<a href="{SITE_URL}/my-listings" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">View My Listings</a>'}
        </div>
        <div style="text-align: center; color: #64748b; font-size: 14px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
            <p>If you have any questions, please reply to this email.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="listing_confirmation")


def _build_public_listing_url(listing_type, listing_id):
    if not listing_type or not listing_id:
        return None
    base = SITE_URL.rstrip("/")
    listing_type = str(listing_type).lower().strip()
    listing_id = str(listing_id).strip()
    paths = {
        "car": f"/cars/{listing_id}",
        "bike": f"/bikes/{listing_id}",
        "plate": f"/plates/{listing_id}",
        "part": f"/car-parts/{listing_id}",
    }
    path = paths.get(listing_type)
    if not path:
        return None
    return f"{base}{path}"


def _send_report_admin_notification(report, reporter_email=None):
    from_email = os.getenv("RESEND_FROM_EMAIL")
    to_email = os.getenv("RESEND_TO_EMAIL")
    if not from_email or not to_email:
        return None, "Missing RESEND_FROM_EMAIL or RESEND_TO_EMAIL"

    listing_type = (report.get("listing_type") or "").lower()
    listing_id = report.get("listing_id")
    reason = report.get("reason") or "unspecified"
    details = report.get("details") or ""
    status = report.get("status") or "pending"
    created_at = report.get("created_at") or ""
    report_id = report.get("id") or ""

    public_url = _build_public_listing_url(listing_type, listing_id)
    admin_url = f"{SITE_URL.rstrip('/')}/admin/reports"

    subject_prefix = "[Bug Report]" if listing_type == "bug" else "[Listing Report]"
    subject_target = f"{listing_type}:{str(listing_id)[:8]}" if listing_id else listing_type
    subject = f"{subject_prefix} {subject_target} – {reason}"

    safe_details = xml_escape(str(details)) if details else "No extra details provided."
    safe_reporter = xml_escape(str(reporter_email)) if reporter_email else "Unknown"
    safe_created = xml_escape(str(created_at)) if created_at else ""

    listing_link_html = (
        f'<a href="{public_url}" style="color:#8bd6b4; text-decoration:none;">Open listing</a>'
        if public_url
        else "<span style=\"color:#94a3b8;\">Listing link unavailable</span>"
    )

    html_content = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="font-size: 28px; font-weight: 800; color: #8bd6b4;">DPH<span style="color: #ffffff;">CLASSIFIEDS</span></div>
        <div style="font-size: 13px; color: #64748b; margin-top: 6px;">Admin Report Notification</div>
      </div>

      <div style="background: rgba(255,255,255,0.03); border-radius: 20px; padding: 28px; border: 1px solid rgba(255,255,255,0.06);">
        <h2 style="margin: 0 0 10px; color: #ffffff; font-size: 20px; font-weight: 800;">New report received</h2>
        <p style="margin: 0 0 18px; color: #94a3b8; line-height: 1.6;">A user reported a listing. Review it in the admin panel and take action if needed.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 10px 0 18px;">
          <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #64748b; width: 34%;">Report ID</td><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-family: monospace; color: #8bd6b4;">{xml_escape(str(report_id))}</td></tr>
          <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #64748b;">Listing</td><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #f0fdf4;">{xml_escape(str(listing_type))} · {xml_escape(str(listing_id))}</td></tr>
          <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #64748b;">Reason</td><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #f0fdf4; font-weight: 700;">{xml_escape(str(reason))}</td></tr>
          <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #64748b;">Status</td><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #f0fdf4;">{xml_escape(str(status))}</td></tr>
          <tr><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #64748b;">Reporter</td><td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); color: #f0fdf4;">{safe_reporter}</td></tr>
          <tr><td style="padding: 10px 0; color: #64748b;">Created</td><td style="padding: 10px 0; color: #f0fdf4;">{safe_created}</td></tr>
        </table>

        <div style="background: rgba(255,255,255,0.02); border-radius: 16px; padding: 16px 18px; border: 1px solid rgba(255,255,255,0.06);">
          <div style="font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color:#64748b; margin-bottom: 8px;">Details</div>
          <div style="white-space: pre-wrap; line-height: 1.6; color:#e2e8f0;">{safe_details}</div>
        </div>

        <div style="display:flex; gap: 12px; margin-top: 18px; flex-wrap: wrap;">
          <a href="{admin_url}" style="display:inline-block; background-color:#8bd6b4; color:#041008; padding:12px 18px; border-radius: 12px; text-decoration:none; font-weight: 800;">Open admin reports</a>
          {listing_link_html}
        </div>
      </div>

      <div style="text-align:center; margin-top: 16px; color:#64748b; font-size: 12px;">
        DPH Classifieds · Admin report notification
      </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload, email_type="admin_report")


def _send_listing_deleted_email(
    user_email, item_type, listing_title, listing_id, reason
):
    """Send email to user when their listing is removed by admin."""
    from_email = os.getenv("RESEND_FROM_EMAIL", "noreply@dphclassifieds.com")
    type_label = {
        "car": "Car",
        "bike": "Bike",
        "part": "Car Part",
        "plate": "Plate",
    }.get(item_type, "Listing")
    subject = f"Your {type_label} listing has been removed — DPH Classifieds"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#041008;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:560px;margin:40px auto;padding:0 20px;">
        <div style="text-align:center;margin-bottom:32px;">
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.03em;color:#ffffff;">DPH</span>
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.03em;color:#8bd6b4;">Classifieds</span>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(139,214,180,0.12);border-radius:20px;padding:36px 32px;">
          <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#ffffff;">Listing Removed</h1>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.55);">Your {type_label.lower()} listing has been removed by our moderation team.</p>
          <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.12em;">Listing</p>
            <p style="margin:0;font-size:15px;font-weight:600;color:#ffffff;">{listing_title}</p>
          </div>
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.12em;">Reason</p>
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.8);">{reason}</p>
          </div>
          <p style="margin:0 0 24px;font-size:13px;color:rgba(255,255,255,0.4);line-height:1.6;">
            If you believe this was removed in error, please reply to this email or contact us at support@dphclassifieds.com.
          </p>
          <a href="https://dphclassifieds.com/my-listings" style="display:inline-block;background:linear-gradient(135deg,#8bd6b4,#004e37);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">Manage Listings</a>
        </div>
        <p style="text-align:center;font-size:12px;color:#64748b;margin-top:32px;">&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
      </div>
    </body>
    </html>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    result, error = _send_resend_email(payload)
    if error:
        logger.error(f"Failed to send deletion email to {user_email}: {error}")
    else:
        logger.info(f"Deletion email sent to {user_email} for {item_type} {listing_id}")
    return result, error


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
@app.route("/api/dealer/listing-limit", methods=["GET"])
@token_required
def dealer_listing_limit(current_user):
    """Return the dealer's current cap and how many listings they've used.

    Response shape: {verified, limit, used, remaining, can_request, default_limit}
    Non-dealers get 403. The cap and counts come from a single
    `_fetch_dealer_listing_policy` call.
    """
    summary = _fetch_dealer_listing_policy(current_user)
    if not summary:
        return jsonify({"error": "Not a dealer"}), 403
    return jsonify(summary), 200


def decide_upgrade_request(current_limit, requested_limit, decision, new_limit, admin_id):
    """Pure decision: what should the admin's approve/reject action do?

    Returns (new_limit, history_dict_or_None, error_or_None).
    - decision='reject'      → (None, None, None)
    - decision='approve'     → (int new_limit, history dict, None) when valid
    - any other value        → (None, None, {code: invalid_decision, ...})

    `new_limit` is the cap the admin wants to set (may differ from what the
    dealer asked for). It is required for 'approve' and must be in
    [1, MAX_LIMIT].
    """
    if decision == "reject":
        return None, None, None
    if decision != "approve":
        return None, None, {"code": "invalid_decision",
                            "message": "decision must be 'approve' or 'reject'"}
    if new_limit is None:
        return None, None, {"code": "new_limit_required",
                            "message": "new_limit is required to approve"}
    try:
        nl = int(new_limit)
    except (TypeError, ValueError):
        return None, None, {"code": "invalid_new_limit",
                            "message": "new_limit must be a number"}
    if nl <= 0 or nl > _DEALER_UPGRADE_REQUEST_MAX_LIMIT:
        return None, None, {"code": "invalid_new_limit",
                            "message": f"new_limit must be 1..{_DEALER_UPGRADE_REQUEST_MAX_LIMIT}"}
    history = {
        "old_limit": int(current_limit),
        "new_limit": nl,
        "changed_by": admin_id,
        "source": "upgrade_request",
    }
    return nl, history, None


def _schedule_dealer_auto_approval_if_eligible(user_id):
    """If both required docs are present and clear the OCR threshold, queue a
    delayed auto-approval. Idempotent: the unique partial index on
    (user_id) WHERE state='pending' ensures at most one pending row per user;
    a new upload cancels the old pending row before inserting a fresh one so
    the 5-minute timer effectively restarts on the latest OCR confidence.
    """
    from services.registration_ocr import should_auto_approve_dealer
    threshold = float(os.getenv("DEALER_AUTO_APPROVAL_OCR_THRESHOLD", "0.90"))
    delay = int(os.getenv("DEALER_AUTO_APPROVAL_DELAY_SECONDS", "300"))
    docs, code = supabase_request(
        "get", "/rest/v1/dealer_documents",
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,document_type,ocr_confidence,replaced_at,status",
            "replaced_at": "is.null",
        },
        use_service_role=True,
    )
    if code >= 400 or not isinstance(docs, list):
        return {"scheduled": False, "reason": "fetch_failed"}
    decision = should_auto_approve_dealer(docs, threshold=threshold)
    if not decision["approve"]:
        return {"scheduled": False, "reason": "not_eligible", "details": decision}
    # Don't schedule if the user is already verified
    user_body, ucode = supabase_request(
        "get", f"/rest/v1/users?id=eq.{user_id}&select=dealer_verified", use_service_role=True,
    )
    if ucode < 400 and user_body and user_body[0].get("dealer_verified"):
        return {"scheduled": False, "reason": "already_verified"}
    # Cancel any existing pending row so the unique index lets the new insert through
    supabase_request(
        "patch", "/rest/v1/dealer_pending_approvals",
        params={"user_id": f"eq.{user_id}", "state": "eq.pending"},
        data={"state": "cancelled", "cancelled_reason": "rescheduled_by_new_upload"},
        use_service_role=True,
    )
    from datetime import datetime, timedelta, timezone
    scheduled_for = (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat()
    by_type = {d["document_type"]: d for d in docs}
    insert_body, ic = supabase_request(
        "post", "/rest/v1/dealer_pending_approvals",
        data={
            "user_id": user_id,
            "trigger_kind": "ocr_high_confidence",
            "scheduled_for": scheduled_for,
            "trade_license_doc_id": (by_type.get("trade_license") or {}).get("id"),
            "tax_registration_doc_id": (by_type.get("tax_registration") or {}).get("id"),
            "trade_license_confidence": (by_type.get("trade_license") or {}).get("ocr_confidence"),
            "tax_registration_confidence": (by_type.get("tax_registration") or {}).get("ocr_confidence"),
            "threshold": threshold,
        },
        use_service_role=True,
    )
    if ic >= 400:
        return {"scheduled": False, "reason": "insert_failed", "details": insert_body}
    return {"scheduled": True, "scheduled_for": scheduled_for,
            "min_confidence": decision["min_confidence"]}


def _send_dealer_signup_admin_notification(user_row, documents=None):
    """Email every admin when a new dealer submits their KYC application.

    `user_row` is the public.users row (must include email, company_name,
    legal_business_name, trn, is_dealer). `documents` is an optional list
    of dealer_documents rows; when supplied, we show which docs are present
    in the email body so the admin knows what's pending review.
    """
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"
    admin_emails = _fetch_all_admin_emails()
    fallback = os.getenv("RESEND_TO_EMAIL") or PRIMARY_SUPER_ADMIN_EMAIL
    if not admin_emails:
        admin_emails = [fallback]
    dealer_label = ((user_row or {}).get("legal_business_name")
                    or (user_row or {}).get("company_name")
                    or (user_row or {}).get("email")
                    or "Dealer")
    docs = documents or []
    docs_lines = ""
    if docs:
        from collections import Counter
        counts = Counter(d.get("document_type") for d in docs)
        chips = " · ".join(f"{_DEALER_DOCUMENT_LABELS.get(k, k)}: {v}" for k, v in counts.items())
        docs_lines = f"<p style='margin:6px 0 0;color:#94a3b8;font-size:13px;'>Documents on file: {chips}</p>"
    subject = f"[Dealer] New dealer signed up — {dealer_label}"
    html = (
        "<div style=\"font-family:'Inter',-apple-system,sans-serif;max-width:600px;margin:0 auto;"
        "padding:24px;background:#041008;color:#f0fdf4;\">"
        "<h2 style=\"color:#8bd6b4;margin-top:0;\">New dealer application submitted</h2>"
        f"<p><strong>Dealer:</strong> {dealer_label}</p>"
        f"<p><strong>Email:</strong> {(user_row or {}).get('email') or '—'}</p>"
        f"<p><strong>TRN:</strong> {(user_row or {}).get('trn') or '—'}</p>"
        f"{docs_lines}"
        f"<p style='margin-top:24px;'>"
        f"<a href=\"{SITE_URL}/admin/dealers\" "
        "style=\"background:#8bd6b4;color:#041008;padding:12px 20px;border-radius:8px;"
        "text-decoration:none;font-weight:600;\">Review in admin panel</a></p>"
        "</div>"
    )
    return _send_resend_email(
        {"from": from_email, "to": admin_emails, "subject": subject, "html": html},
        email_type="dealer_signup_application",
    )


def _send_dealer_approved_admin_notification(user_row):
    """Email every admin when a dealer's KYC application is approved.

    This is the admin-side notification, not the dealer-side one — the dealer
    already gets a 'welcome' email from `_send_dealer_status_email` at the
    moment of approval. This is so the admin team can see the cadence of
    approvals and react to any unusual patterns.
    """
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"
    admin_emails = _fetch_all_admin_emails()
    fallback = os.getenv("RESEND_TO_EMAIL") or PRIMARY_SUPER_ADMIN_EMAIL
    if not admin_emails:
        admin_emails = [fallback]
    dealer_label = ((user_row or {}).get("legal_business_name")
                    or (user_row or {}).get("company_name")
                    or (user_row or {}).get("email")
                    or "Dealer")
    subject = f"[Dealer] Approved — {dealer_label}"
    html = (
        "<div style=\"font-family:'Inter',-apple-system,sans-serif;max-width:600px;margin:0 auto;"
        "padding:24px;background:#041008;color:#f0fdf4;\">"
        "<h2 style=\"color:#8bd6b4;margin-top:0;\">New dealer approved</h2>"
        f"<p><strong>Dealer:</strong> {dealer_label}</p>"
        f"<p><strong>Email:</strong> {(user_row or {}).get('email') or '—'}</p>"
        f"<p style='margin-top:24px;'>"
        f"<a href=\"{SITE_URL}/admin/dealers\" "
        "style=\"background:#8bd6b4;color:#041008;padding:12px 20px;border-radius:8px;"
        "text-decoration:none;font-weight:600;\">View in admin panel</a></p>"
        "</div>"
    )
    return _send_resend_email(
        {"from": from_email, "to": admin_emails, "subject": subject, "html": html},
        email_type="dealer_approved",
    )


def _send_dealer_listing_upgrade_admin_notification(request_row, dealer_row):
    """Email every admin when a dealer requests a higher listing cap.

    Mirrors the layout of the existing new-listing admin notification so the
    two flows look the same in the inbox. The recipient list is the same
    `_fetch_all_admin_emails()` distribution used elsewhere, falling back to
    the primary super-admin / env-configured address.
    """
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"
    admin_emails = _fetch_all_admin_emails()
    fallback = os.getenv("RESEND_TO_EMAIL") or PRIMARY_SUPER_ADMIN_EMAIL
    if not admin_emails:
        admin_emails = [fallback]
    dealer_label = (dealer_row or {}).get("legal_business_name") \
        or (dealer_row or {}).get("company_name") \
        or (dealer_row or {}).get("email") \
        or "Dealer"
    subject = f"[Dealer] Listing limit upgrade request — {dealer_label}"
    html = (
        "<div style=\"font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;"
        "padding:24px;background:#041008;color:#f0fdf4;\">"
        "<h2 style=\"color:#8bd6b4;margin-top:0;\">Dealer requested a higher listing limit</h2>"
        f"<p><strong>Dealer:</strong> {dealer_label}</p>"
        f"<p><strong>Current limit:</strong> {request_row.get('current_limit')}</p>"
        f"<p><strong>Requested limit:</strong> {request_row.get('requested_limit')}</p>"
        "<p><strong>Reason:</strong></p>"
        f"<blockquote style=\"border-left:3px solid #8bd6b4;padding-left:12px;margin-left:0;\">"
        f"{request_row.get('reason')}</blockquote>"
        f"<p style=\"margin-top:24px;\">"
        f"<a href=\"{SITE_URL}/admin/dealers?tab=upgrade-requests\" "
        "style=\"background:#8bd6b4;color:#041008;padding:12px 20px;border-radius:8px;"
        "text-decoration:none;font-weight:600;\">Review in admin panel</a></p>"
        "</div>"
    )
    return _send_resend_email(
        {"from": from_email, "to": admin_emails, "subject": subject, "html": html},
        email_type="dealer_listing_upgrade_request",
    )




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


def find_user_email_by_username(username):
    """Look up a user's email address by their username."""
    try:
        normalized_username = _normalize_username_value(username)
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?username=ilike.{normalized_username}&select=email&limit=1"
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            logger.warning(
                f"Unable to look up username {username}: {response.status_code}"
            )
            return None
        users = response.json()
        if users:
            return users[0].get("email")
        return None
    except Exception as e:
        logger.error(f"Error finding user by username: {str(e)}")
        return None


# User authentication routes
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


def _normalize_username_value(username):
    return str(username or "").strip()


def _compact_username_value(username):
    return re.sub(r"[^a-z0-9]", "", _normalize_username_value(username).lower())


_LEET_USERNAME_TRANSLATION = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "2": "z",
        "3": "e",
        "4": "a",
        "5": "s",
        "6": "g",
        "7": "t",
        "8": "b",
        "9": "g",
    }
)


def _username_blocklist_candidates(username):
    compact = _compact_username_value(username)
    if not compact:
        return []
    normalized = compact.translate(_LEET_USERNAME_TRANSLATION)
    collapsed = re.sub(r"(.)\\1{1,}", r"\\1", normalized)
    candidates = {compact, normalized, collapsed}
    return [value for value in candidates if value]


def _username_blocked_message():
    return "That username is not allowed. Please choose a different one."


def _is_username_blocked(username):
    candidates = _username_blocklist_candidates(username)
    if not candidates:
        return True
    return any(
        term in candidate for candidate in candidates for term in USERNAME_BLOCKLIST
    )


def _username_availability_cache_key(username, exclude_user_id=None):
    normalized = _normalize_username_value(username)
    exclude = str(exclude_user_id or "").strip()
    return f"username-availability:{normalized.lower()}:{exclude}"


def _username_conflict_message():
    return "This username is taken. Please try something else."


def _check_username_availability(username, exclude_user_id=None):
    normalized_username = _normalize_username_value(username)
    if not normalized_username:
        return {
            "available": False,
            "message": "Username is required",
            "username": normalized_username,
        }
    if not USERNAME_PATTERN.fullmatch(normalized_username):
        return {
            "available": False,
            "message": "Username can only contain letters, numbers, and underscores",
            "username": normalized_username,
        }
    if _is_username_blocked(normalized_username):
        return {
            "available": False,
            "message": _username_blocked_message(),
            "username": normalized_username,
            "code": "username_blocked",
        }

    cache_key = _username_availability_cache_key(username, exclude_user_id)
    cached = _api_cache_get(cache_key)
    if cached is not None:
        return cached

    params = {
        "select": "id,username",
        "username": f"ilike.{normalized_username}",
        "limit": "1",
    }
    if exclude_user_id:
        params["id"] = f"neq.{exclude_user_id}"

    response, status = supabase_request(
        "get",
        "/rest/v1/users",
        params=params,
        use_service_role=True,
    )

    if status >= 400:
        return {
            "available": False,
            "message": "Unable to check username right now",
            "username": normalized_username,
            "status": status,
        }

    is_taken = bool(response)
    payload = {
        "username": normalized_username,
        "available": not is_taken,
        "message": None if not is_taken else _username_conflict_message(),
    }
    _api_cache_set(
        cache_key,
        payload,
        ttl_seconds=USERNAME_AVAILABILITY_CACHE_TTL_SECONDS,
    )
    return payload


def _is_username_conflict_error(error_data, response_text=""):
    combined = " ".join(
        [
            json.dumps(error_data, ensure_ascii=False)
            if isinstance(error_data, dict)
            else str(error_data or ""),
            str(response_text or ""),
        ]
    ).lower()
    return (
        "users_username_key" in combined
        or ("duplicate key" in combined and "username" in combined)
        or ("unique constraint" in combined and "username" in combined)
    )


def _draft_payload_from_row(draft_row):
    if not isinstance(draft_row, dict):
        return {}
    payload = draft_row.get("payload")
    if payload in (None, ""):
        payload = draft_row.get("draft_payload")
    return payload if isinstance(payload, dict) else {}


def _draft_type_from_row(draft_row):
    return str((draft_row or {}).get("draft_key") or "car").strip().lower() or "car"


def _draft_source_from_payload(payload):
    if not isinstance(payload, dict):
        return {}
    return (
        payload.get("carForm")
        or payload.get("bikeForm")
        or payload.get("plateForm")
        or payload.get("partsForm")
        or payload.get("formData")
        or payload
    )


def _draft_resume_path(draft_type):
    return {
        "car": "/post-car",
        "bike": "/post-bike",
        "plate": "/post-plate",
        "part": "/post-car-parts",
    }.get(str(draft_type or "").strip().lower(), "/post-car")


def _draft_display_title(draft_type, payload):
    draft_type = str(draft_type or "car").strip().lower()
    source = _draft_source_from_payload(payload)

    if draft_type in ("car", "bike"):
        # Prefer the stored listing_title if available (listing-table drafts have this)
        direct_title = str(
            source.get("listing_title") or payload.get("listing_title") or ""
        ).strip()
        if direct_title:
            return direct_title
        title_parts = [
            str(source.get("year") or source.get("make_year") or "").strip(),
            str(
                source.get("make")
                or source.get("car_manufacturer")
                or source.get("bike_brand")
                or ""
            ).strip(),
            str(
                source.get("model")
                or source.get("car_model")
                or source.get("bike_model")
                or ""
            ).strip(),
        ]
        return " ".join(part for part in title_parts if part).strip() or f"Unfinished {draft_type}"
    if draft_type == "plate":
        digits = str(source.get("digits") or source.get("number") or "").strip()
        city = str(
            payload.get("plateCity") or payload.get("city") or payload.get("emirate") or ""
        ).strip()
        code = str(source.get("code") or "").strip()
        return " ".join(part for part in [city, code, digits] if part).strip() or "Unfinished plate"
    if draft_type == "part":
        return str(
            source.get("title")
            or source.get("name")
            or source.get("part_name")
            or "Unfinished part"
        ).strip()
    return f"Unfinished {draft_type}"


def _draft_thumbnail_url(payload):
    """Pick the first usable image URL out of a draft payload.

    Handles both PostCar's `existingImages` (array of strings or objects with
    `display_url`/`image_url`/`url`) and PostBike/PostCarParts/PostPlate's
    `existingImageUrls` (array of strings). Returns None if nothing usable.
    """
    if not isinstance(payload, dict):
        return None
    candidates = []
    for key in ("existingImages", "existingImageUrls", "images"):
        value = payload.get(key)
        if isinstance(value, list):
            candidates.extend(value)
    for item in candidates:
        if isinstance(item, str) and item.strip():
            return item.strip()
        if isinstance(item, dict):
            url = item.get("display_url") or item.get("image_url") or item.get("url")
            if isinstance(url, str) and url.strip():
                return url.strip()
    return None


def _annotate_draft_row(draft):
    payload = _draft_payload_from_row(draft)
    draft_type = _draft_type_from_row(draft)
    draft["payload"] = payload
    draft["draft_payload"] = payload
    draft["display_title"] = _draft_display_title(draft_type, payload)
    draft["display_subtitle"] = (
        f"Last edited {draft.get('updated_at') or draft.get('created_at') or ''}"
    )
    draft["resume_path"] = _draft_resume_path(draft_type)
    draft["display_image_url"] = _draft_thumbnail_url(payload)
    if draft_type == "plate":
        source = _draft_source_from_payload(payload)
        draft["plate_city"] = str(source.get("city") or payload.get("plateCity") or "").strip()
        draft["plate_code"] = str(source.get("code") or "").strip()
        draft["plate_number"] = str(source.get("number") or "").strip()
    return draft


def _build_draft_listing_summary(draft_row, owner_row=None):
    payload = _draft_payload_from_row(draft_row)
    draft_type = _draft_type_from_row(draft_row)
    display_title = _draft_display_title(draft_type, payload)

    user_email = (owner_row or {}).get("email") or draft_row.get("user_email")
    owner_name = _admin_display_name_from_user_row(owner_row) if owner_row else None
    summary = dict(draft_row)
    summary.update(
        {
            "draft_key": draft_type,
            "listing_type": "drafts",
            "status": "draft",
            "listing_state": "draft",
            "display_status": "draft",
            "display_title": display_title,
            "title": display_title,
            "listing_title": display_title,
            "display_subtitle": f"Last edited {draft_row.get('updated_at') or draft_row.get('created_at') or ''}",
            "display_image_url": _draft_thumbnail_url(payload),
            "resume_path": _draft_resume_path(draft_type),
            "user_email": user_email,
            "owner_email": user_email,
            "owner_name": owner_name,
            "draft_payload": payload,
            "payload": payload,
            "images": payload.get("images") or payload.get("existingImages") or payload.get("existing_image_urls") or [],
        }
    )
    return summary


def _save_listing_draft_record(current_user, draft_key, draft_payload):
    draft_table = "listing_drafts"
    now_iso = _isoformat_utc(_utc_now())
    supabase_request(
        "delete",
        f"/rest/v1/{draft_table}?user_id=eq.{current_user}&draft_key=eq.{draft_key}",
        use_service_role=True,
    )

    base_record = {
        "user_id": current_user,
        "draft_key": draft_key,
        "updated_at": now_iso,
    }
    attempts = [
        {**base_record, "payload": draft_payload, "draft_payload": draft_payload},
        {**base_record, "payload": draft_payload},
        {**base_record, "draft_payload": draft_payload},
    ]
    last_response = None
    last_status = 500

    for record in attempts:
        response, status = supabase_request(
            "post",
            f"/rest/v1/{draft_table}",
            data=record,
            use_service_role=True,
        )
        if status < 400:
            return response, status
        last_response, last_status = response, status
        if _looks_like_missing_table(response):
            break
        if not _looks_like_missing_column(response, "payload", "draft_payload"):
            break

    return last_response, last_status


# ---------------------------------------------------------------------------
# 48-hour repeatable reminder system — subject pools, helpers, new functions
# ---------------------------------------------------------------------------

_DRAFT_REMINDER_SUBJECTS = [
    "Your listing draft is waiting — finish it in 2 minutes",
    "Don't lose your progress — your draft is ready to publish",
    "One step away from selling — complete your listing",
    "Buyers are looking — your draft needs you",
    "Ready when you are: your saved draft",
    "Your listing is almost live — just needs your final touch",
]

_SAVED_CAR_REMINDER_SUBJECTS = [
    "Still thinking about it? The car you saved is waiting",
    "Your saved car — still available, still interested?",
    "Don't miss out on your saved listing",
    "You saved this car — want to make an offer?",
    "Your wishlist car is still here",
    "The car you saved — check in before it's gone",
]

_SAVED_SEARCH_ALERT_SUBJECTS = [
    "{count} listing{s} match your saved search",
    "New matches found for your {category} search",
    "We found {count} result{s} matching your criteria",
    "Your saved search has {count} result{s} right now",
    "{count} car{s} match what you're looking for",
    "Check out the latest matches for your search",
]


def _rotate_subject(pool, **kwargs):
    """Pick a subject from pool using ISO week number as the rotation seed.
    Same user sees a different subject each week. Falls back gracefully."""
    week = _utc_now().isocalendar()[1]
    template = pool[week % len(pool)]
    try:
        return template.format(**kwargs)
    except (KeyError, IndexError):
        return pool[0]


def _count_listings_for_saved_search(search):
    """Re-run a saved search against current inventory and return a result count."""
    category   = str(search.get("category") or "all").lower()
    query_text = str(search.get("query_text") or "").strip()
    filters    = search.get("filters") or {}

    TABLE_MAP = {
        "cars":   ["cars"],
        "bikes":  ["bikes"],
        "parts":  ["car_parts"],
        "plates": ["license_plates"],
        "all":    ["cars", "bikes", "car_parts", "license_plates"],
    }
    tables = TABLE_MAP.get(category, TABLE_MAP["cars"])

    total = 0
    for table in tables:
        params = {
            "status": "in.(approved,active)",
            "deleted_at": "is.null",
            "is_archived": "eq.false",
            "select": "id",
            "limit": "500",
        }
        if query_text:
            title_col = "listing_title" if table == "cars" else "name" if table == "car_parts" else "title"
            params[title_col] = f"ilike.*{query_text}*"
        if filters.get("make"):
            params["car_manufacturer" if table == "cars" else "make"] = f"ilike.{filters['make']}"
        if filters.get("model"):
            params["car_model" if table == "cars" else "model"] = f"ilike.{filters['model']}"
        if filters.get("price_max"):
            price_col = "expected_selling_price" if table == "cars" else "price"
            params[price_col] = f"lte.{filters['price_max']}"
        rows, status_code = supabase_request(
            "get", f"/rest/v1/{table}", params=params, use_service_role=True
        )
        if status_code < 400:
            total += len(rows or [])
    return total


# ---------------------------------------------------------------------------
# Email listing card helpers — fetch image + build rich HTML card for emails
# ---------------------------------------------------------------------------

_IMAGE_TABLE_MAP = {
    "car":   ("car_images",      "car_id"),
    "cars":  ("car_images",      "car_id"),
    "bike":  ("bike_images",     "bike_id"),
    "bikes": ("bike_images",     "bike_id"),
    "part":  ("part_images",     "part_id"),
    "parts": ("part_images",     "part_id"),
    "plate": ("plate_images",    "plate_id"),
    "plates":("plate_images",    "plate_id"),
}


def _fetch_listing_primary_image_url(listing_type, listing_id):
    """Fetch the first image URL for a listing. Returns None if unavailable."""
    cfg = _IMAGE_TABLE_MAP.get(str(listing_type or "").lower())
    if not cfg or not listing_id:
        return None
    images_table, fk = cfg
    rows, status = supabase_request(
        "get",
        f"/rest/v1/{images_table}",
        params={
            "select": "display_url,image_url,url",
            fk: f"eq.{listing_id}",
            "order": "uploaded_at.asc",
            "limit": "1",
        },
        use_service_role=True,
    )
    if status < 400 and rows:
        img = rows[0]
        return img.get("display_url") or img.get("image_url") or img.get("url")
    return None


def _fetch_listing_top_images(listing_type, listing_id, limit=3):
    """Fetch the first N image URLs for a listing. Returns list."""
    cfg = _IMAGE_TABLE_MAP.get(str(listing_type or "").lower())
    if not cfg or not listing_id:
        return []
    images_table, fk = cfg
    rows, status = supabase_request(
        "get",
        f"/rest/v1/{images_table}",
        params={
            "select": "display_url,image_url,url",
            fk: f"eq.{listing_id}",
            "order": "uploaded_at.asc",
            "limit": str(limit),
        },
        use_service_role=True,
    )
    if status < 400 and rows:
        return [r.get("display_url") or r.get("image_url") or r.get("url") for r in rows if r]
    return []


def _fmt_price(value):
    if not value and value != 0:
        return "Price on request"
    try:
        return f"AED {int(value):,}"
    except (ValueError, TypeError):
        return f"AED {value}"


def _build_email_listing_card_html(listing_type, listing, image_url=None, listing_url=None,
                                   cta_label="View Listing", cta_color="#8bd6b4"):
    """Build a self-contained HTML table card for use inside email bodies.
    Works in Gmail, Apple Mail, and Outlook (table-based layout, inline CSS only)."""
    lt = str(listing_type or "car").lower().rstrip("s")  # normalise to singular

    # ── Title ──
    title = xml_escape(
        listing.get("listing_title") or
        listing.get("title") or
        listing.get("name") or
        _build_listing_title(f"{lt}s", listing)
    )

    # ── Price ──
    price_val = (
        listing.get("expected_selling_price") or
        listing.get("price") or
        listing.get("asking_price")
    )
    price = xml_escape(_fmt_price(price_val))

    # ── Subtitle / key details ──
    detail_parts = []
    if lt == "car":
        if listing.get("make_year"):    detail_parts.append(str(listing["make_year"]))
        if listing.get("body_type"):    detail_parts.append(str(listing["body_type"]))
        if listing.get("kilometer_driven"):
            detail_parts.append(f"{int(listing['kilometer_driven']):,} km")
        if listing.get("transmission_type"): detail_parts.append(str(listing["transmission_type"]))
    elif lt == "bike":
        if listing.get("make_year"):    detail_parts.append(str(listing["make_year"]))
        if listing.get("bike_type"):    detail_parts.append(str(listing["bike_type"]))
        if listing.get("mileage"):      detail_parts.append(f"{int(listing['mileage']):,} km")
    elif lt == "part":
        if listing.get("part_type"):    detail_parts.append(str(listing["part_type"]))
        if listing.get("condition"):    detail_parts.append(str(listing["condition"]))
    elif lt == "plate":
        if listing.get("city"):         detail_parts.append(str(listing["city"]))
        if listing.get("digits"):       detail_parts.append(f"{listing['digits']}-digit")
        if listing.get("code"):         detail_parts.append(str(listing["code"]))

    subtitle = xml_escape(" · ".join(str(p) for p in detail_parts if p))

    # ── Image HTML ──
    if image_url:
        img_html = f'''<a href="{listing_url or '#'}" style="display:block;text-decoration:none;">
          <img src="{image_url}" alt="{title}"
               width="560" style="width:100%;max-width:560px;height:200px;object-fit:cover;
                                  display:block;border-radius:12px 12px 0 0;border:0;" />
        </a>'''
    else:
        img_html = f'''<div style="width:100%;height:120px;background:#0d2318;
                               border-radius:12px 12px 0 0;display:flex;align-items:center;
                               justify-content:center;">
          <span style="color:#3d6b52;font-size:14px;">No image available</span>
        </div>'''

    # ── CTA button ──
    cta_html = ""
    if listing_url and cta_label:
        cta_html = f'''<tr>
          <td style="padding:0 20px 20px;">
            <a href="{listing_url}"
               style="display:inline-block;background:{cta_color};color:#041008;
                      font-weight:700;font-size:14px;padding:11px 24px;
                      border-radius:10px;text-decoration:none;white-space:nowrap;">
              {xml_escape(cta_label)}
            </a>
          </td>
        </tr>'''

    return f'''<!--[if mso]><table><tr><td width="560"><![endif]-->
<table width="560" cellpadding="0" cellspacing="0"
       style="max-width:560px;width:100%;background:#0a1f14;
              border-radius:12px;border:1px solid #1a3328;
              margin:0 auto 24px auto;border-collapse:separate;">
  <tr><td style="padding:0;">{img_html}</td></tr>
  <tr>
    <td style="padding:16px 20px 4px;">
      <p style="margin:0;font-size:17px;font-weight:700;color:#f0fdf4;
                line-height:1.3;">{title}</p>
    </td>
  </tr>
  {f'<tr><td style="padding:2px 20px 8px;"><p style="margin:0;font-size:13px;color:#6dac8e;">{subtitle}</p></td></tr>' if subtitle else ""}
  <tr>
    <td style="padding:4px 20px 14px;">
      <p style="margin:0;font-size:18px;font-weight:800;color:#8bd6b4;">{price}</p>
    </td>
  </tr>
  {cta_html}
</table>
<!--[if mso]></td></tr></table><![endif]-->'''


def _email_outer_wrapper(subject, body_html, footer_text=""):
    """Wrap card HTML in a full email-safe outer shell."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{xml_escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#041008;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
         style="background-color:#041008;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="padding-bottom:24px;text-align:center;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:2px;
                    color:#3d6b52;text-transform:uppercase;">DPH Classifieds</p>
        </td></tr>

        <!-- Body -->
        <tr><td>
          {body_html}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:32px;border-top:1px solid #1a3328;margin-top:8px;">
          <p style="margin:0;font-size:12px;color:#3d6b52;text-align:center;line-height:1.6;">
            {footer_text or "You&rsquo;re receiving this from DPH Classifieds."}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _fetch_search_preview_listings(search, limit=3):
    """Fetch top N active listings matching a saved search for email preview cards."""
    category   = str(search.get("category") or "all").lower()
    query_text = str(search.get("query_text") or "").strip()
    filters    = search.get("filters") or {}

    TABLE_MAP = {
        "cars":   [("cars",           "car")],
        "bikes":  [("bikes",          "bike")],
        "parts":  [("car_parts",      "part")],
        "plates": [("license_plates", "plate")],
        "all":    [("cars",           "car"), ("bikes", "bike")],
    }
    tables = TABLE_MAP.get(category, TABLE_MAP["cars"])

    results = []
    for table, lt in tables:
        if len(results) >= limit:
            break
        params = {
            "status": "in.(approved,active)",
            "deleted_at": "is.null",
            "is_archived": "eq.false",
            "select": "*",
            "order": "created_at.desc",
            "limit": str(limit),
        }
        if query_text:
            title_col = "listing_title" if table == "cars" else "name" if table == "car_parts" else "title"
            params[title_col] = f"ilike.*{query_text}*"
        if filters.get("make"):
            params["car_manufacturer" if table == "cars" else "make"] = f"ilike.{filters['make']}"
        rows, status = supabase_request("get", f"/rest/v1/{table}", params=params, use_service_role=True)
        if status < 400 and rows:
            for r in rows[:limit - len(results)]:
                results.append((lt, r))
    return results


def _send_saved_search_alert_email(user_email, search, result_count, subject_override=None):
    if not user_email or user_email == "unknown@example.com":
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    search     = search or {}
    category   = search.get("category") or "listings"
    name       = search.get("name") or f"{category} search"
    route_path = search.get("route_path") or "/explore"
    query_text = search.get("query_text") or ""
    s_plural   = "s" if result_count != 1 else ""
    subject    = subject_override or _rotate_subject(
        _SAVED_SEARCH_ALERT_SUBJECTS,
        count=result_count, s=s_plural, category=category,
    )
    search_url = f"{SITE_URL.rstrip('/')}{route_path}"

    # Fetch up to 2 preview listings to show as cards
    preview_listings = _fetch_search_preview_listings(search, limit=3)
    cards_html = ""
    for lt, listing in preview_listings:
        lid = listing.get("id")
        img_url     = _fetch_listing_primary_image_url(lt, lid)
        listing_url = _build_listing_url(f"{lt}s", lid)
        cards_html += _build_email_listing_card_html(lt, listing, img_url, listing_url, "View Car")

    shown_count   = len(preview_listings)
    remaining     = result_count - shown_count
    more_label    = (
        f"View {remaining} more result{'' if remaining == 1 else 's'} &rarr;"
        if remaining > 0
        else f"View all {result_count} result{s_plural} &rarr;"
    )

    body = f"""
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding-bottom:20px;">
    <h2 style="margin:0;font-size:22px;font-weight:700;color:#f0fdf4;line-height:1.3;">
      {xml_escape(str(result_count))} result{xml_escape(s_plural)} for your saved search
    </h2>
    <p style="margin:8px 0 0;color:#6dac8e;font-size:14px;">
      {xml_escape(name)}{f" &mdash; &ldquo;{xml_escape(query_text)}&rdquo;" if query_text else ""}
    </p>
  </td></tr>
</table>
{cards_html}
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:8px 0 20px;">
    <a href="{search_url}"
       style="display:inline-block;background:#8bd6b4;color:#041008;font-weight:700;
              font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none;">
      {more_label}
    </a>
  </td></tr>
</table>
"""
    footer = (
        "You&rsquo;re receiving this because you saved a search on DPH Classifieds. "
        "To stop these alerts, disable Email Notifications in your account settings."
    )
    html_content = _email_outer_wrapper(subject, body, footer)
    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to
    return _send_resend_email(payload, email_type="saved_search_alert")


def _send_listing_draft_reminder_email(user_email, draft_type, draft_row, subject_override=None):
    if not user_email or user_email == "unknown@example.com":
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    draft_payload = _draft_payload_from_row(draft_row)
    listing_title = _draft_display_title(draft_type, draft_payload)
    # For listing-table drafts link to the edit form; for wizard drafts link to My Listings
    listing_id = draft_payload.get("id") if isinstance(draft_payload, dict) else None
    _edit_paths = {"car": "car", "bike": "bike", "part": "part", "plate": "plate"}
    if listing_id and draft_type in _edit_paths:
        cta_url   = f"{SITE_URL.rstrip('/')}/edit/{_edit_paths[draft_type]}/{listing_id}"
        cta_label = "Edit & Post"
    else:
        cta_url   = f"{SITE_URL.rstrip('/')}/my-listings"
        cta_label = "Resume Draft"
    subject = subject_override or f"Finish your {draft_type or 'listing'} draft on DPH Classifieds"

    # Fetch the listing's primary image if we have an ID
    img_url = None
    if listing_id and draft_type in _edit_paths:
        img_url = _fetch_listing_primary_image_url(draft_type, listing_id)

    card_html = _build_email_listing_card_html(
        draft_type, draft_payload, img_url, cta_url, cta_label, cta_color="#8bd6b4",
    )

    body = f"""
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding-bottom:20px;">
    <h2 style="margin:0;font-size:22px;font-weight:700;color:#f0fdf4;">Your draft is waiting</h2>
    <p style="margin:8px 0 0;color:#a0b8ae;font-size:14px;line-height:1.5;">
      Your listing is saved as a draft. Finish and post it when you&rsquo;re ready
      &mdash; it won&rsquo;t appear in search results until you submit it.
    </p>
  </td></tr>
</table>
{card_html}
"""
    footer = (
        "You&rsquo;re receiving this because you have a draft listing on DPH Classifieds. "
        "To stop these reminders, disable Email Notifications in your account settings."
    )
    html_content = _email_outer_wrapper(subject, body, footer)
    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to
    return _send_resend_email(payload, email_type="draft_reminder")


def _claim_email_row(table_name, row_id, sent_field, claim_field):
    now_iso = _isoformat_utc(_utc_now())
    response, status_code = supabase_request(
        "patch",
        f"/rest/v1/{table_name}?id=eq.{row_id}&{sent_field}=is.null",
        data={claim_field: now_iso},
        use_service_role=True,
    )
    if status_code >= 400:
        return False, response
    return bool(response), None


def _mark_email_row_result(table_name, row_id, sent_field, error_field, error=None):
    payload = {error_field: str(error)[:500] if error else None}
    if not error:
        payload[sent_field] = _isoformat_utc(_utc_now())
    supabase_request(
        "patch",
        f"/rest/v1/{table_name}?id=eq.{row_id}",
        data=payload,
        use_service_role=True,
    )


def _send_draft_listing_reminder(user_id, listing_type, listing, table, now_iso):
    """Send a draft reminder for a listing-table row (cars/bikes/parts/plates with status=draft).
    Returns True on success, False on failure. Handles claim release internally."""
    row_id = listing.get("id")
    email  = get_user_email(user_id)
    # Normalise alternative title column names into listing_title so _draft_display_title picks it up
    normalised = dict(listing)
    for alt_col in ("title", "name", "number", "code"):
        if alt_col in normalised and "listing_title" not in normalised:
            normalised["listing_title"] = normalised[alt_col]
    # Build a synthetic draft_row so _send_listing_draft_reminder_email can build the title
    draft_row = {
        "draft_key": listing_type,
        "payload": normalised,
        "draft_payload": normalised,
    }
    subject = _rotate_subject(_DRAFT_REMINDER_SUBJECTS)
    _, send_error = _send_listing_draft_reminder_email(
        email, listing_type, draft_row, subject_override=subject,
    )
    if send_error:
        supabase_request("patch", f"/rest/v1/{table}?id=eq.{row_id}",
                         data={"draft_reminder_claimed_at": None}, use_service_role=True)
        logger.warning("Draft listing reminder error user=%s id=%s: %s", user_id, row_id, send_error)
        return False
    supabase_request(
        "patch", f"/rest/v1/{table}?id=eq.{row_id}",
        data={
            "draft_reminder_sent_at": now_iso,
            "draft_reminder_claimed_at": None,
            "draft_reminder_count": int(listing.get("draft_reminder_count") or 0) + 1,
        },
        use_service_role=True,
    )
    # Mirror the reminder to a push notification (best-effort, non-fatal).
    # Drafts aren't public, so deep-link to the Sell tab to finish/publish
    # rather than a detail screen.
    _notify_user_push(
        user_id,
        "Finish your listing ✍️",
        f"Your {listing_type} listing is still a draft — tap to finish and publish it.",
        data={"path": "/(tabs)/(post)"},
    )
    logger.info("Draft listing reminder sent user=%s type=%s id=%s subject=%r",
                user_id, listing_type, row_id, subject)
    return True


def _run_listing_draft_reminders_once(first_age_hours=24, repeat_age_hours=48, age_hours=None, limit=100):
    """Send draft reminders: first at 24h, then every 48h.

    Covers two sources:
      1. listing_drafts — in-progress wizard saves (Save Draft button before first submit)
      2. cars/bikes/car_parts/license_plates with status='draft' — previously submitted
         listings that were moved back to draft via Move to Drafts.

    age_hours: legacy override — sets both cutoffs (used in tests with age_hours=0).
    """
    # Only send during the evening window in production; tests pass age_hours to bypass.
    if age_hours is None and not _reminder_window_open():
        return {"processed": 0, "sent": 0, "skipped": "outside_send_window"}
    if age_hours is not None:
        first_age_hours = age_hours
        repeat_age_hours = age_hours
    first_cutoff  = (_utc_now() - datetime.timedelta(hours=first_age_hours)).isoformat()
    repeat_cutoff = (_utc_now() - datetime.timedelta(hours=repeat_age_hours)).isoformat()
    cutoff = first_cutoff  # kept for fallback paths
    sent    = 0
    skipped = 0
    total   = 0

    # ── Source 1: listing_drafts wizard saves ──────────────────────────────
    rows, status_code = supabase_request(
        "get",
        "/rest/v1/listing_drafts",
        params={
            "select": "*",
            "or": f"(and(last_reminder_sent_at.is.null,updated_at.lt.{first_cutoff}),last_reminder_sent_at.lt.{repeat_cutoff})",
            "reminder_email_claimed_at": "is.null",
            "order": "updated_at.asc",
            "limit": str(limit),
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if _looks_like_missing_column(rows, "last_reminder_sent_at"):
            rows, status_code = supabase_request(
                "get",
                "/rest/v1/listing_drafts",
                params={
                    "select": "*",
                    "updated_at": f"lte.{cutoff}",
                    "reminder_email_sent_at": "is.null",
                    "order": "updated_at.asc",
                    "limit": str(limit),
                },
                use_service_role=True,
            )
        if status_code >= 400 and not _looks_like_missing_table(rows):
            logger.warning("Draft wizard reminder query failed: %s", rows)

    for draft in rows or []:
        row_id  = draft.get("id")
        user_id = draft.get("user_id")
        if not row_id or not user_id:
            skipped += 1
            continue
        total += 1
        claimed, claim_error = _claim_email_row(
            "listing_drafts", row_id, "reminder_email_sent_at", "reminder_email_claimed_at",
        )
        if not claimed:
            skipped += 1
            continue
        email   = get_user_email(user_id)
        subject = _rotate_subject(_DRAFT_REMINDER_SUBJECTS)
        _, send_error = _send_listing_draft_reminder_email(
            email, _draft_type_from_row(draft), draft, subject_override=subject,
        )
        now_iso = _isoformat_utc(_utc_now())
        if send_error:
            skipped += 1
            _mark_email_row_result(
                "listing_drafts", row_id, "reminder_email_sent_at", "reminder_email_last_error", send_error,
            )
            supabase_request("patch", f"/rest/v1/listing_drafts?id=eq.{row_id}",
                             data={"reminder_email_claimed_at": None}, use_service_role=True)
            continue
        sent += 1
        supabase_request(
            "patch", f"/rest/v1/listing_drafts?id=eq.{row_id}",
            data={
                "reminder_email_sent_at": now_iso,
                "reminder_email_last_error": None,
                "last_reminder_sent_at": now_iso,
                "reminder_count": int(draft.get("reminder_count") or 0) + 1,
                "reminder_email_claimed_at": None,
            },
            use_service_role=True,
        )
        # Mirror the reminder to a push notification (best-effort, non-fatal).
        _notify_user_push(
            user_id,
            "Finish your listing ✍️",
            f"Your {_draft_type_from_row(draft)} draft is waiting — tap to finish and publish it.",
            data={"path": "/(tabs)/(post)"},
        )
        logger.info("Draft wizard reminder sent user=%s draft=%s subject=%r", user_id, row_id, subject)

    # ── Source 2: listing tables with status='draft' ───────────────────────
    # title_col: the column that holds the display title in each listing table
    DRAFT_TABLE_CONFIG = [
        ("cars",           "car",   "listing_title"),
        ("bikes",          "bike",  "title"),
        ("car_parts",      "part",  "name"),
        ("license_plates", "plate", "number"),
    ]
    for table, listing_type, title_col in DRAFT_TABLE_CONFIG:
        # Try with draft_reminder columns (post-migration)
        lt_rows, lt_status = supabase_request(
            "get",
            f"/rest/v1/{table}",
            params={
                "status": "eq.draft",
                "deleted_at": "is.null",
                "draft_reminder_claimed_at": "is.null",
                "or": f"(and(draft_reminder_sent_at.is.null,updated_at.lt.{first_cutoff}),draft_reminder_sent_at.lt.{repeat_cutoff})",
                "select": f"id,user_id,{title_col},draft_reminder_sent_at,draft_reminder_count,updated_at",
                "order": "updated_at.asc",
                "limit": str(limit),
            },
            use_service_role=True,
        )
        if lt_status >= 400:
            if _looks_like_missing_column(lt_rows, "draft_reminder_sent_at", "draft_reminder_claimed_at"):
                # Migration not yet applied — fall back: query without reminder columns
                lt_rows, lt_status = supabase_request(
                    "get",
                    f"/rest/v1/{table}",
                    params={
                        "status": "eq.draft",
                        "deleted_at": "is.null",
                        "select": f"id,user_id,{title_col}",
                        "order": "updated_at.asc",
                        "limit": str(limit),
                    },
                    use_service_role=True,
                )
            if lt_status >= 400:
                logger.warning("Draft listing reminder query failed for %s: %s", table, lt_rows)
                continue

        for listing in lt_rows or []:
            row_id  = listing.get("id")
            user_id = listing.get("user_id")
            if not row_id or not user_id:
                skipped += 1
                continue
            total += 1
            now_iso = _isoformat_utc(_utc_now())
            # Atomic claim (only if migration applied, otherwise just send)
            if listing.get("draft_reminder_sent_at") is not None or "draft_reminder_claimed_at" in listing:
                claim_resp, claim_st = supabase_request(
                    "patch",
                    f"/rest/v1/{table}?id=eq.{row_id}&draft_reminder_claimed_at=is.null",
                    data={"draft_reminder_claimed_at": now_iso},
                    use_service_role=True,
                )
                if claim_st >= 400 or not claim_resp:
                    skipped += 1
                    continue
            if _send_draft_listing_reminder(user_id, listing_type, listing, table, now_iso):
                sent += 1
            else:
                skipped += 1

    return {"processed": total, "sent": sent, "skipped": skipped}


def _send_saved_car_reminder_email(user_email, listing, subject_override=None):
    if not user_email or user_email == "unknown@example.com":
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    listing     = listing or {}
    listing_id  = listing.get("id")
    title       = _build_listing_title("cars", listing)
    listing_url = _build_listing_url("cars", listing_id) or f"{SITE_URL.rstrip('/')}/saved"
    subject     = subject_override or f"Still interested in {title}?"

    # Fetch the primary image for the card
    img_url = _fetch_listing_primary_image_url("car", listing_id)

    card_html = _build_email_listing_card_html("car", listing, img_url, listing_url, "View Listing")

    body = f"""
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding-bottom:20px;">
    <h2 style="margin:0;font-size:22px;font-weight:700;color:#f0fdf4;">Your saved car is still here</h2>
    <p style="margin:8px 0 0;color:#a0b8ae;font-size:14px;line-height:1.5;">
      Check availability or contact the seller before it&rsquo;s gone.
    </p>
  </td></tr>
</table>
{card_html}
"""
    footer = (
        "You saved this listing on DPH Classifieds. "
        "To stop reminders, disable Email Notifications in your account settings."
    )
    html_content = _email_outer_wrapper(subject, body, footer)
    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to
    return _send_resend_email(payload, email_type="saved_car_reminder")


def _run_saved_car_reminders_once(first_age_hours=24, repeat_age_hours=48, age_hours=None, limit=100):
    """Send saved car reminders: first at 24h, then every 48h. Falls back gracefully if migration not applied."""
    if age_hours is None and not _reminder_window_open():
        return {"processed": 0, "sent": 0, "skipped": "outside_send_window"}
    if age_hours is not None:
        first_age_hours = age_hours
        repeat_age_hours = age_hours
    first_cutoff  = (_utc_now() - datetime.timedelta(hours=first_age_hours)).isoformat()
    repeat_cutoff = (_utc_now() - datetime.timedelta(hours=repeat_age_hours)).isoformat()
    rows, status_code = supabase_request(
        "get",
        "/rest/v1/saved_listings",
        params={
            "listing_type": "eq.car",
            "or": f"(and(reminder_sent_at.is.null,created_at.lt.{first_cutoff}),reminder_sent_at.lt.{repeat_cutoff})",
            "reminder_claimed_at": "is.null",
            "select": "*",
            "order": "created_at.asc",
            "limit": str(limit),
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if _looks_like_missing_column(rows, "reminder_sent_at"):
            # Migration not applied — fall back to one-shot
            rows, status_code = supabase_request(
                "get",
                "/rest/v1/saved_listings",
                params={
                    "listing_type": "eq.car",
                    "created_at": f"lte.{first_cutoff}",
                    "saved_email_sent_at": "is.null",
                    "select": "*",
                    "order": "created_at.asc",
                    "limit": str(limit),
                },
                use_service_role=True,
            )
            if status_code >= 400:
                return {"processed": 0, "sent": 0, "skipped": 0, "error": rows}
        elif _looks_like_missing_table(rows):
            return {"processed": 0, "sent": 0, "skipped": 0, "error": "saved car reminders not migrated"}
        else:
            return {"processed": 0, "sent": 0, "skipped": 0, "error": rows}

    sent = 0
    skipped = 0
    for saved in rows or []:
        row_id     = saved.get("id")
        user_id    = saved.get("user_id")
        listing_id = saved.get("listing_id")
        if not row_id or not user_id or not listing_id:
            skipped += 1
            continue
        now_iso = _isoformat_utc(_utc_now())
        # Atomic claim on reminder_claimed_at (only when migration applied)
        migration_cols_present = "reminder_claimed_at" in saved or "reminder_sent_at" in saved
        claimed_ok = True
        if migration_cols_present:
            claim_resp, claim_status = supabase_request(
                "patch",
                f"/rest/v1/saved_listings?id=eq.{row_id}&reminder_claimed_at=is.null",
                data={"reminder_claimed_at": now_iso},
                use_service_role=True,
            )
            if claim_status >= 400 or not claim_resp:
                skipped += 1
                continue

        listing_rows, listing_status = supabase_request(
            "get", "/rest/v1/cars",
            params={"select": "*", "id": f"eq.{listing_id}", "limit": 1},
            use_service_role=True,
        )
        listing = listing_rows[0] if listing_status < 400 and listing_rows else None
        # Skip deleted or inactive cars
        if not listing or listing.get("deleted_at") or listing.get("status") not in ("approved", "active"):
            if migration_cols_present:
                supabase_request("patch", f"/rest/v1/saved_listings?id=eq.{row_id}",
                                 data={"reminder_claimed_at": None}, use_service_role=True)
            skipped += 1
            continue

        email   = get_user_email(user_id)
        title   = _build_listing_title("cars", listing)
        subject = _rotate_subject(_SAVED_CAR_REMINDER_SUBJECTS, title=title)
        _, send_error = _send_saved_car_reminder_email(email, listing, subject_override=subject)

        if send_error:
            skipped += 1
            if migration_cols_present:
                supabase_request(
                    "patch", f"/rest/v1/saved_listings?id=eq.{row_id}",
                    data={"reminder_claimed_at": None, "reminder_last_error": str(send_error)[:500]},
                    use_service_role=True,
                )
            continue
        sent += 1
        # Mirror the reminder to a push notification (best-effort, non-fatal).
        _notify_user_push(
            user_id,
            "Still interested? 👀",
            f"{title} is still available — take another look.",
            data={"listing_type": "car", "listing_id": str(listing_id)},
        )
        mark_data = {"saved_email_sent_at": saved.get("saved_email_sent_at") or now_iso}
        if migration_cols_present:
            mark_data.update({
                "reminder_sent_at": now_iso,
                "reminder_last_error": None,
                "reminder_count": int(saved.get("reminder_count") or 0) + 1,
                "reminder_claimed_at": None,
            })
        supabase_request("patch", f"/rest/v1/saved_listings?id=eq.{row_id}",
                         data=mark_data, use_service_role=True)
        logger.info("Saved car reminder sent user=%s save=%s subject=%r", user_id, row_id, subject)

    return {"processed": len(rows or []), "sent": sent, "skipped": skipped}


def _maybe_record_price_drop(listing_type, listing_id, new_price):
    """If new_price < current DB price, insert a price_drops record for the worker to process."""
    if not new_price or int(new_price) <= 0:
        return
    price_col = "expected_selling_price" if listing_type == "cars" else "price"
    rows, status = supabase_request(
        "get", f"/rest/v1/{listing_type}",
        params={"id": f"eq.{listing_id}", "select": price_col},
        use_service_role=True,
    )
    if status >= 400 or not rows:
        return
    current_price = rows[0].get(price_col) if rows else None
    if not current_price or int(new_price) >= int(current_price):
        return
    supabase_request(
        "post", "/rest/v1/price_drops",
        data={
            "listing_type": listing_type,
            "listing_id": str(listing_id),
            "old_price": int(current_price),
            "new_price": int(new_price),
        },
        use_service_role=True,
    )


def _record_price_point(listing_type, listing_id, new_price, source="seller"):
    """Append a point to listing_price_history when the price is new or changed
    vs the last recorded value. Powers the per-listing price-history endpoint.
    Best-effort: a missing table (migration not yet applied) is ignored."""
    if new_price is None or not listing_id:
        return
    try:
        if float(new_price) <= 0:
            return
    except (TypeError, ValueError):
        return
    body, st = supabase_request(
        "get", "/rest/v1/listing_price_history",
        params={"select": "price", "listing_id": f"eq.{listing_id}",
                "order": "recorded_at.desc", "limit": "1"},
        use_service_role=True,
    )
    if st < 400 and isinstance(body, list) and body:
        try:
            if float(body[0].get("price")) == float(new_price):
                return  # unchanged since the last record
        except (TypeError, ValueError):
            pass
    supabase_request(
        "post", "/rest/v1/listing_price_history",
        data={"listing_type": listing_type, "listing_id": str(listing_id),
              "price": new_price, "source": source},
        use_service_role=True,
    )



def _saved_searches_for_price_drop(listing_type, listing, new_price):
    """Return saved search rows whose filters match this price-dropped listing."""
    cat_map = {"cars": "cars", "bikes": "bikes", "car_parts": "parts", "license_plates": "plates"}
    category = cat_map.get(listing_type)
    if not category:
        return []
    rows, status = supabase_request(
        "get", "/rest/v1/saved_searches",
        params={
            "select": "id,user_id,filters,name",
            "or": f"(category.eq.{category},category.eq.all)",
            "limit": "2000",
        },
        use_service_role=True,
    )
    if status >= 400 or not rows:
        return []

    if listing_type == "cars":
        listing_make  = (listing.get("car_manufacturer") or "").lower()
        listing_model = (listing.get("car_model") or "").lower()
        listing_year  = listing.get("make_year")
    else:
        listing_make  = (listing.get("make") or "").lower()
        listing_model = (listing.get("model") or "").lower()
        listing_year  = listing.get("year")

    matches = []
    for row in rows:
        f = row.get("filters") or {}
        if f.get("make")  and listing_make  and f["make"].lower()  != listing_make:
            continue
        if f.get("model") and listing_model and f["model"].lower() != listing_model:
            continue
        if f.get("year_min") and listing_year and int(listing_year) < int(f["year_min"]):
            continue
        if f.get("year_max") and listing_year and int(listing_year) > int(f["year_max"]):
            continue
        price_max = f.get("price_max")
        if price_max and int(new_price) > int(price_max):
            continue
        matches.append(row)
    return matches


def _send_price_drop_alert_email(user_email, listing_type, listing, old_price, new_price):
    if not user_email or user_email == "unknown@example.com":
        return None, "Missing recipient email"
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    drop_pct = round((old_price - new_price) / old_price * 100) if old_price else 0
    if listing_type == "cars":
        title = f"{listing.get('car_manufacturer', '')} {listing.get('car_model', '')} {listing.get('make_year', '')}".strip()
    elif listing_type == "bikes":
        title = f"{listing.get('make', '')} {listing.get('model', '')} {listing.get('year', '')}".strip()
    elif listing_type == "car_parts":
        title = listing.get("name") or "Car Part"
    else:
        title = listing.get("plate_number") or "Plate"
    if not title:
        title = "A listing you're watching"

    listing_id  = listing.get("id")
    table_slug  = {"cars": "cars", "bikes": "bikes", "car_parts": "parts", "license_plates": "plates"}.get(listing_type, listing_type)
    img_url     = _fetch_listing_primary_image_url(listing_type.rstrip("s"), listing_id)
    listing_url = _build_listing_url(table_slug, listing_id)
    card_html   = _build_email_listing_card_html(listing_type.rstrip("s"), listing, img_url, listing_url, "View Listing")

    subject = f"Price drop: {xml_escape(title)} — AED {int(new_price):,} (was {int(old_price):,})"
    body = f"""
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding-bottom:20px;">
    <h2 style="margin:0;font-size:22px;font-weight:700;color:#f0fdf4;line-height:1.3;">
      Price dropped {xml_escape(str(drop_pct))}% on a listing you&rsquo;re watching
    </h2>
    <p style="margin:8px 0 0;font-size:16px;">
      <span style="color:#6dac8e;text-decoration:line-through;">AED {xml_escape(f'{int(old_price):,}')}</span>
      &nbsp;&rarr;&nbsp;
      <span style="color:#8bd6b4;font-weight:700;">AED {xml_escape(f'{int(new_price):,}')}</span>
    </p>
  </td></tr>
</table>
{card_html}
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:8px 0 20px;">
    <a href="{listing_url}"
       style="display:inline-block;background:#8bd6b4;color:#041008;font-weight:700;
              font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none;">
      View Listing &rarr;
    </a>
  </td></tr>
</table>
"""
    footer = (
        "You&rsquo;re receiving this because you have a matching saved search on DPH Classifieds. "
        "To stop these alerts, remove the saved search or disable Email Notifications in account settings."
    )
    html_content = _email_outer_wrapper(subject, body, footer)
    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to
    return _send_resend_email(payload, email_type="price_drop_alert")


def _mark_price_drop_processed(drop_id, notified_count):
    supabase_request(
        "patch", f"/rest/v1/price_drops?id=eq.{drop_id}",
        data={"processed_at": _isoformat_utc(_utc_now()), "notified_count": notified_count},
        use_service_role=True,
    )


def _run_price_drop_alerts_once(limit=50):
    """Process queued price drop events: match to saved searches, notify matching users."""
    rows, status = supabase_request(
        "get", "/rest/v1/price_drops",
        params={
            "processed_at": "is.null",
            "select": "*",
            "order": "created_at.asc",
            "limit": str(limit),
        },
        use_service_role=True,
    )
    if status >= 400 or not rows:
        return {"processed": 0, "sent": 0}

    total_sent = 0
    for drop in rows:
        listing_type = drop["listing_type"]
        listing_id   = drop["listing_id"]
        old_price    = drop["old_price"]
        new_price    = drop["new_price"]

        price_col = "expected_selling_price" if listing_type == "cars" else "price"
        if listing_type == "cars":
            fields = f"id,status,{price_col},car_manufacturer,car_model,make_year,listing_title,car_location"
        elif listing_type == "bikes":
            fields = f"id,status,{price_col},make,model,year,title"
        elif listing_type == "car_parts":
            fields = f"id,status,{price_col},make,model,name"
        else:
            fields = f"id,status,{price_col},plate_number"

        listings, lst_status = supabase_request(
            "get", f"/rest/v1/{listing_type}",
            params={"id": f"eq.{listing_id}", "select": fields},
            use_service_role=True,
        )
        if lst_status >= 400 or not listings:
            _mark_price_drop_processed(drop["id"], 0)
            continue

        listing = listings[0]
        if listing.get("status") not in ("approved", "active"):
            _mark_price_drop_processed(drop["id"], 0)
            continue

        matches  = _saved_searches_for_price_drop(listing_type, listing, new_price)
        notified = 0
        seen     = set()
        for search in matches:
            user_id = search.get("user_id")
            if not user_id or user_id in seen:
                continue
            seen.add(user_id)

            email = get_user_email(user_id)
            _, err = _send_price_drop_alert_email(email, listing_type, listing, old_price, new_price)
            if not err:
                if listing_type == "cars":
                    push_label = f"{listing.get('car_manufacturer', '')} {listing.get('car_model', '')}".strip() or "A listing"
                else:
                    push_label = listing.get("title") or listing.get("name") or "A listing"
                _notify_user_push(
                    user_id,
                    "Price Drop",
                    f"{push_label} just dropped to AED {int(new_price):,}",
                    data={"type": "price_drop", "listing_type": listing_type, "listing_id": listing_id},
                )
                notified += 1
                logger.info("Price drop alert sent user=%s listing=%s %d->%d", user_id, listing_id, old_price, new_price)

        _mark_price_drop_processed(drop["id"], notified)
        total_sent += notified

    return {"processed": len(rows), "sent": total_sent}


def _run_saved_search_alerts_once(first_age_hours=24, repeat_age_hours=48, age_hours=None, limit=100):
    """Alert users about their saved searches: first at 24h, then every 48h when there are matching results."""
    if age_hours is None and not _reminder_window_open():
        return {"processed": 0, "sent": 0, "skipped": "outside_send_window"}
    if age_hours is not None:
        first_age_hours = age_hours
        repeat_age_hours = age_hours
    first_cutoff  = (_utc_now() - datetime.timedelta(hours=first_age_hours)).isoformat()
    repeat_cutoff = (_utc_now() - datetime.timedelta(hours=repeat_age_hours)).isoformat()
    rows, status_code = supabase_request(
        "get",
        "/rest/v1/saved_searches",
        params={
            "or": f"(and(alert_sent_at.is.null,created_at.lt.{first_cutoff}),alert_sent_at.lt.{repeat_cutoff})",
            "alert_claimed_at": "is.null",
            "select": "id,user_id,name,category,route_path,query_text,filters,alert_count,alert_sent_at,created_at",
            "order": "updated_at.asc",
            "limit": str(limit),
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if _looks_like_missing_column(rows, "alert_sent_at", "alert_claimed_at", "alert_count"):
            # Migration not applied — fall back: query all saved searches (no cooldown guard)
            rows, status_code = supabase_request(
                "get",
                "/rest/v1/saved_searches",
                params={
                    "select": "id,user_id,name,category,route_path,query_text,filters,result_count",
                    "order": "updated_at.asc",
                    "limit": str(limit),
                },
                use_service_role=True,
            )
            if status_code >= 400:
                return {"processed": 0, "sent": 0, "skipped": 0, "error": rows}
        else:
            return {"processed": 0, "sent": 0, "skipped": 0, "error": rows}

    sent = 0
    skipped = 0
    for search in rows or []:
        row_id  = search.get("id")
        user_id = search.get("user_id")
        if not row_id or not user_id:
            skipped += 1
            continue
        now_iso = _isoformat_utc(_utc_now())
        # Atomic claim — only if migration columns exist (present in search dict)
        migration_applied = "alert_claimed_at" in search or "alert_sent_at" in search
        if migration_applied:
            claim_resp, claim_status = supabase_request(
                "patch",
                f"/rest/v1/saved_searches?id=eq.{row_id}&alert_claimed_at=is.null",
                data={"alert_claimed_at": now_iso},
                use_service_role=True,
            )
            if claim_status >= 400 or not claim_resp:
                skipped += 1
                continue

        try:
            result_count = _count_listings_for_saved_search(search)
        except Exception as count_err:
            logger.exception("search alert count failed search=%s: %s", row_id, count_err)
            if migration_applied:
                supabase_request("patch", f"/rest/v1/saved_searches?id=eq.{row_id}",
                                 data={"alert_claimed_at": None}, use_service_role=True)
            skipped += 1
            continue

        if result_count == 0:
            if migration_applied:
                supabase_request(
                    "patch", f"/rest/v1/saved_searches?id=eq.{row_id}",
                    data={"alert_claimed_at": None, "alert_last_result_count": 0},
                    use_service_role=True,
                )
            skipped += 1
            continue

        email    = get_user_email(user_id)
        s_plural = "s" if result_count != 1 else ""
        subject  = _rotate_subject(
            _SAVED_SEARCH_ALERT_SUBJECTS,
            count=result_count, s=s_plural, category=search.get("category") or "listings",
        )
        _, send_error = _send_saved_search_alert_email(email, search, result_count, subject_override=subject)

        if send_error:
            skipped += 1
            if migration_applied:
                supabase_request(
                    "patch", f"/rest/v1/saved_searches?id=eq.{row_id}",
                    data={"alert_claimed_at": None, "alert_last_error": str(send_error)[:500]},
                    use_service_role=True,
                )
            continue
        sent += 1
        # Mirror the alert to a push notification (best-effort, non-fatal) so
        # saved-search alerts reach iOS + Android like draft/saved-car reminders.
        _notify_user_push(
            user_id,
            "New matches for your search 🔔",
            f"{result_count} new listing{s_plural} match your saved search.",
            data={"path": search.get("route_path") or "/(tabs)/(explore)"},
        )
        if migration_applied:
            supabase_request(
                "patch", f"/rest/v1/saved_searches?id=eq.{row_id}",
                data={
                    "alert_sent_at": now_iso,
                    "alert_last_error": None,
                    "alert_count": int(search.get("alert_count") or 0) + 1,
                    "alert_last_result_count": result_count,
                    "alert_claimed_at": None,
                },
                use_service_role=True,
            )
        logger.info("Search alert sent user=%s search=%s count=%d subject=%r",
                    user_id, row_id, result_count, subject)

    return {"processed": len(rows or []), "sent": sent, "skipped": skipped}


def get_user_admin_status(user_id):
    try:
        # Get user data from Supabase
        user_data, status_code = supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{user_id}",
            params={"select": "id,email,username,is_admin"},
            user_id=user_id,
            use_service_role=True,
        )

        if status_code >= 400 or not user_data:
            return False

        return bool(
            user_data[0].get("is_admin", False)
            or _is_super_admin_record(user_data[0], user_id=user_id)
        )
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
    is_superadmin = False
    try:
        auth_user_data = _fetch_supabase_auth_user(user_id_from_token)
        logger.info(
            "[_get_user_details_with_admin_status] Auth system user fetched: %s",
            bool(auth_user_data),
        )
        if auth_user_data:
            auth_email = auth_user_data.get("email")
            user_role = auth_user_data.get("role", "")
            is_superadmin = user_role == "superadmin"
            logger.info(
                f"[_get_user_details_with_admin_status] Found user in auth system. Email: {auth_email}, Role: {user_role}, Superadmin: {is_superadmin}"
            )
        else:
            logger.warning(
                "[_get_user_details_with_admin_status] Could not get user from auth system"
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
            is_superadmin = is_superadmin or _is_super_admin_record(
                db_user_data, user_id=user_id_from_token
            )
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
                "is_admin": is_superadmin,
                "is_super_admin": is_superadmin,
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

    # Determine final is_admin status - consider both db flag and superadmin role
    final_is_admin = False
    final_is_superadmin = is_superadmin
    if db_user_data:
        final_is_admin = db_user_data.get("is_admin", False)
        final_is_superadmin = final_is_superadmin or bool(
            db_user_data.get("is_super_admin", False)
        )
    final_is_admin = final_is_admin or final_is_superadmin

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

    auth_email_confirmed, auth_phone_confirmed = _extract_auth_confirmation_fields(
        auth_user_data
    )

    email_verified = email_verified or bool(auth_email_confirmed)
    phone_verified = phone_verified or bool(auth_phone_confirmed)

    if (
        db_user_data
        and auth_email_confirmed
        and not bool(db_user_data.get("email_verified", False))
    ):
        try:
            _sync_user_verification_flags(
                user_id_from_token,
                email_verified=True,
                email_verified_at=auth_email_confirmed,
            )
            db_user_data["email_verified"] = True
            db_user_data["email_verified_at"] = auth_email_confirmed
        except Exception as sync_err:
            logger.warning(
                "Failed to sync auth email verification for %s: %s",
                user_id_from_token,
                sync_err,
            )

    if (
        db_user_data
        and auth_phone_confirmed
        and not bool(db_user_data.get("phone_verified", False))
    ):
        try:
            _sync_user_verification_flags(
                user_id_from_token,
                phone_verified=True,
                phone_verified_at=auth_phone_confirmed,
                phone=(auth_user_data or {}).get("phone"),
                country_code=db_user_data.get("country_code"),
            )
            db_user_data["phone_verified"] = True
            db_user_data["phone_verified_at"] = auth_phone_confirmed
            if (auth_user_data or {}).get("phone") and not db_user_data.get("phone"):
                db_user_data["phone"] = auth_user_data.get("phone")
        except Exception as sync_err:
            logger.warning(
                "Failed to sync auth phone verification for %s: %s",
                user_id_from_token,
                sync_err,
            )

    final_user_details = {}
    if db_user_data:
        final_user_details.update(db_user_data)

    final_user_details.update(
        {
            "id": user_id_from_token,
            "email": final_email_to_use,
            "is_admin": final_is_admin,
            "is_super_admin": final_is_superadmin,
            "created_at": final_created_at,
            "is_dealer": bool(db_user_data.get("is_dealer", False))
            if db_user_data
            else False,
            "dealer_verified": bool(db_user_data.get("dealer_verified", False))
            if db_user_data
            else False,
            "email_verified": email_verified,
            "phone_verified": phone_verified,
            "phone_confirmed_at": auth_phone_confirmed,
        }
    )
    logger.info(
        f"[_get_user_details_with_admin_status] Returning final details: {final_user_details}"
    )
    return final_user_details


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
        user_fields = "id,first_name,last_name,email,profile_photo_url,is_dealer,dealer_verified,company_name,legal_business_name"

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
            item["seller_dealer_verified"] = bool(
                user.get("is_dealer", False) and user.get("dealer_verified", False)
            )
            item["seller_company_name"] = (
                user.get("legal_business_name") or user.get("company_name") or ""
            ) or None
    except Exception as seller_err:
        logger.warning(
            f"Failed to enrich seller for listing {item.get('id')}: {seller_err}"
        )

    return item


def _bike_read_dependencies():
    return BikeReadDependencies(
        build_cache_key=lambda: _build_api_cache_key(),
        cache_get=lambda key: _api_cache_get(key),
        cache_set=lambda *args, **kwargs: _api_cache_set(*args, **kwargs),
        cached_json_response=lambda *args, **kwargs: _cached_json_response(
            *args, **kwargs
        ),
        parse_pagination_args=lambda: _parse_pagination_args(),
        getenv=lambda name: os.getenv(name),
        reddit_on_explore=lambda: _reddit_on_explore(),
        should_hide_reddit=lambda *args: _should_hide_reddit(*args),
        search_or_group=lambda *args, **kwargs: _search_or_group(*args, **kwargs),
        combine_or_groups=lambda *groups: _combine_or_groups(*groups),
        cursor_filter=lambda: _cursor_filter(),
        collect_listing_filter_pairs=lambda *args: _collect_listing_filter_pairs(
            *args
        ),
        supabase_url=lambda: app.config["SUPABASE_URL"],
        service_role_key=lambda: app.config["SUPABASE_SERVICE_ROLE_KEY"],
        listing_image_select=LISTING_IMAGE_SELECTS["bikes"],
        direct_get=lambda *args, **kwargs: requests.get(*args, **kwargs),
        supabase_request=lambda *args, **kwargs: supabase_request(*args, **kwargs),
        filter_public_listing_records=lambda table, records: (
            _filter_public_listing_records(table, records)
        ),
        normalize_bike_record=lambda bike: _normalize_bike_record(bike),
        sort_listing_images=lambda images: _sort_listing_images(images),
        batch_fetch_seller_map=lambda *args, **kwargs: _batch_fetch_seller_map(
            *args, **kwargs
        ),
        apply_seller_to_listing=lambda item, seller: _apply_seller_to_listing(
            item, seller
        ),
        attach_page_headers=lambda response, items, limit: _attach_page_headers(
            response, items, limit
        ),
        optional_user_id=lambda: _optional_user_id(),
        sync_listing_lifecycle=lambda *args, **kwargs: _sync_listing_lifecycle(
            *args, **kwargs
        ),
        listing_visible_to_requester=lambda item, user_id: (
            _listing_visible_to_requester(item, user_id)
        ),
        public_strip_fields=_PUBLIC_STRIP_FIELDS,
        logger=logger,
    )


get_bikes, get_bike_by_id = register_bike_read_routes(
    app, dependencies=_bike_read_dependencies
)


def _log_admin_action_direct(admin_user_id, action, **kwargs):
    """Best-effort admin audit log insert from app.py. Kept here (rather than imported
    from routes/admin.py) to avoid a circular import. Mirrors the helper in admin.py."""
    try:
        payload = {
            "admin_user_id": admin_user_id,
            "action": action,
            "target_user_id": kwargs.get("target_user_id"),
            "target_listing_type": kwargs.get("target_listing_type"),
            "target_listing_id": kwargs.get("target_listing_id"),
            "reason": kwargs.get("reason") or None,
            "metadata": kwargs.get("metadata") or {},
        }
        payload = {k: v for k, v in payload.items() if v is not None or k in ("reason", "metadata")}
        supabase_request(
            "post",
            "/rest/v1/admin_actions",
            data=payload,
            use_service_role=True,
        )
    except Exception as exc:
        logger.warning("Admin audit log insert failed (%s): %s", action, exc)



# Columns that should NOT be carried over when a listing is reposted as a new draft.
# Anything else on the original row is reused so the user gets a faithful copy that
# they can edit before resubmitting.
_REPOST_STRIP_KEYS = {
    "id",
    "created_at",
    "updated_at",
    "approved_at",
    "approved_by",
    "is_approved",
    "moderation_status",
    "rejection_note",
    "view_count",
    "qualified_leads",
    "call_click",
    "whatsapp_click",
    "vin_open",
    "vin_reveal",
    "user_dismissed_at",
    "auto_removed_at",
    "deleted_at",
    "sold_status",
    "sold_status_set_at",
    "sold_response_deadline",
    "renewed_at",
    "reminder_job_id",
    "expiration_job_id",
    "expiry_reminder_sent_at",
    "expired_email_sent_at",
    "expires_at",
    "expired_at",
    "retention_expires_at",
    "last_extended_at",
    "extension_count",
    "is_archived",
    "listing_type",
    "listing_state",
    "is_expired",
    "days_until_expiry",
    "days_until_deletion",
    "can_extend",
    "images",
    "image_urls",
    "primary_image_url",
}

def _strip_listing_lifecycle_write_fields(payload):
    """Remove lifecycle write fields that may not exist on older schemas.

    Keep user content fields intact (including `extras`) so reposts remain faithful.
    """
    if not isinstance(payload, dict):
        return payload
    lifecycle_keys = {
        "expires_at",
        "expired_at",
        "retention_expires_at",
        "last_extended_at",
        "renewed_at",
        "deleted_at",
        "extension_count",
        "is_archived",
        "expiry_reminder_sent_at",
        "expired_email_sent_at",
        "reminder_job_id",
        "expiration_job_id",
        "sold_response_deadline",
        "auto_removed_at",
    }
    return {k: v for k, v in payload.items() if k not in lifecycle_keys}


def _clone_listing_images(images_table, fk_field, new_listing_id, original_images):
    """Reinsert image rows pointing at the new listing id. Reuses storage URLs."""
    if not original_images:
        return
    image_strip = {
        "id",
        "uploaded_at",
        "created_at",
        "updated_at",
        fk_field,
    }
    new_rows = []
    for img in original_images:
        if not isinstance(img, dict):
            continue
        cleaned = {k: v for k, v in img.items() if k not in image_strip and v is not None}
        # The image must point at a real URL — skip ghost rows.
        if not (cleaned.get("image_url") or cleaned.get("url") or cleaned.get("display_url")):
            continue
        cleaned[fk_field] = new_listing_id
        new_rows.append(cleaned)
    if not new_rows:
        return
    supabase_request(
        "post",
        f"/rest/v1/{images_table}",
        data=new_rows,
        use_service_role=True,
    )


def _bike_create_dependencies():
    def require_dealer_verified(current_user):
        dealer_check = _require_dealer_verified(current_user)
        return dealer_check

    return BikeCreateDependencies(
        require_verified_user_for_listing=lambda user_id: (
            _require_verified_user_for_listing(user_id)
        ),
        enforce_listing_limit=lambda user_id: _enforce_listing_limit(user_id),
        require_dealer_verified=require_dealer_verified,
        initial_listing_status=lambda: _initial_listing_status(),
        new_listing_lifecycle_fields=lambda: _new_listing_lifecycle_fields(),
        normalize_listing_vin=lambda payload: _normalize_listing_vin(payload),
        require_whatsapp_prefill_and_phone_alignment=lambda payload, listing_type: (
            _require_whatsapp_prefill_and_phone_alignment(payload, listing_type)
        ),
        to_int=lambda *args, **kwargs: _to_int(*args, **kwargs),
        current_year=lambda: datetime.datetime.now().year,
        minimum_allowed_year=MIN_ALLOWED_YEAR,
        validate_description_word_count=lambda *args, **kwargs: (
            _validate_description_word_count(*args, **kwargs)
        ),
        validate_no_profanity=lambda *args, **kwargs: _validate_no_profanity(
            *args, **kwargs
        ),
        sync_gate_error=lambda listing_type, payload, photo_count: (
            _sync_gate_error(listing_type, payload, photo_count)
        ),
        validate_listing_image_entry=lambda entry, user_id: (
            _validate_listing_image_entry(entry, user_id)
        ),
        get_user_email=lambda user_id: get_user_email(user_id),
        create_listing_with_lifecycle_fallback=lambda *args, **kwargs: (
            _create_listing_with_lifecycle_fallback(*args, **kwargs)
        ),
        friendly_db_error=lambda data, status_code, listing_type: (
            _friendly_db_error(data, status_code, listing_type)
        ),
        isoformat_utc=lambda value: _isoformat_utc(value),
        utc_now=lambda: _utc_now(),
        supabase_request=lambda *args, **kwargs: supabase_request(*args, **kwargs),
        get_user_email_by_id=lambda user_id: _get_user_email_by_id(user_id),
        send_new_listing_admin_notification=lambda item_type, listing, user_email: (
            _send_new_listing_admin_notification(item_type, listing, user_email)
        ),
        send_new_listing_user_confirmation=lambda user_email, item_type, listing: (
            _send_new_listing_user_confirmation(user_email, item_type, listing)
        ),
        trigger_auto_review_async=lambda: _trigger_auto_review_async(),
        logger=logger,
    )


create_bike = register_bike_create_route(
    app,
    token_required=token_required,
    dependencies=_bike_create_dependencies,
)


# License Plate Endpoints
def _plate_read_dependencies():
    return PlateReadDependencies(
        build_cache_key=lambda: _build_api_cache_key(),
        cache_get=lambda key: _api_cache_get(key),
        cache_set=lambda *args, **kwargs: _api_cache_set(*args, **kwargs),
        cached_json_response=lambda *args, **kwargs: _cached_json_response(
            *args, **kwargs
        ),
        parse_pagination_args=lambda: _parse_pagination_args(),
        getenv=lambda name: os.getenv(name),
        reddit_on_explore=lambda: _reddit_on_explore(),
        should_hide_reddit=lambda *args: _should_hide_reddit(*args),
        search_or_group=lambda *args, **kwargs: _search_or_group(*args, **kwargs),
        combine_or_groups=lambda *groups: _combine_or_groups(*groups),
        cursor_filter=lambda: _cursor_filter(),
        collect_listing_filter_pairs=lambda *args: _collect_listing_filter_pairs(
            *args
        ),
        supabase_url=lambda: app.config["SUPABASE_URL"],
        service_role_key=lambda: app.config["SUPABASE_SERVICE_ROLE_KEY"],
        direct_get=lambda *args, **kwargs: requests.get(*args, **kwargs),
        filter_public_listing_records=lambda table, records: (
            _filter_public_listing_records(table, records)
        ),
        fetch_plate_image_map=lambda plate_ids, headers: _fetch_plate_image_map(
            plate_ids, headers
        ),
        batch_fetch_seller_map=lambda *args, **kwargs: _batch_fetch_seller_map(
            *args, **kwargs
        ),
        apply_seller_to_listing=lambda item, seller: _apply_seller_to_listing(
            item, seller
        ),
        attach_page_headers=lambda response, items, limit: _attach_page_headers(
            response, items, limit
        ),
        logger=logger,
    )


get_plates = register_plate_read_route(app, dependencies=_plate_read_dependencies)


# Car Parts Endpoints
def _part_read_dependencies():
    return PartReadDependencies(
        build_cache_key=lambda: _build_api_cache_key(),
        cache_get=lambda key: _api_cache_get(key),
        cache_set=lambda *args, **kwargs: _api_cache_set(*args, **kwargs),
        cached_json_response=lambda *args, **kwargs: _cached_json_response(
            *args, **kwargs
        ),
        parse_pagination_args=lambda: _parse_pagination_args(),
        getenv=lambda name: os.getenv(name),
        reddit_on_explore=lambda: _reddit_on_explore(),
        should_hide_reddit=lambda *args: _should_hide_reddit(*args),
        search_or_group=lambda *args, **kwargs: _search_or_group(*args, **kwargs),
        combine_or_groups=lambda *groups: _combine_or_groups(*groups),
        cursor_filter=lambda: _cursor_filter(),
        collect_listing_filter_pairs=lambda *args: _collect_listing_filter_pairs(
            *args
        ),
        supabase_url=lambda: app.config["SUPABASE_URL"],
        service_role_key=lambda: app.config["SUPABASE_SERVICE_ROLE_KEY"],
        listing_image_select=LISTING_IMAGE_SELECTS["car_parts"],
        direct_get=lambda *args, **kwargs: requests.get(*args, **kwargs),
        supabase_request=lambda *args, **kwargs: supabase_request(*args, **kwargs),
        filter_public_listing_records=lambda table, records: (
            _filter_public_listing_records(table, records)
        ),
        batch_fetch_seller_map=lambda *args, **kwargs: _batch_fetch_seller_map(
            *args, **kwargs
        ),
        apply_seller_to_listing=lambda item, seller: _apply_seller_to_listing(
            item, seller
        ),
        attach_page_headers=lambda response, items, limit: _attach_page_headers(
            response, items, limit
        ),
        logger=logger,
    )


get_parts = register_part_read_route(app, dependencies=_part_read_dependencies)


def _part_create_dependencies():
    return PartCreateDependencies(
        require_verified_user_for_listing=lambda user_id: (
            _require_verified_user_for_listing(user_id)
        ),
        require_dealer_verified=lambda user_id: _require_dealer_verified(user_id),
        initial_listing_status=lambda: _initial_listing_status(),
        new_listing_lifecycle_fields=lambda: _new_listing_lifecycle_fields(),
        require_whatsapp_prefill_and_phone_alignment=lambda payload, listing_type: (
            _require_whatsapp_prefill_and_phone_alignment(payload, listing_type)
        ),
        sync_gate_error=lambda listing_type, payload, photo_count: (
            _sync_gate_error(listing_type, payload, photo_count)
        ),
        validate_listing_image_entry=lambda entry, user_id: (
            _validate_listing_image_entry(entry, user_id)
        ),
        part_image_max_count=PART_IMAGE_MAX_COUNT,
        part_image_max_total_bytes=PART_IMAGE_MAX_TOTAL_BYTES,
        upload_to_supabase_storage=lambda *args, **kwargs: upload_to_supabase_storage(
            *args, **kwargs
        ),
        get_user_email=lambda user_id: get_user_email(user_id),
        create_listing_with_lifecycle_fallback=lambda *args, **kwargs: (
            _create_listing_with_lifecycle_fallback(*args, **kwargs)
        ),
        friendly_db_error=lambda data, status_code, listing_type: (
            _friendly_db_error(data, status_code, listing_type)
        ),
        validate_description_word_count=lambda *args, **kwargs: (
            _validate_description_word_count(*args, **kwargs)
        ),
        validate_no_profanity=lambda *args, **kwargs: _validate_no_profanity(
            *args, **kwargs
        ),
        isoformat_utc=lambda value: _isoformat_utc(value),
        utc_now=lambda: _utc_now(),
        supabase_request=lambda *args, **kwargs: supabase_request(*args, **kwargs),
        get_user_email_by_id=lambda user_id: _get_user_email_by_id(user_id),
        send_new_listing_admin_notification=lambda item_type, listing, user_email: (
            _send_new_listing_admin_notification(item_type, listing, user_email)
        ),
        send_new_listing_user_confirmation=lambda user_email, item_type, listing: (
            _send_new_listing_user_confirmation(user_email, item_type, listing)
        ),
        trigger_auto_review_async=lambda: _trigger_auto_review_async(),
        logger=logger,
    )


create_part = register_part_create_route(
    app,
    token_required=token_required,
    dependencies=_part_create_dependencies,
)



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
    redis_client = _get_redis_cache_client()
    cache_key = f"admin-auth-status:{current_user}"

    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached is not None:
                data = json.loads(cached)
                return data if data and data.get("is_admin") else None
        except Exception:
            pass

    user_details = _get_user_details_with_admin_status(current_user)

    if redis_client and user_details and user_details.get("is_admin"):
        try:
            redis_client.setex(cache_key, 300, json.dumps(user_details, default=str))
        except Exception:
            pass

    return user_details if user_details and user_details.get("is_admin") else None


# NOTE: /api/admin/users (GET), /api/admin/users/<id>/status (PATCH), and
# /api/admin/users/<id>/make-admin (POST) used to live here. Removed in favour
# of the single source of truth in routes/admin.py — having duplicate URL rules
# in two blueprints made dispatch non-deterministic (Werkzeug's URL map orders
# by rule complexity, not registration), which is why the admin user list
# silently broke when the wrong handler answered. Auth-user delete, status-
# with-reason+archive, banned status, audit logging, and pagination all live
# in routes/admin.py now. Restore from git if a feature was missed.


# NOTE: DELETE /api/admin/users/<id> now lives in routes/admin.py — the
# duplicate here clashed with the blueprint route and racing dispatch made
# the wrong handler answer in some sessions. The auth-user delete logic
# (calling /auth/v1/admin/users/<id>) was ported into the blueprint so the
# Supabase Auth row is cleaned up alongside public.users.
def _plate_create_dependencies():
    return PlateCreateDependencies(
        require_verified_user_for_listing=lambda user_id: (
            _require_verified_user_for_listing(user_id)
        ),
        require_dealer_verified=lambda user_id: _require_dealer_verified(user_id),
        enforce_listing_limit=lambda user_id: _enforce_listing_limit(user_id),
        to_int=lambda *args, **kwargs: _to_int(*args, **kwargs),
        validate_description_word_count=lambda *args, **kwargs: (
            _validate_description_word_count(*args, **kwargs)
        ),
        validate_no_profanity=lambda *args, **kwargs: _validate_no_profanity(
            *args, **kwargs
        ),
        validate_private_document_path=lambda *args, **kwargs: (
            _validate_private_document_path(*args, **kwargs)
        ),
        get_user_email=lambda user_id: get_user_email(user_id),
        initial_listing_status=lambda: _initial_listing_status(),
        new_listing_lifecycle_fields=lambda: _new_listing_lifecycle_fields(),
        require_whatsapp_prefill_and_phone_alignment=lambda payload, listing_type: (
            _require_whatsapp_prefill_and_phone_alignment(payload, listing_type)
        ),
        sync_gate_error=lambda listing_type, payload, photo_count: (
            _sync_gate_error(listing_type, payload, photo_count)
        ),
        create_listing_with_lifecycle_fallback=lambda *args, **kwargs: (
            _create_listing_with_lifecycle_fallback(*args, **kwargs)
        ),
        friendly_db_error=lambda data, status_code, listing_type: (
            _friendly_db_error(data, status_code, listing_type)
        ),
        supabase_request=lambda *args, **kwargs: supabase_request(*args, **kwargs),
        get_user_email_by_id=lambda user_id: _get_user_email_by_id(user_id),
        send_new_listing_admin_notification=lambda item_type, listing, user_email: (
            _send_new_listing_admin_notification(item_type, listing, user_email)
        ),
        send_new_listing_user_confirmation=lambda user_email, item_type, listing: (
            _send_new_listing_user_confirmation(user_email, item_type, listing)
        ),
        invalidate_public_inventory_cache=lambda item_type: (
            _invalidate_public_inventory_cache(item_type)
        ),
        trigger_auto_review_async=lambda: _trigger_auto_review_async(),
        logger=logger,
    )


_plate_create_views = register_plate_create_route(
    app,
    token_required=token_required,
    dependencies=_plate_create_dependencies,
)
create_plate = _plate_create_views["create_plate"]
create_plate_with_image = _plate_create_views["create_plate_with_image"]
# Compatibility alias for legacy direct-call tests and internal callers. The
# token decorator uses functools.wraps, so __wrapped__ is the route body that
# accepts the already-authenticated user id.
_create_plate_with_image_impl = create_plate.__wrapped__


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


# Import and register Buying Requests routes.
# NOTE: This must happen after `get_user_email` is defined because
# `routes.buying_requests` imports it from this module.
try:
    from routes.buying_requests import buying_requests_bp

    app.register_blueprint(buying_requests_bp)
    logger.info("Buying Requests API routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register Buying Requests API routes: {e}")


def _get_user_email_by_id(user_id):
    try:
        user_data, status_code = supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{user_id}&select=id,email,first_name,last_name",
            use_service_role=True,
        )
        if status_code < 400 and user_data and len(user_data) > 0:
            return user_data[0]
    except Exception:
        pass

    try:
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
        headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers=headers,
            timeout=5,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass

    return None


def _auto_review_enabled() -> bool:
    """Check if auto-review is enabled.
    Checks Redis first (set via admin UI toggle), falls back to env var."""
    rc = _get_redis_cache_client()
    if rc:
        try:
            val = rc.get("ar:enabled")
            if val is not None:
                return val == "1"
        except Exception:
            pass
    raw = (os.getenv("AUTO_REVIEW_WORKER_ENABLED") or "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


_REDDIT_LISTING_TABLES = ("cars", "bikes", "car_parts", "license_plates")


def _reddit_listings_visible() -> bool:
    """Whether Reddit-imported listings are publicly shown. Redis flag
    (admin toggle) first, env fallback. Default visible."""
    rc = _get_redis_cache_client()
    if rc:
        try:
            val = rc.get("reddit:visible")
            if val is not None:
                return val == "1"
        except Exception:
            pass
    raw = (os.getenv("REDDIT_LISTINGS_VISIBLE") or "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _reddit_on_explore() -> bool:
    """Whether Reddit-imported listings are mixed into the MAIN explore feed
    (in addition to their dedicated Reddit tab). Redis flag (admin toggle) first,
    env fallback. Default off — Reddit stays in its own tab unless turned on."""
    rc = _get_redis_cache_client()
    if rc:
        try:
            val = rc.get("reddit:on_explore")
            if val is not None:
                return val == "1"
        except Exception:
            pass
    raw = (os.getenv("REDDIT_ON_EXPLORE") or "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _should_hide_reddit(requesting_reddit, exclude_reddit, reddit_on_explore):
    """Whether to exclude Reddit-sourced rows from a normal listing feed.
    - Never hide when the caller explicitly requests the Reddit tab.
    - Otherwise hide when the client opts out (exclude_reddit) OR Reddit isn't
      globally mixed into explore. exclude_reddit wins over the admin flag so a
      user can always choose not to see Reddit cars."""
    if requesting_reddit:
        return False
    return bool(exclude_reddit) or not reddit_on_explore


def _google_signin_enabled() -> bool:
    """Whether Google sign-in is offered on the login/signup pages. Redis flag
    (admin toggle) first, env fallback. Default on."""
    rc = _get_redis_cache_client()
    if rc:
        try:
            val = rc.get("auth:google_enabled")
            if val is not None:
                return val == "1"
        except Exception:
            pass
    raw = (os.getenv("GOOGLE_SIGNIN_ENABLED") or "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _initial_listing_status():
    """Initial status for a freshly-submitted listing. If the auto-review
    worker is enabled, lands at 'pending_auto_review' so the worker picks
    it up; otherwise the historical 'pending' (straight to admin queue)."""
    return "pending_auto_review" if _auto_review_enabled() else "pending"


def _trigger_auto_review_async():
    """Fire-and-forget: run one auto-review tick in a background thread.
    Called immediately after a listing is saved so approval doesn't wait
    for the next worker poll cycle.
    """
    if not _auto_review_enabled():
        return
    import threading as _threading

    def _run():
        try:
            from workers.auto_review_worker import run as auto_review_run
            auto_review_run()
        except Exception as exc:
            logger.warning("Auto-review immediate trigger failed: %s", exc)

    _threading.Thread(target=_run, daemon=True).start()


def _expire_reddit_dupes_for_vin(vin):
    """A native DPH car takes priority over a Reddit import of the same vehicle.
    Unpublish any Reddit-sourced car sharing this VIN so only the DPH listing
    shows. Closes the gap the reddit importer's own dedup can't: a Reddit car
    imported BEFORE the DPH car was posted (import-time dedup only sees DPH cars
    that already exist)."""
    vin = (vin or "").strip()
    if not vin:
        return
    supabase_request(
        "patch",
        "/rest/v1/cars",
        params={
            "source_platform": "eq.reddit",
            "vin_number": f"eq.{vin}",
            "status": "neq.expired",
        },
        data={"status": "expired", "is_approved": False},
        use_service_role=True,
    )
    # Detail, search, and sitemap responses may be cached. Invalidating after
    # the status change ensures a just-hidden Reddit duplicate does not remain
    # visible until the cache TTL expires.
    _invalidate_public_inventory_cache("cars")


def _run_reddit_vin_dedup_sweep_once():
    """Safety-net sweep, run unconditionally: native-DPH-vs-reddit VIN priority,
    then reddit-vs-reddit repost dedup. Returns the total count de-duped."""
    return _sweep_native_priority_vin_dupes() + _sweep_reddit_vs_reddit_dupes()


def _sweep_native_priority_vin_dupes():
    """Expire any live Reddit car whose VIN also has a live native DPH car
    (priority: DPH over Reddit). The on-approval hook already de-dupes new
    native cars; this catches ones that slipped through (e.g. imported before
    the hook existed, or approved out of order). Returns the count of VINs
    de-duped so the worker can log/back off.
    ponytail: single indexed pass in chunks; if live Reddit inventory ever
    exceeds PostgREST's max-rows the tail waits for the next tick — paginate
    then if it becomes real."""
    reddit_rows, _ = supabase_request(
        "get",
        "/rest/v1/cars",
        params={
            "source_platform": "eq.reddit",
            "status": "neq.expired",
            "vin_number": "not.is.null",
            "select": "vin_number",
            "limit": "100000",
        },
        use_service_role=True,
    )
    if not isinstance(reddit_rows, list) or not reddit_rows:
        return 0
    reddit_vins = sorted(
        {(r.get("vin_number") or "").strip() for r in reddit_rows if (r.get("vin_number") or "").strip()}
    )
    if not reddit_vins:
        return 0

    deduped = 0
    for i in range(0, len(reddit_vins), 100):
        chunk = reddit_vins[i:i + 100]
        quoted = ",".join(f'"{v}"' for v in chunk)
        native_rows, _ = supabase_request(
            "get",
            "/rest/v1/cars",
            params={
                # PostgREST's `neq` does not match SQL NULL. Native DPH
                # listings use NULL for source_platform, so include both those
                # rows and any explicitly non-Reddit source in the priority
                # check.
                "or": "(source_platform.is.null,source_platform.neq.reddit)",
                "status": "neq.expired",
                "vin_number": f"in.({quoted})",
                "select": "vin_number",
            },
            use_service_role=True,
        )
        if not isinstance(native_rows, list):
            continue
        for vin in {(r.get("vin_number") or "").strip() for r in native_rows}:
            if vin:
                _expire_reddit_dupes_for_vin(vin)
                deduped += 1
    return deduped


def _normalize_listing_title(title):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (title or "").lower())).strip()


def _sweep_reddit_vs_reddit_dupes():
    """Catch reposts the importer's own dedup can't (e.g. several near-simultaneous
    reposts of the same car landing in one import batch, or the pre-existing
    backlog). Among live Reddit cars with no native competitor, group by VIN
    (or, when a post has no VIN, by normalized title + author) and keep only
    the newest row per group."""
    rows, _ = supabase_request(
        "get",
        "/rest/v1/cars",
        params={
            "source_platform": "eq.reddit",
            "status": "neq.expired",
            "select": "id,vin_number,listing_title,source_author,created_at",
            "limit": "100000",
        },
        use_service_role=True,
    )
    if not isinstance(rows, list) or not rows:
        return 0

    groups = defaultdict(list)
    for r in rows:
        vin = (r.get("vin_number") or "").strip()
        key = ("vin", vin) if vin else (
            "ta", _normalize_listing_title(r.get("listing_title")), (r.get("source_author") or "").strip().lower()
        )
        groups[key].append(r)

    deduped = 0
    for group in groups.values():
        if len(group) < 2:
            continue
        newest_id = max(group, key=lambda r: r.get("created_at") or "")["id"]
        for row in group:
            if row["id"] == newest_id:
                continue
            _, status = supabase_request(
                "patch",
                f"/rest/v1/cars?id=eq.{row['id']}",
                data={"status": "expired", "is_approved": False},
                use_service_role=True,
            )
            if status < 400:
                deduped += 1
    if deduped:
        _invalidate_public_inventory_cache("cars")
    return deduped


def admin_required(f):
    """Token-based admin authorization - validates JWT and checks is_admin in database"""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization")

        if not auth_header:
            flash("You must be logged in as an admin to access this page.", "danger")
            return redirect(url_for("admin_web.admin_login"))

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            flash("Invalid authorization format.", "danger")
            return redirect(url_for("admin_web.admin_login"))

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
                return redirect(url_for("admin_web.admin_login"))

            user_data = auth_response.json()
            user_id = user_data.get("id")

            if not user_id:
                flash("Invalid user data.", "danger")
                return redirect(url_for("admin_web.admin_login"))

            user_role = user_data.get("role", "")
            is_supabase_superadmin = user_role == "superadmin"
            logger.info(
                f"[admin_required] User {user_id} - Supabase role: '{user_role}', is_superadmin: {is_supabase_superadmin}"
            )

            service_headers = {
                "apikey": os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY),
                "Authorization": f"Bearer {os.getenv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_KEY)}",
                "Content-Type": "application/json",
            }

            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}&select=id,email,username,is_admin",
                headers=service_headers,
                timeout=5,
            )
            logger.info(
                f"[admin_required] public.users query status: {response.status_code}, response: {response.text}"
            )

            is_db_admin = False
            if response.status_code == 200:
                users = response.json()
                is_db_admin = bool(
                    users
                    and len(users) > 0
                    and (
                        users[0].get("is_admin")
                        or _is_super_admin_record(users[0], user_id=user_id)
                    )
                )

            if is_supabase_superadmin or is_db_admin:
                request.user_id = user_id
                session["is_admin"] = True
                session["admin_user_id"] = user_id
                logger.info(f"[admin_required] Access granted for user {user_id}")
                return f(*args, **kwargs)

            flash("Admin access required.", "danger")
            return redirect(url_for("admin_web.admin_login"))

        except Exception as e:
            logger.error(f"Error checking admin status: {e}")
            flash("Authorization check failed.", "danger")
            return redirect(url_for("admin_web.admin_login"))

    return decorated_function


# Admin Blueprint Setup - API routes only (React handles UI)
admin_web_bp = Blueprint(
    "admin_web",
    __name__,
    url_prefix="/admin",
)


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
                params={"status": "in.(pending,pending_auto_review)", "select": "count"},
                use_service_role=True,
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


# API route for listing pending items (returns JSON for React)
@admin_web_bp.route("/approve/<item_type>")
@admin_required
def list_pending_items_api(item_type):
    """API endpoint to get pending items as JSON"""
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
        response, status_code = supabase_request(
            "get",
            f"/rest/v1/{table_name}",
            params={
                "status": "eq.pending",
                "select": "*",
            },
            use_service_role=True,
        )
        if status_code == 200:
            return jsonify(response), 200
        else:
            logger.error(
                f"Error fetching pending {item_type}: {status_code} - {response}"
            )
            return jsonify({"error": f"Error fetching pending {item_type}"}), 500
    except Exception as e:
        logger.error(f"Exception fetching pending {item_type}: {e}")
        return jsonify({"error": str(e)}), 500


# ... (rest of admin_bp routes)


@admin_web_bp.route("/approve/<item_type>/<item_id>/approve", methods=["POST"])
@admin_required
def approve_item_api(item_type, item_id):
    """API endpoint to approve an item"""
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
            _invalidate_public_inventory_cache(item_type)
            return jsonify(
                {
                    "success": True,
                    "message": f"{item_type} {item_id} approved successfully",
                }
            ), 200
        else:
            logger.error(
                f"Error approving {item_type} {item_id}: {status_code} - {response}"
            )
            return jsonify({"error": f"Error approving item: {status_code}"}), 500
    except Exception as e:
        logger.error(f"Exception approving {item_type} {item_id}: {e}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/approve/<item_type>/<item_id>/reject", methods=["POST"])
@admin_required
def reject_item_api(item_type, item_id):
    """API endpoint to reject an item"""
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
        rejection_fix = data.get("rejection_fix", "")

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
            # Send rejection email
            email_sent = False
            email_error = None
            try:
                listing_resp, listing_status = supabase_request(
                    "get",
                    f"/rest/v1/{table_name}?id=eq.{item_id}&select=user_id,user_email,contact_email",
                    use_service_role=True,
                )
                if listing_status < 400 and listing_resp:
                    listing = listing_resp[0]
                    user_email = listing.get("user_email") or listing.get(
                        "contact_email"
                    )
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
                            rejection_fix=rejection_fix,
                        )
                        if not email_error:
                            email_sent = True
                        else:
                            logger.error(
                                f"Rejection email failed for {item_type} {item_id}: {email_error}"
                            )
            except Exception as email_exc:
                logger.error(
                    f"Error sending rejection email for {item_type} {item_id}: {email_exc}"
                )

            _invalidate_public_inventory_cache(item_type)
            return jsonify(
                {
                    "success": True,
                    "message": f"{item_type} {item_id} rejected successfully",
                    "email_sent": email_sent,
                }
            ), 200
        else:
            logger.error(
                f"Error rejecting {item_type} {item_id}: {status_code} - {response}"
            )
            return jsonify({"error": f"Error rejecting item: {status_code}"}), 500
    except Exception as e:
        logger.error(f"Exception rejecting {item_type} {item_id}: {e}")
        return jsonify({"error": str(e)}), 500

    return redirect(url_for("admin_web.list_pending_items", item_type=item_type))


# Dealer Management API Routes (returns JSON for React)
@admin_web_bp.route("/dealers")
@admin_required
def list_dealers_api():
    """API endpoint to get all dealers as JSON"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&select=*&order=created_at.desc",
            headers=headers,
        )

        if dealers_response.status_code == 200:
            return jsonify(dealers_response.json()), 200
        else:
            return jsonify({"error": "Error loading dealers"}), 500
    except Exception as e:
        logger.error(f"Error listing dealers: {str(e)}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/dealers/pending")
@admin_required
def list_pending_dealers_api():
    """API endpoint to get pending dealers as JSON"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        dealers_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?is_dealer=eq.true&dealer_verified=eq.false&select=*&order=created_at.desc",
            headers=headers,
        )

        if dealers_response.status_code == 200:
            return jsonify(dealers_response.json()), 200
        else:
            return jsonify({"error": "Error loading pending dealers"}), 500
    except Exception as e:
        logger.error(f"Error listing pending dealers: {str(e)}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/dealers/<dealer_id>/verify", methods=["POST"])
@admin_required
def verify_dealer_api(dealer_id):
    """API endpoint to verify a dealer account"""
    try:
        from datetime import datetime

        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        update_data = {
            "dealer_verified": True,
            "dealer_verified_at": datetime.utcnow().isoformat(),
            "dealer_verified_by": request.user_id,
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

            return jsonify(
                {"success": True, "message": "Dealer verified successfully"}
            ), 200
        else:
            return jsonify({"error": f"Error verifying dealer: {response.text}"}), 500

    except Exception as e:
        logger.error(f"Error verifying dealer: {str(e)}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/dealers/<dealer_id>/reject", methods=["POST"])
@admin_required
def reject_dealer_api(dealer_id):
    """API endpoint to reject a dealer verification request"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        data = request.get_json() or {}
        rejection_note = data.get("rejection_note", "Verification rejected by admin")
        rejection_fix = data.get("rejection_fix", "")

        update_data = {
            "is_dealer": False,
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
                        rejection_fix=rejection_fix,
                    )
                    if email_error:
                        logger.error(
                            f"Dealer rejection email failed for {dealer_id}: {email_error}"
                        )
            except Exception as email_err:
                logger.error(
                    f"Dealer rejection email exception for {dealer_id}: {email_err}"
                )

            return jsonify(
                {"success": True, "message": "Dealer verification rejected"}
            ), 200
        else:
            return jsonify({"error": f"Error rejecting dealer: {response.text}"}), 500

    except Exception as e:
        logger.error(f"Error rejecting dealer: {str(e)}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/users")
@admin_required
def list_users_api():
    """API endpoint to get all users as JSON"""
    try:
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        users_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/users?select=*&order=created_at.desc",
            headers=headers,
        )

        if users_response.status_code == 200:
            return jsonify(users_response.json()), 200
        else:
            return jsonify({"error": "Error loading users"}), 500
    except Exception as e:
        logger.error(f"Error listing users: {str(e)}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/users/<user_id>/make-admin", methods=["POST"])
@admin_required
def make_user_admin_api(user_id):
    """API endpoint to make a user an admin"""
    try:
        protected = _protect_super_admin_target(user_id, "modify admin access for")
        if protected:
            return protected

        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json={"is_admin": True},
        )

        if response.status_code in [200, 204]:
            return jsonify(
                {"success": True, "message": "User made admin successfully"}
            ), 200
        else:
            return jsonify({"error": f"Error making user admin: {response.text}"}), 500
    except Exception as e:
        logger.error(f"Error making user admin: {str(e)}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/users/<user_id>/remove-admin", methods=["POST"])
@admin_required
def remove_user_admin_api(user_id):
    """API endpoint to remove admin privileges from a user"""
    try:
        protected = _protect_super_admin_target(user_id, "modify admin access for")
        if protected:
            return protected

        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json={"is_admin": False},
        )

        if response.status_code in [200, 204]:
            return jsonify(
                {"success": True, "message": "Admin privileges removed successfully"}
            ), 200
        else:
            return jsonify(
                {"error": f"Error removing admin privileges: {response.text}"}
            ), 500
    except Exception as e:
        logger.error(f"Error removing admin privileges: {str(e)}")
        return jsonify({"error": str(e)}), 500


@admin_web_bp.route("/users/<user_id>/status", methods=["PATCH"])
@admin_required
def update_user_status_api(user_id):
    """API endpoint to update user account status"""
    try:
        protected = _protect_super_admin_target(user_id, "change its status")
        if protected:
            return protected

        data = request.get_json() or {}
        new_status = data.get("status", "active")

        if new_status not in ["active", "suspended"]:
            return jsonify(
                {"error": "Invalid status. Must be 'active' or 'suspended'"}
            ), 400

        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json={"account_status": new_status},
        )

        if response.status_code in [200, 204]:
            return jsonify(
                {"success": True, "message": f"User status updated to {new_status}"}
            ), 200
        else:
            return jsonify(
                {"error": f"Error updating user status: {response.text}"}
            ), 500
    except Exception as e:
        logger.error(f"Error updating user status: {str(e)}")
        return jsonify({"error": str(e)}), 500


# Register admin web blueprint
app.register_blueprint(admin_web_bp)
logger.info("Admin web routes registered successfully")

# Dealer admin panel (feature-flagged)
if os.getenv("ENABLE_DEALER_PANEL", "false").lower() == "true":
    from routes.dealer import register_dealer_blueprints
    register_dealer_blueprints(app)


# ... (End of admin_bp blueprint, before app.register_blueprint(admin_bp) if it was moved, or before if __name__ ...)

# =====================
# Lead + Lifecycle APIs
# =====================


# ---------------------------------------------------------------------------
# Resend webhook — receives email events (open / click / bounce / unsubscribe)
# ---------------------------------------------------------------------------

@app.route("/api/webhooks/resend", methods=["POST"])
def resend_webhook():
    """Receive Resend email lifecycle events and update outbound_emails table."""
    import hmac
    import hashlib

    webhook_secret = os.getenv("RESEND_WEBHOOK_SECRET", "")
    if webhook_secret:
        sig_header = request.headers.get("Resend-Signature") or request.headers.get("svix-signature", "")
        ts_header  = request.headers.get("svix-timestamp", "")
        raw_body   = request.get_data()
        expected   = hmac.new(
            webhook_secret.encode(),
            f"{ts_header}.{raw_body.decode()}".encode(),
            hashlib.sha256,
        ).hexdigest()
        if not any(part.split(",", 1)[-1] == expected for part in sig_header.split(" ")):
            logger.warning("Resend webhook signature mismatch")
            return jsonify({"error": "Invalid signature"}), 401

    try:
        event = request.get_json(silent=True) or {}
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    event_type    = str(event.get("type") or "").lower()
    data          = event.get("data") or {}
    resend_email_id = str(data.get("email_id") or data.get("id") or "")
    created_at    = data.get("created_at") or _isoformat_utc(_utc_now())

    if not resend_email_id:
        return jsonify({"ok": True}), 200

    # Map Resend event types to email_events columns
    update = {}
    if event_type == "email.delivered":
        update["delivered_at"] = created_at
    elif event_type == "email.opened":
        update["opened_at"] = created_at
        # Increment open_count via read-then-write (acceptable — single writer for open events)
        existing, _ = supabase_request(
            "get", "/rest/v1/outbound_emails",
            params={"resend_email_id": f"eq.{resend_email_id}", "select": "id,open_count", "limit": "1"},
            use_service_role=True,
        )
        if existing:
            update["open_count"] = int((existing[0].get("open_count") or 0)) + 1
    elif event_type == "email.clicked":
        update["clicked_at"] = created_at
        existing, _ = supabase_request(
            "get", "/rest/v1/outbound_emails",
            params={"resend_email_id": f"eq.{resend_email_id}", "select": "id,click_count", "limit": "1"},
            use_service_role=True,
        )
        if existing:
            update["click_count"] = int((existing[0].get("click_count") or 0)) + 1
    elif event_type in ("email.bounced", "email.delivery_delayed"):
        update["bounced_at"] = created_at
    elif event_type == "email.complained":
        update["spam_at"] = created_at
    elif event_type == "email.unsubscribed":
        update["unsubscribed_at"] = created_at

    if update:
        supabase_request(
            "patch",
            f"/rest/v1/outbound_emails?resend_email_id=eq.{resend_email_id}",
            data=update,
            use_service_role=True,
        )
        logger.info("Resend webhook %s → email %s updated", event_type, resend_email_id)

    return jsonify({"ok": True}), 200


@app.route("/api/errors", methods=["POST"])
@token_required
def report_app_error(current_user):
    """Client-side error report from the frontend. Best-effort — always 200 so
    a reporting hiccup never cascades into the UI. Authed only."""
    body = request.get_json(silent=True) or {}
    _details = body.get("details")
    record_app_error(
        context=body.get("context") or "frontend",
        message=body.get("message") or "",
        error_code=body.get("error_code"),
        user_id=current_user,
        details=_details if isinstance(_details, (dict, list)) else None,
        source="frontend",
        url=body.get("url"),
        user_agent=request.headers.get("User-Agent"),
    )
    return jsonify({"ok": True}), 200


@app.route("/api/admin/cloudflare/status", methods=["GET"])
@token_required
def get_admin_cloudflare_status(current_user):
    """Diagnostic: report what the Cloudflare integration sees right now.

    Admins call this after deploying env vars to confirm the wiring works
    end-to-end without waiting for the metrics page to render.
    """
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        from services.cloudflare_analytics import (
            fetch_zone_metrics as _cf_fetch,
            is_enabled as _cf_enabled,
            _resolve_zone_ids as _cf_resolve_zones,
        )

        payload = {
            "token_present": bool(os.getenv("CLOUDFLARE_API_TOKEN")),
            "account_id_present": bool(os.getenv("CLOUDFLARE_ACCOUNT_ID")),
            "zone_ids_present": bool(os.getenv("CLOUDFLARE_ZONE_IDS")),
            "zone_id_present": bool(os.getenv("CLOUDFLARE_ZONE_ID")),
            "enabled": _cf_enabled(),
        }
        if not _cf_enabled():
            payload["status"] = "disabled"
            payload["reason"] = (
                "Set CLOUDFLARE_API_TOKEN plus either CLOUDFLARE_ZONE_IDS "
                "(comma-separated), CLOUDFLARE_ZONE_ID, or CLOUDFLARE_ACCOUNT_ID."
            )
            return jsonify(payload), 200

        resolved_zones = _cf_resolve_zones()
        payload["resolved_zone_ids"] = resolved_zones
        if not resolved_zones:
            payload["status"] = "zone_unresolved"
            payload["reason"] = (
                "Token present but no zones resolved. Set CLOUDFLARE_ZONE_IDS "
                "or grant Zone:Read on the account for auto-discovery."
            )
            return jsonify(payload), 200

        sample = _cf_fetch(7)
        if not sample:
            payload["status"] = "fetch_failed"
            payload["reason"] = (
                "Zone resolved but the GraphQL Analytics call failed. The "
                "token needs Zone Analytics:Read on this zone."
            )
            return jsonify(payload), 200

        payload["status"] = "ok"
        payload["sample_7d"] = {
            "unique_visitors": sample.get("unique_visitors"),
            "page_views": sample.get("page_views"),
            "requests": sample.get("requests"),
            "threats": sample.get("threats"),
            "cached_requests": sample.get("cached_requests"),
            "bytes": sample.get("bytes"),
            "peak_daily_uniques": sample.get("peak_daily_uniques"),
            "days_returned": len(sample.get("daily_trends") or []),
        }
        return jsonify(payload), 200
    except Exception as e:
        logger.error(f"Error fetching Cloudflare status: {e}")
        return jsonify({"error": str(e)}), 500


register_health_routes(
    app,
    check_redis_health=check_redis_health,
    get_worker_heartbeat=get_worker_heartbeat,
    utc_now=_utc_now,
    isoformat_utc=_isoformat_utc,
    build_health_snapshot=build_health_snapshot,
    fetch_latest_health_snapshot=fetch_latest_health_snapshot,
    send_health_alert=send_health_alert,
    token_required=token_required,
    require_admin=_require_admin_api_user,
    logger=logger,
)


# NOTE: /api/admin/ga4-summary was removed in 2026-06. The inline-GA4-KPIs
# feature it powered required granting a service account access to the GA4
# property, which Google's policy changes made unreliable. Admins now click
# the "Open GA4 Dashboard" button which deep-links to analytics.google.com
# where the same data lives. Site Visitors is computed from platform_events
# + lead_events + signups in /api/admin/stats below — no GA4 dependency.


def _fetch_rows(path, params):
    """Service-role GET helper for admin aggregations.

    Pages through the full result set: PostgREST caps a single request at
    db-max-rows (typically 1000) regardless of the requested ``limit``, so a
    plain GET silently truncated total_users / total_dealers / total_reports
    once a table crossed 1000 rows. Hoisted to module level so unit tests can
    patch it in isolation when exercising /api/admin/stats.
    """
    rows, status = _fetch_all_rows(path, params)
    return rows if status < 400 else []


def _fetch_all_rows(path, params, *, page_size=1000, max_rows=250000):
    """Fetch all rows for an analytics window, not Supabase's first page.

    PostgREST installations commonly cap a request at 1,000 rows even when a
    larger ``limit`` is supplied. Admin metrics must therefore page explicitly
    rather than silently calculate a partial window.
    """
    collected = []
    offset = 0
    base_params = dict(params or {})

    while len(collected) < max_rows:
        page_params = {
            **base_params,
            "limit": str(min(page_size, max_rows - len(collected))),
            "offset": str(offset),
        }
        rows, status = supabase_request(
            "get", path, params=page_params, use_service_role=True
        )
        if status >= 400:
            return collected, status
        rows = rows or []
        collected.extend(rows)
        if len(rows) < page_size:
            return collected, status
        offset += len(rows)

    logger.warning("Analytics query reached safety cap of %s rows for %s", max_rows, path)
    return collected, 206


LIFECYCLE_SUMMARY_TABLES = {
    "cars": "cars",
    "bikes": "bikes",
    "parts": "car_parts",
    "plates": "license_plates",
}


def _build_listing_lifecycle_summary():
    return _build_listing_lifecycle_summary_from_rows(_fetch_listing_lifecycle_rows())



# Reports API Routes
# =====================


@app.route("/api/admin/reports/<report_id>", methods=["PATCH"])
@token_required
def update_admin_report(current_user, report_id):
    """Admin: update report status (e.g. resolved/dismissed)."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        payload = request.get_json(silent=True) or {}
        status = payload.get("status")
        allowed_statuses = {"pending", "resolved", "dismissed"}
        if status not in allowed_statuses:
            return jsonify(
                {
                    "error": f"Invalid status. Must be one of: {', '.join(sorted(allowed_statuses))}"
                }
            ), 400

        update_data = {"status": status}
        response, status_code = supabase_request(
            "patch",
            "/rest/v1/reports",
            params={"id": f"eq.{report_id}"},
            data=update_data,
            use_service_role=True,
        )
        if status_code >= 400:
            logger.error(f"Failed to update report {report_id}: {response}")
            return jsonify({"error": "Failed to update report"}), status_code

        return jsonify(response[0] if isinstance(response, list) and response else response), 200
    except Exception as e:
        logger.error(f"Error updating report {report_id}: {str(e)}", exc_info=True)
        return jsonify({"error": "An error occurred while updating the report"}), 500


def _load_admin_contact_analytics(days):
    cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()
    platform_events, platform_status = _fetch_all_rows(
        "/rest/v1/platform_events",
        {"select": "event_name,listing_type,listing_id,user_id,visitor_id,session_id,created_at",
         "created_at": f"gte.{cutoff}", "order": "created_at.desc"},
    )
    legacy_events, legacy_status = _fetch_all_rows(
        "/rest/v1/lead_events",
        {"select": "action,listing_type,listing_id,user_id,session_id,payload,created_at",
         "created_at": f"gte.{cutoff}", "order": "created_at.desc"},
    )
    if platform_status >= 400 or legacy_status >= 400:
        raise RuntimeError("Failed to load contact analytics events")
    return build_contact_analytics(platform_events or [], legacy_events or [], days, _utc_now())


@app.route("/api/admin/contact-analytics", methods=["GET"])
@token_required
def get_admin_contact_analytics(current_user):
    """The single normalized reporting source for contact and VIN engagement."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403
    try:
        days = max(min(int(request.args.get("days", 30)), 90), 1)
        cache_key = f"api-cache:admin-contact-analytics:days={days}"
        cached = _api_cache_get(cache_key)
        if cached is not None:
            return jsonify(cached), 200
        analytics = _load_admin_contact_analytics(days)
        payload = {key: value for key, value in analytics.items() if key != "_vin_events"}
        payload["window_days"] = days
        _api_cache_set(cache_key, payload, ttl_seconds=60)
        return jsonify(payload), 200
    except Exception as exc:
        logger.error("Failed to load normalized contact analytics: %s", exc)
        return jsonify({"error": "Failed to fetch contact analytics"}), 500



_REDDIT_VERIFY_CONFIG = {
    "car": {
        "table": "cars", "img_table": "car_images", "img_fk": "car_id", "public_prefix": "/cars",
        "core": ["car_manufacturer", "car_model", "make_year", "expected_selling_price"],
        "spec": ["trim", "body_type", "fuel_type", "transmission_type", "cylinders",
                 "engine_capacity", "horsepower", "drivetrain", "doors", "seating_capacity",
                 "color", "kilometer_driven", "regional_spec", "steering_side", "service_history"],
    },
    "bike": {
        "table": "bikes", "img_table": "bike_images", "img_fk": "bike_id", "public_prefix": "/bikes",
        "select": ("id,bike_brand,bike_model,year,price,mileage,condition,bike_type,location,"
                   "vin_number,source_url,source_author,source_created_at,is_approved,status,created_at"),
        "core": ["bike_brand", "bike_model", "year", "price"],
        "spec": ["condition", "bike_type", "location"],
    },
    "part": {
        "table": "car_parts", "img_table": "part_images", "img_fk": "part_id", "public_prefix": "/car-parts",
        "select": ("id,name,part_type,condition,price,location,"
                   "source_url,source_author,source_created_at,is_approved,status,created_at"),
        "core": ["name", "part_type", "price"],
        "spec": ["condition", "location"],
    },
    "plate": {
        "table": "license_plates", "img_table": "plate_images", "img_fk": "plate_id", "public_prefix": "/plates",
        "select": ("id,listing_title,number,code,digits,city,price,"
                   "source_url,source_author,source_created_at,is_approved,status,created_at"),
        "core": ["number", "price"],
        "spec": ["code", "city"],
    },
}

_INCOMPLETE_VALUES = {None, "", "unspecified", "any format", "0"}


def _reddit_field_incomplete(value):
    if value is None:
        return True
    return str(value).strip().lower() in _INCOMPLETE_VALUES


def _reddit_price_points(listing_ids):
    """{listing_id: [{price, recorded_at}, ...]} oldest-first. Best-effort:
    returns {} if the price-history table isn't there yet."""
    out = {}
    ids = [i for i in listing_ids if i]
    if not ids:
        return out
    for i in range(0, len(ids), 80):
        chunk = ids[i:i + 80]
        rows, sc = supabase_request(
            "get", "/rest/v1/listing_price_history",
            params={"select": "listing_id,price,recorded_at",
                    "listing_id": f"in.({','.join(chunk)})",
                    "order": "recorded_at.asc"},
            use_service_role=True)
        if sc >= 400 or not isinstance(rows, list):
            continue
        for row in rows:
            out.setdefault(str(row.get("listing_id")), []).append(
                {"price": row.get("price"), "recorded_at": row.get("recorded_at")})
    return out


@app.route("/api/admin/reddit-listings", methods=["GET"])
@token_required
def get_admin_reddit_listings(current_user):
    """Every Reddit-imported listing (including hidden ones) with the fields,
    photos and source link needed to verify each import in the admin panel."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403
    try:
        listings = []
        summary = {"total": 0, "hidden": 0, "with_vin": 0, "incomplete": 0}
        for lt, cfg in _REDDIT_VERIFY_CONFIG.items():
            # select=* stays resilient to the import_field_sources column not
            # existing yet (before the provenance migration is applied).
            rows, sc = supabase_request(
                "get", f"/rest/v1/{cfg['table']}",
                params={"select": "*", "source_platform": "eq.reddit",
                        "order": "source_created_at.desc"},
                use_service_role=True)
            if sc >= 400 or not isinstance(rows, list):
                logger.warning("reddit-listings: fetch failed for %s (%s)", cfg["table"], sc)
                continue
            ids = [str(r["id"]) for r in rows if r.get("id")]
            price_points = _reddit_price_points(ids)
            images_by_id = {}
            for i in range(0, len(ids), 60):
                chunk = ids[i:i + 60]
                img_rows, isc = supabase_request(
                    "get", f"/rest/v1/{cfg['img_table']}",
                    params={"select": f"{cfg['img_fk']},url,display_url,image_url,is_primary",
                            cfg["img_fk"]: f"in.({','.join(chunk)})"},
                    use_service_role=True)
                if isc < 400 and isinstance(img_rows, list):
                    for im in img_rows:
                        url = im.get("display_url") or im.get("image_url") or im.get("url")
                        if url:
                            images_by_id.setdefault(str(im.get(cfg["img_fk"])), []).append(url)
            for r in rows:
                rid = str(r.get("id"))
                missing = [f for f in (cfg["core"] + cfg["spec"]) if _reddit_field_incomplete(r.get(f))]
                vin = r.get("vin_number")
                fields = {k: r.get(k) for k in (cfg["core"] + cfg["spec"])}
                listings.append({
                    "id": rid, "listing_type": lt, "title": _vin_title(lt, r),
                    "price": r.get("expected_selling_price") or r.get("price"),
                    "fields": fields, "missing_fields": missing, "vin_number": vin,
                    "field_sources": r.get("import_field_sources") or {},
                    "price_history": price_points.get(rid, []),
                    "images": images_by_id.get(rid, []),
                    "source_url": r.get("source_url"), "source_author": r.get("source_author"),
                    "public_url": f"{cfg['public_prefix']}/{rid}",
                    "is_approved": bool(r.get("is_approved")), "status": r.get("status"),
                    "source_created_at": r.get("source_created_at"),
                })
                summary["total"] += 1
                if not r.get("is_approved"):
                    summary["hidden"] += 1
                if vin:
                    summary["with_vin"] += 1
                if missing:
                    summary["incomplete"] += 1
        listings.sort(key=lambda x: x.get("source_created_at") or "", reverse=True)
        return jsonify({"summary": summary, "listings": listings}), 200
    except Exception as exc:
        logger.error("Failed to load reddit listings for verification: %s", exc)
        return jsonify({"error": "Failed to fetch reddit listings"}), 500


def _vin_title(lt, row):
    """Readable listing title for the VIN-reveal viewer UI."""
    if lt == "car":
        parts = [row.get("make_year"), row.get("car_manufacturer"), row.get("car_model")]
    elif lt == "bike":
        parts = [row.get("year"), row.get("bike_brand"), row.get("bike_model")]
    elif lt == "plate":
        return (f"{row.get('code') or ''} {row.get('number') or ''}").strip() or str(row.get("id", ""))
    elif lt == "part":
        return row.get("part_name") or row.get("name") or str(row.get("id", ""))
    else:
        return str(row.get("id", ""))
    parts = [str(p) for p in parts if p]
    return " ".join(parts) or str(row.get("id", ""))


def _vin_listing_summary(normalized_type, item_id):
    """Title + primary thumbnail + public URL for one listing (viewer header)."""
    cfg = ADMIN_REPORT_TYPE_CONFIG.get(normalized_type)
    summary = {"title": str(item_id), "image_url": None, "public_url": None}
    if not cfg:
        return summary
    summary["public_url"] = f"{cfg['public_prefix']}/{item_id}"
    try:
        row_resp, sc = supabase_request(
            "get", f"/rest/v1/{cfg['table']}?id=eq.{item_id}&select={cfg['select']}&limit=1",
            use_service_role=True)
        if sc < 400 and isinstance(row_resp, list) and row_resp:
            summary["title"] = _vin_title(normalized_type, row_resp[0])
    except Exception as exc:
        logger.warning("VIN summary title fetch failed for %s/%s: %s", normalized_type, item_id, exc)
    try:
        img_resp, isc = supabase_request(
            "get", f"/rest/v1/{cfg['img_table']}?{cfg['img_fk']}=eq.{item_id}"
                   f"&select={cfg['img_fk']},url,display_url,image_url&limit=1",
            use_service_role=True)
        if isc < 400 and isinstance(img_resp, list) and img_resp:
            summary["image_url"] = (img_resp[0].get("display_url")
                                    or img_resp[0].get("image_url") or img_resp[0].get("url"))
    except Exception as exc:
        logger.warning("VIN summary image fetch failed for %s/%s: %s", normalized_type, item_id, exc)
    return summary


def _load_vin_activity_for_listing(normalized_type, item_id, days):
    """Targeted VIN-reveal activity for ONE listing — filters at the DB by
    listing_id + vin_reveal so we don't load the whole window's analytics."""
    cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()
    platform_events, ps = _fetch_all_rows(
        "/rest/v1/platform_events",
        {"select": "event_name,listing_type,listing_id,user_id,visitor_id,session_id,created_at",
         "event_name": "eq.vin_reveal", "listing_id": f"eq.{item_id}",
         "created_at": f"gte.{cutoff}", "order": "created_at.desc"})
    legacy_events, ls = _fetch_all_rows(
        "/rest/v1/lead_events",
        {"select": "action,listing_type,listing_id,user_id,session_id,payload,created_at",
         "action": "eq.vin_reveal", "listing_id": f"eq.{item_id}",
         "created_at": f"gte.{cutoff}", "order": "created_at.desc"})
    if ps >= 400 or ls >= 400:
        raise RuntimeError("Failed to load VIN reveal events")
    analytics = build_contact_analytics(platform_events or [], legacy_events or [], days, _utc_now())
    return build_vin_listing_activity(analytics, normalized_type, item_id)


@app.route("/api/admin/contact-analytics/vin-listings/<item_type>/<item_id>", methods=["GET"])
@token_required
def get_admin_vin_listing_activity(current_user, item_type, item_id):
    """Return safe actor-level VIN reveal history for one listing."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403
    normalized_type = item_type.rstrip("s")
    if not _resolve_listing_table(normalized_type):
        return jsonify({"error": "Invalid listing type"}), 400
    try:
        days = max(min(int(request.args.get("days", 30)), 90), 1)
        activity = _load_vin_activity_for_listing(normalized_type, item_id, days)
        rows = [{**row, "user_id": row["actor_id"]} for row in activity]
        rows = _admin_enrich_activity_rows(rows, "user_id")
        for row in rows:
            # A VIN reveal requires a logged-in, phone-verified account, so a
            # resolved account row always shows its name (falling back to the
            # username, or "Verified user" when no display name is set). Only a
            # pure visitor/session id with no account row is truly anonymous.
            if row.get("actor_username") or row.get("actor_email"):
                if row.get("actor_name") in (None, "", "Guest", "Unknown user"):
                    row["actor_name"] = row.get("actor_username") or "Verified user"
            else:
                row["actor_name"] = "Anonymous visitor"
            row.pop("actor_email", None)
            row.pop("actor_id", None)
            row.pop("user_id", None)
        return jsonify({"window_days": days, "listing_type": normalized_type,
                        "listing_id": str(item_id),
                        "listing": _vin_listing_summary(normalized_type, item_id),
                        "actors": rows}), 200
    except Exception as exc:
        logger.error("Failed loading VIN listing activity: %s", exc)
        return jsonify({"error": "Failed to fetch VIN reveal activity"}), 500



def _listing_source_kind(row):
    """Classify a listing by who posted it: reddit import, dealer, or member."""
    if str(row.get("source_platform") or "").lower() == "reddit":
        return "reddit"
    if row.get("is_dealer"):
        return "dealer"
    return "member"



def _admin_get_listing_meta(item_type):
    normalized = (item_type or "").strip().lower().rstrip("s")
    return LISTING_TABLE_CONFIG.get(normalized)


def _admin_fetch_user_rows(user_id):
    user_response, user_status = supabase_request(
        "get",
        f"/rest/v1/users?id=eq.{user_id}&select=*",
        use_service_role=True,
    )
    if user_status >= 400 or not user_response:
        return None
    return user_response[0]


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
        user_rows, user_status = supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "select": "id,username,display_name,first_name,last_name,email",
                "id": f"in.({','.join(chunk)})",
            },
            use_service_role=True,
        )
        if user_status >= 400:
            continue

        for row in user_rows or []:
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


def _admin_fetch_listing_rows(table_name, owner_user_id=None, item_id=None, limit=25):
    params = {"select": "*", "order": "created_at.desc", "limit": str(limit)}
    if owner_user_id:
        params["user_id"] = f"eq.{owner_user_id}"
    if item_id:
        params["id"] = f"eq.{item_id}"

    response, status_code = supabase_request(
        "get",
        f"/rest/v1/{table_name}",
        params=params,
        use_service_role=True,
    )
    if status_code >= 400:
        return []
    return response or []


def _admin_listing_brief(listing_type, listing):
    if not listing:
        return None

    title = (
        listing.get("listing_title")
        or listing.get("title")
        or listing.get("name")
        or listing.get("car_model")
        or listing.get("bike_model")
        or listing.get("code")
        or "Untitled listing"
    )
    price = (
        listing.get("display_price")
        or listing.get("price")
        or listing.get("expected_selling_price")
    )
    return {
        "id": listing.get("id"),
        "type": listing_type,
        "title": title,
        "status": listing.get("status") or "unknown",
        "view_count": int(listing.get("view_count") or 0),
        "price": price,
        "created_at": listing.get("created_at"),
        "last_viewed_at": listing.get("last_viewed_at"),
    }


def _canonical_visitor_key(row):
    """Return a canonical visitor identity for dedupe across sources.

    Priority: user_id (authoritative when authenticated) > visitor_id (anonymous
    tracker) > session_id (last resort). Returns None when nothing is available
    so callers can skip the row.
    """
    for field in ("user_id", "visitor_id", "session_id"):
        value = row.get(field)
        if value:
            return f"v:{value}"
    return None


def _admin_listing_matches_status(listing, status_filter):
    if not status_filter:
        return True

    normalized = str(status_filter).strip().lower()
    listing_status = str(listing.get("status") or "").strip().lower()
    listing_state = str(listing.get("listing_state") or "").strip().lower()
    auto_removed = bool(listing.get("auto_removed_at"))
    is_expired = bool(listing.get("is_expired"))

    if normalized == "expired":
        # Surface every listing whose lifecycle is past its expiry, including
        # those auto-removed after the sold-response window and those archived
        # past the 30-day retention window. Otherwise admins lose sight of
        # expired listings within hours of expiry.
        return (
            listing_state in {"expired", "archived"}
            or (auto_removed and is_expired)
        )
    if normalized == "active":
        return listing_state == "active"
    if normalized == "approved":
        return listing_status == "approved"
    if normalized == "pending":
        return listing_status in ("pending", "pending_auto_review")
    if normalized == "rejected":
        return listing_status == "rejected"
    if normalized == "deleted":
        # Anything currently in the deleted state — admin/seller delete OR the
        # auto-removed-for-expiry sweep. Auto-removed rows still also match the
        # Expired chip via the listing_state check above, so they show in both
        # places, which matches admins' intuition that a deleted listing is a
        # deleted listing.
        return listing_status == "deleted"
    return listing_status == normalized or listing_state == normalized


def _admin_listing_display_status(listing):
    # Moderation status takes priority over lifecycle. A pending/draft/rejected/
    # sold/deleted listing should never show as "active" in the admin UI just
    # because the expiry timer hasn't fired — that's how a "Pending" filter
    # ended up surfacing rows with an "Active" badge. Only when the moderation
    # status is 'approved' does the lifecycle decide active vs expired.
    listing_status = str(listing.get("status") or "").strip().lower()
    listing_state = str(listing.get("listing_state") or "").strip().lower()

    moderation_override = {"pending", "pending_auto_review", "draft", "rejected", "sold", "deleted", "suspended"}
    if listing_status in moderation_override:
        return "pending" if listing_status == "pending_auto_review" else listing_status

    if listing.get("auto_removed_at") and listing.get("is_expired"):
        return "expired"
    if listing_state in {"active", "expired", "archived"}:
        return listing_state
    return listing_status or "pending"


def _verification_scan_key(listing_type, listing_id):
    normalized_type = str(listing_type or "").strip().lower().rstrip("s")
    normalized_id = str(listing_id or "").strip()
    return normalized_type, normalized_id


def _verification_status_from_scan(scan):
    scan = scan or {}
    vin_validation = scan.get("vin_validation") or {}
    confidence = scan.get("confidence") or {}
    fields = scan.get("fields") or {}
    return {
        "needs_review": bool(scan.get("needs_review")),
        "vin_valid": bool(vin_validation.get("valid") or vin_validation.get("is_valid")),
        "confidence": float(confidence.get("overall") or 0),
        "fields": {
            "make": fields.get("make"),
            "model": fields.get("model"),
            "year": fields.get("year"),
            "vin": fields.get("vin"),
        },
    }


def _admin_fetch_latest_verification_scans(listing_refs):
    refs_by_type = defaultdict(set)
    for listing_type, listing_id in listing_refs or []:
        normalized_type, normalized_id = _verification_scan_key(listing_type, listing_id)
        if normalized_type and normalized_id:
            refs_by_type[normalized_type].add(normalized_id)

    latest_scans = {}
    for listing_type, listing_ids in refs_by_type.items():
        if not listing_ids:
            continue
        rows, status_code = supabase_request(
            "get",
            "/rest/v1/listing_verification_scans",
            params={
                "select": "id,listing_type,listing_id,document_type,raw_text,fields,vin_validation,confidence,needs_review,created_at",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"in.({','.join(sorted(listing_ids))})",
                "order": "created_at.desc",
                "limit": str(max(len(listing_ids) * 5, 25)),
            },
            use_service_role=True,
        )
        if status_code >= 400:
            continue

        for row in rows or []:
            key = _verification_scan_key(row.get("listing_type"), row.get("listing_id"))
            if key not in latest_scans:
                latest_scans[key] = row

    return latest_scans


def _admin_attach_latest_verification_scan(listing, latest_scan_map=None):
    if not listing:
        return listing

    listing_type = listing.get("listing_type") or listing.get("type")
    listing_id = listing.get("id")
    if latest_scan_map is None:
        latest_scan_map = _admin_fetch_latest_verification_scans(
            [(listing_type, listing_id)]
        )
    latest_scan = latest_scan_map.get(_verification_scan_key(listing_type, listing_id))
    listing["latest_verification_scan"] = latest_scan
    listing["verification_status"] = _verification_status_from_scan(latest_scan)
    return listing


def _admin_collect_owned_listing_stats(user_id):
    summary = {
        "cars": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
        "bikes": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
        "parts": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
        "plates": {"count": 0, "views": 0, "pending": 0, "approved": 0, "rejected": 0},
    }
    recent_listings = []
    owned_listing_ids = defaultdict(list)

    for listing_type, config in LISTING_TABLE_CONFIG.items():
        rows = _admin_fetch_listing_rows(
            config["table"], owner_user_id=user_id, limit=50
        )
        stats = summary[listing_type if listing_type != "part" else "parts"]
        for row in rows:
            stats["count"] += 1
            stats["views"] += int(row.get("view_count") or 0)
            status = (row.get("status") or "pending").lower()
            if status in stats:
                stats[status] += 1
            owned_listing_ids[listing_type].append(str(row.get("id")))
            brief = _admin_listing_brief(listing_type, row)
            if brief:
                recent_listings.append(brief)

    recent_listings.sort(
        key=lambda item: item.get("created_at") or "",
        reverse=True,
    )

    return summary, recent_listings[:20], owned_listing_ids


def _admin_collect_user_events(user_id, owned_listing_ids, days=90):
    cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()
    lead_events_resp, lead_events_status = supabase_request(
        "get",
        "/rest/v1/lead_events",
        params={
            "select": "*",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": "2000",
        },
        use_service_role=True,
    )
    if lead_events_status >= 400:
        lead_events_resp = []

    report_resp, report_status = supabase_request(
        "get",
        "/rest/v1/reports",
        params={
            "select": "id,listing_id,listing_type,status,reason,details,created_at,reviewed_by,reviewed_at",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": "500",
        },
        use_service_role=True,
    )
    if report_status >= 400:
        report_resp = []

    recent_events = []
    lead_totals = defaultdict(int)
    for event in lead_events_resp or []:
        listing_type = (event.get("listing_type") or "").rstrip("s")
        listing_id = str(event.get("listing_id"))
        if listing_id in owned_listing_ids.get(listing_type, []):
            recent_events.append(event)
            lead_totals[event.get("action") or "unknown"] += 1

    recent_events = _admin_enrich_activity_rows(recent_events, "user_id")

    user_reports = []
    owned_listing_set = {
        listing_id for ids in owned_listing_ids.values() for listing_id in ids
    }
    for report in report_resp or []:
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


def _admin_collect_dealer_stats(dealer_id):
    return _admin_collect_owned_listing_stats(dealer_id)


# ─── Admin "request more info" dealer flow ────────────────────────────────────

DEALER_INFO_REQUEST_TTL_DAYS = int(os.getenv("DEALER_INFO_REQUEST_TTL_DAYS", "14"))


def _dealer_document_type_from_label(label):
    """Map the admin's human-facing request labels back to canonical KYC types."""
    normalized = re.sub(r"[^a-z0-9]+", "_", str(label or "").lower()).strip("_")
    aliases = {
        "trade_license": "trade_license",
        "trade_licence": "trade_license",
        "company_registration": "company_registration",
        "company_registration_document": "company_registration",
        "tax_registration": "tax_registration",
        "tax_registration_trn": "tax_registration",
        "trn": "tax_registration",
    }
    if normalized in aliases:
        return aliases[normalized]
    # Admins can add clarifying language (for example, "Trade License - clear
    # scan") without turning a recovery upload into an orphaned attachment.
    if "trade" in normalized and ("license" in normalized or "licence" in normalized):
        return "trade_license"
    if "company" in normalized and ("registration" in normalized or "certificate" in normalized):
        return "company_registration"
    if "tax" in normalized or "trn" in normalized:
        return "tax_registration"
    return None


def _send_info_request_email(email, dealer_name, documents, message, link_url):
    """Email a dealer asking them to upload additional documents."""
    if not email or not EMAIL_REGEX.match(email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

    doc_list_html = "".join(
        f'<li style="color:#cbd5e1;margin-bottom:6px;">{doc}</li>'
        for doc in (documents or [])
        if doc
    )
    message_block = (
        f'<p style="color:#94a3b8;line-height:1.6;margin:0 0 20px;">{message}</p>'
        if message
        else ""
    )

    name_part = f", {dealer_name}" if dealer_name else ""

    html_content = f"""
    <div style="font-family:'Inter',-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background-color:#041008;color:#f0fdf4;border-radius:24px;border:1px solid rgba(139,214,180,0.1);">
        <div style="text-align:center;margin-bottom:32px;">
            <div style="font-size:28px;font-weight:800;color:#8bd6b4;letter-spacing:-0.02em;">DPH<span style="color:#ffffff;">CLASSIFIEDS</span></div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border-radius:20px;padding:32px;border:1px solid rgba(255,255,255,0.05);margin-bottom:24px;">
            <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;font-weight:700;">Additional documents required</h2>
            <p style="color:#94a3b8;line-height:1.6;margin:0 0 20px;">
                Hi{name_part}, our review team needs a few more documents to continue verifying your dealer account.
            </p>
            {message_block}
            <p style="color:#cbd5e1;line-height:1.6;margin:0 0 12px;font-weight:600;">Please upload the following:</p>
            <ul style="padding-left:22px;margin:0 0 24px;">{doc_list_html}</ul>
            <a href="{link_url}" style="display:inline-block;background:#8bd6b4;color:#041008;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">Upload documents</a>
            <p style="color:#64748b;font-size:12px;margin-top:24px;">This link expires in {DEALER_INFO_REQUEST_TTL_DAYS} days. If you have any questions, just reply to this email.</p>
        </div>
        <div style="text-align:center;color:#64748b;font-size:13px;">
            <p>&copy; {datetime.datetime.now().year} DPH Classifieds. All rights reserved.</p>
        </div>
    </div>
    """

    payload = {
        "from": from_email,
        "to": [email],
        "subject": "Additional documents required for your dealer verification",
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to
    return _send_resend_email(payload, email_type="info_request")



def _send_document_denial_email(email, doc_type_name, reason, fix_hint, origin=None):
    """Send email when a dealer document is denied"""
    if not MAIL_ENABLED or not mail:
        return None, "Email not configured"

    try:
        base_url = (
            origin or os.getenv("FRONTEND_URL", "https://dphclassifieds.com")
        ).rstrip("/")
        subject = f"Document Update Required - {doc_type_name}"

        html_body = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #e74c3c;">Document Review Update</h2>
            <p>Hello,</p>
            <p>Your <strong>{doc_type_name}</strong> document has been reviewed and requires an update.</p>
            <div style="background: #fdf2f2; border-left: 4px solid #e74c3c; padding: 15px; margin: 20px 0;">
                <p style="margin: 0 0 8px 0;"><strong>Reason:</strong></p>
                <p style="margin: 0;">{reason}</p>
            </div>
            <div style="background: #fff3cd; border-left: 4px solid #f39c12; padding: 15px; margin: 20px 0;">
                <p style="margin: 0 0 8px 0;"><strong>How to fix:</strong></p>
                <p style="margin: 0;">{fix_hint}</p>
            </div>
            <p>Please log in to your account and re-upload a corrected version of this document.</p>
            <a href="{base_url}/account-settings" style="display: inline-block; background: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 15px 0;">Upload New Document</a>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">If you have questions, please contact our support team.</p>
        </div>
        """

        msg = MailMessage(
            subject=subject,
            recipients=[email],
            html=html_body,
            sender=app.config.get("MAIL_DEFAULT_SENDER", "noreply@dphclassifieds.com"),
        )
        mail.send(msg)
        logger.info(f"Document denial email sent to {email} for {doc_type_name}")
        return True, None
    except Exception as e:
        logger.error(f"Failed to send document denial email: {e}")
        return None, str(e)


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


@app.route("/api/admin/deleted-listings", methods=["GET"])
@token_required
def get_deleted_listings(current_user):
    """Return deleted listings from deletion events table with filtering."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        listing_type = request.args.get("type", "").strip()
        limit = max(min(int(request.args.get("limit", 100)), 500), 1)
        offset = max(int(request.args.get("offset", 0)), 0)

        params = {
            "select": "*",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        }

        deleted_type_map = {
            "car": "car",
            "cars": "car",
            "bike": "bike",
            "bikes": "bike",
            "part": "part",
            "parts": "part",
            "plate": "plate",
            "plates": "plate",
            "buying_request": "buying_request",
            "buying_requests": "buying_request",
        }
        if listing_type and listing_type in deleted_type_map:
            params["listing_type"] = f"eq.{deleted_type_map[listing_type]}"

        response, status_code = supabase_request(
            "get",
            "/rest/v1/listing_deletion_events",
            params=params,
            use_service_role=True,
        )

        if status_code not in (200, 201):
            logger.error(f"Failed to fetch deleted listings: {response}")
            return jsonify({"events": [], "total": 0}), 500

        events = response if isinstance(response, list) else []

        return jsonify({"events": events, "total": len(events)})

    except Exception as e:
        logger.error(f"Error fetching deleted listings: {e}")
        return jsonify({"events": [], "total": 0, "error": str(e)}), 500


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


def _run_dealer_doc_expiry_reminders_once(reminder_days_before=30):
    """Nudge dealers whose trade license (or other required docs) expires soon.

    Runs once per call. Designed to be invoked from a daily worker thread.
    Idempotent: a row is re-reminded at most once per week thanks to the
    expiry_reminder_sent_at stamp.
    """
    try:
        today = datetime.datetime.now(datetime.timezone.utc).date()
        cutoff = today + datetime.timedelta(days=reminder_days_before)
        # Pull active docs expiring within the window.
        params = {
            "select": "id,user_id,document_type,expires_at,expiry_reminder_sent_at",
            "replaced_at": "is.null",
            "expires_at": f"lte.{cutoff.isoformat()}",
        }
        rows, status = supabase_request(
            "get", "/rest/v1/dealer_documents", params=params, use_service_role=True
        )
        if status >= 400:
            logger.warning(f"dealer doc reminder query failed: {status} {rows}")
            return 0
        sent = 0
        for row in rows or []:
            try:
                expires_at = row.get("expires_at")
                if not expires_at:
                    continue
                exp_date = datetime.datetime.fromisoformat(str(expires_at)).date()
                days_left = (exp_date - today).days
                last_sent = _parse_datetime(row.get("expiry_reminder_sent_at"))
                if last_sent and (
                    datetime.datetime.now(datetime.timezone.utc) - last_sent
                ).days < 7:
                    continue
                # Look up owner contact.
                owner_resp, owner_status = supabase_request(
                    "get",
                    f"/rest/v1/users?id=eq.{row['user_id']}&select=email,phone,country_code,first_name,legal_business_name,company_name",
                    use_service_role=True,
                )
                if owner_status >= 400 or not owner_resp:
                    continue
                owner = owner_resp[0]
                business_name = (
                    owner.get("legal_business_name")
                    or owner.get("company_name")
                    or owner.get("first_name")
                    or "your business"
                )
                doc_label = (row.get("document_type") or "document").replace("_", " ")
                if days_left < 0:
                    headline = f"Your {doc_label} expired {abs(days_left)} day(s) ago"
                elif days_left == 0:
                    headline = f"Your {doc_label} expires today"
                else:
                    headline = f"Your {doc_label} expires in {days_left} day(s)"
                renew_url = f"{SITE_URL}/dealer/settings"
                # Email
                from_email = os.getenv("RESEND_FROM_EMAIL")
                if owner.get("email") and from_email and EMAIL_REGEX.match(owner["email"]):
                    _send_resend_email({
                        "from": from_email,
                        "to": [owner["email"]],
                        "subject": f"DPH Classifieds: {headline}",
                        "html": (
                            f"<p>Hi {business_name},</p>"
                            f"<p><strong>{headline}</strong>. Please upload a current "
                            f"{doc_label} from your dealer dashboard to keep posting new listings.</p>"
                            f'<p><a href="{renew_url}" style="background:#8bd6b4;color:#041008;'
                            f'padding:10px 20px;border-radius:8px;text-decoration:none;'
                            f'font-weight:600">Upload new {doc_label}</a></p>'
                        ),
                    })
                # Stamp reminder so we don't spam.
                supabase_request(
                    "patch",
                    f"/rest/v1/dealer_documents?id=eq.{row['id']}",
                    data={"expiry_reminder_sent_at": _isoformat_utc(_utc_now())},
                    use_service_role=True,
                )
                sent += 1
            except Exception as row_err:
                logger.warning(
                    f"dealer doc reminder skipped one row: {row_err}", exc_info=False
                )
                continue
        if sent:
            logger.info(f"dealer doc expiry reminders sent: {sent}")
        return sent
    except Exception as exc:
        logger.error(f"dealer doc expiry reminder sweep failed: {exc}", exc_info=True)
        return 0


def _run_listing_expiry_reminders_once(reminder_days_before=2):
    if not LISTING_EXPIRY_EMAILS_ENABLED:
        logger.info("Listing expiry emails disabled via env; skipping reminder run")
        return {"reminders_sent": 0}
    processed = 0
    now = _utc_now()
    reminder_threshold = now + datetime.timedelta(days=reminder_days_before)

    for item_type, config in LISTING_TABLE_CONFIG.items():
        table = config["table"]
        base_params = {
            "expires_at": f"lte.{_isoformat_utc(reminder_threshold)}",
            "status": "in.(approved,active)",
            "is_archived": "eq.false",
            "deleted_at": "is.null",
        }
        records, status = supabase_request(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": (
                    "id,user_id,user_email,contact_email,listing_title,expires_at,"
                    "expired_at,retention_expires_at,status,is_archived,"
                    "last_extended_at,sold_status,deleted_at,"
                    "expiry_reminder_sent_at,expired_email_sent_at"
                ),
                **base_params,
            },
            use_service_role=True,
        )
        if status >= 400 and _looks_like_missing_column(
            records, "expiry_reminder_sent_at", "expired_email_sent_at"
        ):
            # Migration not applied — retry without cooldown columns (degraded, no idempotency)
            records, status = supabase_request(
                "get",
                f"/rest/v1/{table}",
                params={
                    "select": (
                        "id,user_id,user_email,contact_email,listing_title,expires_at,"
                        "expired_at,retention_expires_at,status,is_archived,"
                        "last_extended_at,sold_status,deleted_at"
                    ),
                    **base_params,
                },
                use_service_role=True,
            )
        if status >= 400 or not records:
            continue

        for record in records:
            listing_id = record.get("id")
            lifecycle = _compute_listing_lifecycle(record)
            _log_listing_expiry_decision(
                "processing_listing_expiry_job",
                listingId=listing_id,
                jobExpiresAt=_isoformat_utc(lifecycle.get("expires_at")),
                dbExpiresAt=record.get("expires_at"),
                status=record.get("status"),
                deletedAt=record.get("deleted_at"),
                expiryReminderSentAt=record.get("expiry_reminder_sent_at"),
                expiredEmailSentAt=record.get("expired_email_sent_at"),
                source="scanner",
            )
            if _is_listing_deleted(record):
                _log_listing_expiry_decision(
                    "skipping_listing_expiry_job",
                    listingId=listing_id,
                    table=table,
                    reason="listing_deleted",
                )
                continue
            if lifecycle["is_archived"]:
                continue

            expires_at = lifecycle["expires_at"]
            if expires_at > reminder_threshold:
                continue

            # Skip if the listing was renewed/extended after the expiry it appears to be in
            last_extended_at = _parse_datetime(record.get("last_extended_at"))
            if (
                last_extended_at
                and lifecycle["is_expired"]
                and lifecycle["expired_at"]
                and last_extended_at >= lifecycle["expired_at"]
            ):
                _log_listing_expiry_decision(
                    "skipping_listing_expiry_job",
                    listingId=listing_id,
                    table=table,
                    reason="stale_renewed_listing",
                )
                continue

            notice_state = "expired" if lifecycle["is_expired"] else "active"
            email_field = (
                "expired_email_sent_at"
                if lifecycle["is_expired"]
                else "expiry_reminder_sent_at"
            )
            # Cooldown columns only present when migration applied; degrade to no-idempotency otherwise
            cooldown_cols_present = (
                "expiry_reminder_sent_at" in record or "expired_email_sent_at" in record
            )
            if cooldown_cols_present and record.get(email_field):
                _log_listing_expiry_decision(
                    "skipping_listing_expiry_job",
                    listingId=listing_id,
                    table=table,
                    reason="email_already_sent",
                    emailField=email_field,
                )
                continue

            owner_email = _resolve_listing_owner_email(record, record.get("user_id"))
            if not owner_email:
                _log_listing_expiry_decision(
                    "skipping_listing_expiry_job",
                    listingId=listing_id,
                    table=table,
                    reason="missing_owner_email",
                )
                continue

            if cooldown_cols_present:
                claimed_record = _claim_listing_expiry_email(
                    table,
                    listing_id,
                    expires_at,
                    email_field,
                    mark_expired=lifecycle["is_expired"] and not record.get("expired_at"),
                )
                if not claimed_record:
                    _log_listing_expiry_decision(
                        "skipping_listing_expiry_job",
                        listingId=listing_id,
                        table=table,
                        reason="atomic_claim_failed",
                        emailField=email_field,
                    )
                    continue
                record.update(claimed_record)

            listing_title = _listing_display_title(record)
            if lifecycle["is_expired"]:
                days_until_deletion = max((lifecycle["retention_expires_at"] - now).days, 1)
                result, error = _send_listing_expired_email(
                    owner_email,
                    listing_title,
                    table,
                    listing_id,
                    days_until_deletion,
                )
            else:
                days_left = max((expires_at - now).days, 1)
                result, error = _send_listing_expiry_reminder(
                    owner_email,
                    listing_title,
                    table,
                    listing_id,
                    days_left,
                )

            if error or not result:
                logger.warning(
                    "Failed to send expiry notice for %s/%s: %s",
                    table,
                    listing_id,
                    error or "unknown error",
                )
                continue

            _record_listing_expiry_notice_event(
                listing_id=listing_id,
                listing_type=item_type,
                metadata={
                    "table": table,
                    "state": notice_state,
                    "notice_date": now.date().isoformat(),
                    "notice_phase": notice_state,
                    "expires_at": _isoformat_utc(lifecycle["expires_at"]),
                    "retention_expires_at": _isoformat_utc(
                        lifecycle["retention_expires_at"]
                    ),
                },
            )
            processed += 1

    return {"reminders_sent": processed}


def _run_listing_lifecycle_sweep_once():
    processed = 0
    expired = 0
    deleted = 0

    for item_type, config in LISTING_TABLE_CONFIG.items():
        table = config["table"]
        records, status = supabase_request(
            "get",
            f"/rest/v1/{table}",
            params={
                "select": (
                    "id,user_id,expires_at,expired_at,retention_expires_at,"
                    "sold_response_deadline,status,is_archived,sold_status,"
                    "sold_status_set_at,auto_removed_at,deleted_at,"
                    "expiry_reminder_sent_at,expired_email_sent_at"
                ),
                "status": "in.(approved,active)",
                "is_archived": "eq.false",
                "deleted_at": "is.null",
            },
            use_service_role=True,
        )
        if status >= 400 or not records:
            continue

        for record in records:
            processed += 1
            before_status = record.get("status")
            before_expired = bool(record.get("expired_at"))
            synced = _sync_listing_lifecycle(table, record, hard_delete_archived=True)
            if not synced:
                deleted += 1
                continue
            if not before_expired and synced.get("expired_at"):
                expired += 1
            if before_status != synced.get("status") and synced.get("status") == "deleted":
                deleted += 1

    return {
        "processed": processed,
        "expired": expired,
        "deleted": deleted,
    }


# Admin routes are registered at the top of the file (after imports)
# No need to register again here

@app.route("/api/admin/cache/flush", methods=["POST"])
@token_required
def admin_flush_cache(current_user):
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Admin access required"}), 403

    types = request.json.get("types") if request.is_json else None
    if not types:
        types = ["cars", "bikes", "parts", "plates", "buying_requests"]

    flushed = []
    for t in types:
        _invalidate_public_inventory_cache(t)
        flushed.append(t)

    redis_client = _get_redis_cache_client()
    redis_ok = redis_client is not None
    return jsonify({"ok": True, "flushed": flushed, "redis": redis_ok}), 200


@app.route("/api/admin/auto-review/settings", methods=["GET", "PATCH"])
@token_required
def admin_auto_review_settings(current_user):
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Admin access required"}), 403

    env_enabled = (os.getenv("AUTO_REVIEW_WORKER_ENABLED") or "false").strip().lower() in ("1", "true", "yes", "on")
    rc = _get_redis_cache_client()

    if request.method == "PATCH":
        body = request.get_json(silent=True) or {}
        enabled = bool(body.get("enabled", False))
        if rc:
            try:
                rc.set("ar:enabled", "1" if enabled else "0")
                return jsonify({"enabled": enabled, "source": "redis"}), 200
            except Exception as exc:
                return jsonify({"error": f"Redis error: {exc}"}), 500
        return jsonify({"error": "Redis unavailable — set AUTO_REVIEW_WORKER_ENABLED env var instead"}), 503

    # GET
    redis_val = None
    if rc:
        try:
            redis_val = rc.get("ar:enabled")
        except Exception:
            pass
    if redis_val is not None:
        return jsonify({"enabled": redis_val == "1", "source": "redis", "env_enabled": env_enabled}), 200
    return jsonify({"enabled": env_enabled, "source": "env", "env_enabled": env_enabled}), 200


@app.route("/api/admin/reddit-listings/settings", methods=["GET", "PATCH"])
@token_required
def admin_reddit_listings_settings(current_user):
    """Kill switch for Reddit-imported listings' public visibility. Hiding
    bulk-sets is_approved=false on every reddit row across all listing tables
    (they vanish from every public view, which all filter is_approved=true);
    showing restores is_approved=true. The worker respects the same flag so it
    won't re-show them on the next import tick."""
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Admin access required"}), 403

    env_enabled = (os.getenv("REDDIT_LISTINGS_VISIBLE") or "true").strip().lower() in ("1", "true", "yes", "on")
    rc = _get_redis_cache_client()

    if request.method == "PATCH":
        body = request.get_json(silent=True) or {}
        enabled = bool(body.get("enabled", False))
        if not rc:
            return jsonify({"error": "Redis unavailable — set REDDIT_LISTINGS_VISIBLE env var instead"}), 503
        try:
            rc.set("reddit:visible", "1" if enabled else "0")
        except Exception as exc:
            return jsonify({"error": f"Redis error: {exc}"}), 500
        # Bulk-flip existing reddit rows so the change is immediate.
        updated = 0
        for table in _REDDIT_LISTING_TABLES:
            _, status_code = supabase_request(
                "patch", f"/rest/v1/{table}?source_platform=eq.reddit",
                data={"is_approved": enabled}, use_service_role=True,
            )
            if status_code >= 400:
                logger.warning("reddit visibility: failed to update %s (%s)", table, status_code)
            else:
                updated += 1
        for t in ("cars", "bikes", "parts", "plates"):
            _invalidate_public_inventory_cache(t)
        return jsonify({"enabled": enabled, "source": "redis", "tables_updated": updated}), 200

    # GET
    redis_val = None
    if rc:
        try:
            redis_val = rc.get("reddit:visible")
        except Exception:
            pass
    if redis_val is not None:
        return jsonify({"enabled": redis_val == "1", "source": "redis", "env_enabled": env_enabled}), 200
    return jsonify({"enabled": env_enabled, "source": "env", "env_enabled": env_enabled}), 200


@app.route("/api/admin/reddit-explore/settings", methods=["GET", "PATCH"])
@token_required
def admin_reddit_explore_settings(current_user):
    """Toggle whether Reddit-imported listings are mixed into the MAIN explore
    feed. Unlike the visibility kill-switch, this does NOT touch is_approved on
    rows — the list endpoints read the flag at request time. Requires reddit
    listings to also be visible (reddit:visible) to actually show."""
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Admin access required"}), 403

    env_enabled = (os.getenv("REDDIT_ON_EXPLORE") or "false").strip().lower() in ("1", "true", "yes", "on")
    rc = _get_redis_cache_client()

    if request.method == "PATCH":
        body = request.get_json(silent=True) or {}
        enabled = bool(body.get("enabled", False))
        if not rc:
            return jsonify({"error": "Redis unavailable — set REDDIT_ON_EXPLORE env var instead"}), 503
        try:
            rc.set("reddit:on_explore", "1" if enabled else "0")
        except Exception as exc:
            return jsonify({"error": f"Redis error: {exc}"}), 500
        # Refresh the public feed so the change is immediate.
        for t in ("cars", "bikes", "parts", "plates"):
            _invalidate_public_inventory_cache(t)
        return jsonify({"enabled": enabled, "source": "redis"}), 200

    # GET
    redis_val = None
    if rc:
        try:
            redis_val = rc.get("reddit:on_explore")
        except Exception:
            pass
    if redis_val is not None:
        return jsonify({"enabled": redis_val == "1", "source": "redis", "env_enabled": env_enabled}), 200
    return jsonify({"enabled": env_enabled, "source": "env", "env_enabled": env_enabled}), 200


@app.route("/api/admin/google-signin/settings", methods=["GET", "PATCH"])
@token_required
def admin_google_signin_settings(current_user):
    """Toggle whether the Google sign-in button is offered on login/signup.
    Redis-backed (auth:google_enabled), env fallback GOOGLE_SIGNIN_ENABLED.
    ponytail: hides the entry point; a full block of Supabase OAuth would also
    need the provider disabled in the Supabase dashboard."""
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Admin access required"}), 403

    env_enabled = (os.getenv("GOOGLE_SIGNIN_ENABLED") or "true").strip().lower() in ("1", "true", "yes", "on")
    rc = _get_redis_cache_client()

    if request.method == "PATCH":
        body = request.get_json(silent=True) or {}
        enabled = bool(body.get("enabled", False))
        if not rc:
            return jsonify({"error": "Redis unavailable — set GOOGLE_SIGNIN_ENABLED env var instead"}), 503
        try:
            rc.set("auth:google_enabled", "1" if enabled else "0")
        except Exception as exc:
            return jsonify({"error": f"Redis error: {exc}"}), 500
        return jsonify({"enabled": enabled, "source": "redis"}), 200

    # GET
    redis_val = None
    if rc:
        try:
            redis_val = rc.get("auth:google_enabled")
        except Exception:
            pass
    if redis_val is not None:
        return jsonify({"enabled": redis_val == "1", "source": "redis", "env_enabled": env_enabled}), 200
    return jsonify({"enabled": env_enabled, "source": "env", "env_enabled": env_enabled}), 200


@app.route("/api/config/google-signin", methods=["GET"])
def public_google_signin_config():
    """Public read so the login/signup pages know whether to show the Google
    button. No auth — exposes a single boolean, nothing sensitive."""
    return jsonify({"enabled": _google_signin_enabled()}), 200


@app.route("/api/admin/auto-review/run", methods=["POST"])
@token_required
def admin_auto_review_run(current_user):
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    listing_id = data.get("listing_id")
    listing_type = data.get("listing_type")  # plural: "cars", "bikes", "parts", "plates"

    # If a specific listing is targeted, reset it to pending_auto_review so the
    # sweep picks it up regardless of any previous auto-review decision.
    if listing_id and listing_type and listing_type in ADMIN_ITEM_TYPE_TO_TABLE:
        table = ADMIN_ITEM_TYPE_TO_TABLE[listing_type]
        supabase_request(
            "patch",
            f"/rest/v1/{table}?id=eq.{listing_id}",
            data={
                "status": "pending_auto_review",
                "auto_review_decided_at": None,
                "auto_review_state": None,
                "auto_review_reasons": [],
            },
            use_service_role=True,
        )

    import threading as _threading
    result_box = {}

    def _run():
        try:
            from workers.auto_review_worker import (
                process_once,
                fetch_pending_for_type,
                build_signals_for,
                record_decision_for,
                downgrade_to_pending_for,
                _approve_via_helper,
            )
            from services.auto_review.rules import evaluate as rules_evaluate
            result_box["processed"] = process_once(
                fetch_pending=fetch_pending_for_type,
                build_signals=build_signals_for,
                evaluate=lambda kind, listing, signals: rules_evaluate(
                    kind, listing=listing, signals=signals
                ),
                approve=_approve_via_helper,
                record_decision=record_decision_for,
                downgrade_to_pending=downgrade_to_pending_for,
                dry_run=False,
            )
        except Exception as exc:
            result_box["error"] = str(exc)

    t = _threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=30)
    if "error" in result_box:
        return jsonify({"error": result_box["error"]}), 500
    return jsonify({"ok": True, "processed": result_box.get("processed", 0)}), 200
def _send_dealer_verification_update_admin_notification(user_row, message_text, context=None):
    """Email every admin when a dealer sends an update from the verification
    status page. Mirrors the layout of the existing new-listing /
    upgrade-request admin notifications so the inbox looks consistent.
    """
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"
    admin_emails = _fetch_all_admin_emails()
    fallback = os.getenv("RESEND_TO_EMAIL") or PRIMARY_SUPER_ADMIN_EMAIL
    if not admin_emails:
        admin_emails = [fallback]
    dealer_label = ((user_row or {}).get("legal_business_name")
                    or (user_row or {}).get("company_name")
                    or (user_row or {}).get("email")
                    or "Dealer")
    safe_message = (message_text or "").strip()[:1500]
    safe_context = (context or "").strip()[:200]
    context_block = (
        f"<p style='margin:6px 0 0;color:#94a3b8;font-size:13px;'>Context: {xml_escape(safe_context)}</p>"
        if safe_context else ""
    )
    subject = f"[Dealer] Verification update — {dealer_label}"
    html = (
        "<div style=\"font-family:'Inter',-apple-system,sans-serif;max-width:600px;margin:0 auto;"
        "padding:24px;background:#041008;color:#f0fdf4;\">"
        "<h2 style=\"color:#8bd6b4;margin-top:0;\">Dealer sent a verification update</h2>"
        f"<p><strong>Dealer:</strong> {xml_escape(dealer_label)}</p>"
        f"<p><strong>Email:</strong> {xml_escape((user_row or {}).get('email') or '—')}</p>"
        f"{context_block}"
        "<p style='margin-top:18px;'><strong>Message:</strong></p>"
        f"<blockquote style=\"border-left:3px solid #8bd6b4;padding-left:12px;margin-left:0;\">"
        f"{xml_escape(safe_message).replace(chr(10), '<br>')}</blockquote>"
        f"<p style='margin-top:24px;'>"
        f"<a href=\"{SITE_URL}/admin/dealers\" "
        "style=\"background:#8bd6b4;color:#041008;padding:12px 20px;border-radius:8px;"
        "text-decoration:none;font-weight:600;\">Review in admin panel</a></p>"
        "</div>"
    )
    return _send_resend_email(
        {"from": from_email, "to": admin_emails, "subject": subject, "html": html},
        email_type="dealer_verification_update",
    )


# Public authentication handlers are registered only after app.py has finished
# defining their shared helpers, then receive a snapshot of the backend symbol
# table for compatibility with the legacy implementation.
try:
    from routes.auth_public import (
        check_username_availability,
        login,
        register_auth_public_routes,
        signup,
    )

    register_auth_public_routes(app, globals())
    logger.info("Public authentication routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register public authentication routes: {e}")

# Runtime dependency registry used by extracted route modules.  Keeping the
# registry on the Flask app avoids circular imports from the compatibility
# root while allowing tests to patch the original functions in place.
app.extensions["dph_user_backend"] = globals()

try:
    from routes.user_listing_index import (
        get_all_user_listings,
        get_user_bikes,
        get_user_cars,
        get_user_parts,
        get_user_plates,
        register_user_listing_index_routes,
    )

    register_user_listing_index_routes(app)
    logger.info("User listing inventory routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register user listing inventory routes: {e}")

try:
    from routes.user_listing_actions import (
        dismiss_user_listing,
        register_user_listing_action_routes,
    )

    register_user_listing_action_routes(app)
    logger.info("User listing action routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register user listing action routes: {e}")

try:
    from routes.contact import register_contact_routes, send_contact_message

    register_contact_routes(app)
    logger.info("Contact route registered successfully")
except Exception as e:
    logger.error(f"Failed to register contact route: {e}")

try:
    from routes.car_model_request import (
        register_car_model_request_routes,
        send_car_model_request,
    )

    register_car_model_request_routes(app)
    logger.info("Car model request route registered successfully")
except Exception as e:
    logger.error(f"Failed to register car model request route: {e}")

try:
    from routes.storage_upload import (
        create_storage_signed_upload_url,
        register_storage_upload_routes,
    )

    register_storage_upload_routes(app)
    logger.info("Storage signed-upload route registered successfully")
except Exception as e:
    logger.error(f"Failed to register storage signed-upload route: {e}")

try:
    from routes.featured_listings import (
        DEFAULT_FEATURED_PLACEMENT_PATTERN,
        FEATURED_PLACEMENT_MAX_COUNT,
        FEATURED_PLACEMENT_MAX_SEGMENTS,
        FEATURED_PLACEMENT_REDIS_KEY,
        _hydrate_featured_rows,
        _resolve_featured_listing_meta,
        _validate_featured_placement_pattern,
        admin_create_featured_listing,
        admin_delete_featured_listing,
        admin_featured_placement_settings,
        admin_list_featured_listings,
        admin_update_featured_listing,
        public_featured_placement_pattern,
        public_list_featured_listings,
        register_featured_listing_routes,
    )

    register_featured_listing_routes(app)
    logger.info("Featured-listing routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register featured-listing routes: {e}")

try:
    from routes.admin_saved_searches import (
        get_admin_saved_searches,
        register_admin_saved_search_routes,
    )

    register_admin_saved_search_routes(app)
    logger.info("Admin saved-search route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin saved-search route: {e}")

try:
    from routes.admin_check import admin_check, register_admin_check_routes

    register_admin_check_routes(app)
    logger.info("Admin status route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin status route: {e}")

try:
    from routes.users_legacy import get_users, register_legacy_user_routes

    register_legacy_user_routes(app)
    logger.info("Legacy user-list route registered successfully")
except Exception as e:
    logger.error(f"Failed to register legacy user-list route: {e}")

try:
    from routes.license_plates_legacy import (
        get_license_plates,
        register_license_plate_legacy_routes,
    )

    register_license_plate_legacy_routes(app)
    logger.info("Legacy license-plate route registered successfully")
except Exception as e:
    logger.error(f"Failed to register legacy license-plate route: {e}")

try:
    from routes.listing_details import get_part_details, get_plate_details

    logger.info("Plate and car-part detail helpers registered successfully")
except Exception as e:
    logger.error(f"Failed to register plate/part detail helpers: {e}")

try:
    from routes.car_detail import get_car_by_id, register_car_detail_routes

    register_car_detail_routes(app)
    logger.info("Public car detail route registered successfully")
except Exception as e:
    logger.error(f"Failed to register public car detail route: {e}")

try:
    from routes.price_history import (
        get_listing_price_history,
        register_price_history_routes,
    )

    register_price_history_routes(app)
    logger.info("Listing price-history route registered successfully")
except Exception as e:
    logger.error(f"Failed to register listing price-history route: {e}")

# Admin dealer information-request controls are registered after the runtime
# dependency table exists; public token/upload routes remain root-owned.
try:
    from routes.dealer_info_requests import (
        cancel_dealer_info_request,
        create_dealer_info_request,
        list_dealer_info_requests,
        register_dealer_info_request_routes,
    )

    register_dealer_info_request_routes(app)
    logger.info("Admin dealer info-request routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin dealer info-request routes: {e}")

# Public token lookup and upload are registered separately from the admin controls;
# the token remains the authorization boundary for both public operations.
try:
    from routes.public_info_request import (
        get_public_info_request,
        register_public_info_request_routes,
    )
    from routes.public_info_upload import (
        register_public_info_upload_routes,
        upload_public_info_request,
    )

    register_public_info_request_routes(app)
    register_public_info_upload_routes(app)
    logger.info("Public dealer info-request lookup/upload routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register public dealer info-request routes: {e}")

# Report creation/listing stays separate from admin status updates and contact
# analytics while preserving the legacy shared GET/POST path.
try:
    from routes.reports import create_report, get_reports, register_report_routes

    register_report_routes(app)
    logger.info("Report create/list routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register report create/list routes: {e}")

# Admin metrics routes are registered after the runtime dependency table exists;
# broader admin stats and Cloudflare diagnostics remain separate root-owned
# compatibility surfaces.
try:
    from routes.admin_metrics import (
        get_email_metrics,
        get_error_metrics,
        register_admin_metrics_routes,
    )

    register_admin_metrics_routes(app)
    logger.info("Admin email/error metrics routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin email/error metrics routes: {e}")

try:
    from routes.admin_overview_metrics import (
        get_admin_metrics_overview,
        register_admin_overview_metrics_routes,
    )

    register_admin_overview_metrics_routes(app)
    logger.info("Admin metrics overview route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin metrics overview route: {e}")

try:
    from routes.admin_stats import get_admin_stats, register_admin_stats_routes

    register_admin_stats_routes(app)
    logger.info("Admin stats route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin stats route: {e}")

try:
    from routes.admin_listing_search import (
        admin_listings_search,
        register_admin_listing_search_routes,
    )

    register_admin_listing_search_routes(app)
    logger.info("Admin listing search route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin listing search route: {e}")

try:
    from routes.admin_reddit_analytics import (
        get_admin_reddit_import_analytics,
        register_admin_reddit_analytics_routes,
    )

    register_admin_reddit_analytics_routes(app)
    logger.info("Admin Reddit analytics route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin Reddit analytics route: {e}")

try:
    from routes.user_lead_metrics import (
        get_user_lead_metrics,
        register_user_lead_metrics_routes,
    )

    register_user_lead_metrics_routes(app)
    logger.info("User lead-metrics route registered successfully")
except Exception as e:
    logger.error(f"Failed to register user lead-metrics route: {e}")

try:
    from routes.lead_events import (
        register_listing_lead_event_routes,
        track_listing_lead_event,
    )

    register_listing_lead_event_routes(app)
    logger.info("Listing lead-event route registered successfully")
except Exception as e:
    logger.error(f"Failed to register listing lead-event route: {e}")

try:
    from routes.repost import register_repost_routes, repost_user_listing

    register_repost_routes(app)
    logger.info("Listing repost route registered successfully")
except Exception as e:
    logger.error(f"Failed to register listing repost route: {e}")

try:
    from routes.dealer_document_review import (
        get_admin_dealer_documents,
        register_dealer_document_review_routes,
        review_dealer_document,
    )

    register_dealer_document_review_routes(app)
    logger.info("Dealer document review route registered successfully")
except Exception as e:
    logger.error(f"Failed to register dealer document review route: {e}")

try:
    from routes.dealer_admin_actions import (
        api_verify_dealer,
        api_reject_dealer,
        register_dealer_admin_action_routes,
    )

    register_dealer_admin_action_routes(app)
    logger.info("Dealer admin action routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register dealer admin action routes: {e}")

try:
    from routes.admin_listing_delete import (
        delete_listing,
        register_admin_listing_delete_routes,
    )

    register_admin_listing_delete_routes(app)
    logger.info("Admin listing delete route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin listing delete route: {e}")

try:
    from routes.admin_upgrade_decisions import (
        admin_list_listing_upgrade_requests,
        admin_decide_listing_upgrade_request,
        dealer_create_listing_upgrade_request,
        register_admin_upgrade_decision_routes,
    )

    register_admin_upgrade_decision_routes(app)
    logger.info("Admin upgrade decision route registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin upgrade decision route: {e}")

# Live-user metrics are registered after the runtime dependency table exists;
# broader overview/stats analytics remain root-owned.
try:
    from routes.live_users import (
        get_admin_live_users,
        get_admin_live_users_history,
        register_live_user_routes,
    )

    register_live_user_routes(app)
    logger.info("Admin live-user routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin live-user routes: {e}")

# Phone verification handlers are registered after the runtime dependency table
# is available; shared phone, provider, persistence, and rate-limit helpers stay
# in this compatibility root and remain available to direct callers.
try:
    from routes.phone_verification import (
        register_phone_verification_routes,
        start_phone_verification,
        verify_phone_verification,
        verify_phone_verification_token,
    )

    register_phone_verification_routes(app)
    logger.info("Phone verification routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register phone verification routes: {e}")

# Admin user profile maintenance and destructive unverified-account cleanup
# are registered after the runtime table exists. Compatibility exports remain
# available from app.py for direct callers and service helpers.
try:
    from routes.admin_users import (
        admin_cleanup_unverified_accounts,
        register_admin_user_routes,
        update_admin_user_profile,
    )

    register_admin_user_routes(app, globals())
    logger.info("Admin user maintenance routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin user maintenance routes: {e}")

# Diagnostics configuration is registered after the runtime table exists so
# the extracted handler can resolve token and admin helpers without importing
# this compatibility root.
try:
    from routes.diagnostics import check_config, register_diagnostics_routes

    register_diagnostics_routes(app)
    logger.info("Diagnostics route registered successfully")
except Exception as e:
    logger.error(f"Failed to register diagnostics route: {e}")

# Platform analytics event ingestion is registered after the runtime table is
# available; the shared normalizer and table check remain compatibility-root
# helpers for startup and other analytics consumers.
try:
    from routes.platform_analytics import (
        register_platform_analytics_routes,
        track_platform_event,
    )

    register_platform_analytics_routes(app)
    logger.info("Platform analytics routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register platform analytics routes: {e}")

# Public sitemap aliases are registered after the runtime table exists so the
# extracted generator can resolve cache, provider, lifecycle, and SEO helpers
# without importing this compatibility root.
try:
    from routes.sitemap import (
        _build_sitemap_xml,
        _fetch_public_sitemap_rows,
        _record_is_active_public_listing,
        register_sitemap_routes,
        sitemap_xml,
    )

    register_sitemap_routes(app)
    logger.info("Sitemap routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register sitemap routes: {e}")

# Recommendation HTTP handlers are registered after the runtime dependency
# table exists so their shared saved-listing card and image helpers remain
# patchable compatibility exports without importing this root module.
try:
    from routes.recommendations import (
        _build_recommendation_cards,
        _get_newest_recommendations,
        _get_similar_listings,
        get_recommendations,
        register_recommendations_routes,
    )

    register_recommendations_routes(app)
    logger.info("Recommendations routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register recommendations routes: {e}")

# Profile handlers are registered after shared helpers are defined so the
# extracted module can retain the existing field, username, and phone contracts.
try:
    from routes.profile import (
        get_user_profile,
        register_profile_routes,
        update_user_profile,
    )

    register_profile_routes(app, globals())
    logger.info("Profile routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register profile routes: {e}")

# Dealer documents and KYC submission are registered after shared helpers so
# the extracted module can resolve the legacy service table at request time.
try:
    from routes.dealer_verification import register_dealer_verification_routes

    register_dealer_verification_routes(app, globals())
    logger.info("Dealer verification routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register dealer verification routes: {e}")

# User listing statistics are isolated from storage/KYC mutations so the
# profile dashboard can evolve without expanding the compatibility root.
try:
    from routes.statistics import register_statistics_routes

    register_statistics_routes(app, globals())
    logger.info("User statistics routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register user statistics routes: {e}")

# Compatibility exports for tests and internal callers that historically
# imported these handlers from app.py.
from routes.dealer_verification import (
    dealer_submit_application,
    dealer_verification_list_messages,
    dealer_verification_notify_admin,
    delete_dealer_document,
    get_dealer_documents,
    get_dealer_verification_status,
    upload_profile_photo,
    upload_dealer_document,
)
from routes.statistics import get_user_statistics

# Draft reads/writes are isolated from the reminder worker implementation.
try:
    from routes.drafts import register_draft_routes

    register_draft_routes(app, globals())
    logger.info("Draft routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register draft routes: {e}")

from routes.drafts import list_user_drafts, manage_user_draft

try:
    from routes.vin_admin import register_vin_admin_routes

    register_vin_admin_routes(app, globals())
    logger.info("Admin VIN routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin VIN routes: {e}")

from routes.vin_admin import admin_vin_unlock

try:
    from routes.media import register_media_routes

    register_media_routes(app, globals())
    logger.info("Media routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register media routes: {e}")

from routes.media import upload_car_images, upload_images

try:
    from routes.listing_outcomes import register_listing_outcome_routes

    register_listing_outcome_routes(app, globals())
    logger.info("Listing outcome routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register listing outcome routes: {e}")

from routes.listing_outcomes import set_listing_outcome

try:
    from routes.listing_lifecycle import register_listing_lifecycle_routes

    register_listing_lifecycle_routes(app, globals())
    logger.info("Listing lifecycle routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register listing lifecycle routes: {e}")

from routes.listing_lifecycle import extend_user_listing

try:
    from routes.car_update import register_car_update_routes

    register_car_update_routes(app, globals())
    logger.info("Car update routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register car update routes: {e}")

from routes.car_update import update_car

try:
    from routes.bike_update import register_bike_update_routes

    register_bike_update_routes(app, globals())
    logger.info("Bike update routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register bike update routes: {e}")

from routes.bike_update import update_bike, delete_bike

try:
    from routes.plate_update import register_plate_update_routes

    register_plate_update_routes(app, globals())
    logger.info("Plate update routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register plate update routes: {e}")

from routes.plate_update import plate_handler, update_plate, delete_plate

try:
    from routes.part_update import register_part_update_routes

    register_part_update_routes(app, globals())
    logger.info("Part update routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register part update routes: {e}")

from routes.part_update import part_handler, update_part, delete_part

try:
    from routes.admin_listing_lifecycle import register_admin_listing_lifecycle_routes

    register_admin_listing_lifecycle_routes(app, globals())
    logger.info("Admin listing lifecycle routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register admin listing lifecycle routes: {e}")

from routes.admin_listing_lifecycle import (
    _admin_renew_one,
    admin_renew_listing,
    admin_renew_listings_bulk,
    admin_approve_listings_bulk,
    admin_delete_listings_bulk,
    admin_set_listing_status,
    admin_set_listing_expiry,
)

# Generic moderation routes are registered after the runtime dependency table
# is complete.  The canonical admin blueprint reject route remains owned by
# routes.admin; api_admin_reject_item is retained only for direct callers.
try:
    from routes.moderation import (
        _perform_approval as _moderation_perform_approval,
        api_admin_approve_item,
        api_admin_list_items,
        api_approve_item,
        api_reject_item as _moderation_api_reject_item,
        register_moderation_routes,
    )

    register_moderation_routes(app, globals())
    logger.info("Moderation API routes registered successfully")
except Exception as e:
    logger.error(f"Failed to register moderation API routes: {e}")


def _perform_approval(
    item_type,
    item_id,
    *,
    actor,
    actor_id,
    origin_header=None,
    signals=None,
    dry_run=False,
):
    """Compatibility callable that supplies Flask context to worker callers."""
    with app.app_context():
        return _moderation_perform_approval(
            item_type,
            item_id,
            actor=actor,
            actor_id=actor_id,
            origin_header=origin_header,
            signals=signals,
            dry_run=dry_run,
        )


@token_required
def api_reject_item(current_user, item_type, item_id):
    """Compatibility callable for direct legacy callers; not a live route."""
    return _moderation_api_reject_item.__wrapped__(current_user, item_type, item_id)


@token_required
def api_admin_reject_item(current_user, item_type, item_id):
    """Compatibility callable; the live rule remains ``routes.admin``."""
    return api_reject_item.__wrapped__(current_user, item_type, item_id)


if __name__ == "__main__":
    logger.info("Starting Flask application on port 8000")
    debug_mode = os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    if debug_mode:
        logger.warning("!!! FLASK DEBUG MODE IS ENABLED - NOT FOR PRODUCTION !!!")

    def _run_expiry_reminders():
        check_interval_seconds = int(
            os.getenv("LISTING_REMINDER_INTERVAL_SECONDS", str(60 * 60 * 24))
        )
        while True:
            try:
                result = _run_listing_expiry_reminders_once()
                logger.info(
                    "Listing expiry reminders complete: sent=%d",
                    int(result.get("reminders_sent") or 0),
                )
            except Exception as reminder_err:
                logger.error("Expiry reminder job error: %s", reminder_err)
            time.sleep(check_interval_seconds)

    reminder_thread = threading.Thread(target=_run_expiry_reminders, daemon=True)
    reminder_thread.start()
    app.run(debug=debug_mode, host="127.0.0.1", port=8000)
