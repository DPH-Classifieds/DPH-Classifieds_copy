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
import hashlib
import threading
import logging
import json
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
from urllib.parse import urlparse, quote
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from flask_cors import CORS
from PIL import Image
from posthog import Posthog
from werkzeug.utils import secure_filename
from xml.sax.saxutils import escape as xml_escape

from analytics_metrics import build_platform_metrics, classify_platform_path
from services.analytics_events import AnalyticsEventError, normalize_analytics_event
from services.contact_analytics import build_contact_analytics, build_vin_listing_activity
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
AUTH_RATE_LIMIT_WINDOW_SEC = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SEC", "300"))
AUTH_RATE_LIMIT_MAX = int(os.getenv("AUTH_RATE_LIMIT_MAX", "5"))
AUTH_RATE_LIMIT = defaultdict(deque)
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


INFOBIP_BASE_URL = _normalize_base_url(
    os.getenv("INFOBIP_BASE_URL", "https://api.infobip.com")
)
INFOBIP_API_KEY = os.getenv("INFOBIP_API_KEY")
INFOBIP_SENDER = os.getenv("INFOBIP_SENDER", "ServiceSMS")
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
        allowed_methods={"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
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

    user_fields = "id,first_name,last_name,email,username,profile_photo_url,is_dealer"
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


def _sync_listing_lifecycle(table_name, record, *, hard_delete_archived=False):
    if not isinstance(record, dict):
        return record
    if _is_listing_deleted(record):
        _apply_listing_lifecycle_metadata(record)
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
    elif raw_code in ("42P01", "42703"):
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


def _send_renewal_nudge_sms(phone, item_type, item_id, country_code=None):
    if not phone:
        return False, {"message": "Missing phone"}
    # Strictly ASCII (no em-dash) so the message stays in GSM-7 encoding (160
    # chars/segment) instead of UCS-2 (70 chars/segment) which triples cost
    # and segment count. Also drop the utm_source query param: UAE carriers
    # (Etisalat in particular) filter SMS with long tracker URLs aggressively.
    # The landing page reads the unmarked URL just fine.
    landing_url = _renewal_landing_url(item_type, item_id).split("?", 1)[0]
    body = (
        f"DPH Classifieds: your listing has expired. "
        f"Renew or mark sold: {landing_url}"
    )
    normalized = _normalize_phone_number(phone, country_code) or phone
    return _send_infobip_sms(normalized, body)


def _send_renewal_nudge_whatsapp(phone, item_type, item_id, country_code=None):
    # Placeholder: WhatsApp channel is not configured yet. Wire up Infobip WA or
    # Twilio here once a sender is approved, and surface the result the same way
    # _send_infobip_sms does (returns (ok: bool, response: dict)).
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
            "whatsapp_number,whatsapp_prefill_text,vin_number,"
            + _LIFECYCLE_FIELDS
            + "car_images("
            + LISTING_IMAGE_SELECTS["cars"]
            + ")"
        ),
        "limit": "4",
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


def _record_is_active_public_listing(record):
    if not isinstance(record, dict):
        return False

    lifecycle = _compute_listing_lifecycle(record)
    return lifecycle["state"] == "active"


def _fetch_public_sitemap_rows(table_name, query_params=None, *, page_size=1000):
    service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }

    offset = 0
    collected = []
    base_params = dict(query_params or {})

    while True:
        params = {
            "select": "id,created_at,status,is_approved,expires_at,expired_at,retention_expires_at,is_archived",
            "order": "created_at.desc",
            "limit": page_size,
            "offset": offset,
            **base_params,
        }
        response = requests.get(
            f"{app.config['SUPABASE_URL']}/rest/v1/{table_name}",
            headers=headers,
            params=params,
            timeout=15,
        )
        if response.status_code != 200:
            logger.warning(
                f"Failed to fetch sitemap rows for {table_name}: "
                f"{response.status_code} {response.text}"
            )
            break

        rows = response.json() or []
        active_rows = [row for row in rows if _record_is_active_public_listing(row)]
        collected.extend(active_rows)

        if len(rows) < page_size:
            break

        offset += page_size

    return collected


def _build_sitemap_xml():
    site_base = SITE_URL.rstrip("/")
    static_pages = [
        (f"{site_base}/", "daily", "1.0"),
        (f"{site_base}/explore", "daily", "0.9"),
        (f"{site_base}/cars", "daily", "0.9"),
        (f"{site_base}/bikes", "daily", "0.8"),
        (f"{site_base}/car-parts", "daily", "0.8"),
        (f"{site_base}/plates", "daily", "0.8"),
        (f"{site_base}/about", "weekly", "0.5"),
        (f"{site_base}/contact", "weekly", "0.5"),
        (f"{site_base}/privacy-policy", "monthly", "0.3"),
        (f"{site_base}/terms-of-use", "monthly", "0.3"),
    ]

    listing_sources = [
        (
            "cars",
            f"{site_base}/cars",
            {"status": "eq.approved", "is_approved": "eq.true"},
        ),
        (
            "bikes",
            f"{site_base}/bikes",
            {"status": "eq.approved", "is_approved": "eq.true"},
        ),
        (
            "car_parts",
            f"{site_base}/car-parts",
            {"status": "eq.approved", "is_approved": "eq.true"},
        ),
        ("license_plates", f"{site_base}/plates", {"status": "eq.approved"}),
    ]

    entries = []
    for url, changefreq, priority in static_pages:
        entries.append(
            {
                "loc": url,
                "lastmod": datetime.datetime.now(datetime.timezone.utc)
                .date()
                .isoformat(),
                "changefreq": changefreq,
                "priority": priority,
            }
        )

    for table_name, path_base, query_params in listing_sources:
        rows = _fetch_public_sitemap_rows(table_name, query_params)
        for row in rows:
            listing_id = row.get("id")
            if not listing_id:
                continue

            lastmod_value = row.get("created_at") or row.get("updated_at")
            lastmod = None
            if lastmod_value:
                parsed_lastmod = _parse_datetime(lastmod_value)
                if parsed_lastmod:
                    lastmod = parsed_lastmod.date().isoformat()

            entries.append(
                {
                    "loc": f"{path_base}/{listing_id}",
                    "lastmod": lastmod,
                    "changefreq": "weekly",
                    "priority": "0.7",
                }
            )

    urlset = []
    for entry in entries:
        parts = [
            "  <url>",
            f"    <loc>{xml_escape(entry['loc'])}</loc>",
        ]
        if entry.get("lastmod"):
            parts.append(f"    <lastmod>{xml_escape(entry['lastmod'])}</lastmod>")
        if entry.get("changefreq"):
            parts.append(
                f"    <changefreq>{xml_escape(entry['changefreq'])}</changefreq>"
            )
        if entry.get("priority"):
            parts.append(f"    <priority>{xml_escape(entry['priority'])}</priority>")
        parts.append("  </url>")
        urlset.extend(parts)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urlset)
        + "\n</urlset>"
    )


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
        token_preview = token[:20] + "..." if len(token) > 20 else token

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
                    f"[auth] All local JWT key attempts failed for token {token_preview}"
                )
            except Exception as local_error:
                logger.warning(
                    f"[auth] Local JWT validation failed for token {token_preview}: {local_error}"
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
                    f"for token {token_preview}: {auth_response.text[:200]}"
                )
                return jsonify({"message": "Token has expired or is invalid"}), 401

            supabase_user = auth_response.json()
            current_user = supabase_user.get("id")
            if not current_user:
                logger.warning(
                    f"[auth] Supabase returned 200 but no user ID: {supabase_user}"
                )
                return jsonify({"message": "Invalid token"}), 401

            request.user_id = current_user
            request.user_data = {
                "id": current_user,
                "email": supabase_user.get("email", ""),
                "role": supabase_user.get("role", "authenticated"),
            }
            request.supabase_token = token
        except requests.Timeout:
            logger.error(f"[auth] Supabase auth API timeout for token {token_preview}")
            return jsonify({"message": "Authentication service timeout"}), 503
        except Exception as fallback_error:
            logger.error(
                f"[auth] Fallback token validation error for token {token_preview}: {fallback_error}"
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


@app.route("/api/user/saved-listings", methods=["GET"])
@token_required
def get_user_saved_listings(current_user):
    payload, status_code = _fetch_saved_listing_cards(current_user)
    return jsonify(payload), status_code


@app.route("/api/user/saved-listings", methods=["POST"])
@token_required
def create_user_saved_listing(current_user):
    data = request.json or {}
    listing_type = _normalize_saved_listing_type(data.get("listing_type"))
    listing_id = str(data.get("listing_id") or "").strip()

    if not listing_type or not listing_id:
        return jsonify({"error": "listing_type and listing_id are required"}), 400

    saved_rows, existing_status = supabase_request(
        "get",
        "/rest/v1/saved_listings",
        params={
            "select": "id,user_id,listing_id,listing_type,created_at",
            "user_id": f"eq.{current_user}",
            "listing_id": f"eq.{listing_id}",
            "listing_type": f"eq.{listing_type}",
            "limit": 1,
        },
        user_id=current_user,
    )
    if existing_status >= 400 and _looks_like_missing_table(saved_rows):
        return (
            jsonify(
                {
                    "error": "Supabase table saved_listings is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_ecosystem_tables.sql"
                }
            ),
            501,
        )
    if existing_status < 400 and saved_rows:
        card, _, _ = _load_saved_listing_card(
            current_user, listing_type, listing_id, saved_rows[0]
        )
        return jsonify({"saved": True, "listing": card}), 200

    card, error_payload, error_status = _load_saved_listing_card(
        current_user, listing_type, listing_id
    )
    if error_payload:
        return jsonify(error_payload), error_status
    if not card or card.get("isUnavailable"):
        return jsonify({"error": "Listing not found"}), 404

    insert_payload = {
        "user_id": current_user,
        "listing_id": listing_id,
        "listing_type": listing_type,
    }
    insert_response, insert_status = supabase_request(
        "post",
        "/rest/v1/saved_listings",
        data=insert_payload,
        user_id=current_user,
    )
    if insert_status >= 400:
        if insert_status == 409:
            return jsonify({"saved": True, "listing": card}), 200
        if _looks_like_missing_table(insert_response):
            return (
                jsonify(
                    {
                        "error": "Supabase table saved_listings is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_ecosystem_tables.sql"
                    }
                ),
                501,
            )
        return jsonify(insert_response), insert_status

    capture_posthog_event(
        "listing_saved",
        current_user,
        {"listing_type": listing_type},
    )
    return jsonify(
        {
            "saved": True,
            "listing": card,
            "saved_listing": insert_response[0]
            if isinstance(insert_response, list) and insert_response
            else insert_response,
        }
    ), 200


@app.route(
    "/api/user/saved-listings/<string:listing_type>/<string:listing_id>",
    methods=["DELETE"],
)
@token_required
def delete_user_saved_listing(current_user, listing_type, listing_id):
    normalized_type = _normalize_saved_listing_type(listing_type)
    if not normalized_type:
        return jsonify({"error": "Invalid listing type"}), 400

    delete_response, delete_status = supabase_request(
        "delete",
        "/rest/v1/saved_listings",
        params={
            "user_id": f"eq.{current_user}",
            "listing_type": f"eq.{normalized_type}",
            "listing_id": f"eq.{listing_id}",
        },
        user_id=current_user,
    )

    if delete_status >= 400:
        if _looks_like_missing_table(delete_response):
            return (
                jsonify(
                    {
                        "error": "Supabase table saved_listings is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_ecosystem_tables.sql"
                    }
                ),
                501,
            )
        return jsonify(delete_response), delete_status

    return jsonify(
        {"saved": False, "listing_type": normalized_type, "listing_id": listing_id}
    ), 200


SAVED_SEARCH_CATEGORIES = {
    "all",
    "cars",
    "car",
    "bikes",
    "bike",
    "parts",
    "part",
    "car-parts",
    "plates",
    "plate",
}


def _normalize_saved_search_category(value):
    normalized = str(value or "all").strip().lower()
    mapping = {
        "car": "cars",
        "bike": "bikes",
        "part": "parts",
        "car-parts": "parts",
        "plate": "plates",
    }
    normalized = mapping.get(normalized, normalized)
    return normalized if normalized in SAVED_SEARCH_CATEGORIES else "all"


def _clean_saved_search_filters(value):
    if not isinstance(value, dict):
        return {}
    cleaned = {}
    for key, raw_value in value.items():
        if raw_value in (None, ""):
            continue
        if isinstance(raw_value, dict):
            nested = _clean_saved_search_filters(raw_value)
            if nested:
                cleaned[str(key)] = nested
            continue
        if isinstance(raw_value, list):
            nested_list = [
                item
                for item in raw_value
                if item not in (None, "", [], {})
            ]
            if nested_list:
                cleaned[str(key)] = nested_list
            continue
        cleaned[str(key)] = raw_value
    return cleaned


def _build_saved_search_key(category, route_path, query_text, filters):
    normalized_payload = {
        "category": _normalize_saved_search_category(category),
        "route_path": str(route_path or "").strip()[:300],
        "query_text": str(query_text or "").strip().lower(),
        "filters": _clean_saved_search_filters(filters),
    }
    encoded = json.dumps(normalized_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _saved_search_missing_table_response():
    return (
        jsonify(
            {
                "error": "Supabase table saved_searches is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_saved_searches_and_reminders_20260618.sql"
            }
        ),
        501,
    )


@app.route("/api/user/saved-searches", methods=["GET"])
@token_required
def get_user_saved_searches(current_user):
    response, status_code = supabase_request(
        "get",
        "/rest/v1/saved_searches",
        params={
            "select": "*",
            "user_id": f"eq.{current_user}",
            "order": "updated_at.desc",
            "limit": "100",
        },
        user_id=current_user,
    )
    if status_code >= 400:
        if _looks_like_missing_table(response):
            return _saved_search_missing_table_response()
        return jsonify({"error": "Failed to load saved searches"}), status_code
    return jsonify({"searches": response or []}), 200


@app.route("/api/user/push-token", methods=["POST"])
@token_required
def register_push_token(current_user):
    """Register/refresh an Expo push token for the signed-in user."""
    payload = request.get_json(silent=True) or {}
    token = str(payload.get("expo_push_token") or "").strip()
    if not token:
        return jsonify({"error": "expo_push_token is required"}), 400
    if not is_valid_expo_token(token):
        return jsonify({"error": "invalid expo_push_token"}), 400
    now_iso = _isoformat_utc(_utc_now())
    record = {
        "user_id": current_user,
        "expo_push_token": token,
        "platform": (str(payload.get("platform") or "").strip()[:20] or None),
        "device_id": (str(payload.get("device_id") or "").strip()[:200] or None),
        "enabled": True,
        "updated_at": now_iso,
        "last_used_at": now_iso,
    }
    # Delete-then-insert upsert on the unique expo_push_token (house convention).
    # Deleting by token (not user) reassigns a device that switched accounts.
    supabase_request(
        "delete",
        "/rest/v1/push_tokens",
        params={"expo_push_token": f"eq.{token}"},
        use_service_role=True,
    )
    resp, status_code = supabase_request(
        "post",
        "/rest/v1/push_tokens",
        data=record,
        use_service_role=True,
    )
    if status_code >= 400:
        return jsonify({"error": "Failed to save push token"}), status_code
    saved = resp[0] if isinstance(resp, list) and resp else resp
    return jsonify({"saved": True, "token": saved}), 200


@app.route("/api/user/push-token", methods=["DELETE"])
@token_required
def delete_push_token(current_user):
    """Remove a push token (device opted out or signed out)."""
    token = str(request.args.get("expo_push_token") or "").strip()
    params = {"user_id": f"eq.{current_user}"}
    if token:
        params["expo_push_token"] = f"eq.{token}"
    supabase_request(
        "delete",
        "/rest/v1/push_tokens",
        params=params,
        use_service_role=True,
    )
    return jsonify({"removed": True}), 200


@app.route("/api/user/saved-searches", methods=["POST"])
@token_required
def save_user_search(current_user):
    payload = request.get_json(silent=True) or {}
    category = _normalize_saved_search_category(payload.get("category"))
    route_path = str(payload.get("route_path") or payload.get("routePath") or "").strip()[:300]
    query_text = str(
        payload.get("query")
        or payload.get("query_text")
        or payload.get("search")
        or ""
    ).strip()[:300]
    filters = _clean_saved_search_filters(payload.get("filters") or {})
    result_count = payload.get("result_count", payload.get("resultCount"))
    try:
        result_count = int(result_count) if result_count not in (None, "") else None
    except (TypeError, ValueError):
        result_count = None

    search_key = _build_saved_search_key(category, route_path, query_text, filters)
    now_iso = _isoformat_utc(_utc_now())
    record = {
        "user_id": current_user,
        "search_key": search_key,
        "category": category,
        "route_path": route_path,
        "query_text": query_text,
        "filters": filters,
        "result_count": result_count,
        "last_result_count": result_count,
        "updated_at": now_iso,
        "last_used_at": now_iso,
    }
    name = str(payload.get("name") or "").strip()[:120]
    if name:
        record["name"] = name

    delete_response, delete_status = supabase_request(
        "delete",
        "/rest/v1/saved_searches",
        params={"user_id": f"eq.{current_user}", "search_key": f"eq.{search_key}"},
        user_id=current_user,
    )
    if delete_status >= 400 and _looks_like_missing_table(delete_response):
        return _saved_search_missing_table_response()

    insert_response, insert_status = supabase_request(
        "post",
        "/rest/v1/saved_searches",
        data=record,
        user_id=current_user,
    )
    if insert_status >= 400:
        if _looks_like_missing_table(insert_response):
            return _saved_search_missing_table_response()
        return jsonify({"error": "Failed to save search"}), insert_status

    saved_record = (
        insert_response[0]
        if isinstance(insert_response, list) and insert_response
        else insert_response
    )
    return jsonify({"saved": True, "search": saved_record}), 200


@app.route("/api/user/saved-searches/<string:search_id_or_key>", methods=["DELETE"])
@token_required
def delete_user_saved_search(current_user, search_id_or_key):
    identifier = str(search_id_or_key or "").strip()
    if not identifier:
        return jsonify({"error": "Missing saved search id"}), 400
    params = {"user_id": f"eq.{current_user}"}
    if re.match(r"^[0-9a-fA-F-]{32,36}$", identifier):
        params["id"] = f"eq.{identifier}"
    else:
        params["search_key"] = f"eq.{identifier}"
    response, status_code = supabase_request(
        "delete",
        "/rest/v1/saved_searches",
        params=params,
        user_id=current_user,
    )
    if status_code >= 400:
        if _looks_like_missing_table(response):
            return _saved_search_missing_table_response()
        return jsonify({"error": "Failed to delete saved search"}), status_code
    return jsonify({"deleted": True}), 200


def _soft_delete_user_listing_table(table_name, user_id):
    now_iso = _isoformat_utc(_utc_now())
    full_payload = {
        "status": "deleted",
        "listing_state": "deleted",
        "deleted_at": now_iso,
        "is_approved": False,
        "is_archived": True,
        "auto_removed_at": now_iso,
    }
    path = f"/rest/v1/{table_name}?user_id=eq.{user_id}"
    response, status_code = supabase_request(
        "patch",
        path,
        data=full_payload,
        use_service_role=True,
    )
    if status_code < 400:
        return True, None

    if _looks_like_missing_column(
        response,
        "listing_state",
        "deleted_at",
        "is_approved",
        "is_archived",
        "auto_removed_at",
    ):
        fallback_response, fallback_status = supabase_request(
            "patch",
            path,
            data={"status": "deleted"},
            use_service_role=True,
        )
        if fallback_status < 400:
            return True, None
        return False, fallback_response
    return False, response


def _delete_user_scoped_table_rows(table_name, user_id, column_name="user_id"):
    response, status_code = supabase_request(
        "delete",
        f"/rest/v1/{table_name}",
        params={column_name: f"eq.{user_id}"},
        use_service_role=True,
    )
    if status_code < 400 or _looks_like_missing_table(response):
        return True, None
    return False, response


def _delete_supabase_auth_user(user_id):
    service_key = SUPABASE_SERVICE_ROLE_KEY or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not SUPABASE_URL or not service_key:
        return False, "Supabase service role is not configured"
    response = requests.delete(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        timeout=15,
    )
    if response.status_code in (200, 202, 204):
        return True, None
    return False, response.text[:500]


@app.route("/api/user/delete-account", methods=["DELETE"])
@token_required
def delete_user_account(current_user):
    cleanup_errors = []
    for table_name in ("cars", "bikes", "car_parts", "license_plates"):
        ok, error = _soft_delete_user_listing_table(table_name, current_user)
        if not ok:
            cleanup_errors.append({"table": table_name, "error": error})

    for table_name in (
        "saved_listings",
        "listing_drafts",
        "saved_searches",
        "notifications",
        "user_verification",
    ):
        ok, error = _delete_user_scoped_table_rows(table_name, current_user)
        if not ok:
            cleanup_errors.append({"table": table_name, "error": error})

    for column_name in ("follower_id", "following_id"):
        ok, error = _delete_user_scoped_table_rows(
            "user_followers", current_user, column_name=column_name
        )
        if not ok:
            cleanup_errors.append({"table": "user_followers", "error": error})

    if cleanup_errors:
        logger.error("Account deletion cleanup failed for %s: %s", current_user, cleanup_errors)
        return jsonify({"deleted": False, "error": "Failed to clean up account data"}), 500

    public_user_response, public_user_status = supabase_request(
        "delete",
        "/rest/v1/users",
        params={"id": f"eq.{current_user}"},
        use_service_role=True,
    )
    if public_user_status >= 400 and not _looks_like_missing_table(public_user_response):
        logger.error(
            "Failed to delete public user row for %s: %s",
            current_user,
            public_user_response,
        )
        return jsonify({"deleted": False, "error": "Failed to delete profile"}), 500

    auth_deleted, auth_error = _delete_supabase_auth_user(current_user)
    if not auth_deleted:
        logger.error("Failed to delete auth user %s: %s", current_user, auth_error)
        return (
            jsonify(
                {
                    "deleted": False,
                    "error": "Profile cleanup completed but auth deletion failed",
                    "details": auth_error,
                }
            ),
            502,
        )

    response = make_response(jsonify({"deleted": True}), 200)
    response.set_cookie("access_token", "", expires=0)
    response.set_cookie("refresh_token", "", expires=0)
    return response, 200


@app.route("/api/admin/saved-searches", methods=["GET"])
@token_required
def get_admin_saved_searches(current_user):
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    days = max(min(int(request.args.get("days", 30)), 365), 1)
    limit = max(min(int(request.args.get("limit", 200)), 1000), 1)
    cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()
    rows, status_code = supabase_request(
        "get",
        "/rest/v1/saved_searches",
        params={
            "select": "*",
            "created_at": f"gte.{cutoff}",
            "order": "updated_at.desc",
            "limit": str(limit),
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if _looks_like_missing_table(rows):
            return _saved_search_missing_table_response()
        return jsonify({"error": "Failed to load saved searches"}), status_code

    rows = rows or []
    user_ids = sorted({str(row.get("user_id")) for row in rows if row.get("user_id")})
    owner_map = {}
    if user_ids:
        users, users_status = supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "select": "id,email,username,display_name,first_name,last_name",
                "id": f"in.({','.join(user_ids)})",
            },
            use_service_role=True,
        )
        if users_status < 400:
            owner_map = {str(user.get("id")): user for user in users or []}

    categories = defaultdict(int)
    for row in rows:
        category = _normalize_saved_search_category(row.get("category"))
        categories[category] += 1
        owner = owner_map.get(str(row.get("user_id")))
        if owner:
            row["owner_email"] = owner.get("email")
            row["owner_name"] = _admin_display_name_from_user_row(owner)

    summary = {
        "total": len(rows),
        "unique_users": len(user_ids),
        "categories": dict(categories),
        "days": days,
    }
    return jsonify({"summary": summary, "searches": rows}), 200


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
# In production this should be set explicitly so sessions remain stable across restarts.
flask_secret_key = os.getenv("FLASK_SECRET_KEY")
if not flask_secret_key:
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
    redis_limited = _redis_fixed_window_rate_limited(
        "auth", client_ip, AUTH_RATE_LIMIT_WINDOW_SEC, AUTH_RATE_LIMIT_MAX
    )
    if redis_limited is not None:
        return redis_limited
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
        payload["contact_phone"] = normalized
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
    if not INFOBIP_API_KEY:
        return False, {"message": "INFOBIP_API_KEY is not configured"}

    normalized_phone = _normalize_phone_number(to_phone)
    destination_phone = normalized_phone or str(to_phone or "")
    infobip_base_url = _normalize_base_url(INFOBIP_BASE_URL, default_scheme="https")

    otp_dev_mode = str(os.getenv("OTP_DEV_MODE", "")).lower() == "true"
    skip_sms = str(os.getenv("SKIP_SMS", "")).lower() == "true"
    flask_env = str(os.getenv("FLASK_ENV", "")).lower()

    # Development mode: log code to console instead of sending SMS.
    # In production, never short-circuit to console mode.
    if flask_env != "production" and (otp_dev_mode or skip_sms):
        print("\n" + "=" * 60)
        print("📱 DEVELOPMENT MODE - SMS NOT SENT")
        print("=" * 60)
        print(f"Phone: {normalized_phone}")
        print(f"Message: {message}")
        print("=" * 60 + "\n")
        return True, {
            "status": "dev_mode",
            "message": "SMS logged to console in dev mode",
        }

    if flask_env == "production" and (otp_dev_mode or skip_sms):
        logger.warning(
            "OTP dev flags detected in production environment; ignoring and sending via Infobip."
        )

    payload = {
        "messages": [
            {
                "sender": INFOBIP_SENDER,
                "destinations": [{"to": destination_phone}],
                "content": {"text": message},
            }
        ]
    }
    headers = {
        "Authorization": f"App {INFOBIP_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        response = requests.post(
            f"{infobip_base_url}/sms/3/messages",
            headers=headers,
            json=payload,
            timeout=15,
        )
        if response.status_code >= 400:
            logger.error(
                f"Infobip SMS send failed: {response.status_code} {response.text}"
            )
            return False, {"status": response.status_code, "details": response.text}
        # Infobip returns 200 even when it rejects delivery to a specific number
        # (e.g. no route for a newer MNP range like +97158). The real verdict is
        # the per-message status group, not the HTTP code — treat REJECTED /
        # UNDELIVERABLE as a failure so it surfaces instead of looking "sent".
        body = response.json()
        message_status = (body.get("messages") or [{}])[0].get("status") or {}
        status_group = str(message_status.get("groupName", "")).upper()
        if status_group in ("REJECTED", "UNDELIVERABLE"):
            logger.error(
                f"Infobip rejected delivery to {destination_phone}: {message_status}"
            )
            return False, {"status": "rejected", "details": message_status}
        return True, body
    except Exception as exc:
        logger.error(f"Infobip SMS send error: {exc}", exc_info=True)
        return False, {"message": str(exc)}


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
    tables_and_fields = [
        ("cars", ["car_owner_phone_number", "contact_phone"]),
        ("bikes", ["contact_number", "contact_phone"]),
        ("license_plates", ["contact_phone"]),
        ("car_parts", ["contact_number", "contact_phone"]),
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


@app.before_request
def start_request_timer():
    _request_start_time.set(time.perf_counter())
    _request_supabase_durations_ms.set([])


@app.errorhandler(500)
def handle_internal_error(error):
    if request.path.startswith("/api/"):
        logger.error(
            "Unhandled internal error on %s: %s", request.path, error, exc_info=True
        )
        if posthog_client is not None:
            try:
                posthog_client.capture_exception(error)
            except Exception:
                logger.exception("PostHog exception capture failed")
        return jsonify({"message": "Internal server error"}), 500
    return error


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"
    )
    response.headers.setdefault("Content-Security-Policy", _build_content_security_policy())
    started_at = _request_start_time.get()
    if started_at is not None:
        total_ms = (time.perf_counter() - started_at) * 1000
        supabase_timings = _request_supabase_durations_ms.get() or []
        supabase_total_ms = sum(item.get("duration_ms", 0) for item in supabase_timings)
        response_size = response.calculate_content_length() or 0
        logger.info(
            "REQ_PERF method=%s path=%s status=%s total_ms=%.2f supabase_ms=%.2f supabase_calls=%s response_bytes=%s",
            request.method,
            request.path,
            response.status_code,
            total_ms,
            supabase_total_ms,
            len(supabase_timings),
            response_size,
        )
    return response


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


_DEFAULT_DEALER_LISTING_LIMIT = int(os.getenv("DEFAULT_DEALER_LISTING_LIMIT", "20"))
_DEALER_REQUIRED_DOCS = ("trade_license",)


def _fetch_dealer_listing_policy(user_id):
    """Return {verified: bool, limit: int} for a dealer user, or None for non-dealers."""
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
    return {"verified": bool(row.get("dealer_verified")), "limit": int(limit)}


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
            return None  # Don't block on query errors
        if rows and rows[0].get("is_dealer") and not rows[0].get("dealer_verified"):
            return jsonify(
                {
                    "error": "Your dealer account is pending admin verification. You will be able to post listings once your account is approved.",
                    "code": "dealer_not_verified",
                }
            ), 403

        # Check that all 3 required documents are approved
        if rows and rows[0].get("is_dealer") and rows[0].get("dealer_verified"):
            docs, docs_status = supabase_request(
                "get",
                "/rest/v1/dealer_documents",
                params={
                    "user_id": f"eq.{user_id}",
                    "select": "document_type,status",
                },
                use_service_role=True,
            )
            if docs_status == 200:
                required_types = {
                    "trade_license",
                    "company_registration",
                    "tax_registration",
                }
                approved_types = {
                    d["document_type"] for d in docs if d.get("status") == "approved"
                }
                missing = required_types - approved_types
                if missing:
                    nice_names = {
                        "trade_license": "Trade License",
                        "company_registration": "Company Registration",
                        "tax_registration": "Tax Registration (TRN)",
                    }
                    missing_names = ", ".join(
                        nice_names.get(t, t) for t in sorted(missing)
                    )
                    return jsonify(
                        {
                            "error": f"You must upload and get approval for the following documents before posting: {missing_names}",
                            "code": "dealer_documents_missing",
                            "missing": list(missing),
                        }
                    ), 403
    except Exception as e:
        logger.error(f"Error checking dealer verification: {e}")
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
            f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=id,email,username,is_admin",
            headers=headers,
            timeout=10,
        )

        logger.info(
            f"[admin-check] User {current_user} - Supabase response status: {response.status_code}"
        )

        if response.status_code == 200:
            users = response.json()
            logger.info(f"[admin-check] Users data: {users}")
            if users and len(users) > 0:
                user_data = users[0]
                is_admin = bool(
                    user_data.get("is_admin", False)
                    or _is_super_admin_record(user_data, user_id=current_user)
                )
                logger.info(
                    f"[admin-check] User {current_user} - is_admin: {is_admin}, super_admin: {bool(user_data.get('is_super_admin'))}"
                )
                return (
                    jsonify(
                        {
                            "is_admin": is_admin,
                            "is_super_admin": bool(
                                user_data.get("is_super_admin")
                                or _is_super_admin_record(
                                    user_data, user_id=current_user
                                )
                            ),
                        }
                    ),
                    200,
                )

        logger.warning(f"[admin-check] User {current_user} not found in users table")
        return jsonify({"is_admin": False}), 200
    except Exception as e:
        logger.error(f"Error checking admin status: {str(e)}")
        return jsonify({"is_admin": False, "error": str(e)}), 200


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


# Get all cars (public)
@app.route("/api/cars", methods=["GET"])
def get_cars():
    try:
        cache_key = _build_api_cache_key()
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return _cached_json_response(cached_payload)

        # Get query parameters
        limit, offset = _parse_pagination_args()
        order = request.args.get("order", "created_at.desc")

        # Create parameters for Supabase query, excluding tracking parameters
        params = {
            "select": "*",
            "limit": str(limit),
            "offset": str(offset),
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

        # Use select=* to get all fields, and join with car_images
        filtered_params["select"] = PUBLIC_CAR_PREVIEW_SELECT

        # Use service role for public fetches to ensure all approved listings and images are visible
        response, status_code = supabase_request(
            "get", "/rest/v1/cars", params=filtered_params, use_service_role=True
        )

        if status_code >= 400:
            err_message = ""
            err_code = ""
            if isinstance(response, dict):
                err_message = response.get("message") or response.get("error") or ""
                err_code = response.get("code") or ""
            logger.error(
                "get_cars_supabase_error status=%s code=%s msg=%s raw=%s",
                status_code, err_code, err_message, response,
            )
            return jsonify(
                {"error": err_message or "Unknown error", "data": []}
            ), status_code

        # Ensure we always return a list
        if not response:
            response = []
        elif not isinstance(response, list):
            logger.warning(f"Unexpected response format: {type(response)}")
            response = []

        response = _filter_public_listing_records("cars", response)

        # Normalize images field for frontend
        for car in response:
            car_images = car.pop("car_images", [])
            for img in car_images:
                if "url" in img and "image_url" not in img:
                    img["image_url"] = img["url"]
                elif "image_url" in img and "url" not in img:
                    img["url"] = img["image_url"]
            # Primary image first so car.images[0] is always the thumbnail
            car["images"] = _sort_listing_images(car_images)

        # Fetch seller info for each car in a single batched request
        try:
            seller_map = _batch_fetch_seller_map(
                [car.get("user_id") for car in response]
            )
            for car in response:
                _apply_seller_to_listing(car, seller_map.get(car.get("user_id")))
        except Exception as e:
            logger.warning(f"Error fetching seller info: {e}")

        logger.info(f"Successfully fetched {len(response)} cars")
        _api_cache_set(cache_key, response)
        return _cached_json_response(response), 200

    except Exception as e:
        logger.error(f"Error getting cars: {str(e)}")
        return jsonify({"error": str(e), "data": []}), 500


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


@app.route("/api/cars/<string:car_id>", methods=["GET"])
def get_car_by_id(car_id):
    try:
        logger.info(f"Fetching car details for ID: {car_id}")

        requesting_user = _optional_user_id()
        cache_key = None

        if not requesting_user:
            cache_key = f"api-cache:{request.path}"
            cached_payload = _api_cache_get(cache_key)
            if cached_payload is not None:
                logger.info(f"Redis cache hit for car detail {car_id}")
                return _cached_json_response(cached_payload)

        query = f"/rest/v1/cars?id=eq.{car_id}&select=*"
        car_response, car_status = supabase_request("get", query, use_service_role=True)

        if not car_response or len(car_response) == 0:
            logger.warning(f"Car not found with ID: {car_id}")
            return jsonify({"error": "Car not found"}), 404

        car = _sync_listing_lifecycle(
            "cars", car_response[0], hard_delete_archived=True
        )
        if not car:
            return jsonify({"error": "Car not found"}), 404

        is_owner = requesting_user and car.get("user_id") == requesting_user
        is_public = car.get("is_approved") and car.get("listing_state") == "active"

        if not is_owner and not is_public:
            return jsonify({"error": "Car not found"}), 404

        if is_public and not is_owner:
            try:
                headers = {
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                }
                current_view_count = 0
                view_response = requests.get(
                    f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}&select=view_count",
                    headers=headers,
                    timeout=2,
                )
                if view_response.status_code == 200 and view_response.json():
                    current_view_count = (
                        view_response.json()[0].get("view_count", 0) or 0
                    )
                requests.patch(
                    f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                    headers=headers,
                    json={
                        "view_count": current_view_count + 1,
                        "last_viewed_at": "now()",
                    },
                    timeout=2,
                )
                car["view_count"] = current_view_count + 1
            except Exception as view_error:
                logger.warning(f"Failed to increment view count: {view_error}")

        logger.info(
            f"Found car: {car.get('listing_title', 'Untitled')} (ID: {car['id']})"
        )

        images_query = (
            f"/rest/v1/car_images?car_id=eq.{car_id}&select=*&order=uploaded_at.asc"
        )
        images_response, images_status = supabase_request(
            "get", images_query, use_service_role=True
        )

        if images_status < 400:
            logger.info(f"Found {len(images_response)} images for car {car_id}")
            for image in images_response:
                if "url" in image and not image.get("image_url"):
                    image["image_url"] = image["url"]
                elif "image_url" in image and not image.get("url"):
                    image["url"] = image["image_url"]
            car["images"] = _sort_listing_images(images_response)
        else:
            logger.warning(
                f"Failed to fetch images for car {car_id}: status {images_status}"
            )
            car["images"] = []

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
        if not is_owner:
            for _f in _PUBLIC_STRIP_FIELDS:
                car.pop(_f, None)
        if cache_key:
            _api_cache_set(cache_key, car)
            return _cached_json_response(car)
        return jsonify(car), 200
    except Exception as e:
        logger.error(f"Error fetching car details: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


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


# Create a new car listing (authenticated)
@app.route("/api/cars", methods=["POST"])
@token_required
def create_car(current_user):
    try:
        # Log request details for debugging
        logger.info(f"POST /api/cars - Content-Type: {request.content_type}")
        logger.info(f"POST /api/cars - Content-Length: {request.content_length}")
        logger.info(f"POST /api/cars - Headers: {dict(request.headers)}")

        # Validate input
        if not request.json:
            logger.error(
                f"No JSON data in request. Raw data: {request.data[:500] if request.data else 'None'}"
            )
            return jsonify(
                {
                    "error": "Invalid request data - no JSON received",
                    "content_type": request.content_type,
                    "raw_data": str(request.data[:200]),
                }
            ), 400

        logger.info(f"Creating car listing for user {current_user}")
        logger.info(f"Request data keys: {list(request.json.keys())}")

        verification_check = _require_verified_user_for_listing(current_user)
        if verification_check:
            return verification_check

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        dealer_check = _require_dealer_verified(current_user)
        if dealer_check:
            return dealer_check

        car_data = request.json
        car_data["user_id"] = current_user
        car_data.update(_new_listing_lifecycle_fields())
        _normalize_listing_vin(car_data)

        # Normalize legacy/alternate frontend keys.
        if "description" in car_data and "car_description" not in car_data:
            car_data["car_description"] = car_data.pop("description")
        if "location" in car_data and "car_location" not in car_data:
            car_data["car_location"] = car_data.get("location")
        if "location" in car_data and "car_city" not in car_data:
            car_data["car_city"] = car_data.get("location")
        if "location" in car_data and "area" not in car_data:
            car_data["area"] = car_data.get("location")
        if "contact_phone" in car_data and "car_owner_phone_number" not in car_data:
            car_data["car_owner_phone_number"] = car_data.get("contact_phone")
        if "car_variant" in car_data and "trim" not in car_data:
            car_data["trim"] = car_data.get("car_variant")
        if "exterior_color" in car_data and "color" not in car_data:
            car_data["color"] = car_data.get("exterior_color")
        if "mileage" in car_data and "kilometer_driven" not in car_data:
            car_data["kilometer_driven"] = car_data.get("mileage")
        if "transmission" in car_data and "transmission_type" not in car_data:
            car_data["transmission_type"] = car_data.get("transmission")
        if "engine" in car_data and "engine_capacity" not in car_data:
            car_data["engine_capacity"] = car_data.get("engine")
        try:
            _require_whatsapp_prefill_and_phone_alignment(car_data, "cars")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        try:
            logger.info(
                f"Validating car data: make_year={car_data.get('make_year')}, kilometer_driven={car_data.get('kilometer_driven')}, expected_selling_price={car_data.get('expected_selling_price')}"
            )

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
                    logger.error(
                        f"Invalid transmission_type: {car_data.get('transmission_type')}"
                    )
                    return jsonify(
                        {"error": "Transmission must be Automatic or Manual"}
                    ), 400

            # Validate fuel_type
            if "fuel_type" in car_data and car_data.get("fuel_type"):
                if not _is_valid_car_fuel_type(car_data["fuel_type"]):
                    logger.error(f"Invalid fuel_type: {car_data.get('fuel_type')}")
                    return jsonify(
                        {
                            "error": "Fuel type must be Petrol, Diesel, Electric, Hybrid, Other, or Other - <custom>"
                        }
                    ), 400

            # Validate steering_side
            if "steering_side" in car_data and car_data.get("steering_side"):
                if car_data["steering_side"] not in STEERING_SIDE_OPTIONS:
                    logger.error(
                        f"Invalid steering_side: {car_data.get('steering_side')}"
                    )
                    return jsonify(
                        {"error": "Steering side must be Left or Right"}
                    ), 400

            _validate_description_word_count(
                car_data.get("car_description"), field_name="car_description"
            )
            _validate_no_profanity(
                car_data.get("listing_title"), field_name="listing_title"
            )
            _validate_no_profanity(
                car_data.get("car_description"), field_name="car_description"
            )
            logger.info("All validations passed")
        except ValueError as validation_error:
            logger.error(f"Validation error: {validation_error}")
            return jsonify({"error": str(validation_error)}), 400

        # Extract extras array and save to JSONB column
        extras = car_data.get("extras", [])
        car_data["extras"] = extras

        # Also map extras to boolean columns for backward compatibility
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

        sync_error = _sync_gate_error("car", car_data, len(images))
        if sync_error:
            return sync_error

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
            "color",
            "cylinders",
            "doors",
            "warranty",
            "service_history",
            "car_location",
            "area",
            "emirate",
            "vehicle_type",
            "is_approved",
            "user_id",
            "user_email",
            "country_code",
            "whatsapp_number",
            "whatsapp_prefill_text",
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
            "lady_driven",
            "extras",
            "expires_at",
            "expired_at",
            "retention_expires_at",
            "last_extended_at",
            "extension_count",
            "is_archived",
            "registration_document_url",
        }
        car_data = {k: v for k, v in car_data.items() if k in allowed_fields}
        car_data["user_email"] = get_user_email(current_user)
        car_data["status"] = _initial_listing_status()
        # auto_review_reasons is NOT NULL in the cars table — default to empty array
        car_data.setdefault("auto_review_reasons", [])

        if not images or len(images) == 0:
            return jsonify(
                {"error": "At least one image is required for a car listing."}
            ), 400

        logger.info(f"Creating car with data: {car_data}")

        # Create the car
        data, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/cars", car_data, user_id=current_user
        )

        logger.info(f"Database insert result: status={status_code}, data={data}")

        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(data, status_code, "car")
            return jsonify(friendly_data), friendly_status

        car_id = data[0]["id"]

        # Add images if any
        image_inserts = []
        for index, image_entry in enumerate(images):
            if isinstance(image_entry, str):
                image_url = image_entry
                display_url = image_url
                normalized_crop = _normalize_crop_settings({})
                crop_meta = None
            elif isinstance(image_entry, dict):
                image_url = image_entry.get("image_url") or image_entry.get("url")
                if not image_url:
                    continue
                display_url = image_entry.get("display_url") or image_url
                normalized_crop = _normalize_crop_settings(image_entry)
                crop_meta = image_entry.get("crop_meta")
            else:
                continue

            image_insert = {
                "car_id": car_id,
                "url": image_url,
                "image_url": image_url,
                "display_url": display_url,
                "focal_x": normalized_crop["focal_x"],
                "focal_y": normalized_crop["focal_y"],
                "crop_meta": crop_meta,
                "cropped_at": _isoformat_utc(_utc_now()),
            }
            image_inserts.append(image_insert)

        if not image_inserts:
            supabase_request(
                "delete",
                "/rest/v1/cars",
                params={"id": f"eq.{car_id}"},
                user_id=current_user,
            )
            return jsonify({"error": "At least one valid image is required."}), 400

        images_data, images_status = supabase_request(
            "post", "/rest/v1/car_images", data=image_inserts, user_id=current_user
        )
        if images_status < 400:
            data[0]["images"] = _sort_listing_images(images_data)
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

            data[0]["images"] = _sort_listing_images(inserted_images)

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            # Only notify admins immediately if auto-review won't handle it
            if _initial_listing_status() == "pending":
                _send_new_listing_admin_notification("car", data[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "car", data[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

        _invalidate_public_inventory_cache("cars")
        _trigger_auto_review_async()
        capture_posthog_event(
            "listing_created",
            current_user,
            {
                "listing_type": "car",
                "has_images": bool(images),
                "is_dealer": bool(car_data.get("is_dealer")),
                "submission_status": data[0].get("status"),
            },
        )
        return jsonify(data[0]), 201
    except Exception as e:
        logger.error(f"Error creating car listing: {e}")
        return jsonify({"error": str(e)}), 500


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


# Update a car listing (authenticated)
# Accept PUT/PATCH/POST for compatibility with method-restrictive proxies.
@app.route("/api/cars/<string:car_id>/update", methods=["POST"])
@app.route("/api/cars/<string:car_id>", methods=["PUT", "PATCH", "POST"])
@token_required
def update_car(current_user, car_id):
    try:
        logger.info(f"Updating car {car_id} for user {current_user}")

        # Check if this is FormData or JSON
        is_form_data = (
            request.content_type and "multipart/form-data" in request.content_type
        )

        # Also treat as form data if request.form has fields (some proxies strip content-type)
        if not is_form_data and request.form:
            is_form_data = True

        # Try JSON as fallback
        parsed_json = None
        try:
            parsed_json = request.get_json(silent=True)
        except Exception:
            pass

        if not is_form_data and not parsed_json:
            return jsonify(
                {"error": "Invalid request data", "content_type": request.content_type}
            ), 400

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
            images = None

            # Extract form fields
            for key in request.form.keys():
                value = request.form.get(key)
                if key in ["keep_image_ids", "crop_data"]:
                    continue
                if value in ["undefined", "null"]:
                    continue
                if value == "":
                    continue
                # Convert boolean strings
                if value == "true":
                    update_data[key] = True
                elif value == "false":
                    update_data[key] = False
                # Convert numeric strings
                elif (
                    key
                    in [
                        "make_year",
                        "mileage",
                        "expected_selling_price",
                        "price",
                        "kilometer_driven",
                    ]
                    and value.lstrip("-").isdigit()
                ):
                    update_data[key] = int(value)
                else:
                    update_data[key] = value

            logger.info(f"Extracted form data: {update_data}")

            # Handle extras array (multiple checkboxes with same name)
            if "extras[]" in request.form:
                extras_list = request.form.getlist("extras[]")
                update_data["extras"] = extras_list

                # Also map to boolean columns for backward compatibility
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
                    update_data[db_field] = False

                # Set selected extras to True
                for extra in extras_list:
                    if extra in extras_mapping:
                        update_data[extras_mapping[extra]] = True

            # Handle new images
            new_images = (
                request.files.getlist("images") if "images" in request.files else []
            )
            keep_image_ids = request.form.getlist("keep_image_ids")
            crop_data = _parse_crop_data_payload(
                request.form.get("crop_data"), len(new_images)
            )

        else:
            logger.info("Processing JSON request")
            update_data = parsed_json or {}
            new_images = []
            keep_image_ids = []
            crop_data = []
            images = update_data.pop("images", None)

        _normalize_listing_vin(update_data)

        # Normalize legacy/alternate frontend keys.
        if "description" in update_data and "car_description" not in update_data:
            update_data["car_description"] = update_data.pop("description")
        if "location" in update_data and "car_location" not in update_data:
            update_data["car_location"] = update_data.get("location")
        if "location" in update_data and "car_city" not in update_data:
            update_data["car_city"] = update_data.get("location")
        if "location" in update_data and "area" not in update_data:
            update_data["area"] = update_data.get("location")
        if (
            "contact_phone" in update_data
            and "car_owner_phone_number" not in update_data
        ):
            update_data["car_owner_phone_number"] = update_data.get("contact_phone")
        if "car_variant" in update_data and "trim" not in update_data:
            update_data["trim"] = update_data.get("car_variant")
        if "exterior_color" in update_data and "color" not in update_data:
            update_data["color"] = update_data.get("exterior_color")
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "cars")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

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
            # Validate fuel_type if provided
            if "fuel_type" in update_data and update_data.get("fuel_type"):
                if not _is_valid_car_fuel_type(update_data["fuel_type"]):
                    return jsonify(
                        {
                            "error": "Fuel type must be Petrol, Diesel, Electric, Hybrid, Other, or Other - <custom>"
                        }
                    ), 400
            # Validate steering_side if provided
            if "steering_side" in update_data and update_data.get("steering_side"):
                if update_data["steering_side"] not in STEERING_SIDE_OPTIONS:
                    return jsonify(
                        {"error": "Steering side must be Left or Right"}
                    ), 400
            if "car_description" in update_data:
                _validate_description_word_count(
                    update_data.get("car_description"), field_name="car_description"
                )
                _validate_no_profanity(
                    update_data.get("car_description"), field_name="car_description"
                )
            if "description" in update_data and "car_description" not in update_data:
                _validate_description_word_count(
                    update_data.get("description"), field_name="car_description"
                )
                _validate_no_profanity(
                    update_data.get("description"), field_name="car_description"
                )
                update_data["car_description"] = update_data.pop("description")
            if "listing_title" in update_data:
                _validate_no_profanity(
                    update_data.get("listing_title"), field_name="listing_title"
                )
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
            "color",
            "cylinders",
            "doors",
            "warranty",
            "service_history",
            "car_location",
            "area",
            "emirate",
            "vehicle_type",
            "is_approved",
            "country_code",
            "whatsapp_number",
            "whatsapp_prefill_text",
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
            "lady_driven",
            "extras",
            "registration_document_url",
        }
        # Sanitize update data to ensure 'id' is NOT sent to Supabase as part of the body
        # (Supabase/PostgREST rejects updates where the primary key is in the body)
        update_data.pop("id", None)

        # Strictly apply allowed fields filter
        update_data = {k: v for k, v in update_data.items() if k in allowed_fields}

        if "expected_selling_price" in update_data and update_data["expected_selling_price"] is not None:
            _maybe_record_price_drop("cars", car_id, update_data["expected_selling_price"])
            _record_price_point("cars", car_id, update_data["expected_selling_price"])

        # Update the car using PATCH for partial update
        data, status_code = supabase_request(
            "patch",
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
            kept_images = [img for img in current_images if img["id"] in keep_image_ids]

            upload_failures = []
            inserted_new_images = 0

            # Upload new images
            if new_images:
                if not ensure_storage_bucket("listing-images"):
                    return jsonify({"error": "Storage bucket not available."}), 500

                # Check if any kept image is primary
                has_primary_kept = any(
                    img.get("is_primary", False) for img in kept_images
                )
                primary_assigned = has_primary_kept

                for index, file in enumerate(new_images):
                    if file and file.filename:
                        upload_metadata, upload_error = upload_to_supabase_storage(
                            file,
                            bucket_name="listing-images",
                            folder=str(current_user),
                            return_metadata=True,
                            crop_settings=crop_data[index],
                        )

                        if upload_error:
                            message = f"Failed to upload new image {file.filename}: {upload_error}"
                            logger.error(message)
                            upload_failures.append(message)
                            continue

                        image_data = {
                            "car_id": car_id,
                            "url": upload_metadata["url"],
                            "image_url": upload_metadata["image_url"],
                            "display_url": upload_metadata.get("display_url"),
                            "focal_x": upload_metadata.get("focal_x", 50),
                            "focal_y": upload_metadata.get("focal_y", 50),
                            "crop_meta": upload_metadata.get("crop_meta"),
                            "cropped_at": _isoformat_utc(_utc_now()),
                        }

                        image_insert_response, image_insert_status = supabase_request(
                            "post",
                            "/rest/v1/car_images",
                            data=image_data,
                            user_id=current_user,
                        )
                        if image_insert_status >= 400:
                            message = (
                                f"Failed to save image metadata for {file.filename}: "
                                f"{image_insert_status} - {image_insert_response}"
                            )
                            logger.error(message)
                            upload_failures.append(message)
                            continue

                        inserted_new_images += 1
                        primary_assigned = True

                if upload_failures and inserted_new_images == 0 and not kept_images:
                    return jsonify(
                        {
                            "error": "All uploaded images failed to save. Existing images were kept.",
                            "details": upload_failures,
                        }
                    ), 500

            # Delete images not in keep_image_ids after new uploads succeed.
            for img in current_images:
                if img["id"] not in keep_image_ids:
                    logger.info(f"Deleting image {img['id']}")
                    supabase_request(
                        "delete",
                        "/rest/v1/car_images",
                        params={"id": f"eq.{img['id']}"},
                        user_id=current_user,
                    )

        elif not is_form_data and images is not None:
            image_inserts = []
            for image_entry in images:
                if isinstance(image_entry, str):
                    image_url = image_entry
                    display_url = image_url
                    normalized_crop = _normalize_crop_settings({})
                    crop_meta = None
                elif isinstance(image_entry, dict):
                    image_url = image_entry.get("image_url") or image_entry.get("url")
                    if not image_url:
                        continue
                    display_url = image_entry.get("display_url") or image_url
                    normalized_crop = _normalize_crop_settings(image_entry)
                    crop_meta = image_entry.get("crop_meta")
                else:
                    continue

                image_inserts.append(
                    {
                        "car_id": car_id,
                        "url": image_url,
                        "image_url": image_url,
                        "display_url": display_url,
                        "focal_x": normalized_crop["focal_x"],
                        "focal_y": normalized_crop["focal_y"],
                        "crop_meta": crop_meta,
                        "cropped_at": _isoformat_utc(_utc_now()),
                    }
                )

            if not image_inserts:
                return jsonify({"error": "At least one valid image is required."}), 400

            # Snapshot existing image IDs BEFORE inserting replacements so we can
            # delete them only after the new rows land. If the insert fails we
            # leave the originals intact rather than wiping the listing.
            existing_images_resp, existing_images_status = supabase_request(
                "get",
                "/rest/v1/car_images",
                params={"select": "id", "car_id": f"eq.{car_id}"},
                user_id=current_user,
            )
            existing_image_ids = (
                [row["id"] for row in existing_images_resp if isinstance(row, dict) and row.get("id")]
                if existing_images_status < 400 and isinstance(existing_images_resp, list)
                else []
            )

            images_response, images_status = supabase_request(
                "post",
                "/rest/v1/car_images",
                data=image_inserts,
                user_id=current_user,
            )

            inserted_rows = []
            if images_status >= 400:
                for image_insert in image_inserts:
                    single_image_response, single_image_status = supabase_request(
                        "post",
                        "/rest/v1/car_images",
                        data=image_insert,
                        user_id=current_user,
                    )
                    if single_image_status < 400 and single_image_response:
                        if isinstance(single_image_response, list):
                            inserted_rows.extend(single_image_response)
                        else:
                            inserted_rows.append(single_image_response)

                if not inserted_rows:
                    logger.error(
                        f"Failed to replace car images for {car_id}: "
                        f"{images_status} - {images_response}"
                    )
                    # No new rows landed → leave originals untouched.
                    return jsonify({"error": "Failed to save listing images."}), 500
            else:
                if isinstance(images_response, list):
                    inserted_rows = images_response
                elif isinstance(images_response, dict):
                    inserted_rows = [images_response]

            # New rows are persisted; safe to drop the originals now.
            if existing_image_ids:
                inserted_ids = {
                    row.get("id")
                    for row in inserted_rows
                    if isinstance(row, dict) and row.get("id")
                }
                to_delete = [img_id for img_id in existing_image_ids if img_id not in inserted_ids]
                if to_delete:
                    quoted_ids = ",".join(f'"{img_id}"' for img_id in to_delete)
                    supabase_request(
                        "delete",
                        "/rest/v1/car_images",
                        params={"id": f"in.({quoted_ids})"},
                        user_id=current_user,
                    )

            images_data = _sort_listing_images(inserted_rows)

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
            params={
                "select": "*",
                "car_id": f"eq.{car_id}",
                "order": "uploaded_at.asc",
            },
            user_id=current_user,
        )

        if images_status < 400:
            # Transform url to image_url for frontend compatibility
            for image in images_data:
                if "url" in image and "image_url" not in image:
                    image["image_url"] = image["url"]
            car["images"] = _sort_listing_images(images_data)
        else:
            car["images"] = []

        # Send edit notification email
        try:
            user_email = car.get("user_email") or car.get("contact_email")
            if not user_email:
                user_email = get_user_email(current_user)
            if user_email and EMAIL_REGEX.match(user_email):
                _, email_error = _send_listing_status_email(
                    user_email,
                    "cars",
                    car,
                    "updated",
                    request.headers.get("Origin"),
                )
                if email_error:
                    logger.error(f"Edit email failed for car {car_id}: {email_error}")
                else:
                    logger.info(f"Edit email sent for car {car_id}")
        except Exception as email_err:
            logger.error(f"Error sending edit email: {email_err}")

        _invalidate_public_inventory_cache("cars")
        _invalidate_api_cache_prefixes([f"/api/cars/{car_id}"])
        return jsonify(car), 200
    except Exception as e:
        logger.error(f"Error updating car: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/storage/signed-upload-url", methods=["POST"])
@token_required
def create_storage_signed_upload_url(current_user):
    try:
        payload = request.get_json(silent=True) or {}
        bucket_name = str(payload.get("bucket_name") or "").strip()
        object_path = str(payload.get("object_path") or "").strip().lstrip("/")
        upsert = bool(payload.get("upsert"))

        if bucket_name not in {
            "listing-images",
            "profile-photos",
            "dealer-documents",
            "registration-documents",
        }:
            return jsonify({"error": "Unsupported bucket"}), 400

        if not object_path:
            return jsonify({"error": "object_path is required"}), 400

        if not object_path.startswith(f"{current_user}/"):
            return jsonify(
                {"error": "object_path must be scoped to the authenticated user"}
            ), 403

        if not ensure_storage_bucket(bucket_name):
            return jsonify({"error": "Storage bucket not available"}), 500

        signed_upload, error = _create_signed_upload_url(
            bucket_name=bucket_name,
            object_path=object_path,
            upsert=upsert,
        )
        if error:
            return jsonify({"error": error}), 502

        return jsonify(signed_upload), 200
    except Exception as e:
        logger.error(f"Error creating signed upload URL: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to create signed upload URL"}), 500


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
        for index, image_url in enumerate(image_urls):
            image_data = {
                "car_id": car_id,
                "url": image_url,
                "image_url": image_url,  # Add image_url field for frontend compatibility
                "crop_meta": {"sort_index": index},
                "cropped_at": _isoformat_utc(_utc_now()),
            }
            supabase_request(
                "post", "/rest/v1/car_images", data=image_data, user_id=current_user
            )

        return jsonify({"message": f"{len(image_urls)} images uploaded successfully"})
    except Exception as e:
        logger.error(f"Error uploading images: {e}")
        return jsonify({"error": str(e)}), 500


def ensure_storage_bucket(bucket_name="listing-images"):
    """
    Ensure the storage bucket exists and is public.
    """
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
                    "public": True,
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
        elif response.status_code == 404:
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
            else:
                logger.error(
                    f"Failed to create bucket: {create_response.status_code} - {create_response.text}"
                )
                return False
        else:
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


def _create_signed_upload_url(bucket_name, object_path, upsert=False):
    if not bucket_name or not object_path:
        return None, "bucket_name and object_path are required"

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

    return {
        "signed_url": signed_url,
        "token": token,
        "path": object_path,
        "public_url": _get_public_storage_object_url(bucket_name, object_path),
    }, None


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


@app.route("/api/upload-images", methods=["POST"])
@token_required
def upload_images(current_user):
    try:
        logger.info(f"Image upload request received from user: {current_user}")

        # Ensure storage bucket exists
        if not ensure_storage_bucket("listing-images"):
            logger.error("Failed to ensure storage bucket exists")
            return jsonify(
                {"error": "Storage bucket not available. Please try again later."}
            ), 500

        # Check if files were uploaded
        if "images" not in request.files:
            logger.error("No images field in request")
            return jsonify({"error": "No images provided"}), 400

        files = request.files.getlist("images")
        if not files or all(file.filename == "" for file in files):
            logger.error("No image files selected")
            return jsonify({"error": "No images selected"}), 400

        crop_data = _parse_crop_data_payload(request.form.get("crop_data"), len(files))

        logger.info(f"Processing {len(files)} images for user {current_user}")
        image_records = []
        image_urls = []
        errors = []

        for index, file in enumerate(files):
            if file and file.filename:
                upload_metadata, error = upload_to_supabase_storage(
                    file,
                    bucket_name="listing-images",
                    folder=str(current_user),
                    return_metadata=True,
                    crop_settings=crop_data[index],
                )

                if upload_metadata:
                    image_records.append(upload_metadata)
                    image_urls.append(upload_metadata["url"])
                else:
                    errors.append(f"Failed to upload {file.filename}: {error}")
                    logger.error(f"Failed to upload {file.filename}: {error}")

        if not image_records and errors:
            return jsonify(
                {"error": "All image uploads failed", "details": errors}
            ), 500

        logger.info(
            f"Successfully uploaded {len(image_records)} images to Supabase Storage"
        )

        return jsonify(
            {
                "images": image_records,
                "urls": image_urls,
                "absolute_urls": image_urls,  # Already absolute URLs from Supabase
                "count": len(image_records),
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
    my_listings_url = f"{SITE_URL}/my-listings"

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
            <a href="{my_listings_url}" style="display: inline-block; background-color: #8bd6b4; color: #041008; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">View My Listings</a>
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


@app.route("/api/car-model-request", methods=["POST"])
def send_car_model_request():
    try:
        data = request.json or {}
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip()
        make = (data.get("make") or "").strip()
        model = (data.get("model") or "").strip()
        year = (data.get("year") or "").strip()
        notes = (data.get("notes") or "").strip()
        source = (data.get("source") or "").strip() or "post-car"

        if not email or not make or not model:
            return jsonify({"error": "Name, email, make, and model are required"}), 400

        if not EMAIL_REGEX.match(email):
            return jsonify({"error": "Invalid email address"}), 400

        if any(len(value) > 2000 for value in [name, make, model, year, notes, source]):
            return jsonify({"error": "Request is too long"}), 400

        client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
        if _contact_rate_limited(client_ip):
            return jsonify({"error": "Too many requests. Please try again later."}), 429

        from_email = os.getenv("RESEND_FROM_EMAIL")
        admin_email = os.getenv("PRIMARY_SUPER_ADMIN_EMAIL", "admin@dphclassifieds.com")
        if not from_email:
            return jsonify({"error": "Email service is not configured"}), 500

        title = f"{make} {model}".strip()
        html_content = f"""
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 40px 20px; background-color: #041008; color: #f0fdf4; border-radius: 24px; border: 1px solid rgba(139, 214, 180, 0.1);">
          <h2 style="margin: 0 0 8px; font-size: 22px; color: #ffffff;">Car model request</h2>
          <p style="margin: 0 0 20px; color: #94a3b8;">A user could not find a model in the listing form.</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #64748b; width: 28%;">Name</td><td style="padding: 8px 0; color: #f0fdf4;">{xml_escape(name or 'Unknown')}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Email</td><td style="padding: 8px 0; color: #f0fdf4;">{xml_escape(email)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Make</td><td style="padding: 8px 0; color: #f0fdf4;">{xml_escape(make)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Model</td><td style="padding: 8px 0; color: #f0fdf4;">{xml_escape(model)}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Year</td><td style="padding: 8px 0; color: #f0fdf4;">{xml_escape(year or 'Not provided')}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b;">Source</td><td style="padding: 8px 0; color: #f0fdf4;">{xml_escape(source)}</td></tr>
          </table>
          <div style="margin-top: 20px; padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; white-space: pre-wrap; line-height: 1.6; color:#e2e8f0;">{xml_escape(notes or 'No notes provided.')}</div>
        </div>
        """

        payload = {
            "from": from_email,
            "to": [admin_email],
            "subject": f"[Model Request] {title}",
            "reply_to": email,
            "html": html_content,
            "text": (
                f"Name: {name or 'Unknown'}\n"
                f"Email: {email}\n"
                f"Make: {make}\n"
                f"Model: {model}\n"
                f"Year: {year or 'Not provided'}\n"
                f"Source: {source}\n\n"
                f"Notes:\n{notes or 'No notes provided.'}"
            ),
        }

        result, error = _send_resend_email(payload)
        if error:
            logger.error(f"Model request email failed: {error}")
            return jsonify({"error": "Failed to send request"}), 502

        return jsonify({"message": "Request sent successfully", "result": result}), 200
    except Exception as e:
        logger.error(f"Error sending car model request: {str(e)}")
        return jsonify({"error": "Failed to send request"}), 500


# Get license plates
@app.route("/api/license-plates", methods=["GET"])
def get_license_plates():
    try:
        cache_key = _build_api_cache_key()
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return _cached_json_response(cached_payload)

        # Optional query parameters
        city = request.args.get("city")
        code = request.args.get("code")
        digits = request.args.get("digits")

        # Build query — public endpoint, so mirror the other list endpoints:
        # only approved rows, and is_approved=eq.true so the admin "hide reddit
        # listings" toggle (bulk-sets is_approved=false on reddit rows) removes
        # them here too. Without these predicates this endpoint leaked reddit
        # (and unapproved) plates.
        query = "/rest/v1/license_plates?select=*&status=eq.approved&is_approved=eq.true"

        # Add filters if provided
        if city and city != "All cities":
            query += f"&city=eq.{city}"
        if code and code != "All codes":
            query += f"&code=eq.{code}"
        if digits and digits != "Any digits":
            query += f"&digits=eq.{digits}"

        response, response_status = supabase_request("get", query)
        if response_status >= 400:
            return jsonify(response), response_status
        _api_cache_set(cache_key, response)
        return _cached_json_response(response)
    except Exception as e:
        logger.error(f"Error fetching license plates: {e}")
        return jsonify({"error": str(e)}), 500


# Add a test endpoint that returns static data
@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok"}), 200


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

        if "username" in data and not _normalize_username_value(data.get("username")):
            return jsonify(
                {
                    "message": "Username is required",
                    "code": "username_required",
                    "field": "username",
                }
            ), 400

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
            "city": "city",
            "emirate": "emirate",
            "country": "country",
            "postalCode": "postal_code",
            "address": "address",
            "bio": "bio",
            "isDealer": "is_dealer",
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
            "showUsernameOnListings": "show_username_on_listings",
        }

        # Prepare update data - only include fields that are provided and not empty
        update_payload = {}
        varchar_limits = {
            "phone": 20,
            "country_code": 10,
            "whatsapp_number": 20,
            "first_name": 100,
            "last_name": 100,
            "username": 100,
            "display_name": 150,
            "city": 100,
            "emirate": 50,
            "country": 100,
            "postal_code": 20,
            "company_name": 255,
            "company_registration_number": 100,
            "trade_license_number": 100,
            "tax_registration_number": 100,
        }
        for frontend_field, db_field in field_mapping.items():
            if frontend_field in data:
                value = data[frontend_field]
                # Include the value if it's not an empty string, or if it's a required field
                if (
                    value or value is False or value == 0
                ):  # Include False and 0 but not empty strings
                    if isinstance(value, str) and db_field in varchar_limits:
                        max_len = varchar_limits[db_field]
                        if len(value) > max_len:
                            logger.warning(
                                f"Truncating {db_field} from {len(value)} to {max_len} chars"
                            )
                            value = value[:max_len]
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
        check_url = (
            f"{app.config['SUPABASE_URL']}/rest/v1/users?id=eq.{current_user}&select=*"
        )
        check_response = requests.get(check_url, headers=headers, timeout=10)

        try:
            existing_rows = check_response.json()
        except Exception:
            logger.error(
                f"Failed to parse user lookup response: {check_response.text}",
                exc_info=True,
            )
            return jsonify({"message": "Failed to load user profile"}), 502

        if (
            check_response.status_code != 200
            or not isinstance(existing_rows, list)
            or not existing_rows
        ):
            logger.error(f"User not found: {current_user}")
            return jsonify({"message": "User not found"}), 404

        existing_user = existing_rows[0]
        requested_username = _normalize_username_value(update_payload.get("username"))
        existing_username = _normalize_username_value(existing_user.get("username"))

        if not existing_username and not requested_username:
            return jsonify(
                {
                    "message": "Username is required",
                    "code": "username_required",
                    "field": "username",
                }
            ), 400

        if requested_username and requested_username != existing_username:
            if _is_username_blocked(requested_username):
                return jsonify(
                    {
                        "message": _username_blocked_message(),
                        "code": "username_blocked",
                        "field": "username",
                    }
                ), 409
            username_check = _check_username_availability(
                requested_username,
                current_user,
            )
            if not username_check.get("available", False):
                return jsonify(
                    {
                        "message": username_check.get("message")
                        or _username_conflict_message(),
                        "code": "username_taken",
                        "field": "username",
                    }
                ), 409

        existing_phone = _normalize_phone_number(
            existing_user.get("phone"),
            existing_user.get("country_code"),
        )
        requested_phone = _normalize_phone_number(
            update_payload.get("phone", existing_user.get("phone")),
            update_payload.get("country_code", existing_user.get("country_code")),
        )
        phone_changed = bool(requested_phone and requested_phone != existing_phone)

        if phone_changed:
            update_payload["phone_verified"] = False
            update_payload["phone_verified_at"] = None

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
                    phone_verification = None

                    if phone_changed and requested_phone:
                        try:
                            verification_result = _issue_phone_verification(
                                user_id=current_user,
                                phone=requested_phone,
                                country_code=update_payload.get(
                                    "country_code", existing_user.get("country_code")
                                ),
                                purpose="phone_change",
                                metadata={
                                    "source": "account_settings",
                                    "phone_changed": True,
                                },
                            )
                            phone_verification = _phone_verification_response(
                                verification_result["verification"]
                            )
                        except Exception as verification_err:
                            logger.error(
                                f"Failed to start phone verification after profile update: {verification_err}",
                                exc_info=True,
                            )
                            phone_verification = {
                                "status": "failed",
                                "message": str(verification_err),
                            }

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
                            "phone_verification": phone_verification,
                            "phone_verification_required": bool(phone_verification),
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
            except Exception:
                error_data = {"detail": response.text}

            error_message = "Failed to update profile"
            if isinstance(error_data, dict):
                if _is_username_conflict_error(error_data, response.text):
                    return jsonify(
                        {
                            "message": _username_conflict_message(),
                            "error": error_data,
                            "code": "username_taken",
                            "field": "username",
                            "status": 409,
                        }
                    ), 409
                error_message = (
                    error_data.get("message")
                    or error_data.get("detail")
                    or error_data.get("hint")
                    or str(error_data.get("errors", error_data))
                )

            return jsonify(
                {
                    "message": error_message,
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


@app.route("/api/user/dealer-documents", methods=["GET"])
@token_required
def get_dealer_documents(current_user):
    """Get all dealer documents for the current user"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{current_user}&select=*&order=uploaded_at.desc",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": "Failed to fetch documents"}), 500

        docs = resp.json()
        return jsonify({"documents": docs}), 200
    except Exception as e:
        logger.error(f"Error fetching dealer documents: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to fetch documents"}), 500


@app.route("/api/user/dealer-documents", methods=["POST"])
@token_required
def upload_dealer_document(current_user):
    """Upload a dealer document (trade_license, company_registration, or tax_registration).

    Accepts an optional `expires_at` form field (ISO date, e.g. 2027-04-15) which
    is stored on the dealer_documents row so the expiry-reminder worker and the
    listing-create gate can check whether the doc is still valid.
    """
    try:
        document_type = request.form.get("document_type")
        if document_type not in (
            "trade_license",
            "company_registration",
            "tax_registration",
        ):
            return jsonify(
                {
                    "error": "Invalid document_type. Must be: trade_license, company_registration, or tax_registration"
                }
            ), 400

        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "No file selected"}), 400

        content_type = file.content_type or ""
        if content_type not in DEALER_DOCUMENT_ALLOWED_MIME_TYPES:
            return jsonify({"error": "Invalid file type. Allowed: JPG, PNG, PDF"}), 400

        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        if file_size > DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES:
            return jsonify(
                {
                    "error": f"File too large. Maximum size: {DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES // (1024 * 1024)}MB"
                }
            ), 400

        # Optional expiry date. Trade license is the one we strictly require
        # an expiry for; the others are nice-to-have.
        raw_expires_at = (request.form.get("expires_at") or "").strip()
        expires_at_iso = None
        if raw_expires_at:
            try:
                expires_at_dt = datetime.datetime.fromisoformat(raw_expires_at)
                if expires_at_dt.date() <= datetime.datetime.utcnow().date():
                    return jsonify({"error": "Expiry date must be in the future"}), 400
                expires_at_iso = expires_at_dt.date().isoformat()
            except ValueError:
                return jsonify({"error": "Invalid expiry date"}), 400
        elif document_type == "trade_license":
            return jsonify(
                {"error": "Trade license requires an expiry date"}
            ), 400

        if not ensure_storage_bucket("dealer-documents"):
            return jsonify({"error": "Storage bucket not available"}), 500

        ext = (
            file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        )
        object_path = f"{current_user}/{document_type}_{uuid.uuid4()}.{ext}"

        file_bytes = file.read()
        upload_url = f"{SUPABASE_URL}/storage/v1/object/dealer-documents/{object_path}"
        upload_headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "true",
        }

        upload_response = requests.post(
            upload_url, headers=upload_headers, data=file_bytes, timeout=30
        )
        if upload_response.status_code not in [200, 201]:
            logger.error(
                f"Document upload failed: {upload_response.status_code} - {upload_response.text}"
            )
            return jsonify({"error": "Failed to upload document"}), 500

        public_url = (
            f"{SUPABASE_URL}/storage/v1/object/public/dealer-documents/{object_path}"
        )

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        # Soft-replace: mark any active row of the same doc_type as
        # `replaced_at=now()` rather than deleting, so admins keep an audit
        # trail of every license the dealer has ever uploaded.
        existing_resp = requests.get(
            (
                f"{SUPABASE_URL}/rest/v1/dealer_documents"
                f"?user_id=eq.{current_user}"
                f"&document_type=eq.{document_type}"
                f"&replaced_at=is.null"
                f"&select=id"
            ),
            headers=headers,
            timeout=10,
        )
        if existing_resp.status_code == 200 and existing_resp.json():
            prev_ids = ",".join(str(p["id"]) for p in existing_resp.json())
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/dealer_documents?id=in.({prev_ids})",
                headers=headers,
                json={"replaced_at": "now()"},
                timeout=10,
            )

        insert_payload = {
            "user_id": current_user,
            "document_type": document_type,
            "url": public_url,
            "filename": file.filename,
            "file_type": content_type,
            "storage_path": object_path,
            "status": "pending",
        }
        if expires_at_iso:
            insert_payload["expires_at"] = expires_at_iso
        insert_resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_documents",
            headers={**headers, "Prefer": "return=representation"},
            json=insert_payload,
            timeout=10,
        )
        if insert_resp.status_code not in [200, 201]:
            logger.error(f"Failed to insert document record: {insert_resp.text}")
            return jsonify({"error": "Failed to save document"}), 500
        doc_data = insert_resp.json()[0]

        all_docs_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{current_user}&select=*&order=uploaded_at.desc",
            headers=headers,
            timeout=10,
        )
        all_docs = (
            all_docs_resp.json() if all_docs_resp.status_code == 200 else [doc_data]
        )

        return jsonify(
            {
                "message": "Document uploaded successfully",
                "document": doc_data,
                "documents": all_docs,
            }
        ), 200

    except Exception as e:
        logger.error(f"Error uploading dealer document: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to upload document"}), 500


@app.route("/api/auth/dealer-submit-application", methods=["POST"])
@token_required
def dealer_submit_application(current_user):
    """Mark the dealer's KYC application as submitted and notify admins.

    Called by the frontend after the dealer has uploaded the trade license at
    signup (or on the resume-flow /dealer/onboarding page). Idempotent: a
    second call from an already-submitted account is a no-op.
    """
    try:
        # Fetch the user row so we know what we're transitioning from.
        user_resp, user_status = supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{current_user}&select=id,email,first_name,last_name,legal_business_name,company_name,trn,is_dealer,dealer_verified,dealer_application_status",
            use_service_role=True,
        )
        if user_status >= 400 or not user_resp:
            return jsonify({"error": "User not found"}), 404
        user_row = user_resp[0]

        if not user_row.get("is_dealer"):
            return jsonify({"error": "Only dealer accounts can submit an application"}), 400

        # Require the trade license to be on file before we accept submission.
        docs_resp, docs_status = supabase_request(
            "get",
            (
                f"/rest/v1/dealer_documents?user_id=eq.{current_user}"
                f"&document_type=eq.trade_license"
                f"&replaced_at=is.null"
                f"&select=id,expires_at"
                f"&order=uploaded_at.desc&limit=1"
            ),
            use_service_role=True,
        )
        if docs_status >= 400 or not docs_resp:
            return jsonify({
                "error": "Trade license must be uploaded before submitting",
                "code": "trade_license_missing",
            }), 400

        current_status = user_row.get("dealer_application_status") or "draft"
        if current_status == "submitted":
            return jsonify({
                "message": "Application already submitted",
                "dealer_application_status": "submitted",
            }), 200
        if current_status == "approved":
            return jsonify({
                "message": "Application already approved",
                "dealer_application_status": "approved",
            }), 200

        patch_resp, patch_status = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{current_user}",
            data={
                "dealer_application_status": "submitted",
                "verification_documents_submitted": True,
            },
            use_service_role=True,
        )
        if patch_status >= 400:
            logger.warning(
                f"Failed to mark dealer application submitted for {current_user}: {patch_resp}"
            )
            return jsonify({"error": "Failed to submit application"}), 500

        # Best-effort admin notification email. The actual review happens in
        # the admin Dealers page.
        try:
            admin_email = os.getenv("RESEND_ADMIN_NOTIFICATION_EMAIL") or os.getenv(
                "RESEND_REPLY_TO_EMAIL"
            )
            from_email = os.getenv("RESEND_FROM_EMAIL")
            if admin_email and from_email:
                biz_name = (
                    user_row.get("legal_business_name")
                    or user_row.get("company_name")
                    or "(no name)"
                )
                _send_resend_email({
                    "from": from_email,
                    "to": [admin_email],
                    "subject": f"DPH Admin: New dealer application — {biz_name}",
                    "html": (
                        f"<p>A new dealer application is waiting for review.</p>"
                        f"<p><strong>Business:</strong> {biz_name}<br/>"
                        f"<strong>TRN:</strong> {user_row.get('trn') or '(none)'}<br/>"
                        f"<strong>Email:</strong> {user_row.get('email')}</p>"
                        f"<p>Review in the admin panel under Dealers → Pending.</p>"
                    ),
                })
        except Exception as notify_err:
            logger.warning(f"Admin notification email failed: {notify_err}")

        return jsonify({
            "message": "Application submitted",
            "dealer_application_status": "submitted",
        }), 200
    except Exception as e:
        logger.error(f"Error submitting dealer application: {e}", exc_info=True)
        return jsonify({"error": "Failed to submit application"}), 500


@app.route("/api/user/dealer-documents", methods=["DELETE"])
@token_required
def delete_dealer_document(current_user):
    """Delete a dealer document"""
    try:
        data = request.json
        document_id = data.get("document_id")
        if not document_id:
            return jsonify({"error": "document_id is required"}), 400

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        doc_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{document_id}&user_id=eq.{current_user}&select=storage_path",
            headers=headers,
            timeout=10,
        )
        if doc_resp.status_code != 200 or not doc_resp.json():
            return jsonify({"error": "Document not found"}), 404

        storage_path = doc_resp.json()[0].get("storage_path")
        if storage_path:
            del_url = (
                f"{SUPABASE_URL}/storage/v1/object/dealer-documents/{storage_path}"
            )
            requests.delete(
                del_url,
                headers={
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                },
                timeout=10,
            )

        del_db_resp = requests.delete(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{document_id}&user_id=eq.{current_user}",
            headers={**headers, "Prefer": "return=minimal"},
            timeout=10,
        )
        if del_db_resp.status_code not in [200, 204]:
            return jsonify({"error": "Failed to delete document"}), 500

        all_docs_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{current_user}&select=*&order=uploaded_at.desc",
            headers=headers,
            timeout=10,
        )
        all_docs = all_docs_resp.json() if all_docs_resp.status_code == 200 else []

        return jsonify({"message": "Document deleted", "documents": all_docs}), 200

    except Exception as e:
        logger.error(f"Error deleting dealer document: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to delete document"}), 500


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


def find_user_email_by_username(username):
    """Find user's email by username for login"""
    try:
        normalized_username = _normalize_username_value(username)
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Search for user by username
        url = f"{app.config['SUPABASE_URL']}/rest/v1/users?username=ilike.{normalized_username}&select=email"
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
@app.route("/api/auth/login", methods=["POST"])
def login():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if _auth_rate_limited(client_ip):
        logger.warning(f"[Login] Rate limit exceeded for IP: {client_ip}")
        return jsonify(
            {"message": "Too many login attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    identifier = str(data.get("email", "")).strip()  # email or username
    remember_me = bool(data.get("remember_me", False))
    logger.info(f"[Login] Attempt for identifier: {identifier}")

    if not data or not identifier or not data.get("password"):
        logger.warning("[Login] Missing email/username or password in request.")
        return jsonify({"message": "Missing email/username or password"}), 400

    # Note: CAPTCHA is now handled by Supabase's built-in bot protection
    # No need to verify Turnstile token here

    password = data.get("password")
    remember_me = bool(data.get("remember_me", True))

    # Determine if the identifier is an email or username
    email = identifier
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

    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
    payload = {"email": email, "password": password}

    try:
        logger.info(f"[Login] Sending login request to Supabase auth: {url}")
        response = requests.post(url, headers=headers, json=payload, timeout=10)

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
            access_max_age = 3600 * 24 * 7 if remember_me else None
            refresh_max_age = 3600 * 24 * 30 if remember_me else None
            response.set_cookie(
                "access_token",
                token,
                httponly=True,
                secure=secure,
                samesite="Lax",
                max_age=access_max_age,
            )
            refresh_token = resp_data.get("refresh_token")
            if refresh_token:
                response.set_cookie(
                    "refresh_token",
                    refresh_token,
                    httponly=True,
                    secure=secure,
                    samesite="Lax",
                    max_age=refresh_max_age,
                )
            capture_posthog_event(
                "user_logged_in",
                user_id,
                {"login_method": "password", "remember_me": remember_me},
            )
            return response
        else:
            try:
                error_data = response.json()
            except Exception:
                logger.error(
                    "[Login] Supabase auth failed with non-JSON response: %s",
                    response.text,
                )
                return jsonify({"message": "Login failed. Please try again."}), 502
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


@app.route("/api/auth/check-username", methods=["GET"])
def check_username_availability():
    username = request.args.get("username", "")
    exclude_user_id = request.args.get("exclude_user_id") or None
    cache_key = _build_api_cache_key()
    cached = _api_cache_get(cache_key)
    if cached is not None:
        return _cached_json_response(
            cached,
            ttl_seconds=USERNAME_AVAILABILITY_CACHE_TTL_SECONDS,
        )

    result = _check_username_availability(username, exclude_user_id)
    status = 200
    if "status" in result and result["status"] >= 400:
        status = result["status"]
    if status < 400:
        _api_cache_set(
            cache_key,
            result,
            ttl_seconds=USERNAME_AVAILABILITY_CACHE_TTL_SECONDS,
        )
    return _cached_json_response(
        result, status, ttl_seconds=USERNAME_AVAILABILITY_CACHE_TTL_SECONDS
    )


@app.route("/api/auth/signup", methods=["POST"])
def signup():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if _auth_rate_limited(client_ip):
        logger.warning(f"[Signup] Rate limit exceeded for IP: {client_ip}")
        return jsonify(
            {"message": "Too many signup attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    if not data or not data.get("email") or not data.get("password"):
        return jsonify({"message": "Missing email or password"}), 400

    # Note: CAPTCHA is now handled by Supabase's built-in bot protection
    # No need to verify Turnstile token here

    email = data.get("email")
    password = data.get("password")
    phone_raw = str(data.get("phone", "")).strip()
    phone_digits = re.sub(r"[^\d]", "", phone_raw)

    if not phone_digits:
        return jsonify({"message": "Phone number is required"}), 400
    if len(phone_digits) < 7 or len(phone_digits) > 15:
        return jsonify({"message": "Phone number must be between 7 and 15 digits"}), 400

    password_errors = _get_password_policy_errors(password)
    if password_errors:
        return jsonify(
            {
                "message": "Password does not meet requirements",
                "details": password_errors,
            }
        ), 400

    # Validate dealer-specific fields when isDealer is true. The form will
    # collect TRN + legal business name + trade license file; the file is
    # uploaded in a second request after this one returns a session token.
    is_dealer_signup = bool(data.get("isDealer"))
    trn_raw = (data.get("trn") or "").strip()
    legal_business_name = (data.get("legalBusinessName") or "").strip()
    trade_license_expires_at = (data.get("tradeLicenseExpiresAt") or "").strip()

    if is_dealer_signup:
        if not legal_business_name or len(legal_business_name) < 3:
            return jsonify({
                "message": "Legal business name is required",
                "code": "legal_business_name_required",
                "field": "legalBusinessName",
            }), 400
        trn_digits = re.sub(r"[^\d]", "", trn_raw)
        if len(trn_digits) != 15:
            return jsonify({
                "message": "TRN must be exactly 15 digits",
                "code": "trn_invalid_format",
                "field": "trn",
            }), 400
        # Uniqueness check before we create the auth user.
        existing, exists_status = supabase_request(
            "get",
            f"/rest/v1/users?select=id&trn=eq.{trn_digits}&limit=1",
            use_service_role=True,
        )
        if exists_status < 400 and existing:
            return jsonify({
                "message": "This TRN is already registered with another account",
                "code": "trn_in_use",
                "field": "trn",
            }), 409
        if not trade_license_expires_at:
            return jsonify({
                "message": "Trade license expiry date is required",
                "code": "trade_license_expires_at_required",
                "field": "tradeLicenseExpiresAt",
            }), 400
        try:
            tlx_date = datetime.datetime.fromisoformat(trade_license_expires_at)
            if tlx_date.date() <= datetime.datetime.utcnow().date():
                return jsonify({
                    "message": "Trade license expiry date must be in the future",
                    "code": "trade_license_expires_at_invalid",
                    "field": "tradeLicenseExpiresAt",
                }), 400
        except ValueError:
            return jsonify({
                "message": "Trade license expiry date is invalid",
                "code": "trade_license_expires_at_invalid",
                "field": "tradeLicenseExpiresAt",
            }), 400
        trn_normalized = trn_digits
    else:
        trn_normalized = ""

    # Extract additional user metadata
    user_metadata = {
        "first_name": data.get("firstName", ""),
        "last_name": data.get("lastName", ""),
        "username": data.get("username", ""),
        "phone": phone_digits,
        "country_code": data.get("countryCode", "+971"),
        "city": data.get("city", ""),
        "area": data.get("area", ""),
        "emirate": data.get("emirate", ""),
        "is_dealer": is_dealer_signup,
        "company_name": data.get("companyName", ""),
        "company_registration_number": data.get("companyRegistrationNumber", ""),
        "legal_business_name": legal_business_name,
        "trn": trn_normalized,
        "trade_license_number": data.get("tradeLicenseNumber", ""),
        "display_name": data.get("displayName", ""),
        "email_notifications": data.get("emailNotifications", True),
        "sms_notifications": data.get("smsNotifications", True),
        "marketing_emails": data.get("marketingEmails", False),
    }
    if is_dealer_signup:
        user_metadata["dealer_application_status"] = "draft"

    # Remove empty strings so unique constraints (e.g., username) are not violated by blank values
    cleaned_metadata = {}
    for key, value in user_metadata.items():
        if isinstance(value, str) and value.strip() == "":
            continue
        cleaned_metadata[key] = value

    requested_username = _normalize_username_value(cleaned_metadata.get("username"))
    if not requested_username:
        return jsonify(
            {
                "message": "Username is required",
                "code": "username_required",
                "field": "username",
            }
        ), 400

    if _is_username_blocked(requested_username):
        return jsonify(
            {
                "message": _username_blocked_message(),
                "code": "username_blocked",
                "field": "username",
            }
        ), 409
    username_check = _check_username_availability(requested_username)
    if not username_check.get("available", False):
        return jsonify(
            {
                "message": username_check.get("message")
                or _username_conflict_message(),
                "code": "username_taken",
                "field": "username",
            }
        ), 409

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
            try:
                response_data = response.json()
            except Exception:
                logger.error(
                    f"Signup succeeded but response was not valid JSON: {response.text}",
                    exc_info=True,
                )
                return jsonify(
                    {"message": "Signup succeeded but response was invalid"}
                ), 502
            user_id = None
            try:
                user_id = (
                    response_data.get("user", {}).get("id")
                    or response_data.get("id")
                    or response_data.get("user_id")
                )
            except Exception:
                user_id = None

            response_data["phone_verification"] = None
            response_data["phone_verification_required"] = False
            response_data["email_verification_required"] = True
            response_data["next_step"] = (
                "Verify your email first. Phone verification will be available after email confirmation."
            )
            if user_id:
                capture_posthog_event(
                    "user_signed_up",
                    user_id,
                    {"account_type": "dealer" if is_dealer_signup else "individual"},
                )
            return jsonify(response_data), 200

        # Try to parse error details; fall back to raw text
        try:
            error_data = response.json()
        except Exception:
            logger.error(f"Signup failed with non-JSON response: {response.text}")
            return jsonify(
                {"message": "Signup failed", "details": response.text}
            ), response.status_code

        logger.error(f"Signup failed: {error_data}")
        if _is_username_conflict_error(error_data, response.text):
            return jsonify(
                {
                    "message": _username_conflict_message(),
                    "code": "username_taken",
                    "field": "username",
                }
            ), 409
        normalized_error = _format_auth_email_error(error_data, "Signup failed")
        return jsonify(normalized_error), response.status_code

    except Exception as e:
        logger.error(f"Signup error: {str(e)}", exc_info=True)
        return jsonify({"message": "An error occurred during signup"}), 500


@app.route("/api/phone-verifications/start", methods=["POST"])
def start_phone_verification():
    current_user = _get_optional_user_id_from_auth_header()
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    user_agent = request.headers.get("User-Agent", "")

    if _auth_rate_limited(client_ip):
        return jsonify(
            {"message": "Too many verification attempts. Please try again later."}
        ), 429

    data = request.get_json(silent=True) or {}
    purpose = str(data.get("purpose") or "vin_reveal").strip()
    listing_id = data.get("listing_id")
    verification_id = data.get("verification_id")
    phone = data.get("phone")
    country_code = data.get("country_code")
    verification_record = None

    if purpose not in PHONE_VERIFICATION_PURPOSES:
        return jsonify({"message": "Invalid verification purpose"}), 400

    if verification_id:
        verification_record = _lookup_phone_verification(
            verification_id=verification_id,
        )
        if not verification_record:
            return jsonify({"message": "Verification record not found"}), 404
        if current_user and verification_record.get("user_id") != current_user:
            logger.info(
                "Stale verification_id %s for user %s (owner %s). Issuing a fresh verification.",
                verification_id,
                current_user,
                verification_record.get("user_id"),
            )
            verification_id = None
            verification_record = None
        elif not current_user:
            return jsonify({"message": "Authentication required"}), 401

    if verification_record:
        try:
            refreshed = _resend_phone_verification(verification_record)
            return jsonify(
                {
                    "message": "Verification code resent",
                    "phone_verification": _phone_verification_response(
                        refreshed["verification"]
                    ),
                }
            ), 200
        except ValueError as resend_err:
            return jsonify({"message": str(resend_err)}), 400
        except Exception as resend_err:
            logger.error(f"Failed to resend verification: {resend_err}", exc_info=True)
            return jsonify({"message": "Failed to resend verification code"}), 500

    if not current_user:
        return jsonify({"message": "Authentication required"}), 401

    profile = _get_user_profile_for_verification(current_user) or {}
    if purpose == "signup" and not bool(profile.get("email_verified")):
        return jsonify(
            {
                "message": "Please verify your email first before phone verification.",
                "email_verification_required": True,
            }
        ), 403

    if purpose in ("vin_reveal", "profile_verify") and profile.get("phone_verified"):
        return jsonify(
            {
                "message": "Phone already verified",
                "already_verified": True,
                "phone_verification": None,
            }
        ), 200

    verification_phone = _normalize_phone_number(
        phone or profile.get("phone"),
        country_code or profile.get("country_code"),
    )
    if not verification_phone:
        return jsonify({"message": "A valid phone number is required"}), 400

    try:
        issued = _issue_phone_verification(
            user_id=current_user,
            phone=verification_phone,
            country_code=country_code or profile.get("country_code"),
            purpose=purpose,
            listing_id=listing_id,
            metadata={
                "source": data.get("source") or "frontend",
                "client_ip": client_ip,
                "user_agent": user_agent,
            },
        )
        return jsonify(
            {
                "message": "Verification code sent",
                "phone_verification": _phone_verification_response(
                    issued["verification"]
                ),
            }
        ), 200
    except ValueError as verification_err:
        return jsonify({"message": str(verification_err)}), 400
    except Exception as verification_err:
        logger.error(
            f"Failed to start phone verification: {verification_err}",
            exc_info=True,
        )
        return jsonify({"message": "Failed to send verification code"}), 500


@app.route("/api/phone-verifications/verify", methods=["POST"])
def verify_phone_verification():
    current_user = _get_optional_user_id_from_auth_header()
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    user_agent = request.headers.get("User-Agent", "")

    if _auth_rate_limited(client_ip):
        return jsonify(
            {"message": "Too many verification attempts. Please try again later."}
        ), 429

    data = request.json or {}
    code = str(data.get("code") or "").strip()
    verification_id = data.get("verification_id")
    purpose = data.get("purpose")
    listing_id = data.get("listing_id")

    if not code:
        return jsonify({"message": "Verification code is required"}), 400

    verification_record = None
    if verification_id:
        verification_record = _lookup_phone_verification(
            verification_id=verification_id
        )
    elif current_user:
        verification_record = _lookup_phone_verification(
            user_id=current_user,
            purpose=purpose,
            listing_id=listing_id,
        )

    if not verification_record:
        return jsonify({"message": "Verification record not found"}), 404

    if current_user and verification_record.get("user_id") != current_user:
        return jsonify({"message": "You cannot verify this code"}), 403

    try:
        result = _finalize_phone_verification(
            verification_record,
            code,
            ip_address=client_ip,
            user_agent=user_agent,
        )
        return jsonify(
            {
                "message": "Phone verified successfully",
                "verification": result,
            }
        ), 200
    except ValueError as verification_err:
        status_code = 400
        error_message = str(verification_err)
        if "expired" in error_message.lower():
            status_code = 410
        elif "too many" in error_message.lower():
            status_code = 429
        return jsonify({"message": error_message}), status_code
    except Exception as verification_err:
        logger.error(f"Failed to verify phone code: {verification_err}", exc_info=True)
        return jsonify({"message": "Failed to verify code"}), 500


@app.route("/api/auth/logout", methods=["POST"])
@token_required
def logout(current_user):
    response = make_response(jsonify({"message": "Successfully logged out"}), 200)
    response.set_cookie("access_token", "", expires=0)
    response.set_cookie("refresh_token", "", expires=0)
    return response


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


@app.route("/api/user/drafts", methods=["GET"])
@token_required
def list_user_drafts(current_user):
    """Return all in-progress wizard drafts for the user (for the Drafts tab)."""
    try:
        response, status = supabase_request(
            "get",
            "/rest/v1/listing_drafts",
            params={
                "user_id": f"eq.{current_user}",
                "select": "*",
                "order": "updated_at.desc",
            },
            use_service_role=True,
        )
        if status >= 400:
            if _looks_like_missing_table(response):
                return jsonify({"drafts": []}), 200
            return jsonify({"error": "Failed to load drafts"}), status

        drafts = response or []
        # Annotate each row with a friendly preview the UI can render directly,
        # so the Drafts tab doesn't need draft-type-specific code to show summaries.
        for draft in drafts:
            _annotate_draft_row(draft)

        return jsonify({"drafts": drafts}), 200
    except Exception as exc:
        logger.error(f"Failed to list user drafts: {exc}")
        return jsonify({"error": "Failed to load drafts"}), 500


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


_PRICE_HISTORY_TABLES = {
    "cars": ("cars", "expected_selling_price"),
    "bikes": ("bikes", "price"),
    "plates": ("license_plates", "price"),
    "parts": ("car_parts", "price"),
}


@app.route("/api/<string:listing_type>/<string:listing_id>/price-history", methods=["GET"])
def get_listing_price_history(listing_type, listing_id):
    """Public price history + analysis for one listing. Always returns at least
    the current price; the history table is optional (falls back gracefully if
    the migration hasn't been applied)."""
    cfg = _PRICE_HISTORY_TABLES.get(listing_type)
    if not cfg:
        return jsonify({"error": "Unknown listing type"}), 404
    table, price_col = cfg

    # Only expose price history for a public (approved) listing.
    cur, csc = supabase_request(
        "get", f"/rest/v1/{table}",
        params={"select": f"{price_col},is_approved", "id": f"eq.{listing_id}"},
        use_service_role=True,
    )
    if csc >= 400 or not isinstance(cur, list) or not cur or not cur[0].get("is_approved"):
        return jsonify({"error": "Listing not found"}), 404
    current = cur[0].get(price_col)

    rows, sc = supabase_request(
        "get", "/rest/v1/listing_price_history",
        params={"select": "price,recorded_at,source", "listing_id": f"eq.{listing_id}",
                "order": "recorded_at.asc"},
        use_service_role=True,
    )
    raw = rows if (sc < 400 and isinstance(rows, list)) else []

    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    series = []
    for p in raw:
        val = _num(p.get("price"))
        if val is not None:
            series.append({"price": val, "recorded_at": p.get("recorded_at"),
                           "source": p.get("source")})
    cur_num = _num(current)
    if cur_num is not None and (not series or series[-1]["price"] != cur_num):
        series.append({"price": cur_num, "recorded_at": None, "source": "current"})

    prices = [s["price"] for s in series]
    analysis = None
    if prices:
        first, last = prices[0], prices[-1]
        analysis = {
            "first": first, "current": last,
            "min": min(prices), "max": max(prices),
            "change": round(last - first, 2),
            "change_pct": round((last - first) / first * 100, 1) if first else 0,
            "points": len(prices),
        }
    return jsonify({"points": series, "analysis": analysis}), 200


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


@app.route("/api/user/drafts/<draft_key>", methods=["GET", "POST", "DELETE"])
@token_required
def manage_user_draft(current_user, draft_key):
    """Persist a user's in-progress listing draft."""
    normalized_key = str(draft_key or "").strip().lower()
    if not normalized_key or not re.match(r"^[a-z0-9_-]+$", normalized_key):
        return jsonify({"error": "Invalid draft key"}), 400

    draft_table = "listing_drafts"
    service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }

    try:
        if request.method == "GET":
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/{draft_table}",
                headers=headers,
                params={
                    "user_id": f"eq.{current_user}",
                    "draft_key": f"eq.{normalized_key}",
                    "select": "*",
                    "order": "updated_at.desc",
                    "limit": "1",
                },
                timeout=10,
            )
            if response.status_code >= 400:
                try:
                    error_payload = response.json()
                except Exception:
                    error_payload = None
                if _looks_like_missing_table(error_payload):
                    return (
                        jsonify(
                            {
                                "error": "Supabase table listing_drafts is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_listing_drafts.sql"
                            }
                        ),
                        501,
                    )
                return jsonify({"error": "Failed to load draft"}), response.status_code
            drafts = response.json() or []
            return jsonify({"draft": _annotate_draft_row(drafts[0]) if drafts else None}), 200

        if request.method == "DELETE":
            response, status_code = supabase_request(
                "delete",
                f"/rest/v1/{draft_table}?user_id=eq.{current_user}&draft_key=eq.{normalized_key}",
                use_service_role=True,
            )
            if status_code >= 400:
                logger.warning(
                    "Failed to delete draft %s for user %s: %s",
                    normalized_key,
                    current_user,
                    response,
                )
            return jsonify({"success": True}), 200

        payload = request.get_json(silent=True) or {}
        draft_payload = payload.get("payload", payload)
        insert_response, insert_status = _save_listing_draft_record(
            current_user, normalized_key, draft_payload
        )
        if insert_status >= 400:
            logger.error(
                "Failed to save draft %s for user %s: %s",
                normalized_key,
                current_user,
                insert_response,
            )
            if _looks_like_missing_table(insert_response):
                return (
                    jsonify(
                        {
                            "error": "Supabase table listing_drafts is missing. Run backend migration: flask-react-supabase-app/backend/migrations/add_listing_drafts.sql"
                        }
                    ),
                    501,
                )
            return jsonify({"error": "Failed to save draft"}), 500

        saved_record = (
            insert_response[0]
            if isinstance(insert_response, list) and insert_response
            else insert_response
        )
        return jsonify({"success": True, "draft": saved_record}), 200
    except Exception as exc:
        logger.error(
            "Draft storage failed for %s/%s: %s", current_user, normalized_key, exc
        )
        return jsonify({"error": "Failed to save draft"}), 500


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


@app.route("/api/auth/update-email", methods=["POST"])
def update_user_email():
    """Update email before verification - for users who entered wrong email during signup"""
    data = request.json
    if not data:
        return jsonify({"error": "Missing request body"}), 400

    current_email = (data.get("current_email") or "").strip().lower()
    new_email = (data.get("new_email") or "").strip().lower()
    redirect_to = _get_safe_redirect_url(
        request.headers.get("Origin"),
        data.get("redirect_to"),
        fallback_path="/auth/callback",
    )

    if not current_email or not new_email:
        return jsonify({"error": "Both current_email and new_email are required"}), 400

    if current_email == new_email:
        return jsonify({"error": "New email is the same as the current email"}), 400

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }

    try:
        # Find the user in Supabase Auth by current email
        list_url = f"{SUPABASE_URL}/auth/v1/admin/users"
        list_resp = requests.get(list_url, headers=headers, timeout=10)

        target_user = None
        if list_resp.status_code == 200:
            for u in list_resp.json().get("users", []):
                if (u.get("email") or "").lower() == current_email:
                    target_user = u
                    break

        if not target_user:
            return jsonify({"error": "No account found with that email address"}), 404

        user_id = target_user["id"]

        # Update email in Supabase Auth
        update_url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"
        update_payload = {"email": new_email}
        update_resp = requests.put(
            update_url, headers=headers, json=update_payload, timeout=10
        )

        if update_resp.status_code not in (200, 204):
            error_msg = "Failed to update email in auth system"
            try:
                err = update_resp.json()
                error_msg = err.get("msg") or err.get("message") or error_msg
            except Exception:
                pass
            return jsonify({"error": error_msg}), 500

        # Update email in local users table
        db_headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        db_resp = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=db_headers,
            json={"email": new_email, "email_verified": False},
            timeout=10,
        )

        # Resend confirmation to new email
        resend_url = f"{SUPABASE_URL}/auth/v1/resend"
        resend_payload = {
            "type": "signup",
            "email": new_email,
            "redirect_to": redirect_to,
        }
        requests.post(
            resend_url,
            headers={"apikey": SUPABASE_KEY, "Content-Type": "application/json"},
            json=resend_payload,
            timeout=10,
        )

        return jsonify(
            {"message": "Email updated successfully. Confirmation sent to new address."}
        ), 200

    except Exception as e:
        logger.error(f"Update email error: {str(e)}")
        return jsonify({"error": "Failed to update email. Please try again."}), 500


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
        cache_key = _build_api_cache_key()
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return _cached_json_response(cached_payload)

        # Get query parameters
        limit, offset = _parse_pagination_args()
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
            # Build query with join for images
            url = (
                f"{app.config['SUPABASE_URL']}/rest/v1/bikes?{query_string}"
                "&select=id,user_id,bike_brand,bike_model,year,bike_type,engine_size,mileage,"
                "color,price,location,area,emirate,description,contact_number,country_code,"
                "status,is_approved,created_at,updated_at,"
                "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
                "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
                "bike_images("
                + LISTING_IMAGE_SELECTS["bikes"]
                + ")"
            )

            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)

            if response.status_code == 200:
                bikes = response.json()
                bikes = _filter_public_listing_records("bikes", bikes)

                seller_map = _batch_fetch_seller_map(
                    [bike.get("user_id") for bike in bikes], headers=headers
                )
                for bike in bikes:
                    _normalize_bike_record(bike)
                    bike_images = bike.pop("bike_images", [])
                    normalized_images = []
                    for img in bike_images:
                        image_url = img.get("image_url") or img.get("url")
                        if not image_url:
                            continue
                        normalized_images.append(
                            {
                                "id": img.get("id"),
                                "image_url": image_url,
                                "url": image_url,
                                "display_url": img.get("display_url"),
                                "focal_x": img.get("focal_x"),
                                "focal_y": img.get("focal_y"),
                                "crop_meta": img.get("crop_meta"),
                                "is_primary": img.get("is_primary", False),
                            }
                        )
                    bike["images"] = _sort_listing_images(normalized_images)
                    # Fallback for main image
                    if not bike["images"]:
                        if bike.get("image_url") or bike.get("url"):
                            main_url = bike.get("image_url") or bike.get("url")
                            bike["images"] = [
                                {
                                    "id": "main",
                                    "url": main_url,
                                    "image_url": main_url,
                                    "display_url": bike.get("display_url"),
                                    "focal_x": bike.get("focal_x"),
                                    "focal_y": bike.get("focal_y"),
                                    "crop_meta": bike.get("crop_meta"),
                                }
                            ]

                    _apply_seller_to_listing(bike, seller_map.get(bike.get("user_id")))

                _api_cache_set(cache_key, bikes)
                return _cached_json_response(bikes)
            else:
                logger.error(
                    f"Direct request failed: {response.status_code} - {response.text}"
                )
                # Fallback to regular method
                raise Exception("Direct request failed")

        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client (single joined query; no N+1 image fetch)
            fallback_params = {
                **params,
                "select": (
                    "id,user_id,bike_brand,bike_model,year,bike_type,engine_size,mileage,"
                    "color,price,location,area,emirate,description,contact_number,country_code,"
                    "status,is_approved,created_at,updated_at,"
                    "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
                    "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
                    "bike_images("
                    + LISTING_IMAGE_SELECTS["bikes"]
                    + ")"
                ),
            }
            response, status_code = supabase_request(
                "get", "/rest/v1/bikes", params=fallback_params, use_service_role=True
            )
            if status_code < 400 and response:
                bikes = _filter_public_listing_records("bikes", response)

                seller_map = _batch_fetch_seller_map(
                    [bike.get("user_id") for bike in bikes], headers=headers
                )
                for bike in bikes:
                    _normalize_bike_record(bike)
                    bike_images = bike.pop("bike_images", []) or []
                    normalized_images = []
                    for img in bike_images:
                        image_url = img.get("image_url") or img.get("url")
                        if not image_url:
                            continue
                        normalized_images.append(
                            {
                                "id": img.get("id"),
                                "image_url": image_url,
                                "url": image_url,
                                "display_url": img.get("display_url"),
                                "focal_x": img.get("focal_x"),
                                "focal_y": img.get("focal_y"),
                                "crop_meta": img.get("crop_meta"),
                                "is_primary": img.get("is_primary", False),
                            }
                        )
                    bike["images"] = _sort_listing_images(normalized_images)
                    if not bike["images"] and (bike.get("image_url") or bike.get("url")):
                        main_url = bike.get("image_url") or bike.get("url")
                        bike["images"] = [
                            {
                                "id": "main",
                                "url": main_url,
                                "image_url": main_url,
                                "display_url": bike.get("display_url"),
                                "focal_x": bike.get("focal_x"),
                                "focal_y": bike.get("focal_y"),
                                "crop_meta": bike.get("crop_meta"),
                            }
                        ]

                    _apply_seller_to_listing(bike, seller_map.get(bike.get("user_id")))

                _api_cache_set(cache_key, bikes)
                return _cached_json_response(bikes)
            else:
                empty_payload = []
                _api_cache_set(cache_key, empty_payload)
                return _cached_json_response(empty_payload)

    except Exception as e:
        logger.error(f"Error fetching bikes: {str(e)}")
        return jsonify([]), 500


@app.route("/api/bikes/<string:bike_id>", methods=["GET"])
def get_bike_by_id(bike_id):
    try:
        logger.info(f"Fetching bike details for ID: {bike_id}")

        cache_key = f"api-cache:{request.path}"
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            logger.info(f"Redis cache hit for bike detail {bike_id}")
            return _cached_json_response(cached_payload)

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
        for _f in _PUBLIC_STRIP_FIELDS:
            bike.pop(_f, None)
        _api_cache_set(cache_key, bike)
        return _cached_json_response(bike)
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
    status_filter = (request.args.get("status") or "").strip().lower()
    categories = {}
    flattened = []

    for item_type in ["car", "bike", "part", "plate"]:
        try:
            category_items, status_code = _collect_user_listing_records(
                current_user, item_type
            )
            if status_code >= 400:
                logger.warning(
                    "[user/listings] %s query failed (%s): %s",
                    item_type,
                    status_code,
                    category_items,
                )
                category_items = []
        except Exception as exc:
            logger.error(
                "[user/listings] unhandled exception collecting %s records: %s",
                item_type,
                exc,
                exc_info=True,
            )
            category_items = []

        for item in category_items:
            item["listing_type"] = item_type
        filtered_items = _filter_user_listing_records(category_items, status_filter)
        categories[f"{item_type}s" if item_type != "part" else "parts"] = filtered_items
        flattened.extend(filtered_items)

    flattened.sort(
        key=lambda item: _parse_datetime(item.get("created_at")) or _utc_now(),
        reverse=True,
    )

    # Total count across cars + bikes + plates + parts.
    listing_count, count_error = _get_user_listing_count(current_user)
    if count_error is not None:
        listing_count = 0

    return jsonify(
        {
            "listings": flattened,
            **categories,
            "listing_limit": _user_listing_limit_info(current_user, listing_count),
        }
    ), 200


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

    if _is_listing_deleted(listing):
        return jsonify({"error": "Listing is no longer available"}), 410
    _apply_listing_lifecycle_metadata(listing)

    if listing.get("is_archived"):
        _delete_listing_with_assets(config["table"], item_id)
        return jsonify(
            {"error": "Listing has already passed its retention period"}
        ), 410

    if listing.get("status") in {"deleted", "rejected"}:
        return jsonify({"error": "This listing cannot be extended"}), 400

    refreshed_listing, refreshed_status, refresh_error = _renew_listing_and_verify(
        config["table"],
        item_id,
        listing,
        current_user=current_user,
    )
    if refreshed_status >= 400:
        return jsonify(refresh_error or {"error": "Failed to renew listing"}), refreshed_status

    _invalidate_public_inventory_cache(config["table"])

    try:
        renewal_record = refreshed_listing
        owner_email = renewal_record.get("user_email") or renewal_record.get(
            "contact_email"
        )
        if not owner_email:
            owner_email = get_user_email(current_user)
        if owner_email and EMAIL_REGEX.match(owner_email):
            _send_listing_status_email(
                owner_email,
                item_type,
                renewal_record,
                "renewed",
                request.headers.get("Origin"),
            )
    except Exception as email_err:
        logger.error(f"Error sending renewal email: {email_err}")

    return jsonify(
        {
            "message": "Listing extended successfully",
            "listing": refreshed_listing,
        }
    ), 200


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


def _admin_renew_one(item_type, item_id, *, admin_user_id, reason=None):
    """Run a renewal as an admin (no user_id ownership check). Returns (payload, status).
    On success, logs the action and invalidates the public inventory cache."""
    config = LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return {"error": "Invalid listing type", "item_id": item_id}, 400

    listing_data, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"select": "*", "id": f"eq.{item_id}", "limit": 1},
        use_service_role=True,
    )
    if listing_status >= 400 or not listing_data:
        return {"error": "Listing not found", "item_id": item_id}, 404

    listing = listing_data[0]
    target_user_id = listing.get("user_id")

    # Bring lifecycle state up to date before renewing (mirrors user-side extend)
    listing = _sync_listing_lifecycle(
        config["table"], listing, hard_delete_archived=False
    )
    if not listing:
        return {"error": "Listing is no longer available", "item_id": item_id}, 410

    refreshed, refreshed_status, refresh_error = _renew_listing_and_verify(
        config["table"], item_id, listing, current_user=target_user_id
    )
    if refreshed_status >= 400:
        return refresh_error or {"error": "Failed to renew listing", "item_id": item_id}, refreshed_status

    _invalidate_public_inventory_cache(config["table"])

    _log_admin_action_direct(
        admin_user_id=admin_user_id,
        action="listing_renew",
        target_user_id=target_user_id,
        target_listing_type=item_type,
        target_listing_id=item_id,
        reason=reason,
        metadata={"new_expires_at": refreshed.get("expires_at")},
    )

    return {"message": "Listing renewed", "listing": refreshed, "item_id": item_id}, 200


@app.route("/api/admin/listings/<item_type>/<item_id>/renew", methods=["POST"])
@token_required
def admin_renew_listing(current_user, item_type, item_id):
    """Renew a single listing on behalf of any user (admin only)."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip() or None
    payload, status = _admin_renew_one(
        item_type, item_id, admin_user_id=current_user, reason=reason
    )
    return jsonify(payload), status


@app.route("/api/admin/listings/renew-bulk", methods=["POST"])
@token_required
def admin_renew_listings_bulk(current_user):
    """Renew many listings in one call. Body: {items: [{type, id}, ...], reason?}"""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    items = data.get("items") or []
    reason = (data.get("reason") or "").strip() or None

    if not isinstance(items, list) or not items:
        return jsonify({"error": "Provide a non-empty items array"}), 400
    if len(items) > 200:
        return jsonify({"error": "Bulk renew is capped at 200 listings per call"}), 400

    results = []
    for item in items:
        if not isinstance(item, dict):
            results.append({"ok": False, "error": "Invalid item shape"})
            continue
        item_type = (item.get("type") or item.get("item_type") or "").strip().lower()
        item_id = (item.get("id") or item.get("item_id") or "").strip() if isinstance(item.get("id") or item.get("item_id"), str) else item.get("id") or item.get("item_id")
        if not item_type or not item_id:
            results.append({"ok": False, "error": "Missing type or id", "item": item})
            continue
        payload, status = _admin_renew_one(
            item_type, str(item_id), admin_user_id=current_user, reason=reason
        )
        results.append({
            "ok": status < 400,
            "status": status,
            "item_type": item_type,
            "item_id": str(item_id),
            **({"error": payload.get("error")} if status >= 400 else {"new_expires_at": (payload.get("listing") or {}).get("expires_at")}),
        })

    succeeded = sum(1 for r in results if r.get("ok"))

    _log_admin_action_direct(
        admin_user_id=current_user,
        action="listing_bulk_renew",
        reason=reason,
        metadata={
            "total": len(results),
            "succeeded": succeeded,
            "failed": len(results) - succeeded,
        },
    )

    return jsonify({
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }), 200


@app.route("/api/admin/listings/approve-bulk", methods=["POST"])
@token_required
def admin_approve_listings_bulk(current_user):
    """Approve many listings in one call. Body: {items: [{type, id}, ...]}"""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    items = data.get("items") or []

    if not isinstance(items, list) or not items:
        return jsonify({"error": "Provide a non-empty items array"}), 400
    if len(items) > 200:
        return jsonify({"error": "Bulk approve is capped at 200 listings per call"}), 400

    table_map = {
        "cars": "cars", "bikes": "bikes", "parts": "car_parts",
        "plates": "license_plates", "buying_requests": "buying_requests",
    }

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }

    import datetime as _dt
    _now = _dt.datetime.now(_dt.timezone.utc)
    new_expires = (_now + _dt.timedelta(days=LISTING_EXPIRY_DAYS)).isoformat()
    new_retention = (_now + _dt.timedelta(days=LISTING_EXPIRY_DAYS + LISTING_RETENTION_DAYS)).isoformat()

    results = []
    succeeded_types = set()
    for item in items:
        if not isinstance(item, dict):
            results.append({"ok": False, "error": "Invalid item shape"})
            continue
        item_type = (item.get("type") or item.get("item_type") or "").strip().lower()
        item_id = str(item.get("id") or item.get("item_id") or "").strip()
        if not item_type or not item_id:
            results.append({"ok": False, "error": "Missing type or id"})
            continue
        table = table_map.get(item_type)
        if not table:
            results.append({"ok": False, "error": f"Unknown type: {item_type}", "item_id": item_id})
            continue
        try:
            get_r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}&select=*&limit=1",
                headers={**headers, "Accept": "application/json"},
                timeout=5,
            )
            listing_data = (get_r.json()[0] if get_r.status_code == 200 and get_r.json() else None)
            user_id = listing_data.get("user_id") if listing_data else None

            _LIFECYCLE_TYPES = {"cars", "bikes", "parts", "plates"}
            patch_body = {"status": "approved", "is_approved": True}
            if item_type in _LIFECYCLE_TYPES:
                patch_body.update({
                    "expires_at": new_expires,
                    "retention_expires_at": new_retention,
                    "deleted_at": None,
                    "expired_at": None,
                    "is_archived": False,
                    "sold_status": None,
                    "sold_status_set_at": None,
                    "auto_removed_at": None,
                    "sold_response_deadline": None,
                    "expiry_reminder_sent_at": None,
                    "expired_email_sent_at": None,
                })
            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
                headers=headers,
                json=patch_body,
                timeout=5,
            )
            ok = resp.status_code in (200, 204)
            results.append({"ok": ok, "item_type": item_type, "item_id": item_id,
                            **({"error": f"DB error {resp.status_code}"} if not ok else {})})
            if ok:
                succeeded_types.add(item_type)
            if ok and user_id and listing_data:
                try:
                    user_email, _ = _get_user_email_by_id(user_id)
                    if user_email:
                        _send_listing_status_email(user_email, item_type, listing_data, "approved")
                except Exception as email_err:
                    logger.error(f"approve-bulk: email failed for {item_id}: {email_err}")
        except Exception as e:
            results.append({"ok": False, "item_type": item_type, "item_id": item_id, "error": str(e)})

    succeeded = sum(1 for r in results if r.get("ok"))

    for t in succeeded_types:
        try:
            _invalidate_public_inventory_cache(t)
        except Exception:
            pass

    try:
        _log_admin_action_direct(
            admin_user_id=current_user,
            action="listing_bulk_approve",
            metadata={"total": len(results), "succeeded": succeeded, "failed": len(results) - succeeded},
        )
    except Exception:
        pass

    return jsonify({
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }), 200


@app.route("/api/admin/listings/delete-bulk", methods=["POST"])
@token_required
def admin_delete_listings_bulk(current_user):
    """Soft-delete many listings in one call. Body: {items: [{type, id}, ...], reason?}"""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403

    data = request.get_json(silent=True) or {}
    items = data.get("items") or []
    reason = (data.get("reason") or "").strip() or "Removed by admin (bulk action)"

    if not isinstance(items, list) or not items:
        return jsonify({"error": "Provide a non-empty items array"}), 400
    if len(items) > 200:
        return jsonify({"error": "Bulk delete is capped at 200 listings per call"}), 400

    table_map = {
        "cars": "cars", "bikes": "bikes", "parts": "car_parts",
        "plates": "license_plates", "buying_requests": "buying_requests",
    }

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }

    results = []
    for item in items:
        if not isinstance(item, dict):
            results.append({"ok": False, "error": "Invalid item shape"})
            continue
        item_type = (item.get("type") or item.get("item_type") or "").strip().lower()
        item_id = str(item.get("id") or item.get("item_id") or "").strip()
        if not item_type or not item_id:
            results.append({"ok": False, "error": "Missing type or id"})
            continue
        table = table_map.get(item_type)
        if not table:
            results.append({"ok": False, "error": f"Unknown type: {item_type}", "item_id": item_id})
            continue
        try:
            get_r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}&select=*&limit=1",
                headers={**headers, "Accept": "application/json"},
                timeout=5,
            )
            listing_data = (get_r.json()[0] if get_r.status_code == 200 and get_r.json() else None)
            user_id = listing_data.get("user_id") if listing_data else None

            resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
                headers=headers,
                json={"status": "deleted", "deleted_at": "now()", "is_approved": False},
                timeout=5,
            )
            ok = resp.status_code in (200, 204)
            results.append({"ok": ok, "item_type": item_type, "item_id": item_id,
                            **({"error": f"DB error {resp.status_code}"} if not ok else {})})
            if ok and user_id and listing_data:
                try:
                    user_email, _ = _get_user_email_by_id(user_id)
                    if user_email:
                        listing_title = _build_listing_title(item_type, listing_data)
                        _send_listing_deleted_email(user_email, item_type, listing_title, item_id, reason)
                except Exception as email_err:
                    logger.error(f"delete-bulk: email failed for {item_id}: {email_err}")
        except Exception as e:
            results.append({"ok": False, "item_type": item_type, "item_id": item_id, "error": str(e)})

    succeeded = sum(1 for r in results if r.get("ok"))

    for t in set(r["item_type"] for r in results if r.get("ok") and r.get("item_type")):
        try:
            _invalidate_public_inventory_cache(t)
        except Exception:
            pass

    try:
        _log_admin_action_direct(
            admin_user_id=current_user,
            action="listing_bulk_delete",
            reason=reason,
            metadata={"total": len(results), "succeeded": succeeded, "failed": len(results) - succeeded},
        )
    except Exception:
        pass

    return jsonify({
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
        "results": results,
    }), 200


@app.route("/api/admin/listings/<item_type>/<item_id>/set-status", methods=["POST"])
@token_required
def admin_set_listing_status(current_user, item_type, item_id):
    """Admin: change a listing's status (approved / rejected / deleted / sold_on_dph / sold_elsewhere)."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(silent=True) or {}
    new_status = (data.get("status") or "").strip().lower()

    ALLOWED_STATUSES = {"approved", "rejected", "deleted", "sold_on_dph", "sold_elsewhere"}
    if new_status not in ALLOWED_STATUSES:
        return jsonify({"error": f"status must be one of {sorted(ALLOWED_STATUSES)}"}), 400

    # sold_on_dph / sold_elsewhere are sub-types; both map to status='sold'
    is_sold_action = new_status in ("sold_on_dph", "sold_elsewhere")
    db_status = "sold" if is_sold_action else new_status

    table_map = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
        "buying_requests": "buying_requests",
    }
    table = table_map.get(item_type)
    if not table:
        return jsonify({"error": f"Unknown item_type: {item_type}"}), 400

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    update_data = {"status": db_status}

    import datetime as _dt

    _LIFECYCLE_TYPES = {"cars", "bikes", "parts", "plates"}
    if new_status == "approved":
        update_data["is_approved"] = True
        if item_type in _LIFECYCLE_TYPES:
            new_expires = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(days=LISTING_EXPIRY_DAYS)
            new_retention = new_expires + _dt.timedelta(days=LISTING_RETENTION_DAYS)
            update_data.update(
                {
                    "deleted_at": None,
                    "expired_at": None,
                    "is_archived": False,
                    "sold_status": None,
                    "sold_status_set_at": None,
                    "auto_removed_at": None,
                    "sold_response_deadline": None,
                    "expires_at": new_expires.isoformat(),
                    "retention_expires_at": new_retention.isoformat(),
                    "expiry_reminder_sent_at": None,
                    "expired_email_sent_at": None,
                }
            )
    elif new_status == "deleted":
        update_data.update({"deleted_at": "now()", "is_approved": False})
    elif new_status == "rejected":
        update_data["is_approved"] = False
    elif is_sold_action:
        update_data["is_approved"] = False
        if item_type in _LIFECYCLE_TYPES:
            update_data["sold_status"] = new_status          # 'sold_on_dph' or 'sold_elsewhere'
            update_data["sold_status_set_at"] = _dt.datetime.now(_dt.timezone.utc).isoformat()
            update_data["sold_response_deadline"] = None

    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
        headers=headers,
        json=update_data,
        timeout=5,
    )

    if resp.status_code not in (200, 204):
        logger.error(f"set-status DB error {resp.status_code}: {resp.text[:200]}")
        return jsonify({"error": "Database update failed"}), 500

    rows = resp.json() if resp.text else []
    updated = rows[0] if rows else {}

    if new_status in ("approved", "deleted", "rejected") or is_sold_action:
        try:
            _invalidate_public_inventory_cache(item_type)
        except Exception:
            pass

    try:
        _log_meta = {"item_type": item_type, "item_id": item_id}
        if is_sold_action:
            _log_meta["sold_status"] = new_status
        _log_admin_action_direct(
            admin_user_id=current_user,
            action=f"listing_status_set_{db_status}",
            metadata=_log_meta,
        )
    except Exception:
        pass

    return jsonify({"success": True, "status": new_status, "listing": updated}), 200


@app.route("/api/admin/listings/<item_type>/<item_id>/set-expiry", methods=["POST"])
@token_required
def admin_set_listing_expiry(current_user, item_type, item_id):
    """Admin: set a custom expiry date on any listing."""
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json(silent=True) or {}
    expires_at_raw = (data.get("expires_at") or "").strip()
    if not expires_at_raw:
        return jsonify({"error": "expires_at is required"}), 400

    try:
        import datetime as _dt
        from dateutil import parser as _dtp

        new_expiry = _dtp.isoparse(expires_at_raw)
        if new_expiry.tzinfo is None:
            new_expiry = new_expiry.replace(tzinfo=_dt.timezone.utc)
        if new_expiry < _dt.datetime.now(_dt.timezone.utc):
            return jsonify({"error": "expires_at must be in the future"}), 400
    except Exception:
        return jsonify({"error": "Invalid expires_at date format"}), 400

    table_map = {
        "cars": "cars",
        "bikes": "bikes",
        "parts": "car_parts",
        "plates": "license_plates",
        "buying_requests": "buying_requests",
    }
    table = table_map.get(item_type)
    if not table:
        return jsonify({"error": f"Unknown item_type: {item_type}"}), 400

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{item_id}",
        headers=headers,
        json={
            "expires_at": new_expiry.isoformat(),
            "expired_at": None,
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
            "is_archived": False,
        },
        timeout=5,
    )

    if resp.status_code not in (200, 204):
        return jsonify({"error": "Database update failed"}), 500

    try:
        _log_admin_action_direct(
            admin_user_id=current_user,
            action="listing_expiry_set",
            metadata={"item_type": item_type, "item_id": item_id, "expires_at": new_expiry.isoformat()},
        )
    except Exception:
        pass

    try:
        _invalidate_public_inventory_cache(item_type)
    except Exception:
        pass

    rows = resp.json() if resp.text else []
    return jsonify({"success": True, "expires_at": new_expiry.isoformat(), "listing": rows[0] if rows else {}}), 200


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


@app.route(
    "/api/user/listings/<item_type>/<item_id>/repost", methods=["POST"]
)
@token_required
def repost_user_listing(current_user, item_type, item_id):
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

    original = listing_data[0]
    if original.get("user_id") != current_user:
        return jsonify({"error": "You do not have permission to repost this listing"}), 403

    status_value = str(original.get("status") or "").lower()
    if status_value not in {"deleted", "rejected"} and not original.get("deleted_at"):
        return jsonify({"error": "Only deleted listings can be reposted"}), 400

    # Per-account listing cap applies to fresh listings too.
    limit_response = _enforce_listing_limit(current_user)
    if limit_response:
        return limit_response

    dealer_check = _require_dealer_verified(current_user)
    if dealer_check:
        return dealer_check

    # Build the new row from the original, stripping persistence/analytics fields.
    new_listing = {
        key: value
        for key, value in original.items()
        if key not in _REPOST_STRIP_KEYS
    }
    new_listing["user_id"] = current_user
    new_listing["status"] = "pending"
    new_listing.update(_new_listing_lifecycle_fields())
    new_listing.pop("user_dismissed_at", None)

    logger.info(
        "Reposting %s/%s: payload keys=%s",
        config["table"],
        item_id,
        sorted(new_listing.keys()),
    )
    insert_response, insert_status = supabase_request(
        "post",
        f"/rest/v1/{config['table']}",
        data=new_listing,
        use_service_role=True,
    )

    # If lifecycle/idempotency columns haven't been migrated yet (or PostgREST cache
    # is stale), retry without those fields so repost still works.
    if (
        insert_status >= 400
        and isinstance(insert_response, dict)
        and str(insert_response.get("code") or "") == "PGRST204"
    ):
        stripped_listing = _strip_listing_lifecycle_write_fields(new_listing)
        logger.warning(
            "Repost insert failed due to missing columns; retrying without lifecycle fields. table=%s listing_id=%s error=%s",
            config["table"],
            item_id,
            insert_response.get("message"),
        )
        insert_response, insert_status = supabase_request(
            "post",
            f"/rest/v1/{config['table']}",
            data=stripped_listing,
            use_service_role=True,
        )
    if insert_status >= 400 or not insert_response:
        logger.warning(
            "Repost insert failed for %s/%s (status=%s): %s",
            config["table"],
            item_id,
            insert_status,
            insert_response,
        )
        detail = None
        if isinstance(insert_response, dict):
            detail = (
                insert_response.get("message")
                or insert_response.get("error")
                or insert_response.get("hint")
                or insert_response.get("details")
            )
        return jsonify(
            {
                "error": "Failed to repost listing",
                "detail": detail or str(insert_response)[:300],
            }
        ), 500

    new_record = (
        insert_response[0] if isinstance(insert_response, list) else insert_response
    )
    new_id = new_record.get("id")

    # Clone images so the user doesn't have to re-upload.
    original_images, images_status = supabase_request(
        "get",
        f"/rest/v1/{config['images_table']}",
        params={"select": "*", config["fk"]: f"eq.{item_id}"},
        use_service_role=True,
    )
    if images_status < 400 and new_id is not None:
        _clone_listing_images(
            config["images_table"], config["fk"], new_id, original_images or []
        )

    # Hide the original from the user's listings view (audit trail stays).
    supabase_request(
        "patch",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "user_id": f"eq.{current_user}"},
        data={"user_dismissed_at": _isoformat_utc(_utc_now())},
        use_service_role=True,
    )

    _invalidate_public_inventory_cache(config["table"])

    return jsonify(
        {
            "message": "Listing reposted as a new pending listing",
            "new_listing_id": new_id,
            "listing": new_record,
        }
    ), 201


@app.route(
    "/api/user/listings/<item_type>/<item_id>/dismiss", methods=["POST"]
)
@token_required
def dismiss_user_listing(current_user, item_type, item_id):
    config = LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return jsonify({"error": "Invalid listing type"}), 400

    listing_data, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={
            "select": "id,user_id,status,deleted_at,is_archived,user_dismissed_at",
            "id": f"eq.{item_id}",
            "limit": 1,
        },
        user_id=current_user,
    )
    if listing_status >= 400:
        return jsonify(listing_data), listing_status
    if not listing_data:
        return jsonify({"error": "Listing not found"}), 404

    original = listing_data[0]
    if original.get("user_id") != current_user:
        return jsonify(
            {"error": "You do not have permission to dismiss this listing"}
        ), 403

    status_value = str(original.get("status") or "").lower()
    if (
        status_value not in {"deleted", "rejected", "sold"}
        and not original.get("deleted_at")
        and not original.get("is_archived")
    ):
        return jsonify(
            {"error": "Only deleted, expired, or sold listings can be removed from your list"}
        ), 400

    # Idempotent: if already dismissed, return success.
    if original.get("user_dismissed_at"):
        return jsonify({"message": "Listing already removed from your list"}), 200

    patch_response, patch_status = supabase_request(
        "patch",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "user_id": f"eq.{current_user}"},
        data={"user_dismissed_at": _isoformat_utc(_utc_now())},
        use_service_role=True,
    )
    if patch_status >= 400:
        return jsonify({"error": "Failed to remove listing from your list"}), 500

    return jsonify({"message": "Listing removed from your list"}), 200


@app.route("/api/bikes", methods=["POST"])
@token_required
def create_bike(current_user):
    try:
        # Validate input
        if not request.json:
            return jsonify({"error": "Invalid request data"}), 400

        verification_check = _require_verified_user_for_listing(current_user)
        if verification_check:
            return verification_check

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        dealer_check = _require_dealer_verified(current_user)
        if dealer_check:
            return dealer_check

        bike_data = request.json
        bike_data["user_id"] = current_user
        bike_data["status"] = _initial_listing_status()
        bike_data.update(_new_listing_lifecycle_fields())
        _normalize_listing_vin(bike_data)

        # Normalize legacy/alternate frontend keys.
        if "make" in bike_data and "bike_brand" not in bike_data:
            bike_data["bike_brand"] = bike_data.get("make")
        if "model" in bike_data and "bike_model" not in bike_data:
            bike_data["bike_model"] = bike_data.get("model")
        if "contact_phone" in bike_data and "contact_number" not in bike_data:
            bike_data["contact_number"] = bike_data.get("contact_phone")
        if "engine_capacity" in bike_data and "engine_size" not in bike_data:
            bike_data["engine_size"] = bike_data.get("engine_capacity")
        if "area" not in bike_data and bike_data.get("location"):
            bike_data["area"] = bike_data.get("location")
        try:
            _require_whatsapp_prefill_and_phone_alignment(bike_data, "bikes")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

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
            _validate_no_profanity(
                bike_data.get("description"), field_name="description"
            )
            _validate_no_profanity(bike_data.get("bike_brand"), field_name="bike_brand")
            _validate_no_profanity(bike_data.get("bike_model"), field_name="bike_model")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Extract images from the request
        images = bike_data.pop("images", [])
        sync_error = _sync_gate_error("bike", bike_data, len(images))
        if sync_error:
            return sync_error
        if not images:
            return jsonify(
                {"error": "At least one image is required for a bike listing."}
            ), 400

        # Whitelist allowed fields for bikes
        bike_allowed_fields = {
            "bike_brand",
            "bike_model",
            "bike_type",
            "make",
            "model",
            "year",
            "mileage",
            "engine_size",
            "color",
            "condition",
            "price",
            "location",
            "area",
            "emirate",
            "contact_number",
            "contact_phone",
            "country_code",
            "vin_number",
            "whatsapp_number",
            "whatsapp_prefill_text",
            "description",
            "transmission",
            "fuel_type",
            "features",
            "cylinders",
            "wheels",
            "status",
            "user_id",
            "user_email",
            "is_dealer",
            "expires_at",
            "expired_at",
            "retention_expires_at",
            "last_extended_at",
            "extension_count",
            "is_archived",
            "registration_doc_url",
        }
        bike_data = {k: v for k, v in bike_data.items() if k in bike_allowed_fields}
        bike_data["user_email"] = get_user_email(current_user)

        # make/model are required NOT NULL in the bikes table; populate from bike_brand/bike_model
        bike_data["make"] = bike_data.get("make") or bike_data.get("bike_brand") or ""
        bike_data["model"] = bike_data.get("model") or bike_data.get("bike_model") or ""
        # auto_review_reasons is NOT NULL in the bikes table — default to empty array
        bike_data.setdefault("auto_review_reasons", [])

        # Create the bike
        data, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/bikes", bike_data, user_id=current_user
        )

        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(data, status_code, "bike")
            return jsonify(friendly_data), friendly_status

        bike_id = data[0]["id"]

        # Add images if any
        if images:
            image_inserts = []
            for image_url in images:
                if isinstance(image_url, dict):
                    url_value = (
                        image_url.get("image_url")
                        or image_url.get("url")
                        or image_url.get("display_url")
                    )
                    if not url_value:
                        continue
                    image_inserts.append(
                        {
                            "bike_id": bike_id,
                            "url": image_url.get("url") or url_value,
                            "image_url": image_url.get("image_url") or url_value,
                            "display_url": image_url.get("display_url"),
                            "focal_x": image_url.get("focal_x"),
                            "focal_y": image_url.get("focal_y"),
                            "crop_meta": image_url.get("crop_meta"),
                            "cropped_at": _isoformat_utc(_utc_now()),
                        }
                    )
                    continue
                image_inserts.append(
                    {
                        "bike_id": bike_id,
                        "url": image_url,
                        "image_url": image_url,  # Add image_url field for frontend compatibility
                        "cropped_at": _isoformat_utc(_utc_now()),
                    }
                )

            images_data, images_status = supabase_request(
                "post", "/rest/v1/bike_images", data=image_inserts, user_id=current_user
            )

            if images_status < 400:
                data[0]["images"] = images_data
            else:
                data[0]["images"] = []

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            if _initial_listing_status() == "pending":
                _send_new_listing_admin_notification("bike", data[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "bike", data[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

        _trigger_auto_review_async()
        return jsonify(data[0]), 201
    except Exception as e:
        logger.error(f"Error creating bike listing: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bikes/<string:bike_id>", methods=["PUT", "PATCH", "POST"])
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
        _normalize_listing_vin(update_data)

        # Normalize legacy/alternate frontend keys.
        if "make" in update_data and "bike_brand" not in update_data:
            update_data["bike_brand"] = update_data.get("make")
        if "model" in update_data and "bike_model" not in update_data:
            update_data["bike_model"] = update_data.get("model")
        if "contact_phone" in update_data and "contact_number" not in update_data:
            update_data["contact_number"] = update_data.get("contact_phone")
        if "engine_capacity" in update_data and "engine_size" not in update_data:
            update_data["engine_size"] = update_data.get("engine_capacity")
        if "area" not in update_data and update_data.get("location"):
            update_data["area"] = update_data.get("location")
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "bikes")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

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
                _validate_no_profanity(
                    update_data.get("description"), field_name="description"
                )
            if "bike_brand" in update_data:
                _validate_no_profanity(
                    update_data.get("bike_brand"), field_name="bike_brand"
                )
            if "bike_model" in update_data:
                _validate_no_profanity(
                    update_data.get("bike_model"), field_name="bike_model"
                )
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Whitelist allowed fields for bikes
        bike_allowed_fields = {
            "bike_brand",
            "bike_model",
            "bike_type",
            "make",
            "model",
            "year",
            "mileage",
            "engine_size",
            "color",
            "price",
            "location",
            "area",
            "emirate",
            "contact_number",
            "contact_phone",
            "vin_number",
            "whatsapp_number",
            "whatsapp_prefill_text",
            "description",
            "transmission",
            "fuel_type",
            "features",
            "cylinders",
            "wheels",
            "status",
            "user_id",
            "is_dealer",
            "registration_doc_url",
        }
        # Sanitize update data to ensure 'id' is NOT sent to Supabase as part of the body
        update_data.pop("id", None)

        update_data = {k: v for k, v in update_data.items() if k in bike_allowed_fields}

        if "price" in update_data and update_data["price"] is not None:
            _maybe_record_price_drop("bikes", bike_id, update_data["price"])
            _record_price_point("bikes", bike_id, update_data["price"])

        # Update the bike using PATCH for partial update
        data, status_code = supabase_request(
            "patch",
            f"/rest/v1/bikes",
            params={"id": f"eq.{bike_id}"},
            data=update_data,
            user_id=current_user,
        )

        if status_code >= 400:
            return jsonify(data), status_code

        # Update images if provided. Snapshot the existing rows first, attempt
        # the insert, and only drop the originals once the replacements have
        # landed — otherwise a transient insert failure would wipe the listing.
        if images is not None:
            existing_images_resp, existing_images_status = supabase_request(
                "get",
                "/rest/v1/bike_images",
                params={"select": "id", "bike_id": f"eq.{bike_id}"},
                user_id=current_user,
            )
            existing_image_ids = (
                [row["id"] for row in existing_images_resp if isinstance(row, dict) and row.get("id")]
                if existing_images_status < 400 and isinstance(existing_images_resp, list)
                else []
            )

            image_inserts = []
            for image_url in images:
                if isinstance(image_url, dict):
                    url_value = (
                        image_url.get("image_url")
                        or image_url.get("url")
                        or image_url.get("display_url")
                    )
                    if not url_value:
                        continue
                    image_inserts.append(
                        {
                            "bike_id": bike_id,
                            "url": image_url.get("url") or url_value,
                            "image_url": image_url.get("image_url") or url_value,
                            "display_url": image_url.get("display_url"),
                            "focal_x": image_url.get("focal_x"),
                            "focal_y": image_url.get("focal_y"),
                            "crop_meta": image_url.get("crop_meta"),
                            "cropped_at": _isoformat_utc(_utc_now()),
                        }
                    )
                    continue
                image_inserts.append(
                    {
                        "bike_id": bike_id,
                        "url": image_url,
                        "image_url": image_url,
                        "cropped_at": _isoformat_utc(_utc_now()),
                    }
                )

            inserted_rows = []
            if image_inserts:
                bulk_resp, bulk_status = supabase_request(
                    "post",
                    "/rest/v1/bike_images",
                    data=image_inserts,
                    user_id=current_user,
                )
                if bulk_status < 400:
                    if isinstance(bulk_resp, list):
                        inserted_rows = bulk_resp
                    elif isinstance(bulk_resp, dict):
                        inserted_rows = [bulk_resp]
                else:
                    for image_insert in image_inserts:
                        single_resp, single_status = supabase_request(
                            "post",
                            "/rest/v1/bike_images",
                            data=image_insert,
                            user_id=current_user,
                        )
                        if single_status < 400 and single_resp:
                            if isinstance(single_resp, list):
                                inserted_rows.extend(single_resp)
                            else:
                                inserted_rows.append(single_resp)

                    if not inserted_rows:
                        logger.error(
                            f"Failed to replace bike images for {bike_id}: "
                            f"{bulk_status} - {bulk_resp}"
                        )
                        return jsonify({"error": "Failed to save listing images."}), 500

            # New rows are in (or images list was empty → delete-all is OK).
            if existing_image_ids:
                inserted_ids = {
                    row.get("id")
                    for row in inserted_rows
                    if isinstance(row, dict) and row.get("id")
                }
                to_delete = [img_id for img_id in existing_image_ids if img_id not in inserted_ids]
                if to_delete:
                    quoted_ids = ",".join(f'"{img_id}"' for img_id in to_delete)
                    supabase_request(
                        "delete",
                        "/rest/v1/bike_images",
                        params={"id": f"in.({quoted_ids})"},
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

        # Send edit notification email
        try:
            user_email = bike.get("user_email") or bike.get("contact_email")
            if not user_email:
                user_email = get_user_email(current_user)
            if user_email and EMAIL_REGEX.match(user_email):
                _, email_error = _send_listing_status_email(
                    user_email,
                    "bikes",
                    bike,
                    "updated",
                    request.headers.get("Origin"),
                )
                if email_error:
                    logger.error(f"Edit email failed for bike {bike_id}: {email_error}")
                else:
                    logger.info(f"Edit email sent for bike {bike_id}")
        except Exception as email_err:
            logger.error(f"Error sending edit email: {email_err}")

        _invalidate_public_inventory_cache("bikes")
        _invalidate_api_cache_prefixes([f"/api/bikes/{bike_id}"])
        return jsonify(bike), 200
    except Exception as e:
        logger.error(f"Error updating bike: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bikes/<string:bike_id>", methods=["DELETE"])
@token_required
def delete_bike(current_user, bike_id):
    try:
        delete_resp, delete_status = _delete_user_owned_listing(
            current_user, "bike", bike_id
        )
        if delete_status >= 400:
            return jsonify(delete_resp), delete_status

        _invalidate_public_inventory_cache("bikes")
        _invalidate_api_cache_prefixes([f"/api/bikes/{bike_id}"])
        return jsonify({"message": "Bike listing deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting bike: {e}")
        return jsonify({"error": str(e)}), 500


# License Plate Endpoints
@app.route("/api/plates", methods=["GET"])
def get_plates():
    try:
        cache_key = _build_api_cache_key()
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return _cached_json_response(cached_payload)

        # Get query parameters
        limit, offset = _parse_pagination_args()

        logger.info(f"Fetching plates with limit: {limit}, offset: {offset}")

        # Use direct request with service role key
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        order = request.args.get("order", "created_at.desc")

        # Build query - only get approved plates
        # is_approved=eq.true is required so the admin "hide reddit listings"
        # toggle (which bulk-sets is_approved=false on source_platform=reddit
        # rows) actually removes them here, matching /api/cars|bikes|parts.
        # plate_images join omitted: no FK relationship declared in schema (plates use UAELicensePlate component)
        url = (
            f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?status=eq.approved&is_approved=eq.true&order={order}"
            f"&limit={limit}&offset={offset}&select=id,user_id,city,code,digits,price,number,plate_format,"
            "description,contact_phone,contact_name,country_code,status,is_approved,created_at,updated_at,"
            "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
            "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at"
        )

        logger.info(f"Fetching plates from: {url}")
        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code == 200:
            plates = response.json()
            plates = _filter_public_listing_records("license_plates", plates)
            logger.info(f"Found {len(plates)} plates")

            seller_map = _batch_fetch_seller_map(
                [plate.get("user_id") for plate in plates], headers=headers
            )
            for plate in plates:
                # Normalize images
                plate_images = plate.pop("plate_images", [])
                plate["images"] = [
                    {
                        "id": img.get("id"),
                        "url": img.get("url") or img.get("image_url"),
                        "image_url": img.get("image_url") or img.get("url"),
                        "display_url": img.get("display_url"),
                        "focal_x": img.get("focal_x"),
                        "focal_y": img.get("focal_y"),
                        "crop_meta": img.get("crop_meta"),
                    }
                    for img in plate_images
                    if img.get("url") or img.get("image_url")
                ]
                # Fallback for main image if images list is empty but one of these fields exists
                if not plate["images"]:
                    if plate.get("image_url") or plate.get("url"):
                        main_url = plate.get("image_url") or plate.get("url")
                        plate["images"] = [
                            {
                                "id": "main",
                                "url": main_url,
                                "image_url": main_url,
                                "display_url": plate.get("display_url"),
                                "focal_x": plate.get("focal_x"),
                                "focal_y": plate.get("focal_y"),
                                "crop_meta": plate.get("crop_meta"),
                            }
                        ]

                _apply_seller_to_listing(plate, seller_map.get(plate.get("user_id")))

            _api_cache_set(cache_key, plates)
            return _cached_json_response(plates)
        else:
            logger.error(
                f"Failed to fetch plates: {response.status_code} - {response.text}"
            )
            empty_payload = []
            _api_cache_set(cache_key, empty_payload)
            return _cached_json_response(empty_payload)
    except Exception as e:
        logger.error(f"Error fetching plates: {str(e)}", exc_info=True)
        empty_payload = []
        if "cache_key" in locals():
            _api_cache_set(cache_key, empty_payload)
        return _cached_json_response(empty_payload)


@app.route("/api/plates/<plate_id>", methods=["GET", "PUT", "PATCH", "POST"])
@token_required_optional
def plate_handler(current_user, plate_id):
    if request.method == "GET":
        return get_plate_details(plate_id)

    # For update methods, token is required
    if not current_user:
        return jsonify({"message": "Authentication required"}), 401

    return update_plate(current_user, plate_id)


def get_plate_details(plate_id):
    """Get details for a specific license plate by ID"""
    try:
        logger.info(f"Fetching plate details for ID: {plate_id}")

        cache_key = f"api-cache:{request.path}"
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            logger.info(f"Redis cache hit for plate detail {plate_id}")
            return _cached_json_response(cached_payload)

        # Use service role for consistent data fetching
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }

        # plate_images join omitted: no FK relationship declared in schema (plates use UAELicensePlate component)
        url = f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?id=eq.{plate_id}&select=*"
        response = requests.get(url, headers=headers)

        if response.status_code == 200:
            plates = response.json()
            if not plates:
                return jsonify({"error": "Plate not found"}), 404

            plate = _sync_listing_lifecycle(
                "license_plates", plates[0], hard_delete_archived=True
            )
            if not plate:
                return jsonify({"error": "Plate not found"}), 404

            # Normalize images
            plate_images = plate.pop("plate_images", [])
            plate["images"] = [
                {
                    "id": img.get("id"),
                    "url": img.get("url") or img.get("image_url"),
                    "image_url": img.get("image_url") or img.get("url"),
                    "display_url": img.get("display_url"),
                    "focal_x": img.get("focal_x"),
                    "focal_y": img.get("focal_y"),
                    "crop_meta": img.get("crop_meta"),
                }
                for img in plate_images
            ]

            _enrich_listing_seller(plate, headers=headers)
            for _f in _PUBLIC_STRIP_FIELDS:
                plate.pop(_f, None)
            _api_cache_set(cache_key, plate)
            return _cached_json_response(plate)
        else:
            return jsonify({"error": "Failed to fetch plate"}), response.status_code

    except Exception as e:
        logger.error(f"Error getting plate {plate_id}: {e}")
        return jsonify({"error": str(e)}), 500


def update_plate(current_user, plate_id):
    """Update a license plate listing"""
    try:
        logger.info(f"Updating plate listing: {plate_id}")

        data = request.form if request.form else (request.get_json(silent=True) or {})

        # Prepare update payload
        update_data = {}
        allowed_fields = {
            "city",
            "code",
            "digits",
            "price",
            "number",
            "plate_format",
            "contact_name",
            "contact_phone",
            "country_code",
            "whatsapp_number",
            "whatsapp_prefill_text",
            "description",
            "area",
            "emirate",
            "is_dealer",
            "proof_document_url",
            "registration_doc_url",
        }

        for key in allowed_fields:
            if key in data:
                update_data[key] = data[key]
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "plates")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        try:
            if "description" in update_data:
                _validate_description_word_count(
                    update_data.get("description"), field_name="description"
                )
                _validate_no_profanity(
                    update_data.get("description"), field_name="description"
                )
            if "contact_name" in update_data:
                _validate_no_profanity(
                    update_data.get("contact_name"), field_name="contact_name"
                )
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Sanitize
        update_data.pop("id", None)

        if "price" in update_data and update_data["price"] is not None:
            _maybe_record_price_drop("license_plates", plate_id, update_data["price"])
            _record_price_point("license_plates", plate_id, update_data["price"])

        # Update — include user_id filter so the query is a no-op if the caller
        # does not own this plate (belt-and-suspenders alongside RLS).
        data, status_code = supabase_request(
            "patch",
            f"/rest/v1/license_plates",
            params={"id": f"eq.{plate_id}", "user_id": f"eq.{current_user}"},
            data=update_data,
            use_service_role=True,
        )

        if status_code >= 400:
            return jsonify(data), status_code

        # Fetch full plate data for email
        refreshed_resp, refreshed_status = supabase_request(
            "get",
            "/rest/v1/license_plates",
            params={"id": f"eq.{plate_id}", "select": "*", "limit": 1},
            user_id=current_user,
        )

        if refreshed_status < 400 and refreshed_resp:
            plate = refreshed_resp[0]
            # Send edit notification email
            try:
                user_email = plate.get("user_email") or plate.get("contact_email")
                if not user_email:
                    user_email = get_user_email(current_user)
                if user_email and EMAIL_REGEX.match(user_email):
                    _, email_error = _send_listing_status_email(
                        user_email,
                        "plates",
                        plate,
                        "updated",
                        request.headers.get("Origin"),
                    )
                    if email_error:
                        logger.error(
                            f"Edit email failed for plate {plate_id}: {email_error}"
                        )
            except Exception as email_err:
                logger.error(f"Error sending edit email: {email_err}")

        _invalidate_public_inventory_cache("plates")
        _invalidate_api_cache_prefixes([f"/api/plates/{plate_id}"])
        return jsonify({"message": "Plate updated successfully"}), 200

    except Exception as e:
        logger.error(f"Error updating plate {plate_id}: {e}")
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
        _invalidate_public_inventory_cache("plates")
        _invalidate_api_cache_prefixes([f"/api/plates/{plate_id}"])
        return jsonify({"message": "Plate listing deleted successfully"}), 200
    except Exception as e:
        logger.error(f"Error deleting plate {plate_id}: {e}")
        return jsonify({"error": str(e)}), 500


# Car Parts Endpoints
@app.route("/api/parts", methods=["GET"])
def get_parts():
    try:
        cache_key = _build_api_cache_key()
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return _cached_json_response(cached_payload)

        # Get query parameters
        limit, offset = _parse_pagination_args()
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
            # Build query with join for images
            url = (
                f"{app.config['SUPABASE_URL']}/rest/v1/car_parts?{query_string}"
                "&select=id,user_id,name,part_type,condition,price,location,area,emirate,"
                "description,contact_number,country_code,status,is_approved,created_at,updated_at,"
                "compatible_makes,compatible_models,compatible_years,"
                "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
                "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
                "part_images(" + LISTING_IMAGE_SELECTS["car_parts"] + ")"
            )

            logger.info(f"Making direct request to: {url}")
            response = requests.get(url, headers=headers)

            if response.status_code == 200:
                parts = response.json()
                parts = _filter_public_listing_records("car_parts", parts)

                seller_map = _batch_fetch_seller_map(
                    [part.get("user_id") for part in parts], headers=headers
                )
                for part in parts:
                    part_images = part.pop("part_images", [])
                    part["images"] = [
                        {
                            "id": img.get("id"),
                            "url": img.get("url") or img.get("image_url"),
                            "image_url": img.get("image_url") or img.get("url"),
                            "display_url": img.get("display_url"),
                            "focal_x": img.get("focal_x"),
                            "focal_y": img.get("focal_y"),
                            "crop_meta": img.get("crop_meta"),
                        }
                        for img in part_images
                        if img.get("url") or img.get("image_url")
                    ]
                    # Fallback for main image
                    if not part["images"]:
                        if part.get("image_url") or part.get("url"):
                            main_url = part.get("image_url") or part.get("url")
                            part["images"] = [
                                {
                                    "id": "main",
                                    "url": main_url,
                                    "image_url": main_url,
                                    "display_url": part.get("display_url"),
                                    "focal_x": part.get("focal_x"),
                                    "focal_y": part.get("focal_y"),
                                    "crop_meta": part.get("crop_meta"),
                                }
                            ]
                    _apply_seller_to_listing(part, seller_map.get(part.get("user_id")))

                _api_cache_set(cache_key, parts)
                return _cached_json_response(parts)
            else:
                logger.error(
                    f"Direct request failed: {response.status_code} - {response.text}"
                )
                raise Exception("Direct request failed")

        except Exception as e:
            logger.error(f"Error in direct request: {str(e)}")
            # Fallback to regular Supabase client (single joined query; no N+1 image fetch)
            fallback_params = {
                **params,
                "select": (
                    "id,user_id,name,part_type,condition,price,location,area,emirate,"
                    "description,contact_number,country_code,status,is_approved,created_at,updated_at,"
                    "compatible_makes,compatible_models,compatible_years,"
                    "expires_at,retention_expires_at,expired_at,is_archived,deleted_at,"
                    "sold_status,sold_status_set_at,sold_response_deadline,last_extended_at,"
                    "part_images(" + LISTING_IMAGE_SELECTS["car_parts"] + ")"
                ),
            }
            response, status_code = supabase_request(
                "get", "/rest/v1/car_parts", params=fallback_params, use_service_role=True
            )
            if status_code < 400 and response:
                parts = _filter_public_listing_records("car_parts", response)

                seller_map = _batch_fetch_seller_map(
                    [part.get("user_id") for part in parts], headers=headers
                )
                for part in parts:
                    part_images = part.pop("part_images", []) or []
                    part["images"] = [
                        {
                            "id": img.get("id"),
                            "url": img.get("url") or img.get("image_url"),
                            "image_url": img.get("image_url") or img.get("url"),
                            "display_url": img.get("display_url"),
                            "focal_x": img.get("focal_x"),
                            "focal_y": img.get("focal_y"),
                            "crop_meta": img.get("crop_meta"),
                        }
                        for img in part_images
                        if img.get("url") or img.get("image_url")
                    ]

                    if not part["images"] and (part.get("image_url") or part.get("url")):
                        main_url = part.get("image_url") or part.get("url")
                        part["images"] = [
                            {
                                "id": "main",
                                "url": main_url,
                                "image_url": main_url,
                                "display_url": part.get("display_url"),
                                "focal_x": part.get("focal_x"),
                                "focal_y": part.get("focal_y"),
                                "crop_meta": part.get("crop_meta"),
                            }
                        ]

                    _apply_seller_to_listing(part, seller_map.get(part.get("user_id")))

                _api_cache_set(cache_key, parts)
                return _cached_json_response(parts)
            else:
                empty_payload = []
                _api_cache_set(cache_key, empty_payload)
                return _cached_json_response(empty_payload)

    except Exception as e:
        logger.error(f"Error fetching parts: {str(e)}")
        return jsonify({"error": str(e)}), 500


# Create a new car parts listing (authenticated)
@app.route("/api/parts", methods=["POST"])
@token_required
def create_part(current_user):
    try:
        logger.info("Creating new car part listing")

        verification_check = _require_verified_user_for_listing(current_user)
        if verification_check:
            return verification_check

        dealer_check = _require_dealer_verified(current_user)
        if dealer_check:
            return dealer_check

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
        part_data["status"] = _initial_listing_status()
        part_data.update(_new_listing_lifecycle_fields())
        try:
            _require_whatsapp_prefill_and_phone_alignment(part_data, "parts")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

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
            "country_code",
            "whatsapp_number",
            "whatsapp_prefill_text",
            "description",
            "is_negotiable",
            "status",
            "user_id",
            "user_email",
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
        part_data["user_email"] = get_user_email(current_user)
        # auto_review_reasons is NOT NULL in the car_parts table — default to empty array
        part_data.setdefault("auto_review_reasons", [])

        # compatible_years is TEXT[] in the DB — coerce string values to array/null
        cy = part_data.get("compatible_years")
        if not cy:
            part_data["compatible_years"] = None
        elif isinstance(cy, str):
            part_data["compatible_years"] = [cy]

        # Validate required fields
        required_fields = ["name", "part_type", "price"]
        for field in required_fields:
            if not part_data.get(field):
                return jsonify({"error": f"Missing required field: {field}"}), 400

        try:
            _validate_description_word_count(
                part_data.get("description"), field_name="description"
            )
            _validate_no_profanity(
                part_data.get("description"), field_name="description"
            )
            _validate_no_profanity(part_data.get("name"), field_name="name")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Create the part entry
        logger.info(f"Creating part with data: {part_data}")
        data, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/car_parts", part_data, user_id=current_user
        )

        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(data, status_code, "part")
            return jsonify(friendly_data), friendly_status

        part_id = data[0]["id"]
        logger.info(f"Created part with ID: {part_id}")

        # Add images if any
        if uploaded_files:
            image_inserts = []
            for image_url in uploaded_files:
                if isinstance(image_url, dict):
                    url_value = (
                        image_url.get("image_url")
                        or image_url.get("url")
                        or image_url.get("display_url")
                    )
                    if not url_value:
                        continue
                    image_inserts.append(
                        {
                            "part_id": part_id,
                            "url": image_url.get("url") or url_value,
                            "image_url": image_url.get("image_url") or url_value,
                            "display_url": image_url.get("display_url"),
                            "focal_x": image_url.get("focal_x"),
                            "focal_y": image_url.get("focal_y"),
                            "crop_meta": image_url.get("crop_meta"),
                            "cropped_at": _isoformat_utc(_utc_now()),
                        }
                    )
                    continue
                image_inserts.append(
                    {
                        "part_id": part_id,
                        "url": image_url,
                        "image_url": image_url,  # Add image_url field for frontend compatibility
                        "cropped_at": _isoformat_utc(_utc_now()),
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

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            if _initial_listing_status() == "pending":
                _send_new_listing_admin_notification("part", data[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "part", data[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

        _trigger_auto_review_async()
        return jsonify(data[0]), 201

    except Exception as e:
        logger.error(f"Error creating car part listing: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/parts/<part_id>", methods=["GET", "PUT", "PATCH", "POST"])
@token_required_optional
def part_handler(current_user, part_id):
    if request.method == "GET":
        return get_part_details(part_id)

    # For update methods, token is required
    if not current_user:
        return jsonify({"message": "Authentication required"}), 401

    return update_part(current_user, part_id)


def get_part_details(part_id):
    """Get details for a specific car part by ID"""
    try:
        logger.info(f"Fetching part details for ID: {part_id}")

        cache_key = f"api-cache:{request.path}"
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            logger.info(f"Redis cache hit for part detail {part_id}")
            return _cached_json_response(cached_payload)

        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }

        url = f"{app.config['SUPABASE_URL']}/rest/v1/car_parts?id=eq.{part_id}&select=*,part_images(*)"
        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code != 200:
            return jsonify({"error": "Failed to fetch part"}), response.status_code

        parts = response.json()
        if not parts:
            return jsonify({"error": "Part not found"}), 404

        part = _sync_listing_lifecycle("car_parts", parts[0], hard_delete_archived=True)
        if not part:
            return jsonify({"error": "Part not found"}), 404

        part_images = part.pop("part_images", [])
        part["images"] = [
            {
                "id": img.get("id"),
                "url": img.get("url") or img.get("image_url"),
                "image_url": img.get("image_url") or img.get("url"),
                "display_url": img.get("display_url"),
                "focal_x": img.get("focal_x"),
                "focal_y": img.get("focal_y"),
                "crop_meta": img.get("crop_meta"),
            }
            for img in part_images
            if img.get("url") or img.get("image_url")
        ]

        if not part["images"] and (part.get("image_url") or part.get("url")):
            main_url = part.get("image_url") or part.get("url")
            part["images"] = [
                {
                    "id": "main",
                    "url": main_url,
                    "image_url": main_url,
                    "display_url": part.get("display_url"),
                    "focal_x": part.get("focal_x"),
                    "focal_y": part.get("focal_y"),
                    "crop_meta": part.get("crop_meta"),
                }
            ]

        _enrich_listing_seller(part, headers=headers)
        _api_cache_set(cache_key, part)
        return _cached_json_response(part)

    except Exception as e:
        logger.error(f"Error getting part {part_id}: {e}")
        return jsonify({"error": str(e)}), 500


def update_part(current_user, part_id):
    """Update a car part listing"""
    try:
        logger.info(f"Updating part listing: {part_id}")

        # Check if this is FormData or JSON
        is_form_data = (
            request.content_type and "multipart/form-data" in request.content_type
        )

        if is_form_data:
            update_data = {}
            for key, value in request.form.items():
                if key == "compatible_makes" or key == "compatible_models":
                    try:
                        update_data[key] = json.loads(value) if value else []
                    except:
                        update_data[key] = []
                else:
                    update_data[key] = value

            keep_image_ids = request.form.getlist("keep_image_ids")
            new_images = request.files.getlist("images")
            images = None
        else:
            update_data = request.json.copy() if request.json else {}
            keep_image_ids = update_data.pop("keep_image_ids", None)
            new_images = []
            images = update_data.pop("images", None)

        # Sanitize update data
        update_data.pop("id", None)
        update_data.pop("user_id", None)

        # Whitelist allowed fields
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
            "whatsapp_prefill_text",
            "country_code",
            "whatsapp_number",
            "description",
            "is_negotiable",
            "is_dealer",
        }
        update_data = {k: v for k, v in update_data.items() if k in part_allowed_fields}

        # compatible_years is TEXT[] in the DB — coerce string values to array/null
        if "compatible_years" in update_data:
            cy = update_data["compatible_years"]
            if not cy:
                update_data["compatible_years"] = None
            elif isinstance(cy, str):
                update_data["compatible_years"] = [cy]

        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "parts")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        try:
            if "description" in update_data:
                _validate_description_word_count(
                    update_data.get("description"), field_name="description"
                )
                _validate_no_profanity(
                    update_data.get("description"), field_name="description"
                )
            if "name" in update_data:
                _validate_no_profanity(update_data.get("name"), field_name="name")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        if "price" in update_data and update_data["price"] is not None:
            _maybe_record_price_drop("car_parts", part_id, update_data["price"])
            _record_price_point("car_parts", part_id, update_data["price"])

        # Update the part
        data, status_code = supabase_request(
            "patch",
            f"/rest/v1/car_parts",
            params={"id": f"eq.{part_id}"},
            data=update_data,
            user_id=current_user,
        )

        if status_code >= 400:
            return jsonify(data), status_code

        # Handle image updates from JSON payload (uploaded URLs). Snapshot
        # existing rows, insert replacements, then delete the originals only
        # once the new rows are persisted.
        if images is not None:
            existing_images_resp, existing_images_status = supabase_request(
                "get",
                "/rest/v1/part_images",
                params={"select": "id", "part_id": f"eq.{part_id}"},
                user_id=current_user,
            )
            existing_image_ids = (
                [row["id"] for row in existing_images_resp if isinstance(row, dict) and row.get("id")]
                if existing_images_status < 400 and isinstance(existing_images_resp, list)
                else []
            )

            image_inserts = []
            for image_url in images:
                if isinstance(image_url, dict):
                    url_value = (
                        image_url.get("image_url")
                        or image_url.get("url")
                        or image_url.get("display_url")
                    )
                    if not url_value:
                        continue
                    image_inserts.append(
                        {
                            "part_id": part_id,
                            "url": image_url.get("url") or url_value,
                            "image_url": image_url.get("image_url") or url_value,
                            "display_url": image_url.get("display_url"),
                            "focal_x": image_url.get("focal_x"),
                            "focal_y": image_url.get("focal_y"),
                            "crop_meta": image_url.get("crop_meta"),
                            "cropped_at": _isoformat_utc(_utc_now()),
                        }
                    )
                    continue
                image_inserts.append(
                    {
                        "part_id": part_id,
                        "url": image_url,
                        "image_url": image_url,
                        "cropped_at": _isoformat_utc(_utc_now()),
                    }
                )

            inserted_rows = []
            if image_inserts:
                bulk_resp, bulk_status = supabase_request(
                    "post",
                    "/rest/v1/part_images",
                    data=image_inserts,
                    user_id=current_user,
                )
                if bulk_status < 400:
                    if isinstance(bulk_resp, list):
                        inserted_rows = bulk_resp
                    elif isinstance(bulk_resp, dict):
                        inserted_rows = [bulk_resp]
                else:
                    for image_insert in image_inserts:
                        single_resp, single_status = supabase_request(
                            "post",
                            "/rest/v1/part_images",
                            data=image_insert,
                            user_id=current_user,
                        )
                        if single_status < 400 and single_resp:
                            if isinstance(single_resp, list):
                                inserted_rows.extend(single_resp)
                            else:
                                inserted_rows.append(single_resp)

                    if not inserted_rows:
                        logger.error(
                            f"Failed to replace part images for {part_id}: "
                            f"{bulk_status} - {bulk_resp}"
                        )
                        return jsonify({"error": "Failed to save listing images."}), 500

            if existing_image_ids:
                inserted_ids = {
                    row.get("id")
                    for row in inserted_rows
                    if isinstance(row, dict) and row.get("id")
                }
                to_delete = [img_id for img_id in existing_image_ids if img_id not in inserted_ids]
                if to_delete:
                    quoted_ids = ",".join(f'"{img_id}"' for img_id in to_delete)
                    supabase_request(
                        "delete",
                        "/rest/v1/part_images",
                        params={"id": f"in.({quoted_ids})"},
                        user_id=current_user,
                    )

        # Fetch full part data for email
        refreshed_resp, refreshed_status = supabase_request(
            "get",
            "/rest/v1/car_parts",
            params={"id": f"eq.{part_id}", "select": "*", "limit": 1},
            user_id=current_user,
        )

        if refreshed_status < 400 and refreshed_resp:
            part = refreshed_resp[0]
            # Send edit notification email
            try:
                user_email = part.get("user_email") or part.get("contact_email")
                if not user_email:
                    user_email = get_user_email(current_user)
                if user_email and EMAIL_REGEX.match(user_email):
                    _, email_error = _send_listing_status_email(
                        user_email,
                        "parts",
                        part,
                        "updated",
                        request.headers.get("Origin"),
                    )
                    if email_error:
                        logger.error(
                            f"Edit email failed for part {part_id}: {email_error}"
                        )
            except Exception as email_err:
                logger.error(f"Error sending edit email: {email_err}")

        _invalidate_public_inventory_cache("parts")
        _invalidate_api_cache_prefixes([f"/api/parts/{part_id}"])
        return jsonify({"message": "Part updated successfully"}), 200

    except Exception as e:
        logger.error(f"Error updating part {part_id}: {e}")
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
        _invalidate_public_inventory_cache("parts")
        _invalidate_api_cache_prefixes([f"/api/parts/{part_id}"])
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

        if (
            status_code >= 400
            or not user_data
            or not (
                user_data[0].get("is_admin")
                or _is_super_admin_record(user_data[0], user_id=current_user)
            )
        ):
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

        if response.status_code not in (200, 206):
            logger.error(f"Failed to get users: {response.text}")
            return jsonify({"error": "Failed to fetch users"}), response.status_code

        payload = response.json()
        if response.status_code == 206:
            return jsonify({"users": payload, "partial_content": True}), 200

        return jsonify(payload), 200

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


@app.route("/api/admin/users/<user_id>/profile", methods=["PATCH"])
@token_required
def update_admin_user_profile(current_user, user_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        if user_id == current_user:
            return jsonify(
                {"error": "You cannot modify your own admin profile from this panel"}
            ), 400

        protected = _protect_super_admin_target(
            user_id, "modify the main admin account"
        )
        if protected:
            return protected

        data = request.get_json(silent=True) or {}
        allowed_fields = {
            "account_status": {"active", "suspended", "banned"},
            "is_admin": bool,
            "is_dealer": bool,
            "dealer_verified": bool,
            "email_verified": bool,
            "phone_verified": bool,
            "first_name": str,
            "last_name": str,
            "display_name": str,
            "username": str,
            "phone": str,
            "city": str,
            "emirate": str,
            "company_name": str,
            "company_registration_number": str,
            "trade_license_number": str,
            "tax_registration_number": str,
            "profile_photo_url": str,
            "rejection_note": str,
        }

        update_data = {}
        for field, validator in allowed_fields.items():
            if field not in data:
                continue

            value = data.get(field)
            if validator is bool:
                update_data[field] = bool(value)
            elif validator is str:
                if value is None:
                    update_data[field] = None
                else:
                    next_value = str(value).strip()
                    update_data[field] = next_value if next_value else None
            elif isinstance(validator, set):
                next_value = str(value or "").strip().lower()
                if next_value not in validator:
                    return jsonify(
                        {
                            "error": f"{field} must be one of: {', '.join(sorted(validator))}"
                        }
                    ), 400
                update_data[field] = next_value

        if not update_data:
            return jsonify({"error": "No supported profile fields were provided"}), 400

        if "is_dealer" in update_data and not update_data["is_dealer"]:
            update_data["dealer_verified"] = False
            update_data["dealer_verified_at"] = None
        elif update_data.get("dealer_verified") is True:
            from datetime import datetime

            update_data["dealer_verified_at"] = datetime.utcnow().isoformat()

        if update_data.get("phone_verified") is True:
            current_profile = _get_user_profile_for_verification(user_id) or {}
            next_phone = update_data.get("phone")
            if next_phone is None:
                next_phone = current_profile.get("phone")
            next_country_code = update_data.get("country_code")
            if next_country_code is None:
                next_country_code = current_profile.get("country_code")
            normalized_phone = _normalize_phone_number(next_phone, next_country_code)
            if not normalized_phone:
                return jsonify(
                    {
                        "error": "Cannot mark a user as phone verified without a valid phone number."
                    }
                ), 400
            update_data["phone"] = normalized_phone
            update_data["country_code"] = (
                next_country_code
                or _infer_country_code_from_phone(normalized_phone)
                or "+971"
            )
            update_data["phone_verified_at"] = _isoformat_utc(_utc_now())
        elif update_data.get("phone_verified") is False:
            update_data["phone_verified_at"] = None

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{user_id}",
            data=update_data,
            use_service_role=True,
        )

        if status_code not in [200, 204]:
            logger.error(f"Failed updating admin profile for {user_id}: {response}")
            return jsonify({"error": "Failed to update user profile"}), status_code

        # Send notification emails for dealer-related changes
        try:
            dealer_fields_changed = any(
                f in update_data
                for f in (
                    "is_dealer",
                    "dealer_verified",
                    "company_name",
                    "company_registration_number",
                    "trade_license_number",
                )
            )
            if dealer_fields_changed:
                # Look up dealer email
                dealer_resp, dealer_status = supabase_request(
                    "get",
                    f"/rest/v1/users?id=eq.{user_id}&select=email,first_name,last_name,company_name",
                    use_service_role=True,
                )
                if dealer_status < 400 and dealer_resp:
                    dealer_info = dealer_resp[0]
                    dealer_email = dealer_info.get("email")
                    dealer_name = (
                        dealer_info.get("first_name")
                        or dealer_info.get("display_name")
                        or "Dealer"
                    )

                    # Notify dealer
                    if dealer_email:
                        if (
                            update_data.get("dealer_verified") is False
                            and "dealer_verified" in update_data
                        ):
                            _send_dealer_status_email(
                                dealer_email,
                                "rejected",
                                request.headers.get("Origin"),
                                rejection_note="Your dealer profile was updated by an admin. Please re-submit your verification documents.",
                            )
                        elif update_data.get("dealer_verified") is True:
                            _send_dealer_status_email(
                                dealer_email,
                                "approved",
                                request.headers.get("Origin"),
                            )

                    # Notify DPH team
                    admin_email = os.getenv("RESEND_TO_EMAIL") or os.getenv(
                        "ADMIN_EMAIL"
                    )
                    if admin_email:
                        _send_resend_email(
                            {
                                "from": os.getenv(
                                    "RESEND_FROM_EMAIL", "noreply@dphclassifieds.com"
                                ),
                                "to": admin_email,
                                "subject": f"DPH Admin: Dealer profile updated - {dealer_info.get('company_name') or dealer_name}",
                                "html": f"""
                            <div style="font-family: sans-serif; padding: 20px;">
                                <h2>Dealer Profile Updated</h2>
                                <p>An admin has updated the dealer profile for <strong>{dealer_info.get("company_name") or dealer_name}</strong>.</p>
                                <p><strong>Email:</strong> {dealer_email}</p>
                                <p><strong>Changes:</strong> {", ".join(update_data.keys())}</p>
                                {'<p style="color: red;"><strong>Dealer verification has been revoked. The dealer will need to re-submit verification documents.</strong></p>' if update_data.get("dealer_verified") is False and "dealer_verified" in update_data else ""}
                            </div>
                            """,
                            }
                        )
        except Exception as notify_err:
            logger.error(f"Error sending admin update notification: {notify_err}")

        refreshed_response, refreshed_status = supabase_request(
            "get",
            f"/rest/v1/users?id=eq.{user_id}&select=id,email,first_name,last_name,display_name,username,phone,city,emirate,profile_photo_url,profile_completion_percentage,email_verified,phone_verified,is_dealer,dealer_verified,dealer_verified_at,is_admin,account_status,created_at,company_name,company_registration_number,trade_license_number",
            use_service_role=True,
        )

        updated_user = (
            refreshed_response[0]
            if refreshed_status < 400 and refreshed_response
            else update_data
        )
        return jsonify(
            {
                "message": "User profile updated successfully",
                "user": updated_user,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error updating admin user profile: {str(e)}")
        return jsonify({"error": "An error occurred while updating user profile"}), 500


# NOTE: DELETE /api/admin/users/<id> now lives in routes/admin.py — the
# duplicate here clashed with the blueprint route and racing dispatch made
# the wrong handler answer in some sessions. The auth-user delete logic
# (calling /auth/v1/admin/users/<id>) was ported into the blueprint so the
# Supabase Auth row is cleaned up alongside public.users.


@app.route("/api/admin/cleanup-unverified-accounts", methods=["POST"])
@token_required
def admin_cleanup_unverified_accounts(current_user):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        data = request.get_json(silent=True) or {}
        dry_run = bool(data.get("dryRun", False))
        limit = int(data.get("limit", 500))
        max_age_hours = float(data.get("maxAgeHours", 48))

        from auth_cleanup import cleanup_unverified_accounts

        result = cleanup_unverified_accounts(
            max_age_hours=max_age_hours,
            limit=limit,
            dry_run=dry_run,
        )
        return jsonify(result), 200
    except Exception as e:
        logger.error(f"Error running unverified cleanup: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to run cleanup"}), 500


def _create_plate_with_image_impl(current_user):
    try:
        logger.info("Creating plate listing with image upload")

        verification_check = _require_verified_user_for_listing(current_user)
        if verification_check:
            return verification_check

        dealer_check = _require_dealer_verified(current_user)
        if dealer_check:
            return dealer_check

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
        country_code = payload.get("country_code")
        whatsapp_number = payload.get("whatsapp_number")
        whatsapp_prefill_text = payload.get("whatsapp_prefill_text")
        description = payload.get("description")
        area = payload.get("area")
        emirate = payload.get("emirate")
        is_dealer = payload.get("is_dealer", False)
        if isinstance(is_dealer, str):
            is_dealer = is_dealer.lower() == "true"

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
            _validate_no_profanity(description, field_name="description")
            _validate_no_profanity(contact_name, field_name="contact_name")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        # Create plate entry
        plate_number_str = str(number).strip() if number is not None else ""
        proof_document_url = payload.get("proof_document_url") or None
        registration_doc_url = payload.get("registration_doc_url") or None
        plate_data = {
            "city": city,
            "code": code,
            "digits": digits,
            "price": price,
            "number": plate_number_str,
            "plate_format": plate_format,
            "contact_name": contact_name,
            "contact_phone": contact_phone,
            "country_code": country_code,
            "whatsapp_number": whatsapp_number,
            "whatsapp_prefill_text": whatsapp_prefill_text,
            "description": description,
            "area": area,
            "emirate": emirate,
            "is_dealer": is_dealer,
            "listing_title": f"{city} {code} {plate_number_str}".strip(),
            "user_id": current_user,
            "user_email": get_user_email(current_user),
            "status": _initial_listing_status(),
            **({"proof_document_url": proof_document_url} if proof_document_url else {}),
            **({"registration_doc_url": registration_doc_url} if registration_doc_url else {}),
        }
        plate_data.update(_new_listing_lifecycle_fields())
        # auto_review_reasons is NOT NULL in the license_plates table — default to empty array
        plate_data.setdefault("auto_review_reasons", [])
        try:
            _require_whatsapp_prefill_and_phone_alignment(plate_data, "plates")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        logger.info(f"Creating plate entry with data: {plate_data}")

        # Create plate in database
        response, status_code = _create_listing_with_lifecycle_fallback(
            "/rest/v1/license_plates", plate_data, user_id=current_user
        )

        if status_code >= 400:
            friendly_data, friendly_status = _friendly_db_error(response, status_code, "plate")
            return jsonify(friendly_data), friendly_status

        plate_id = response[0]["id"]
        logger.info(f"Created plate with ID: {plate_id}")

        # Attempt to generate a legacy static plate image. This is optional —
        # the frontend now renders plates via the UAELicensePlate React component
        # so a failure here must never prevent the listing from being created.
        try:
            import os
            from PIL import Image, ImageDraw, ImageFont

            plate_dir = os.path.join("static", "uploads", "plates", str(plate_id))
            os.makedirs(plate_dir, exist_ok=True)

            plate_width, plate_height = 600, 200
            plate_img = Image.new("RGB", (plate_width, plate_height), color=(255, 255, 255))
            draw = ImageDraw.Draw(plate_img)
            draw.rectangle(
                [(0, 0), (plate_width - 1, plate_height - 1)], outline=(0, 0, 0), width=5
            )

            try:
                font_path = os.path.join("static", "fonts", "arial.ttf")
                if not os.path.exists(font_path):
                    import matplotlib.font_manager as fm
                    font_path = fm.findfont(fm.FontProperties(family="Arial"))
                font = ImageFont.truetype(font_path, 50)
            except Exception:
                font = ImageFont.load_default()

            text = f"{city} {code} {plate_number_str}"
            text_width = draw.textlength(text, font=font)
            draw.text(
                ((plate_width - text_width) / 2, plate_height / 3),
                text,
                fill=(0, 0, 0),
                font=font,
            )

            image_filename = f"plate_{city}_{code}_{plate_number_str}.png"
            image_path = os.path.join(plate_dir, image_filename)
            plate_img.save(image_path)

            image_url = f"/static/uploads/plates/{plate_id}/{image_filename}"
            response[0]["image_url"] = image_url

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
                    logger.error(f"Failed to add plate image record: {image_response}")
            except Exception as img_db_err:
                logger.error(f"Error saving plate image record: {img_db_err}")

        except Exception as pil_err:
            logger.warning(f"Plate PIL image generation skipped (non-fatal): {pil_err}")

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            if _initial_listing_status() == "pending":
                _send_new_listing_admin_notification("plate", response[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "plate", response[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

        _trigger_auto_review_async()
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
                    params={
                        "select": "*",
                        "car_id": f"eq.{car_id}",
                        "order": "uploaded_at.asc",
                    },
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
            from workers.auto_review_worker import run as _ar_run
            _ar_run()
        except Exception as exc:
            logger.warning("Auto-review immediate trigger failed: %s", exc)

    _threading.Thread(target=_run, daemon=True).start()


_APPROVAL_TABLE_BY_ITEM_TYPE = {
    "cars": "cars",
    "bikes": "bikes",
    "parts": "car_parts",
    "plates": "license_plates",
    "buying_requests": "buying_requests",
    "buying_request": "buying_requests",
}


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
    """Shared implementation used by admin approval route and the auto-review
    worker. Returns (ok: bool, payload: dict, http_status: int).

    actor: 'admin' | 'auto'.
    actor_id: user id (admin) or worker name (auto). Used only for logging.
    """
    table_name = _APPROVAL_TABLE_BY_ITEM_TYPE.get(item_type)
    if not table_name:
        return False, {"error": f"Invalid item type: {item_type}"}, 400

    patch_data = {"status": "approved", "is_approved": True}
    # Reset lifecycle state for all inventory listing types (not buying_requests,
    # which don't have expiry columns).
    _LIFECYCLE_TYPES = {"cars", "bikes", "parts", "plates"}
    if item_type in _LIFECYCLE_TYPES:
        import datetime as _dt
        _now = _dt.datetime.now(_dt.timezone.utc)
        _new_expires = _now + _dt.timedelta(days=LISTING_EXPIRY_DAYS)
        _new_retention = _new_expires + _dt.timedelta(days=LISTING_RETENTION_DAYS)
        patch_data.update({
            "expires_at": _new_expires.isoformat(),
            "retention_expires_at": _new_retention.isoformat(),
            "deleted_at": None,
            "expired_at": None,
            "is_archived": False,
            "sold_status": None,
            "sold_status_set_at": None,
            "auto_removed_at": None,
            "sold_response_deadline": None,
            "expiry_reminder_sent_at": None,
            "expired_email_sent_at": None,
        })
    if actor == "auto":
        patch_data["auto_review_state"] = "auto_approved"
        patch_data["auto_review_decided_at"] = _utc_now().isoformat()

    if dry_run:
        logger.info(
            "dry-run approval: actor=%s actor_id=%s type=%s id=%s",
            actor, actor_id, item_type, item_id,
        )
        return True, {"success": True, "dry_run": True}, 200

    response, status_code = supabase_request(
        "patch",
        f"/rest/v1/{table_name}?id=eq.{item_id}",
        data=patch_data,
        use_service_role=True,
    )

    if not (200 <= status_code < 300):
        logger.error(
            f"Error approving {item_type} {item_id}: {status_code} - {response}"
        )
        return False, {"error": f"Failed to approve {item_type}"}, status_code

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
    if listing:
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
                origin_header,
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

    # When the auto-review worker approves a listing, notify admins (informational)
    if actor == "auto" and listing:
        try:
            admin_user_email = listing.get("user_email") or listing.get("contact_email")
            if not admin_user_email:
                uid = listing.get("user_id")
                if uid:
                    admin_user_email = get_user_email(uid)
            _send_auto_approved_admin_notification(item_type, listing, admin_user_email)
        except Exception as _ae:
            logger.warning("Auto-approved admin notification failed: %s", _ae)

    logger.info(
        "%s %s approved %s %s",
        actor.capitalize(), actor_id, item_type, item_id,
    )
    _invalidate_public_inventory_cache(item_type)
    payload = {
        "success": True,
        "message": f"{item_type} approved successfully",
        "email_sent": email_sent,
    }
    if email_error:
        payload["email_error"] = "Approval email was not sent"
    return True, payload, 200


# Generic API approval/rejection endpoints for admin dashboard
@app.route("/api/<item_type>/<item_id>/approve", methods=["POST"])
@token_required
def api_approve_item(current_user, item_type, item_id):
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        _ok, payload, status_code = _perform_approval(
            item_type,
            item_id,
            actor="admin",
            actor_id=current_user,
            origin_header=request.headers.get("Origin"),
        )
        return jsonify(payload), status_code

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
            "buying_requests": "buying_requests",
            "buying_request": "buying_requests",
        }

        if item_type not in valid_item_types:
            return jsonify({"error": f"Invalid item type: {item_type}"}), 400

        table_name = valid_item_types[item_type]

        # Get rejection note from request if provided
        rejection_note = ""
        rejection_fix = ""
        if request.is_json and request.json:
            rejection_note = request.json.get("rejection_note", "")
            rejection_fix = request.json.get("rejection_fix", "")
        rejection_note = str(rejection_note or "").strip()
        if not rejection_note:
            return jsonify({"error": "Rejection reason is required"}), 400

        # Update the item status to rejected and add rejection note
        patch_data = {"status": "rejected", "rejection_note": rejection_note}

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
            if listing:
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
                        rejection_fix=rejection_fix,
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


@app.route("/api/admin/listings/<item_type>/<item_id>/vin-unlock", methods=["POST"])
@token_required
def admin_vin_unlock(current_user, item_type, item_id):
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        listing_meta = _admin_get_listing_meta(item_type)
        if not listing_meta:
            return jsonify({"error": "Invalid listing type"}), 400

        listing_rows, listing_status = supabase_request(
            "get",
            f"/rest/v1/{listing_meta['table']}",
            params={
                "select": "id,user_id,vin_number",
                "id": f"eq.{item_id}",
                "limit": 1,
            },
            use_service_role=True,
        )
        if listing_status >= 400:
            return jsonify({"error": "Failed to fetch listing"}), listing_status
        if not listing_rows:
            return jsonify({"error": "Listing not found"}), 404

        listing = listing_rows[0]
        owner_id = listing.get("user_id")
        if not owner_id:
            return jsonify({"error": "Listing owner not found"}), 400

        owner_profile = _get_user_profile_for_verification(owner_id) or {}
        if not _normalize_phone_number(
            owner_profile.get("phone"), owner_profile.get("country_code")
        ):
            return jsonify(
                {
                    "error": "Listing owner must have a valid phone number on file before VIN unlock can mark them verified."
                }
            ), 400

        _sync_user_verification_flags(
            owner_id,
            phone_verified=True,
            phone_verified_at=_isoformat_utc(_utc_now()),
            phone=owner_profile.get("phone"),
            country_code=owner_profile.get("country_code"),
        )

        return jsonify(
            {
                "success": True,
                "message": "VIN unlocked for listing owner",
                "listing_id": listing.get("id"),
                "owner_id": owner_id,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error unlocking VIN: {e}")
        return jsonify({"error": "Failed to unlock VIN"}), 500


@app.route("/api/admin/approve/<item_type>", methods=["GET"])
@token_required
def api_admin_list_items(current_user, item_type):
    """Token-auth admin listing endpoint used by React admin screens."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        table_name = ADMIN_ITEM_TYPE_TO_TABLE.get(item_type)
        if not table_name:
            return jsonify({"error": "Invalid item type"}), 400

        status = request.args.get("status", "pending")
        query_params = {"select": "*", "order": "created_at.desc"}
        if status:
            query_params["status"] = f"eq.{status}"

        response, status_code = supabase_request(
            "get",
            f"/rest/v1/{table_name}",
            params=query_params,
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch listings"}), status_code

        listings = response or []
        listing_ids = {
            str(item.get("id"))
            for item in listings
            if isinstance(item, dict) and item.get("id") is not None
        }

        lead_counts_by_listing = defaultdict(lambda: defaultdict(int))
        if listing_ids:
            normalized_listing_type = item_type.rstrip("s")
            lead_events, lead_status = supabase_request(
                "get",
                "/rest/v1/lead_events",
                params={
                    "select": "listing_id,action,created_at",
                    "listing_type": f"eq.{normalized_listing_type}",
                    "order": "created_at.desc",
                    "limit": "10000",
                },
                use_service_role=True,
            )
            if lead_status < 400:
                for event in lead_events or []:
                    listing_id = str(event.get("listing_id"))
                    if listing_id not in listing_ids:
                        continue
                    action = event.get("action") or "unknown"
                    lead_counts_by_listing[listing_id][action] += 1
            else:
                logger.warning(
                    f"Failed loading lead events for admin listing view: {lead_events}"
                )

        enriched_listings = []
        for item in listings:
            item_copy = dict(item) if isinstance(item, dict) else item
            if not isinstance(item_copy, dict):
                enriched_listings.append(item_copy)
                continue

            listing_id = str(item_copy.get("id"))
            counts = lead_counts_by_listing.get(listing_id, {})
            call_click = int(counts.get("call_click", 0))
            whatsapp_click = int(counts.get("whatsapp_click", 0))
            vin_open = int(counts.get("vin_open", 0))
            vin_reveal = int(counts.get("vin_reveal", 0))
            item_copy["lead_metrics"] = {
                "call_click": call_click,
                "whatsapp_click": whatsapp_click,
                "vin_open": vin_open,
                "vin_reveal": vin_reveal,
                "qualified_leads": call_click + whatsapp_click,
            }
            # Mirror listings-search: inject listing_type so frontend approve/reject uses correct table.
            item_copy.setdefault("listing_type", item_type)
            enriched_listings.append(item_copy)

        return jsonify(enriched_listings), 200
    except Exception as e:
        logger.error(f"Exception in api_admin_list_items: {e}")
        return jsonify({"error": "Failed to fetch listings"}), 500


@app.route("/api/admin/approve/<item_type>/<item_id>/approve", methods=["POST"])
@token_required
def api_admin_approve_item(current_user, item_type, item_id):
    return api_approve_item.__wrapped__(current_user, item_type, item_id)


@app.route("/api/admin/approve/<item_type>/<item_id>/reject", methods=["POST"])
@token_required
def api_admin_reject_item(current_user, item_type, item_id):
    return api_reject_item.__wrapped__(current_user, item_type, item_id)


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


@app.route("/api/analytics/events", methods=["POST"])
def track_platform_event():
    """Persist a raw platform analytics event."""
    try:
        payload = request.json or {}
        user_id = _get_optional_user_id_from_auth_header()
        try:
            canonical = normalize_analytics_event(payload, user_id)
        except AnalyticsEventError as exc:
            return jsonify({"error": str(exc)}), 400
        event_name = (payload.get("event_name") or payload.get("action") or "").strip()
        if not event_name:
            return jsonify({"error": "event_name is required"}), 400

        page_path = (
            payload.get("page_path") or payload.get("path") or "/"
        ).strip() or "/"
        classified = classify_platform_path(page_path)
        metadata = payload.get("metadata") or payload.get("payload") or {}
        if not isinstance(metadata, dict):
            metadata = {"value": metadata}

        session_id = (
            payload.get("session_id")
            or metadata.get("session_id")
            or payload.get("visitor_id")
            or payload.get("user_id")
            or str(uuid.uuid4())
        )
        visitor_id = (
            payload.get("visitor_id") or metadata.get("visitor_id") or session_id
        )
        user_id = canonical["user_id"]

        row = {
            "id": str(uuid.uuid4()),
            "event_id": canonical["event_id"],
            "event_name": event_name,
            "event_category": (
                payload.get("event_category")
                or metadata.get("event_category")
                or event_name
            ).strip(),
            "page_path": page_path,
            "page_title": payload.get("page_title") or metadata.get("page_title"),
            "page_kind": payload.get("page_kind") or metadata.get("page_kind"),
            "element_tag": payload.get("element_tag") or metadata.get("element_tag"),
            "element_text": payload.get("element_text") or metadata.get("element_text"),
            "target_url": payload.get("target_url") or metadata.get("target_url"),
            "listing_type": (
                payload.get("listing_type")
                or classified.get("listing_type")
                or metadata.get("listing_type")
                or ""
            ).rstrip("s")
            or None,
            "listing_id": str(
                payload.get("listing_id")
                or classified.get("listing_id")
                or metadata.get("listing_id")
                or ""
            )
            or None,
            "user_id": user_id,
            "visitor_id": canonical["visitor_id"] or str(visitor_id),
            "session_id": canonical["session_id"] or str(session_id),
            "platform": canonical["platform"],
            "occurred_at": canonical["occurred_at"],
            "received_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "duration_ms": int(
                payload.get("duration_ms") or metadata.get("duration_ms") or 0
            ),
            "metadata": canonical["metadata"],
        }
        if not row["page_kind"]:
            if row["listing_id"]:
                row["page_kind"] = "listing_detail"
            elif page_path.startswith("/admin"):
                row["page_kind"] = "admin"
            elif page_path.startswith("/post-") or page_path.startswith("/create"):
                row["page_kind"] = "post_form"
            elif page_path == "/":
                row["page_kind"] = "home"
            else:
                row["page_kind"] = "other"

        response, status_code = supabase_request(
            "post",
            "/rest/v1/platform_events",
            data=row,
            use_service_role=True,
        )
        if status_code >= 400 and (
            status_code == 404
            or "does not exist" in str(response).lower()
            or "relation" in str(response).lower()
        ):
            if not ensure_platform_events_table():
                return (
                    jsonify(
                        {
                            "error": "Analytics table missing. Apply backend/migrations/add_platform_analytics_tracking.sql to the live Supabase project."
                        }
                    ),
                    503,
                )

        if status_code >= 400:
            if status_code == 409 and "event_id" in str(response).lower():
                return jsonify({"success": True, "duplicate": True}), 200
            logger.error(f"Failed to store platform event: {response}")
            return jsonify({"error": "Failed to track event"}), 500

        return jsonify({"success": True}), 201
    except Exception as e:
        logger.error(f"Error tracking platform event: {e}")
        return jsonify({"error": "Failed to track event"}), 500


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


# ---------------------------------------------------------------------------
# Admin: email metrics endpoint
# ---------------------------------------------------------------------------

@app.route("/api/admin/metrics/email", methods=["GET"])
@token_required
def get_email_metrics(current_user):
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Unauthorized"}), 403

    days   = max(min(int(request.args.get("days", 30)), 365), 1)
    cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()

    _EMAIL_METRICS_TTL = 60
    _email_cache_key = f"api-cache:/api/admin/metrics/email?days={days}"
    _email_cached = _api_cache_get(_email_cache_key)
    if _email_cached is not None:
        return jsonify(_email_cached), 200
    if not _cache_lock_acquire(_email_cache_key):
        time.sleep(0.15)
        _email_cached = _api_cache_get(_email_cache_key)
        if _email_cached is not None:
            return jsonify(_email_cached), 200

    rows, status_code = supabase_request(
        "get",
        "/rest/v1/outbound_emails",
        params={
            "select": "email_type,sent_at,delivered_at,opened_at,clicked_at,bounced_at,unsubscribed_at,open_count,click_count,error_message",
            "sent_at": f"gte.{cutoff}",
            "order": "sent_at.desc",
            "limit": "5000",
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if _looks_like_missing_table(rows):
            return jsonify({"error": "outbound_emails table not migrated yet", "summary": {}, "by_type": [], "daily": []}), 200
        return jsonify({"error": "Failed to fetch email events"}), status_code

    rows = rows or []
    total         = len(rows)
    delivered     = sum(1 for r in rows if r.get("delivered_at"))
    opened        = sum(1 for r in rows if r.get("opened_at"))
    clicked       = sum(1 for r in rows if r.get("clicked_at"))
    bounced       = sum(1 for r in rows if r.get("bounced_at"))
    unsubscribed  = sum(1 for r in rows if r.get("unsubscribed_at"))
    errored       = sum(1 for r in rows if r.get("error_message"))

    # Per-type breakdown
    from collections import defaultdict
    by_type_map = defaultdict(lambda: {"sent": 0, "opened": 0, "clicked": 0, "bounced": 0})
    for r in rows:
        t = r.get("email_type") or "unknown"
        by_type_map[t]["sent"]    += 1
        by_type_map[t]["opened"]  += 1 if r.get("opened_at") else 0
        by_type_map[t]["clicked"] += 1 if r.get("clicked_at") else 0
        by_type_map[t]["bounced"] += 1 if r.get("bounced_at") else 0
    by_type = [
        {
            "type":       k,
            "sent":       v["sent"],
            "opened":     v["opened"],
            "clicked":    v["clicked"],
            "bounced":    v["bounced"],
            "open_rate":  round(v["opened"] / v["sent"] * 100, 1) if v["sent"] else 0,
            "click_rate": round(v["clicked"] / v["sent"] * 100, 1) if v["sent"] else 0,
        }
        for k, v in sorted(by_type_map.items(), key=lambda x: -x[1]["sent"])
    ]

    # Daily trend (sent count per day)
    daily_map = defaultdict(int)
    for r in rows:
        day = str(r.get("sent_at") or "")[:10]
        if day:
            daily_map[day] += 1
    daily = [{"date": d, "count": c} for d, c in sorted(daily_map.items())]

    _email_result = {
        "summary": {
            "total_sent":       total,
            "delivered":        delivered,
            "opened":           opened,
            "clicked":          clicked,
            "bounced":          bounced,
            "unsubscribed":     unsubscribed,
            "errored":          errored,
            "open_rate":        round(opened  / total * 100, 1) if total else 0,
            "click_rate":       round(clicked / total * 100, 1) if total else 0,
            "bounce_rate":      round(bounced / total * 100, 1) if total else 0,
        },
        "by_type": by_type,
        "daily":   daily,
    }
    _api_cache_set(_email_cache_key, _email_result, _EMAIL_METRICS_TTL)
    return jsonify(_email_result), 200


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


@app.route("/api/admin/metrics/errors", methods=["GET"])
@token_required
def get_error_metrics(current_user):
    """Recent silent errors/failures for the admin Errors tab."""
    user_details = _get_user_details_with_admin_status(current_user)
    if not user_details or not user_details.get("is_admin"):
        return jsonify({"error": "Unauthorized"}), 403

    days   = max(min(int(request.args.get("days", 30)), 365), 1)
    cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()

    rows, status_code = supabase_request(
        "get",
        "/rest/v1/app_errors",
        params={
            "select": "created_at,user_id,context,error_code,message,source,url",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": "1000",
        },
        use_service_role=True,
    )
    if status_code >= 400:
        if _looks_like_missing_table(rows):
            return jsonify({"error": "app_errors table not migrated yet", "summary": {}, "by_context": [], "recent": []}), 200
        return jsonify({"error": "Failed to fetch errors"}), status_code

    rows = rows or []
    from collections import defaultdict
    by_context_map = defaultdict(int)
    for r in rows:
        by_context_map[r.get("context") or "unknown"] += 1
    by_context = [
        {"context": k, "count": c}
        for k, c in sorted(by_context_map.items(), key=lambda x: -x[1])
    ]

    return jsonify({
        "summary": {
            "total":    len(rows),
            "frontend": sum(1 for r in rows if r.get("source") == "frontend"),
            "backend":  sum(1 for r in rows if r.get("source") != "frontend"),
        },
        "by_context": by_context,
        "recent":     rows[:200],
    }), 200


@app.route("/api/admin/metrics/overview", methods=["GET"])
@token_required
def get_admin_metrics_overview(current_user):
    """Return user, car, and plate analytics for the admin metrics page."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        days = max(min(int(request.args.get("days", 30)), 365), 1)
        cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()

        _OVERVIEW_METRICS_TTL = 60
        _overview_cache_key = f"api-cache:/api/admin/metrics/overview?days={days}"
        _overview_cached = _api_cache_get(_overview_cache_key)
        if _overview_cached is not None:
            return jsonify(_overview_cached), 200
        if not _cache_lock_acquire(_overview_cache_key):
            time.sleep(0.15)
            _overview_cached = _api_cache_get(_overview_cache_key)
            if _overview_cached is not None:
                return jsonify(_overview_cached), 200

        events_resp, events_status = _fetch_all_rows(
            "/rest/v1/platform_events",
            {
                "select": "*",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
            },
        )
        if events_status >= 400:
            return jsonify({"error": "Failed to fetch analytics events"}), events_status

        # Page through the full tables: a single request caps at PostgREST's
        # db-max-rows (~1000), which under-counted total_listings / GMV /
        # unique_sellers / new_users once a table crossed that threshold.
        car_rows_resp, car_status = _fetch_all_rows(
            "/rest/v1/cars",
            {
                "select": "id,car_manufacturer,car_model,make_year,body_type,vehicle_type,expected_selling_price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if car_status >= 400:
            car_rows_resp = []

        plate_rows_resp, plate_status = _fetch_all_rows(
            "/rest/v1/license_plates",
            {
                "select": "id,city,code,number,digits,price,plate_format,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if plate_status >= 400:
            plate_rows_resp = []

        bike_rows_resp, bike_status = _fetch_all_rows(
            "/rest/v1/bikes",
            {
                "select": "id,make,model,make_year,body_type,vehicle_type,price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if bike_status >= 400:
            bike_rows_resp = []

        part_rows_resp, part_status = _fetch_all_rows(
            "/rest/v1/car_parts",
            {
                "select": "id,title,name,price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
            },
        )
        if part_status >= 400:
            part_rows_resp = []

        user_rows_resp, user_status = _fetch_all_rows(
            "/rest/v1/users",
            {
                "select": "id,username,display_name,first_name,last_name,email,created_at,is_dealer,account_status,phone_verified,email_verified",
                "order": "created_at.desc",
            },
        )
        if user_status >= 400:
            user_rows_resp = []

        metrics = build_platform_metrics(
            events_resp or [],
            car_rows=car_rows_resp or [],
            plate_rows=plate_rows_resp or [],
            user_rows=user_rows_resp or [],
            bike_rows=bike_rows_resp or [],
            part_rows=part_rows_resp or [],
            days=days,
        )

        live_cutoff = _utc_now() - datetime.timedelta(minutes=5)
        live_visitor_ids = set()
        for event in events_resp or []:
            try:
                event_time = _parse_datetime(event.get("created_at"))
                if not event_time or event_time < live_cutoff:
                    continue
                live_visitor_ids.add(
                    str(
                        event.get("visitor_id")
                        or event.get("user_id")
                        or event.get("session_id")
                        or "anonymous"
                    )
                )
            except Exception:
                continue

        metrics["live_users"] = len(live_visitor_ids)
        metrics.setdefault("user_metrics", {})["live_users"] = len(live_visitor_ids)

        # When Cloudflare is configured, override the headline traffic numbers
        # with what the edge sees. Per-listing engagement (view_count, lead
        # events) and the bounce / conversion fields stay on platform_events
        # because Cloudflare can't tell us which listing got viewed. Admins
        # will see a "Source: Cloudflare" badge on the affected tiles.
        try:
            from services.cloudflare_analytics import (
                fetch_zone_metrics as _cf_fetch,
                is_enabled as _cf_enabled,
            )

            user_metrics = metrics.setdefault("user_metrics", {})
            if _cf_enabled():
                cf = _cf_fetch(days)
                if cf:
                    user_metrics["unique_visitors"] = cf["unique_visitors"]
                    user_metrics["page_views"] = cf["page_views"]
                    user_metrics["sessions"] = cf["unique_visitors"]
                    user_metrics["edge_requests"] = cf["requests"]
                    user_metrics["edge_threats"] = cf["threats"]
                    user_metrics["edge_cached_requests"] = cf["cached_requests"]
                    user_metrics["edge_bytes"] = cf["bytes"]
                    user_metrics["peak_daily_uniques"] = cf["peak_daily_uniques"]
                    user_metrics["data_source"] = "cloudflare"
                    user_metrics["unique_visitors_source"] = cf.get("unique_visitors_source")
                    # Daily chart series — preserve the platform_events one as
                    # `daily_trends_platform` in case the frontend wants both.
                    if user_metrics.get("daily_trends"):
                        user_metrics["daily_trends_platform"] = user_metrics["daily_trends"]
                    user_metrics["daily_trends"] = cf["daily_trends"]
                else:
                    user_metrics["data_source"] = "platform_events"
                    user_metrics["data_source_note"] = (
                        "Cloudflare configured but the API call failed; "
                        "showing platform_events numbers."
                    )
            else:
                user_metrics["data_source"] = "platform_events"
        except Exception as cf_err:
            logger.warning("Cloudflare metrics override skipped: %s", cf_err)
            metrics.setdefault("user_metrics", {})["data_source"] = "platform_events"

        _api_cache_set(_overview_cache_key, metrics, _OVERVIEW_METRICS_TTL)
        return jsonify(metrics), 200
    except Exception as e:
        logger.error(f"Error fetching admin metrics overview: {str(e)}")
        return jsonify({"error": "Failed to fetch admin metrics"}), 500


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


@app.route("/api/admin/live-users", methods=["GET"])
@token_required
def get_admin_live_users(current_user):
    """Return an approximate count of currently live visitors.

    Uses distinct `visitor_id` values seen in `platform_events` within the lookback window.
    """
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        lookback_seconds = int(request.args.get("window_seconds", 300))
        lookback_seconds = max(min(lookback_seconds, 1800), 30)
        # 15s cache. Live-users is polled every 15s from the mobile dashboard;
        # serving the same payload twice in a tight loop is wasteful.
        cache_key = f"api-cache:admin-live-users:window={lookback_seconds}"
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

        cutoff = (_utc_now() - datetime.timedelta(seconds=lookback_seconds)).isoformat()

        events_resp, status_code = supabase_request(
            "get",
            "/rest/v1/platform_events",
            params={
                "select": "visitor_id,created_at",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "5000",
            },
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch live visitors"}), status_code

        visitors = {
            str(row.get("visitor_id")).strip()
            for row in (events_resp or [])
            if row and str(row.get("visitor_id") or "").strip()
        }

        payload = {
            "window_seconds": lookback_seconds,
            "live_visitors": len(visitors),
            "timestamp": _isoformat_utc(_utc_now()),
        }
        _api_cache_set(cache_key, payload, ttl_seconds=15)
        return jsonify(payload), 200
    except Exception as exc:
        logger.error(f"Failed to compute live visitors: {exc}")
        return jsonify({"error": "Failed to compute live visitors"}), 500


@app.route("/api/admin/live-users/history", methods=["GET"])
@token_required
def get_admin_live_users_history(current_user):
    """Per-minute distinct-visitor buckets over a lookback window.

    Lets the admin dashboard sparkline render historical context instead of
    starting empty and only filling in after several poll cycles.

    Query params:
      window_seconds  total lookback (default 1800, clamped 300..3600)
      bucket_seconds  bucket width  (default 60,   clamped 30..300)

    Returns: { window_seconds, bucket_seconds, points: [{ts, value}, ...] }
    where `ts` is the bucket-start ISO timestamp and `value` is the count of
    distinct visitor_id values seen in that bucket.
    """
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        window_seconds = int(request.args.get("window_seconds", 1800))
        window_seconds = max(min(window_seconds, 3600), 300)
        bucket_seconds = int(request.args.get("bucket_seconds", 60))
        bucket_seconds = max(min(bucket_seconds, 300), 30)

        cache_key = (
            f"api-cache:admin-live-users-history:"
            f"w={window_seconds}:b={bucket_seconds}"
        )
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

        now = _utc_now()
        cutoff = now - datetime.timedelta(seconds=window_seconds)
        cutoff_iso = cutoff.isoformat()

        events_resp, status_code = supabase_request(
            "get",
            "/rest/v1/platform_events",
            params={
                "select": "visitor_id,created_at",
                "created_at": f"gte.{cutoff_iso}",
                "order": "created_at.asc",
                "limit": "20000",
            },
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch live visitor history"}), status_code

        # Build empty buckets covering the entire window so the chart shows
        # zeros for quiet minutes instead of a jagged line.
        bucket_count = max(1, window_seconds // bucket_seconds)
        # Align the right edge of the window to "now", then walk backwards.
        end_epoch = int(now.timestamp())
        # Bucket start = end_epoch - bucket_seconds * (bucket_count - i)
        bucket_starts = [
            end_epoch - bucket_seconds * (bucket_count - i)
            for i in range(bucket_count)
        ]
        buckets = {start: set() for start in bucket_starts}

        for row in events_resp or []:
            visitor_id = str(row.get("visitor_id") or "").strip()
            if not visitor_id:
                continue
            ts = _parse_datetime(row.get("created_at"))
            if ts is None:
                continue
            ts_epoch = int(ts.timestamp())
            # Floor to bucket boundary using the window-aligned grid.
            offset = end_epoch - ts_epoch
            if offset < 0 or offset >= window_seconds:
                continue
            bucket_index = bucket_count - 1 - (offset // bucket_seconds)
            if 0 <= bucket_index < bucket_count:
                buckets[bucket_starts[bucket_index]].add(visitor_id)

        points = [
            {
                "ts": _isoformat_utc(
                    datetime.datetime.fromtimestamp(start, tz=datetime.timezone.utc)
                ),
                "value": len(buckets[start]),
            }
            for start in bucket_starts
        ]

        payload = {
            "window_seconds": window_seconds,
            "bucket_seconds": bucket_seconds,
            "points": points,
        }
        # Cache for one bucket interval — refreshing more often is wasted work.
        _api_cache_set(cache_key, payload, ttl_seconds=bucket_seconds)
        return jsonify(payload), 200
    except Exception as exc:
        logger.error(f"Failed to compute live visitor history: {exc}")
        return jsonify({"error": "Failed to compute live visitor history"}), 500


@app.route("/api/health", methods=["GET"])
@app.route("/healthz", methods=["GET"])
def api_health():
    try:
        redis_health = check_redis_health()
        worker_health = get_worker_heartbeat()
        backend_health = {
            "ok": True,
            "status": "healthy",
            "message": "Backend API responding",
            "latency_ms": None,
            "checked_url": request.base_url,
        }
        snapshot = {
            "id": str(uuid.uuid4()),
            "checked_at": _isoformat_utc(_utc_now()),
            "source": "backend",
            "overall_status": "healthy"
            if redis_health.get("ok") and worker_health.get("ok")
            else "degraded",
            "frontend_status": "skipped",
            "backend_status": backend_health["status"],
            "redis_status": redis_health["status"],
            "worker_status": worker_health["status"],
            "frontend_latency_ms": None,
            "backend_latency_ms": None,
            "redis_latency_ms": redis_health.get("latency_ms"),
            "worker_latency_ms": None,
            "details": {
                "frontend": None,
                "backend": backend_health,
                "redis": redis_health,
                "worker": worker_health,
            },
        }
        # Keep this endpoint liveness-friendly for platform health checks.
        # The payload still reports degraded dependencies when Redis or the
        # worker is unavailable, but the container itself remains reachable.
        return jsonify(snapshot), 200
    except Exception as exc:
        logger.error(f"Health check failed: {exc}")
        return jsonify({"status": "down", "error": str(exc)}), 503


@app.route("/api/health/live", methods=["GET"])
@app.route("/healthz/live", methods=["GET"])
def api_health_live():
    try:
        return jsonify(
            {
                "status": "healthy",
                "service": "backend",
                "timestamp": _isoformat_utc(_utc_now()),
            }
        ), 200
    except Exception as exc:
        logger.error(f"Live health check failed: {exc}")
        return jsonify({"status": "down", "error": str(exc)}), 503


@app.route("/api/admin/health", methods=["GET"])
@token_required
def admin_health(current_user):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        live_snapshot = build_health_snapshot(include_frontend=True)
        latest_snapshot, snapshot_error = fetch_latest_health_snapshot()
        response_payload = {
            "current": live_snapshot,
            "latest": latest_snapshot,
            "latest_error": snapshot_error,
        }

        if live_snapshot.get("overall_status") != "healthy":
            send_health_alert(live_snapshot)

        return jsonify(response_payload), 200
    except Exception as exc:
        logger.error(f"Failed to build admin health payload: {exc}")
        return jsonify(
            {"error": "Failed to fetch health status", "details": str(exc)}
        ), 500


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


@app.route("/api/admin/stats", methods=["GET"])
@token_required
def get_admin_stats(current_user):
    """Return dashboard summary counts plus visitor totals."""
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        days = max(min(int(request.args.get("days", 30)), 90), 1)
        # 60s cache. This endpoint scans up to ~13k Supabase rows per call —
        # admin dashboards refresh on every focus, so without the cache each
        # operator session generates dozens of needless full table scans.
        cache_key = f"api-cache:admin-stats:days={days}"
        cached_payload = _api_cache_get(cache_key)
        if cached_payload is not None:
            return jsonify(cached_payload), 200

        now = _utc_now()
        window_start = now - datetime.timedelta(days=days)
        cutoff = window_start.isoformat()

        # platform_events: query directly so we can detect "table missing"
        # explicitly and feed that into data_health for the admin UI.
        platform_events = []
        platform_events_status = "ok"
        events_resp, events_status = _fetch_all_rows(
            "/rest/v1/platform_events",
            {
                "select": "event_name,visitor_id,user_id,session_id,page_kind,listing_type,created_at",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
            },
        )
        if events_status == 404 or (
            events_status >= 400 and "does not exist" in str(events_resp).lower()
        ):
            platform_events_status = "missing"
            logger.warning(
                "platform_events table is missing in production Supabase. "
                "Apply backend/migrations/add_platform_analytics_tracking.sql."
            )
        elif events_status >= 400:
            platform_events_status = "error"
            logger.warning(
                "platform_events query failed: status=%s body=%s", events_status, events_resp
            )
        else:
            platform_events = events_resp or []
            if not platform_events:
                platform_events_status = "empty"

        lead_events, lead_events_status = _fetch_all_rows(
            "/rest/v1/lead_events",
            {
                "select": "action,listing_type,listing_id,created_at,user_id,session_id",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
            },
        )
        if lead_events_status >= 400:
            logger.warning("lead_events query failed: status=%s", lead_events_status)
            lead_events = []

        aux_rows = {}
        aux_jobs = {
            "users": (
                "/rest/v1/users",
                {
                    "select": "id,created_at,is_dealer,dealer_verified",
                    "order": "created_at.desc",
                    "limit": "5000",
                },
            ),
            "reports": (
                "/rest/v1/reports",
                {
                    "select": "id,status,created_at",
                    "order": "created_at.desc",
                    "limit": "5000",
                },
            ),
            "saved_searches": (
                "/rest/v1/saved_searches",
                {
                    "select": "id,created_at",
                    "order": "created_at.desc",
                    "limit": "5000",
                },
            ),
            "listing_drafts": (
                "/rest/v1/listing_drafts",
                {
                    "select": "id,created_at,updated_at",
                    "order": "updated_at.desc",
                    "limit": "5000",
                },
            ),
        }
        with ThreadPoolExecutor(max_workers=len(aux_jobs)) as executor:
            future_map = {
                executor.submit(_fetch_rows, path, params): key
                for key, (path, params) in aux_jobs.items()
            }
            for future in as_completed(future_map):
                aux_rows[future_map[future]] = future.result()

        users = aux_rows.get("users", [])
        reports = aux_rows.get("reports", [])
        saved_searches = aux_rows.get("saved_searches", [])
        listing_drafts = aux_rows.get("listing_drafts", [])

        listing_rows_by_type = _fetch_listing_lifecycle_rows()
        listing_lifecycle = _build_listing_lifecycle_summary_from_rows(
            listing_rows_by_type,
            draft_total=len(listing_drafts),
        )
        lifecycle_totals = listing_lifecycle.get("totals", {})

        cars_total = len(listing_rows_by_type.get("cars", []))
        bikes_total = len(listing_rows_by_type.get("bikes", []))
        parts_total = len(listing_rows_by_type.get("parts", []))
        plates_total = len(listing_rows_by_type.get("plates", []))
        cars_pending = listing_lifecycle.get("by_type", {}).get("cars", {}).get("pending", 0)
        bikes_pending = listing_lifecycle.get("by_type", {}).get("bikes", {}).get("pending", 0)
        parts_pending = listing_lifecycle.get("by_type", {}).get("parts", {}).get("pending", 0)
        plates_pending = listing_lifecycle.get("by_type", {}).get("plates", {}).get("pending", 0)
        total_reports = len(reports)
        pending_reports = sum(
            1 for report in reports if str(report.get("status") or "").lower() == "pending"
        )
        saved_searches_total = len(saved_searches)
        saved_searches_window = sum(
            1
            for saved_search in saved_searches
            if (_parse_datetime(saved_search.get("created_at")) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc))
            >= window_start
        )
        total_users = len(users)
        total_dealers = sum(1 for user in users if user.get("is_dealer"))
        verified_dealers = sum(
            1
            for user in users
            if user.get("is_dealer") and user.get("dealer_verified")
        )
        platform_events_window_count = (
            _supabase_count("platform_events", {"created_at": f"gte.{cutoff}"})
            if platform_events_status == "ok"
            else 0
        )

        # Unique visitors: collapse all signal sources onto a canonical identity
        # key (auth user_id > visitor_id > session_id) so the same person showing
        # up across platform_events, lead_events, and the signups list counts
        # once. The previous pe:/le:/u: prefix scheme avoided in-source
        # collisions but inflated cross-source counts.
        unique_visitors = set()
        live_visitors = set()
        unique_sources = set()
        live_cutoff = now - datetime.timedelta(minutes=5)

        for event in platform_events:
            key = _canonical_visitor_key(event)
            if not key:
                # Row had no user_id / visitor_id / session_id — no identity, no visitor.
                # Previously bucketed under "pe:anonymous" which inflated the count by
                # collapsing all anonymous-no-ID traffic into a single fake visitor.
                continue
            unique_visitors.add(key)
            unique_sources.add("platform_events")
            event_time = _parse_datetime(event.get("created_at"))
            if event_time and event_time >= live_cutoff:
                live_visitors.add(key)

        # Source views from platform_events page_view rows tagged as
        # page_kind="listing_detail" — that's where PlatformAnalyticsTracker
        # writes them, with listing_type already parsed from page_path.
        view_counts_by_type = defaultdict(int)
        for event in platform_events:
            if (event.get("page_kind") or "").strip() != "listing_detail":
                continue
            listing_type = (event.get("listing_type") or "").strip().rstrip("s")
            if listing_type:
                view_counts_by_type[listing_type] += 1
            view_counts_by_type["__total__"] += 1

        lead_event_counts = defaultdict(int)       # raw event counts per action
        lead_unique_actors = defaultdict(set)      # unique actors per action
        # New interactions have a canonical event row. Count those first so
        # retries and the legacy compatibility insert cannot inflate leads.
        for event in platform_events:
            action = str(event.get("event_name") or "")
            if action not in LEAD_EVENT_ACTIONS:
                continue
            lead_event_counts[action] += 1
            key = _canonical_visitor_key(event)
            if key:
                lead_unique_actors[action].add(key)
                unique_visitors.add(key)
                unique_sources.add("platform_events")

        # ``lead_events`` is the historical source only. Every event emitted
        # after the canonical migration is written to both tables for legacy
        # integrations, so including it here would double-count contacts.
        for event in lead_events:
            created_at = _parse_datetime(event.get("created_at"))
            if created_at and created_at >= CANONICAL_ANALYTICS_CUTOVER_AT:
                continue
            action = str(event.get("action") or "unknown")
            if action not in LEAD_EVENT_ACTIONS:
                continue
            lead_event_counts[action] += 1
            key = _canonical_visitor_key(event)
            if key:
                lead_unique_actors[action].add(key)
                unique_visitors.add(key)
                unique_sources.add("lead_events")

        new_signups_in_window = 0
        for user in users:
            created_at = _parse_datetime(user.get("created_at"))
            if created_at and created_at >= window_start and user.get("id"):
                # users-table rows use `id` (not `user_id`), so we form the
                # canonical key inline rather than via _canonical_visitor_key.
                unique_visitors.add(f"v:{user['id']}")
                unique_sources.add("new_signups")
                new_signups_in_window += 1

        data_health = {
            "platform_events": platform_events_status,
            "platform_events_window_count": platform_events_window_count,
            "platform_events_truncated": events_status == 206,
            "unique_visitor_sources": sorted(unique_sources),
            "new_signups_window_count": new_signups_in_window,
            "lead_events_window_count": len(lead_events),
            "lead_events_truncated": lead_events_status == 206,
        }

        stats = {
            "cars_pending": cars_pending,
            "bikes_pending": bikes_pending,
            "parts_pending": parts_pending,
            "plates_pending": plates_pending,
            "cars_views": view_counts_by_type.get("car", 0),
            "bikes_views": view_counts_by_type.get("bike", 0),
            "parts_views": view_counts_by_type.get("part", 0),
            "plates_views": view_counts_by_type.get("plate", 0),
            "total_views": view_counts_by_type.get("__total__", 0),
            "total_users": total_users,
            "total_reports": total_reports,
            # Deduped: unique visitors who called/WhatsApp'd, not raw taps (a
            # single person tapping call 3x is 1 lead, not 3). Matches total_calls/
            # total_whatsapp and the dealer-KPI dedupe semantics.
            "total_leads": sum(len(lead_unique_actors.get(a, set())) for a in CONTACT_LEAD_ACTIONS),
            "total_calls": len(lead_unique_actors.get("call_click", set())),
            "total_call_events": lead_event_counts.get("call_click", 0),
            "total_whatsapp": len(lead_unique_actors.get("whatsapp_click", set())),
            "total_whatsapp_events": lead_event_counts.get("whatsapp_click", 0),
            "total_dealers": total_dealers,
            "unique_visitors": len(unique_visitors),
            "live_users": len(live_visitors),
            "data_health": data_health,
            "cars_total": cars_total,
            "bikes_total": bikes_total,
            "parts_total": parts_total,
            "plates_total": plates_total,
            "saved_searches_total": saved_searches_total,
            "saved_searches_window": saved_searches_window,
            "listing_lifecycle": listing_lifecycle,
            "sold_listings_total": lifecycle_totals.get("sold_total", 0),
            "sold_on_dph_total": lifecycle_totals.get("sold_on_dph", 0),
            "sold_elsewhere_total": lifecycle_totals.get("sold_elsewhere", 0),
            "no_response_total": lifecycle_totals.get("no_response", 0),
            "expired_listings_total": lifecycle_totals.get("expired", 0),
            "draft_listings_total": lifecycle_totals.get("draft", 0),
            "active_listings_total": lifecycle_totals.get("active", 0),
            "verified_dealers": verified_dealers,
            "pending_reports": pending_reports,
            "total_vin_reveals": len(lead_unique_actors.get("vin_reveal", set())),
            "total_vin_reveal_events": lead_event_counts.get("vin_reveal", 0),
        }
        stats["cropped_at_pct"] = _cached_cropped_at_pct()

        # Cloudflare override for the headline traffic tiles. Edge metrics are
        # truth for "how many real humans hit the domain" — platform_events only
        # sees clients that successfully loaded our JS, which under-counts.
        # We override unique_visitors/total_views/page_views and tag the source
        # so the dashboard can render a "Source: Cloudflare" badge. Per-listing
        # views (cars_views/bikes_views/etc.) stay platform_events because the
        # edge can't tell us which listing got viewed.
        stats["data_source"] = "platform_events"
        stats["data_source_note"] = None
        try:
            from services.cloudflare_analytics import (
                fetch_zone_metrics as _cf_fetch,
                is_enabled as _cf_enabled,
            )
            if _cf_enabled():
                cf = _cf_fetch(days)
                if cf:
                    stats["site_visitors_platform"] = stats["unique_visitors"]
                    stats["total_views_platform"] = stats["total_views"]
                    stats["unique_visitors"] = cf["unique_visitors"]
                    stats["page_views"] = cf["page_views"]
                    stats["edge_requests"] = cf["requests"]
                    stats["edge_threats"] = cf["threats"]
                    stats["edge_cached_requests"] = cf["cached_requests"]
                    stats["edge_bytes"] = cf["bytes"]
                    stats["peak_daily_uniques"] = cf["peak_daily_uniques"]
                    stats["data_source"] = "cloudflare"
                    # Which path produced unique_visitors: 'cf_rest' (truth),
                    # 'cf_graphql_estimate' (heuristic from daily uniques),
                    # 'none' (no data). Surfaced in the dashboard tooltip so
                    # operators know how trustworthy the number is.
                    stats["unique_visitors_source"] = cf.get("unique_visitors_source")
                else:
                    stats["data_source_note"] = (
                        "Cloudflare configured but the API call failed; "
                        "showing in-app platform_events numbers. "
                        "Hit /api/admin/cloudflare/status to debug."
                    )
            else:
                stats["data_source_note"] = (
                    "Cloudflare not configured. Set CLOUDFLARE_API_TOKEN plus "
                    "CLOUDFLARE_ACCOUNT_ID (or CLOUDFLARE_ZONE_ID) to switch to "
                    "edge-truth visitor numbers."
                )
        except Exception as cf_err:
            logger.warning("Cloudflare override on admin stats skipped: %s", cf_err)

        _api_cache_set(cache_key, stats, ttl_seconds=60)
        return jsonify(stats), 200
    except Exception as exc:
        logger.error(f"Error fetching admin stats: {exc}")
        return jsonify({"error": "Failed to fetch admin stats"}), 500


@app.route("/api/listings/<item_type>/<item_id>/lead-events", methods=["POST"])
def track_listing_lead_event(item_type, item_id):
    """Track listing lead interactions (call, WhatsApp, VIN opens)."""
    try:
        normalized_type = item_type.rstrip("s")
        table_name = _resolve_listing_table(normalized_type)
        if not table_name:
            return jsonify({"error": "Invalid listing type"}), 400

        payload = request.json or {}
        action = (payload.get("action") or "").strip()
        if action not in LEAD_EVENT_ACTIONS:
            return jsonify({"error": "Invalid action"}), 400

        listing_resp, listing_status = supabase_request(
            "get",
            f"/rest/v1/{table_name}",
            params={"id": f"eq.{item_id}", "select": "id,user_id", "limit": 1},
            use_service_role=True,
        )
        if listing_status >= 400:
            return jsonify({"error": "Failed to validate listing"}), listing_status
        if not listing_resp:
            return jsonify({"error": "Listing not found"}), 404

        user_id = _get_optional_user_id_from_auth_header()
        try:
            canonical = normalize_analytics_event({
                **payload, "event_name": action, "listing_type": normalized_type,
                "listing_id": item_id, "metadata": {"source": payload.get("source")},
            }, user_id)
        except AnalyticsEventError as exc:
            return jsonify({"error": str(exc)}), 400
        canonical_response, canonical_status = supabase_request(
            "post", "/rest/v1/rpc/record_analytics_event", data={
                "p_event_id": canonical["event_id"], "p_event_name": canonical["event_name"],
                "p_listing_type": canonical["listing_type"], "p_listing_id": canonical["listing_id"],
                "p_visitor_id": canonical["visitor_id"], "p_session_id": canonical["session_id"],
                "p_user_id": canonical["user_id"], "p_platform": canonical["platform"],
                "p_occurred_at": canonical["occurred_at"], "p_metadata": canonical["metadata"],
            }, use_service_role=True)
        if canonical_status >= 400:
            logger.error("Failed to store canonical lead event: %s", canonical_response)
            return jsonify({"error": "Failed to track lead event"}), 500
        event_payload = {
            "listing_id": str(item_id),
            "listing_type": normalized_type,
            "action": action,
            "user_id": user_id,
            "session_id": canonical["session_id"],
            "source": payload.get("source"),
            "user_agent": request.headers.get("User-Agent"),
            "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            "payload": payload.get("payload") or {},
        }

        response, status_code = supabase_request(
            "post",
            "/rest/v1/lead_events",
            data=event_payload,
            use_service_role=True,
        )
        if status_code >= 400:
            logger.error(f"Failed to track lead event: {response}")
            return jsonify({"error": "Failed to track lead event"}), status_code

        # Real-time push to the seller only on direct-contact intent (call /
        # WhatsApp), and only when the actor isn't the owner previewing. VIN
        # opens are higher-frequency / lower-intent, so they don't push — keeps
        # sellers from being spammed. Best-effort — never blocks the response.
        # ponytail: no per-listing debounce; add one if a hot listing spams the seller.
        owner_id = (listing_resp[0] or {}).get("user_id")
        if owner_id and owner_id != user_id and action in ("call_click", "whatsapp_click"):
            verb = "called about" if action == "call_click" else "messaged you on WhatsApp about"
            # Background daemon thread so a slow Expo call (up to 10s) never
            # blocks the buyer's request. _notify_user_push is self-contained
            # (service-role Supabase + Expo HTTP), no Flask request context needed.
            threading.Thread(
                target=_notify_user_push,
                args=(owner_id, "New buyer interest 🚗",
                      f"Someone just {verb} your {normalized_type} listing."),
                kwargs={"data": {"listing_type": normalized_type, "listing_id": str(item_id)}},
                daemon=True,
            ).start()

        if user_id:
            capture_posthog_event(
                "lead_contacted",
                user_id,
                {"listing_type": normalized_type, "contact_method": action},
            )
        return jsonify({"message": "Lead event tracked"}), 201
    except Exception as e:
        logger.error(f"Error tracking lead event: {e}")
        return jsonify({"error": "Failed to track lead event"}), 500


@app.route("/api/user/listings/<item_type>/<item_id>/outcome", methods=["POST"])
@token_required
def set_listing_outcome(current_user, item_type, item_id):
    """Handle listing outcome popup action after expiry."""
    _PLURAL_TO_SINGULAR = {"cars": "car", "bikes": "bike", "parts": "part", "plates": "plate"}
    item_type = _PLURAL_TO_SINGULAR.get(item_type, item_type)
    config = LISTING_TABLE_CONFIG.get(item_type)
    if not config:
        return jsonify({"error": "Invalid listing type"}), 400

    data = request.json or {}
    outcome = (data.get("outcome") or "").strip()
    if outcome not in LISTING_OUTCOME_OPTIONS:
        return jsonify({"error": "Invalid outcome"}), 400

    listing_resp, listing_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "select": "*", "limit": 1},
        user_id=current_user,
    )
    if listing_status >= 400:
        return jsonify({"error": "Failed to fetch listing"}), listing_status
    if not listing_resp:
        return jsonify({"error": "Listing not found"}), 404

    listing = listing_resp[0]
    if listing.get("user_id") != current_user:
        return jsonify(
            {"error": "You do not have permission to update this listing"}
        ), 403

    if _is_listing_deleted(listing):
        return jsonify({"error": "Listing is no longer available"}), 410
    _apply_listing_lifecycle_metadata(listing)

    now = _utc_now()
    updates = {
        "sold_status": outcome,
        "sold_status_set_at": _isoformat_utc(now),
    }

    if outcome == "not_sold_renew":
        refreshed, refreshed_status, refresh_error = _renew_listing_and_verify(
            config["table"],
            item_id,
            listing,
            current_user=current_user,
        )
        if refreshed_status >= 400:
            return jsonify(refresh_error or {"error": "Failed to renew listing"}), refreshed_status

        _invalidate_public_inventory_cache(config["table"])

        try:
            user_email = refreshed.get("user_email") or refreshed.get("contact_email")
            if not user_email:
                user_email = get_user_email(current_user)
            if user_email and EMAIL_REGEX.match(user_email):
                _send_listing_status_email(
                    user_email,
                    item_type,
                    refreshed,
                    "renewed",
                    request.headers.get("Origin"),
                )
        except Exception as email_err:
            logger.error(f"Error sending renewal email: {email_err}")

        return jsonify({"message": "Listing outcome saved", "listing": refreshed}), 200

    if outcome == "move_to_draft":
        expiry_anchor = _parse_datetime(listing.get("expires_at")) or now
        if expiry_anchor < now:
            expiry_anchor = now
        new_expires_at = expiry_anchor + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
        lifecycle_updates = _resubmission_listing_lifecycle_fields()
        lifecycle_updates["expires_at"] = _isoformat_utc(new_expires_at)
        lifecycle_updates["retention_expires_at"] = _isoformat_utc(
            new_expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
        )
        updates.update(
            {
                "status": "draft",
                "sold_status": None,
                "sold_status_set_at": None,
                "expired_at": None,
                "retention_expires_at": lifecycle_updates["retention_expires_at"],
                "sold_response_deadline": None,
                "auto_removed_at": None,
                "last_extended_at": lifecycle_updates["last_extended_at"],
                "is_archived": False,
                "expires_at": lifecycle_updates["expires_at"],
            }
        )
        if config["table"] == "cars":
            updates["is_approved"] = False
    else:
        updates.update(
            {
                "status": "sold",
                "sold_response_deadline": None,
            }
        )

    patch_resp, patch_status = supabase_request(
        "patch",
        f"/rest/v1/{config['table']}?id=eq.{item_id}",
        data=updates,
        use_service_role=True,
    )
    if patch_status >= 400:
        return jsonify({"error": "Failed to update listing outcome"}), patch_status

    _invalidate_public_inventory_cache(config["table"])

    if isinstance(patch_resp, list) and patch_resp:
        refreshed = patch_resp[0]
        _apply_listing_lifecycle_metadata(refreshed)
        return jsonify({"message": "Listing outcome saved", "listing": refreshed}), 200
    if isinstance(patch_resp, dict) and patch_resp:
        _apply_listing_lifecycle_metadata(patch_resp)
        return jsonify({"message": "Listing outcome saved", "listing": patch_resp}), 200

    refreshed_resp, refreshed_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "select": "*", "limit": 1},
        use_service_role=True,
    )
    if refreshed_status < 400 and refreshed_resp:
        refreshed = refreshed_resp[0]
        _apply_listing_lifecycle_metadata(refreshed)

        return jsonify({"message": "Listing outcome saved", "listing": refreshed}), 200

    return jsonify({"message": "Listing outcome saved"}), 200


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

        try:
            reporter_details = _get_user_email_by_id(current_user)
            reporter_email = reporter_details.get("email") if reporter_details else None
            inserted_report = response[0] if isinstance(response, list) and response else report_data
            _send_report_admin_notification(inserted_report, reporter_email=reporter_email)
        except Exception as email_err:
            logger.warning(f"Report admin notification failed: {email_err}")

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
    """Get all reports for admin dashboard, enriched with listing details."""
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        # Get query parameters for filtering
        status = request.args.get("status")
        listing_type_filter = request.args.get("listing_type")
        try:
            limit = int(request.args.get("limit", "100"))
        except (TypeError, ValueError):
            limit = 100
        limit = min(max(limit, 1), 500)

        # Build query — hard cap at 500
        query = f"/rest/v1/reports?order=created_at.desc&limit={limit}"

        if status:
            query += f"&status=eq.{status}"
        if listing_type_filter:
            query += f"&listing_type=eq.{listing_type_filter}"

        response, status_code = supabase_request(
            "get", query, user_id=current_user, use_service_role=True
        )

        if status_code >= 400:
            logger.error(f"Failed to fetch admin reports: {response}")
            return jsonify({"error": "Failed to fetch reports"}), status_code

        reports = response if isinstance(response, list) else []

        # ── Enrich reports with listing details ───────────────────────────────
        # Bucket report rows by listing_type (skip bug type)
        buckets = {"car": [], "bike": [], "plate": [], "part": []}
        for r in reports:
            lt = str(r.get("listing_type") or "").lower()
            if lt in buckets and r.get("listing_id"):
                buckets[lt].append(r)

        # Helper: build a readable title from a listing row
        def _listing_title(lt, row):
            if lt == "car":
                parts = [row.get("make_year"), row.get("car_manufacturer"), row.get("car_model")]
                parts = [str(p) for p in parts if p]
                return " ".join(parts) if parts else str(row.get("id", ""))
            if lt == "bike":
                parts = [row.get("year"), row.get("bike_brand"), row.get("bike_model")]
                parts = [str(p) for p in parts if p]
                return " ".join(parts) if parts else str(row.get("id", ""))
            if lt == "plate":
                code = row.get("code") or ""
                number = row.get("number") or ""
                return f"{code} {number}".strip() or str(row.get("id", ""))
            if lt == "part":
                return row.get("part_name") or row.get("name") or str(row.get("id", ""))
            return str(row.get("id", ""))

        # Per-type: fetch listing rows in one batch per type
        listing_map = {}  # listing_id -> enriched dict
        all_seller_ids = set()

        for lt, rows in buckets.items():
            if not rows:
                continue
            cfg = ADMIN_REPORT_TYPE_CONFIG[lt]
            ids = list({r["listing_id"] for r in rows})
            ids_csv = ",".join(ids)
            try:
                lst_resp, lst_sc = supabase_request(
                    "get",
                    f"/rest/v1/{cfg['table']}?id=in.({ids_csv})&select={cfg['select']}",
                    user_id=current_user,
                    use_service_role=True,
                )
                if lst_sc < 400 and isinstance(lst_resp, list):
                    for row in lst_resp:
                        lid = str(row.get("id", ""))
                        uid = str(row.get("user_id") or "")
                        if uid:
                            all_seller_ids.add(uid)
                        listing_map[lid] = {
                            "_lt": lt,
                            "_row": row,
                            "id": lid,
                            "title": _listing_title(lt, row),
                            "price": row.get("expected_selling_price") or row.get("price"),
                            "image_url": None,
                            "seller_email": None,
                            "public_url": f"{cfg['public_prefix']}/{lid}",
                            "user_id": uid,
                        }
                else:
                    logger.warning(f"Listing batch fetch failed for type={lt}: {lst_sc}")
            except Exception as sub_err:
                logger.warning(f"Error fetching listing batch type={lt}: {sub_err}")

            # Fetch thumbnails for this type in one batch
            try:
                img_resp, img_sc = supabase_request(
                    "get",
                    f"/rest/v1/{cfg['img_table']}?{cfg['img_fk']}=in.({ids_csv})&select={cfg['img_fk']},url,display_url,image_url,cropped_at&limit=1000",
                    user_id=current_user,
                    use_service_role=True,
                )
                if img_sc < 400 and isinstance(img_resp, list):
                    # Keep only first image per listing_id
                    seen_img = set()
                    for img_row in img_resp:
                        img_lid = str(img_row.get(cfg["img_fk"]) or "")
                        if img_lid and img_lid not in seen_img:
                            seen_img.add(img_lid)
                            if img_lid in listing_map:
                                listing_map[img_lid]["image_url"] = (
                                    img_row.get("display_url")
                                    or img_row.get("image_url")
                                    or img_row.get("url")
                                )
            except Exception as img_err:
                logger.warning(f"Error fetching image batch type={lt}: {img_err}")

        # Collect all user IDs (sellers + reporters)
        reporter_ids = set()
        for r in reports:
            rid = str(r.get("reporter_id") or "")
            if rid:
                reporter_ids.add(rid)

        all_user_ids = all_seller_ids | reporter_ids
        user_email_map = {}  # user_id -> {id, email, first_name, last_name}

        if all_user_ids:
            try:
                uids_csv = ",".join(all_user_ids)
                users_resp, users_sc = supabase_request(
                    "get",
                    f"/rest/v1/users?id=in.({uids_csv})&select=id,email,first_name,last_name",
                    user_id=current_user,
                    use_service_role=True,
                )
                if users_sc < 400 and isinstance(users_resp, list):
                    for u in users_resp:
                        uid = str(u.get("id") or "")
                        if uid:
                            user_email_map[uid] = u
                else:
                    logger.warning(f"Users batch fetch failed: {users_sc}")
            except Exception as usr_err:
                logger.warning(f"Error fetching users batch: {usr_err}")

        # Attach seller_email to listing_map entries
        for entry in listing_map.values():
            uid = entry.get("user_id", "")
            if uid and uid in user_email_map:
                entry["seller_email"] = user_email_map[uid].get("email")

        # Attach listing + reporter to each report row
        for r in reports:
            lt = str(r.get("listing_type") or "").lower()
            lid = str(r.get("listing_id") or "")
            if lt != "bug" and lid and lid in listing_map:
                entry = listing_map[lid]
                r["listing"] = {
                    "id": entry["id"],
                    "title": entry["title"],
                    "price": entry["price"],
                    "image_url": entry["image_url"],
                    "seller_email": entry["seller_email"],
                    "public_url": entry["public_url"],
                }
            else:
                r["listing"] = None

            reporter_id = str(r.get("reporter_id") or "")
            if reporter_id and reporter_id in user_email_map:
                r["reporter"] = {
                    "id": reporter_id,
                    "email": user_email_map[reporter_id].get("email"),
                }
            else:
                r["reporter"] = {"id": reporter_id, "email": None} if reporter_id else None

        return jsonify(reports), 200

    except Exception as e:
        logger.error(f"Error fetching admin reports: {str(e)}")
        return jsonify({"error": "An error occurred while fetching reports"}), 500


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


@app.route("/api/admin/lead-metrics", methods=["GET"])
@token_required
def get_admin_lead_metrics(current_user):
    """Admin lead metrics summary + recent events."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        days = max(min(int(request.args.get("days", 30)), 365), 1)
        cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()
        # 1. Fetch ALL lead events for the period (only action column for efficiency) to get accurate totals
        leads_total_resp, leads_total_status = supabase_request(
            "get",
            "/rest/v1/lead_events",
            params={
                "select": "action",
                "created_at": f"gte.{cutoff}",
            },
            use_service_role=True,
        )

        # 2. Fetch RECENT lead events for the list
        leads_recent_resp, leads_recent_status = supabase_request(
            "get",
            "/rest/v1/lead_events",
            params={
                "select": "*",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "100",
            },
            use_service_role=True,
        )

        if leads_total_status >= 400:
            return jsonify(
                {"error": "Failed to fetch lead metrics"}
            ), leads_total_status

        reports_resp, reports_status = supabase_request(
            "get",
            "/rest/v1/reports",
            params={
                "select": "id,listing_id,listing_type,status,created_at",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "100",
            },
            use_service_role=True,
        )
        if reports_status >= 400:
            reports_resp = []

        totals = defaultdict(int)
        for event in leads_total_resp or []:
            totals[event.get("action") or "unknown"] += 1

        leads_per_listing = defaultdict(int)
        # Calculate leads per listing based on RECENT events (for top listings)
        # Note: If we want this to be for ALL events, we'd need to fetch more data,
        # but for top listings, recent data is usually what's shown.
        for event in leads_recent_resp or []:
            listing_key = f"{event.get('listing_type')}:{event.get('listing_id')}"
            if event.get("action") in {"call_click", "whatsapp_click"}:
                leads_per_listing[listing_key] += 1

        leads_recent_resp = _admin_enrich_activity_rows(leads_recent_resp, "user_id")

        report_count = len(reports_resp or [])
        qualified_leads = totals["call_click"] + totals["whatsapp_click"]
        conversion_rate = (
            round((report_count / qualified_leads) * 100, 2)
            if qualified_leads > 0
            else 0
        )

        return jsonify(
            {
                "window_days": days,
                "totals": {
                    "call_click": totals["call_click"],
                    "whatsapp_click": totals["whatsapp_click"],
                    "vin_open": totals["vin_open"],
                    "vin_reveal": totals["vin_reveal"],
                    "qualified_leads": qualified_leads,
                    "reports_created": report_count,
                    "report_conversion_percent": conversion_rate,
                },
                "recent_events": leads_recent_resp or [],
                "recent_reports": reports_resp or [],
            }
        ), 200
    except Exception as e:
        logger.error(f"Error fetching lead metrics: {str(e)}")
        return jsonify({"error": "Failed to fetch lead metrics"}), 500


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


@app.route("/api/admin/reddit-import-analytics", methods=["GET"])
@token_required
def get_admin_reddit_import_analytics(current_user):
    """Import health + Reddit outbound-open engagement for imported listings.

    Admin-only. Returns no IP/user-agent, raw event metadata, access token,
    post body, or seller contact — only aggregate counters and safe titles/links.
    """
    if not _require_admin_api_user(current_user):
        return jsonify({"error": "Unauthorized - Admin access required"}), 403
    try:
        days = max(min(int(request.args.get("days", 30)), 90), 1)
        cache_key = f"api-cache:admin-reddit-import-analytics:days={days}"
        cached = _api_cache_get(cache_key)
        if cached is not None:
            return jsonify(cached), 200
        cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()

        # 1. Imported listings across every category: totals, live/removed, links.
        _REDDIT_TABLES = [
            ("cars", "car", "listing_title"),
            ("bikes", "bike", None),  # title built from make/model
            ("license_plates", "plate", "listing_title"),
            ("car_parts", "part", "name"),
        ]
        listing_by_id = {}
        total = live = total_views = 0
        for table, ltype, title_col in _REDDIT_TABLES:
            select_cols = ["id", "source_url", "source_removed_at", "view_count"]
            if title_col:
                select_cols.append(title_col)
            if table == "bikes":
                select_cols += ["make", "model"]
            rows, _s = _fetch_all_rows(
                f"/rest/v1/{table}",
                {"select": ",".join(select_cols), "source_platform": "eq.reddit",
                 "order": "source_last_seen_at.desc"},
            )
            for r in (rows or []):
                total += 1
                if not r.get("source_removed_at"):
                    live += 1
                total_views += int(r.get("view_count") or 0)
                if title_col:
                    title = r.get(title_col)
                else:
                    title = " ".join(x for x in [r.get("make"), r.get("model")] if x) or None
                listing_by_id[str(r.get("id"))] = {
                    "title": title, "source_url": r.get("source_url"),
                    "views": int(r.get("view_count") or 0), "listing_type": ltype,
                }

        # 2. reddit_post_open events in the window (any imported category).
        events, _ev_status = _fetch_all_rows(
            "/rest/v1/platform_events",
            {
                "select": "listing_id,visitor_id,occurred_at",
                "event_name": "eq.reddit_post_open",
                "occurred_at": f"gte.{cutoff}",
                "order": "occurred_at.desc",
            },
        )
        events = events or []
        opens_total = len(events)
        unique_visitors = len({e.get("visitor_id") for e in events if e.get("visitor_id")})
        daily = defaultdict(int)
        per_listing = defaultdict(int)
        for event in events:
            day = (event.get("occurred_at") or "")[:10]
            if day:
                daily[day] += 1
            listing_id = str(event.get("listing_id") or "")
            if listing_id:
                per_listing[listing_id] += 1
        daily_opens = [{"date": day, "count": daily[day]} for day in sorted(daily)]
        top_listings = []
        for listing_id, opens in sorted(per_listing.items(), key=lambda kv: -kv[1])[:5]:
            item = listing_by_id.get(listing_id, {})
            top_listings.append({
                "listing_id": listing_id,
                "title": item.get("title") or "(listing removed)",
                "listing_type": item.get("listing_type"),
                "source_url": item.get("source_url"),
                "views": int(item.get("views") or 0),
                "opens": opens,
            })

        # 3. Latest import run health.
        run_rows, _run_status = supabase_request(
            "get",
            "/rest/v1/reddit_import_runs",
            params={"select": "*", "order": "started_at.desc", "limit": "1"},
            use_service_role=True,
        )
        latest_run = run_rows[0] if isinstance(run_rows, list) and run_rows else None

        payload = {
            "window_days": days,
            "listings": {"total": total, "live": live, "removed": total - live, "views": total_views},
            "opens": {"total": opens_total, "unique_visitors": unique_visitors},
            "daily_opens": daily_opens,
            "top_listings": top_listings,
            "latest_run": latest_run,
        }
        _api_cache_set(cache_key, payload, ttl_seconds=60)
        return jsonify(payload), 200
    except Exception as exc:
        logger.error("Failed to load Reddit import analytics: %s", exc)
        return jsonify({"error": "Failed to fetch Reddit import analytics"}), 500


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


@app.route("/api/user/lead-metrics", methods=["GET"])
@token_required
def get_user_lead_metrics(current_user):
    """Lead metrics scoped to listings owned by the authenticated user."""
    try:
        days = max(min(int(request.args.get("days", 30)), 365), 1)
        cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()

        owned_listing_ids = defaultdict(set)
        for listing_type, config in LISTING_TABLE_CONFIG.items():
            listing_rows, listing_status = supabase_request(
                "get",
                f"/rest/v1/{config['table']}",
                params={
                    "select": "id",
                    "user_id": f"eq.{current_user}",
                    "limit": "1000",
                },
                use_service_role=True,
            )
            if listing_status >= 400:
                logger.warning(
                    f"Failed loading {listing_type} listings for user {current_user}: {listing_rows}"
                )
                continue

            for row in listing_rows or []:
                listing_id = row.get("id")
                if listing_id is not None:
                    owned_listing_ids[listing_type].add(str(listing_id))

        if not any(owned_listing_ids.values()):
            return jsonify(
                {
                    "window_days": days,
                    "totals": {
                        "call_click": 0,
                        "whatsapp_click": 0,
                        "vin_open": 0,
                        "vin_reveal": 0,
                        "qualified_leads": 0,
                    },
                    "recent_events": [],
                }
            ), 200

        leads_resp, leads_status = supabase_request(
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
        if leads_status >= 400:
            return jsonify({"error": "Failed to fetch lead metrics"}), leads_status

        user_events = []
        totals = defaultdict(int)
        for event in leads_resp or []:
            listing_type = (event.get("listing_type") or "").rstrip("s")
            listing_id = str(event.get("listing_id"))
            if listing_id in owned_listing_ids.get(listing_type, set()):
                user_events.append(event)
                totals[event.get("action") or "unknown"] += 1

        return jsonify(
            {
                "window_days": days,
                "totals": {
                    "call_click": totals["call_click"],
                    "whatsapp_click": totals["whatsapp_click"],
                    "vin_open": totals["vin_open"],
                    "vin_reveal": totals["vin_reveal"],
                    "qualified_leads": totals["call_click"] + totals["whatsapp_click"],
                },
                "recent_events": user_events[:100],
            }
        ), 200
    except Exception as e:
        logger.error(f"Error fetching user lead metrics: {str(e)}")
        return jsonify({"error": "Failed to fetch lead metrics"}), 500


@app.route("/api/admin/listing-history", methods=["GET"])
@token_required
def get_admin_listing_history(current_user):
    """Admin history of auto/user/admin removed listings, enriched with
    title, price, and first-image thumbnail per row so the dashboard can
    render a meaningful card instead of just a UUID."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        limit = max(min(int(request.args.get("limit", 200)), 500), 1)
        response, status_code = supabase_request(
            "get",
            "/rest/v1/listing_deletion_events",
            params={
                "select": "*",
                "order": "created_at.desc",
                "limit": str(limit),
                "reason": f"neq.{LISTING_EXPIRY_NOTICE_REASON}",
            },
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch listing history"}), status_code

        rows = response or []

        # ── Enrich with listing title/price/image ───────────────────────────
        type_config = {
            "car": {
                "table": "cars",
                "select": "id,car_model,car_manufacturer,make_year,expected_selling_price",
                "img_table": "car_images",
                "img_fk": "car_id",
            },
            "bike": {
                "table": "bikes",
                "select": "id,bike_model,bike_brand,year,price,expected_selling_price",
                "img_table": "bike_images",
                "img_fk": "bike_id",
            },
            "plate": {
                "table": "license_plates",
                "select": "id,number,code,city,price",
                "img_table": "plate_images",
                "img_fk": "plate_id",
            },
            "part": {
                "table": "car_parts",
                "select": "id,name,part_name,category,price",
                "img_table": "part_images",
                "img_fk": "part_id",
            },
        }

        def _title(lt, lrow):
            if lt == "car":
                parts = [lrow.get("make_year"), lrow.get("car_manufacturer"), lrow.get("car_model")]
                return " ".join(str(p) for p in parts if p) or str(lrow.get("id", ""))
            if lt == "bike":
                parts = [lrow.get("year"), lrow.get("bike_brand"), lrow.get("bike_model")]
                return " ".join(str(p) for p in parts if p) or str(lrow.get("id", ""))
            if lt == "plate":
                code = lrow.get("code") or ""
                number = lrow.get("number") or ""
                return f"{code} {number}".strip() or str(lrow.get("id", ""))
            if lt == "part":
                return lrow.get("part_name") or lrow.get("name") or str(lrow.get("id", ""))
            return str(lrow.get("id", ""))

        # Bucket history rows by listing type
        buckets = {"car": [], "bike": [], "plate": [], "part": []}
        for r in rows:
            lt = str(r.get("listing_type") or "").lower()
            if lt in buckets and r.get("listing_id"):
                buckets[lt].append(r)

        # Per type: batch-fetch listing rows + first image, attach to each
        # history entry. Missing rows (truly deleted) get image_url=None and
        # the frontend will fall back to a placeholder + the listing_id.
        for lt, lt_rows in buckets.items():
            if not lt_rows:
                continue
            cfg = type_config[lt]
            ids = list({r["listing_id"] for r in lt_rows})
            ids_csv = ",".join(ids)
            listing_lookup = {}
            try:
                lst_resp, lst_sc = supabase_request(
                    "get",
                    f"/rest/v1/{cfg['table']}?id=in.({ids_csv})&select={cfg['select']}",
                    user_id=current_user,
                    use_service_role=True,
                )
                if lst_sc < 400 and isinstance(lst_resp, list):
                    for lrow in lst_resp:
                        lid = str(lrow.get("id", ""))
                        listing_lookup[lid] = {
                            "title": _title(lt, lrow),
                            "price": lrow.get("expected_selling_price") or lrow.get("price"),
                            "image_url": None,
                        }
            except Exception as sub_err:
                logger.warning(
                    f"listing-history enrichment listing fetch failed type={lt}: {sub_err}"
                )

            try:
                img_resp, img_sc = supabase_request(
                    "get",
                    (
                        f"/rest/v1/{cfg['img_table']}"
                        f"?{cfg['img_fk']}=in.({ids_csv})"
                        f"&select={cfg['img_fk']},url,image_url,display_url,cropped_at&limit=1000"
                    ),
                    user_id=current_user,
                    use_service_role=True,
                )
                if img_sc < 400 and isinstance(img_resp, list):
                    seen = set()
                    for img_row in img_resp:
                        ilid = str(img_row.get(cfg["img_fk"]) or "")
                        if not ilid or ilid in seen:
                            continue
                        seen.add(ilid)
                        if ilid in listing_lookup:
                            listing_lookup[ilid]["image_url"] = (
                                img_row.get("display_url")
                                or img_row.get("image_url")
                                or img_row.get("url")
                            )
            except Exception as img_err:
                logger.warning(
                    f"listing-history enrichment image fetch failed type={lt}: {img_err}"
                )

            for r in lt_rows:
                lid = str(r.get("listing_id") or "")
                meta = listing_lookup.get(lid)
                if meta:
                    r["title"] = meta["title"]
                    r["price"] = meta["price"]
                    r["image_url"] = meta["image_url"]
                else:
                    # Listing row no longer exists; show ID + no image so the
                    # frontend can render a placeholder.
                    r["title"] = None
                    r["price"] = None
                    r["image_url"] = None

        return jsonify(rows), 200
    except Exception as e:
        logger.error(f"Error fetching listing history: {e}")
        return jsonify({"error": "Failed to fetch listing history"}), 500


def _listing_source_kind(row):
    """Classify a listing by who posted it: reddit import, dealer, or member."""
    if str(row.get("source_platform") or "").lower() == "reddit":
        return "reddit"
    if row.get("is_dealer"):
        return "dealer"
    return "member"


@app.route("/api/admin/listings-search", methods=["GET"])
@token_required
def admin_listings_search(current_user):
    """Unified admin listing search for moderation and lifecycle views."""
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        raw_types = request.args.get("types", "")
        raw_statuses = request.args.get("statuses", "")
        requested_sources = {
            (value or "").strip().lower()
            for value in request.args.get("source", "").split(",")
            if (value or "").strip() and (value or "").strip().lower() != "all"
        } & {"member", "dealer", "reddit"}

        requested_types = [
            (value or "").strip().lower()
            for value in raw_types.split(",")
            if (value or "").strip()
        ]
        requested_statuses = [
            (value or "").strip().lower()
            for value in raw_statuses.split(",")
            if (value or "").strip()
        ]

        type_map = {
            "car": "car",
            "cars": "car",
            "bike": "bike",
            "bikes": "bike",
            "part": "part",
            "parts": "part",
            "plate": "plate",
            "plates": "plate",
            "draft": "drafts",
            "drafts": "drafts",
            "buying_request": "buying_request",
            "buying_requests": "buying_request",
        }
        if requested_types:
            normalized_types = [
                type_map[value] for value in requested_types if value in type_map
            ]
        else:
            normalized_types = list(LISTING_TABLE_CONFIG.keys()) + ["drafts"]

        if not requested_statuses or "all" in requested_statuses:
            requested_statuses = []

        try:
            _req_limit = int(request.args.get("limit", "100"))
        except (ValueError, TypeError):
            _req_limit = 100
        per_type_limit = min(max(_req_limit, 1), 200)
        include_verification = (
            str(request.args.get("include_verification", "")).strip().lower()
            in {"1", "true", "yes"}
        )

        listings = []
        counts = defaultdict(int)

        for listing_type in normalized_types:
            if listing_type == "drafts":
                rows, status_code = supabase_request(
                    "get",
                    "/rest/v1/listing_drafts",
                    params={
                        "select": "id,user_id,draft_key,payload,created_at,updated_at",
                        "order": "updated_at.desc",
                        "limit": str(per_type_limit),
                    },
                    use_service_role=True,
                )
                if status_code >= 400:
                    logger.warning("Failed to fetch admin drafts: %s", rows)
                    continue

                draft_rows = rows or []
                owner_map = _admin_fetch_user_display_map(
                    [row.get("user_id") for row in draft_rows if row.get("user_id")]
                )

                for row in draft_rows:
                    try:
                        owner_row = owner_map.get(str(row.get("user_id"))) if row.get("user_id") else None
                        draft_listing = _build_draft_listing_summary(row, owner_row=owner_row)
                        draft_listing["source_kind"] = "member"
                        if requested_sources and "member" not in requested_sources:
                            continue
                        if requested_statuses and not any(
                            _admin_listing_matches_status(draft_listing, status)
                            for status in requested_statuses
                        ):
                            continue
                        counts["total"] += 1
                        counts["draft"] += 1
                        listings.append(draft_listing)
                    except Exception as draft_err:
                        logger.exception(
                            "admin_listings_search: failed processing draft %s — %s",
                            (row or {}).get("id"),
                            draft_err,
                        )
                        continue
                continue

            config = LISTING_TABLE_CONFIG.get(listing_type)
            if not config:
                continue

            rows, status_code = supabase_request(
                "get",
                f"/rest/v1/{config['table']}",
                params={
                    "select": ADMIN_LISTING_SELECTS.get(listing_type, "*"),
                    "order": "created_at.desc",
                    "limit": str(per_type_limit),
                },
                use_service_role=True,
            )
            if status_code >= 400:
                logger.warning(
                    "Failed to fetch admin listings for %s: %s", listing_type, rows
                )
                continue

            for row in rows or []:
                # Defensively isolate per-row work so a single malformed listing
                # cannot 500 the whole admin page.
                try:
                    preview = _preview_listing_record(row)
                    if not preview:
                        continue

                    if listing_type == "car":
                        preview["images"] = _sort_listing_images(preview.pop("car_images", []) or [])
                    elif listing_type == "bike":
                        preview["images"] = _sort_listing_images(preview.pop("bike_images", []) or [])
                    elif listing_type == "part":
                        preview["images"] = _sort_listing_images(preview.pop("part_images", []) or [])
                    else:
                        preview["images"] = preview.get("images") or []
                    if not preview["images"] and (
                        preview.get("display_url") or preview.get("image_url") or preview.get("url")
                    ):
                        main_url = (
                            preview.get("display_url")
                            or preview.get("image_url")
                            or preview.get("url")
                        )
                        preview["images"] = [
                            {"id": "main", "url": main_url, "image_url": main_url}
                        ]

                    display_status = _admin_listing_display_status(preview)
                    preview["display_status"] = display_status
                    preview["listing_type"] = f"{listing_type}s" if listing_type != "part" else "parts"
                    preview["_table_status"] = preview.get("status")
                    preview["source_kind"] = _listing_source_kind(preview)

                    if requested_sources and preview["source_kind"] not in requested_sources:
                        continue
                    if requested_statuses and not any(
                        _admin_listing_matches_status(preview, status)
                        for status in requested_statuses
                    ):
                        continue

                    counts["total"] += 1
                    counts[preview.get("_table_status") or "unknown"] += 1
                    if preview.get("listing_state") == "active":
                        counts["active"] += 1
                    if preview.get("listing_state") in {"expired", "archived"}:
                        counts["expired"] += 1

                    listings.append(preview)
                except Exception as row_err:
                    logger.exception(
                        "admin_listings_search: failed processing %s/%s — %s",
                        config["table"], (row or {}).get("id"), row_err,
                    )
                    continue

        if include_verification:
            try:
                latest_scan_map = _admin_fetch_latest_verification_scans(
                    [
                        (listing.get("listing_type"), listing.get("id"))
                        for listing in listings
                    ]
                )
                for listing in listings:
                    _admin_attach_latest_verification_scan(listing, latest_scan_map)
            except Exception as scan_err:
                logger.exception(
                    "admin_listings_search: verification scan enrichment failed — %s",
                    scan_err,
                )

        return jsonify({"listings": listings, "metadata": dict(counts)}), 200
    except Exception as e:
        logger.exception("Error searching admin listings: %s", e)
        return jsonify({"error": "Failed to search listings"}), 500


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


@app.route("/api/admin/users/<user_id>/overview", methods=["GET"])
@token_required
def get_admin_user_overview(current_user, user_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        user_row = _admin_fetch_user_rows(user_id)
        if not user_row:
            return jsonify({"error": "User not found"}), 404

        listing_summary, recent_listings, owned_listing_ids = (
            _admin_collect_owned_listing_stats(user_id)
        )
        activity = _admin_collect_user_events(user_id, owned_listing_ids)

        total_views = sum(bucket["views"] for bucket in listing_summary.values())
        total_listings = sum(bucket["count"] for bucket in listing_summary.values())
        active_listings = sum(bucket["approved"] for bucket in listing_summary.values())
        pending_listings = sum(bucket["pending"] for bucket in listing_summary.values())

        recent_reports = activity["reports"]
        lead_totals = activity["lead_totals"]

        return jsonify(
            {
                "user": user_row,
                "summary": {
                    "total_listings": total_listings,
                    "active_listings": active_listings,
                    "pending_listings": pending_listings,
                    "total_views": total_views,
                    "call_clicks": int(lead_totals.get("call_click", 0)),
                    "whatsapp_clicks": int(lead_totals.get("whatsapp_click", 0)),
                    "vin_opens": int(lead_totals.get("vin_open", 0)),
                    "qualified_leads": int(lead_totals.get("call_click", 0))
                    + int(lead_totals.get("whatsapp_click", 0)),
                    "report_count": len(recent_reports),
                },
                "listing_summary": listing_summary,
                "recent_listings": recent_listings,
                "recent_events": activity["recent_events"],
                "recent_reports": recent_reports,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error fetching admin user overview for {user_id}: {e}")
        return jsonify({"error": "Failed to fetch user overview"}), 500


@app.route("/api/admin/listings/<item_type>/<item_id>/overview", methods=["GET"])
@token_required
def get_admin_listing_overview(current_user, item_type, item_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        meta = _admin_get_listing_meta(item_type)
        if not meta:
            return jsonify({"error": "Invalid listing type"}), 400

        listing_rows, listing_status = supabase_request(
            "get",
            f"/rest/v1/{meta['table']}",
            params={"id": f"eq.{item_id}", "select": "*", "limit": "1"},
            use_service_role=True,
        )
        if listing_status >= 400 or not listing_rows:
            return jsonify({"error": "Listing not found"}), 404

        listing = listing_rows[0]
        listing["listing_type"] = item_type
        owner_id = listing.get("user_id")
        owner_row = _admin_fetch_user_rows(owner_id) if owner_id else None

        images_rows, images_status = supabase_request(
            "get",
            f"/rest/v1/{meta['images_table']}",
            params={
                "select": "*",
                meta["fk"]: f"eq.{item_id}",
                "order": "uploaded_at.asc",
            },
            use_service_role=True,
        )
        if images_status >= 400:
            images_rows = []

        lead_events, lead_status = supabase_request(
            "get",
            "/rest/v1/lead_events",
            params={
                "select": "*",
                "listing_id": f"eq.{item_id}",
                "listing_type": f"eq.{item_type.rstrip('s')}",
                "order": "created_at.desc",
                "limit": "100",
            },
            use_service_role=True,
        )
        if lead_status >= 400:
            lead_events = []

        lead_events = _admin_enrich_activity_rows(lead_events, "user_id")

        report_rows, report_status = supabase_request(
            "get",
            "/rest/v1/reports",
            params={
                "select": "*",
                "listing_id": f"eq.{item_id}",
                "listing_type": f"eq.{item_type.rstrip('s')}",
                "order": "created_at.desc",
                "limit": "100",
            },
            use_service_role=True,
        )
        if report_status >= 400:
            report_rows = []

        deletion_rows, deletion_status = supabase_request(
            "get",
            "/rest/v1/listing_deletion_events",
            params={
                "select": "*",
                "listing_id": f"eq.{item_id}",
                "listing_type": f"eq.{item_type.rstrip('s')}",
                "order": "created_at.desc",
                "limit": "50",
            },
            use_service_role=True,
        )
        if deletion_status >= 400:
            deletion_rows = []
        else:
            deletion_rows = [
                row
                for row in deletion_rows or []
                if str(row.get("reason") or "") != LISTING_EXPIRY_NOTICE_REASON
            ]

        _admin_attach_latest_verification_scan(listing)
        latest_verification_scan = listing.get("latest_verification_scan")
        verification_status = listing.get("verification_status") or {}

        lead_totals = defaultdict(int)
        for event in lead_events or []:
            lead_totals[event.get("action") or "unknown"] += 1

        return jsonify(
            {
                "listing": listing,
                "owner": owner_row,
                "images": images_rows or [],
                "summary": {
                    "view_count": int(
                        listing.get("view_count") or listing.get("views") or 0
                    ),
                    "call_clicks": int(lead_totals.get("call_click", 0)),
                    "whatsapp_clicks": int(lead_totals.get("whatsapp_click", 0)),
                    "vin_opens": int(lead_totals.get("vin_open", 0)),
                    "qualified_leads": int(lead_totals.get("call_click", 0))
                    + int(lead_totals.get("whatsapp_click", 0)),
                    "report_count": len(report_rows or []),
                    "deletion_count": len(deletion_rows or []),
                },
                "lead_events": lead_events or [],
                "reports": report_rows or [],
                "deletion_events": deletion_rows or [],
                "latest_verification_scan": latest_verification_scan,
                "verification_status": verification_status,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error fetching listing overview for {item_type}/{item_id}: {e}")
        return jsonify({"error": "Failed to fetch listing overview"}), 500


@app.route("/api/admin/dealers/<dealer_id>/overview", methods=["GET"])
@token_required
def get_admin_dealer_overview(current_user, dealer_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        dealer_row = _admin_fetch_user_rows(dealer_id)
        if not dealer_row:
            return jsonify({"error": "Dealer not found"}), 404

        listing_summary, recent_listings, owned_listing_ids = (
            _admin_collect_owned_listing_stats(dealer_id)
        )
        activity = _admin_collect_user_events(dealer_id, owned_listing_ids)

        dealer_bucket_total = sum(
            bucket["count"] for bucket in listing_summary.values()
        )
        dealer_views_total = sum(bucket["views"] for bucket in listing_summary.values())
        lead_totals = activity["lead_totals"]

        return jsonify(
            {
                "dealer": dealer_row,
                "summary": {
                    "total_listings": dealer_bucket_total,
                    "total_views": dealer_views_total,
                    "call_clicks": int(lead_totals.get("call_click", 0)),
                    "whatsapp_clicks": int(lead_totals.get("whatsapp_click", 0)),
                    "vin_opens": int(lead_totals.get("vin_open", 0)),
                    "qualified_leads": int(lead_totals.get("call_click", 0))
                    + int(lead_totals.get("whatsapp_click", 0)),
                    "recent_reports": len(activity["reports"]),
                },
                "listing_summary": listing_summary,
                "recent_listings": recent_listings,
                "recent_events": activity["recent_events"],
                "reports": activity["reports"],
            }
        ), 200
    except Exception as e:
        logger.error(f"Error fetching dealer overview for {dealer_id}: {e}")
        return jsonify({"error": "Failed to fetch dealer overview"}), 500


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
        query += "&select=id,email,first_name,last_name,company_name,company_registration_number,trade_license_number,is_dealer,dealer_verified,dealer_verified_at,created_at,phone,city,emirate,profile_completion_percentage,company_documents,verification_documents_submitted"

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
        rejection_fix = ""
        if request.is_json and request.json:
            rejection_note = request.json.get("rejection_note", "")
            rejection_fix = request.json.get("rejection_fix", "")

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
                    rejection_fix=rejection_fix,
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


@app.route("/api/admin/dealers/<dealer_id>/documents", methods=["GET"])
@token_required
def get_admin_dealer_documents(current_user, dealer_id):
    """Get all documents for a specific dealer"""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{dealer_id}&select=*&order=uploaded_at.desc",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": "Failed to fetch documents"}), 500

        return jsonify({"documents": resp.json()}), 200
    except Exception as e:
        logger.error(f"Error fetching dealer documents: {str(e)}")
        return jsonify({"error": "Failed to fetch documents"}), 500


@app.route("/api/admin/dealer-documents/<doc_id>/review", methods=["POST"])
@token_required
def review_dealer_document(current_user, doc_id):
    """Approve or deny a specific dealer document"""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        data = request.json
        action = data.get("action")
        if action not in ("approve", "deny"):
            return jsonify({"error": "action must be 'approve' or 'deny'"}), 400

        denial_reason = data.get("denial_reason", "")
        denial_fix = data.get("denial_fix", "")

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }

        doc_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{doc_id}&select=*,users:user_id(email,first_name,last_name,company_name)",
            headers=headers,
            timeout=10,
        )
        if doc_resp.status_code != 200 or not doc_resp.json():
            return jsonify({"error": "Document not found"}), 404

        doc = doc_resp.json()[0]
        from datetime import datetime

        update_fields = {
            "status": "approved" if action == "approve" else "denied",
            "reviewed_at": datetime.utcnow().isoformat(),
            "reviewed_by": current_user,
        }
        if action == "deny":
            update_fields["denial_reason"] = denial_reason
            update_fields["denial_fix"] = denial_fix

        update_resp = requests.patch(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{doc_id}",
            headers={**headers, "Prefer": "return=representation"},
            json=update_fields,
            timeout=10,
        )

        if update_resp.status_code not in [200, 204]:
            logger.error(f"Failed to update document: {update_resp.text}")
            return jsonify({"error": "Failed to update document"}), 500

        if action == "deny":
            user_data = doc.get("users", {})
            dealer_email = (
                user_data.get("email") if isinstance(user_data, dict) else None
            )
            if dealer_email:
                doc_type_nice = {
                    "trade_license": "Trade License",
                    "company_registration": "Company Registration",
                    "tax_registration": "Tax Registration (TRN)",
                }.get(doc.get("document_type", ""), doc.get("document_type", ""))

                try:
                    _send_document_denial_email(
                        dealer_email,
                        doc_type_nice,
                        denial_reason,
                        denial_fix,
                        request.headers.get("Origin"),
                    )
                except Exception as email_err:
                    logger.error(f"Document denial email failed: {email_err}")

        logger.info(f"Admin {current_user} {action}d document {doc_id}")
        return jsonify(
            {"success": True, "message": f"Document {action}d successfully"}
        ), 200

    except Exception as e:
        logger.error(f"Error reviewing document: {str(e)}")
        return jsonify({"error": "Failed to review document"}), 500


# ─── Admin "request more info" dealer flow ────────────────────────────────────

DEALER_INFO_REQUEST_TTL_DAYS = int(os.getenv("DEALER_INFO_REQUEST_TTL_DAYS", "14"))


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


@app.route("/api/admin/dealers/<dealer_id>/info-requests", methods=["POST"])
@token_required
def create_dealer_info_request(current_user, dealer_id):
    """Admin creates a request asking a dealer to upload additional documents."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        body = request.get_json(silent=True) or {}
        documents_raw = body.get("documents") or []
        if not isinstance(documents_raw, list):
            return jsonify({"error": "documents must be a list of strings"}), 400
        documents = [str(d).strip() for d in documents_raw if str(d).strip()][:20]
        if not documents:
            return jsonify({"error": "At least one document label is required"}), 400
        message = (body.get("message") or "").strip()[:2000] or None

        # Resolve dealer email
        dealer_resp, dealer_status = supabase_request(
            "get",
            f"/rest/v1/users",
            params={"select": "email,first_name,last_name,company_name", "id": f"eq.{dealer_id}", "limit": 1},
            use_service_role=True,
        )
        if dealer_status >= 400 or not dealer_resp:
            return jsonify({"error": "Dealer not found"}), 404
        dealer = dealer_resp[0]
        dealer_email = dealer.get("email")
        dealer_name = (
            dealer.get("company_name")
            or " ".join(filter(None, [dealer.get("first_name"), dealer.get("last_name")])).strip()
            or None
        )

        token = secrets.token_urlsafe(32)
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=DEALER_INFO_REQUEST_TTL_DAYS)
        insert_payload = {
            "dealer_user_id": dealer_id,
            "requested_by": current_user,
            "requested_documents": documents,
            "message": message,
            "token": token,
            "status": "pending",
            "expires_at": _isoformat_utc(expires_at),
        }
        created_resp, created_status = supabase_request(
            "post",
            "/rest/v1/dealer_info_requests",
            data=insert_payload,
            use_service_role=True,
        )
        if created_status >= 400 or not created_resp:
            logger.error(f"Failed to create info request: {created_status} - {created_resp}")
            return jsonify({"error": "Failed to create info request"}), 500
        created = created_resp[0] if isinstance(created_resp, list) else created_resp

        base_url = _get_safe_frontend_origin(request.headers.get("Origin")).rstrip("/")
        link_url = f"{base_url}/dealer-info-request/{token}"

        if dealer_email:
            _, email_error = _send_info_request_email(
                dealer_email, dealer_name, documents, message, link_url
            )
            if email_error:
                logger.error(f"Info-request email failed for dealer {dealer_id}: {email_error}")

        logger.info(f"Admin {current_user} created info request {created.get('id')} for dealer {dealer_id}")
        return jsonify({
            "id": created.get("id"),
            "token": token,
            "link_url": link_url,
            "documents": documents,
            "message": message,
            "expires_at": created.get("expires_at"),
            "status": created.get("status"),
            "created_at": created.get("created_at"),
        }), 201
    except Exception as e:
        logger.exception("Error creating dealer info request")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/dealers/<dealer_id>/info-requests", methods=["GET"])
@token_required
def list_dealer_info_requests(current_user, dealer_id):
    """List all info requests for a dealer (admin only)."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        reqs_resp, reqs_status = supabase_request(
            "get",
            "/rest/v1/dealer_info_requests",
            params={
                "select": "*,dealer_info_request_uploads(*)",
                "dealer_user_id": f"eq.{dealer_id}",
                "order": "created_at.desc",
            },
            use_service_role=True,
        )
        if reqs_status >= 400:
            return jsonify({"error": "Failed to fetch info requests"}), 500
        return jsonify({"requests": reqs_resp or []}), 200
    except Exception as e:
        logger.exception("Error listing dealer info requests")
        return jsonify({"error": str(e)}), 500


@app.route("/api/admin/info-requests/<request_id>/cancel", methods=["POST"])
@token_required
def cancel_dealer_info_request(current_user, request_id):
    """Admin cancels a pending info request."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        update_resp, update_status = supabase_request(
            "patch",
            "/rest/v1/dealer_info_requests",
            params={"id": f"eq.{request_id}", "status": "eq.pending"},
            data={"status": "cancelled"},
            use_service_role=True,
        )
        if update_status >= 400:
            return jsonify({"error": "Failed to cancel info request"}), 500
        return jsonify({"success": True}), 200
    except Exception as e:
        logger.exception("Error cancelling info request")
        return jsonify({"error": str(e)}), 500


@app.route("/api/info-requests/<token>", methods=["GET"])
def get_public_info_request(token):
    """Public lookup of an info request by token. Returns the requested
    document list, current uploads, and basic status. No auth required —
    the token IS the authorization."""
    try:
        if not token or len(token) < 16:
            return jsonify({"error": "Invalid token"}), 404

        reqs_resp, reqs_status = supabase_request(
            "get",
            "/rest/v1/dealer_info_requests",
            params={
                "select": "id,requested_documents,message,status,expires_at,submitted_at,created_at,dealer_user_id,dealer_info_request_uploads(id,document_label,filename,file_type,url,uploaded_at)",
                "token": f"eq.{token}",
                "limit": 1,
            },
            use_service_role=True,
        )
        if reqs_status >= 400 or not reqs_resp:
            return jsonify({"error": "Not found"}), 404
        req = reqs_resp[0]

        # Auto-expire
        try:
            exp = datetime.datetime.fromisoformat(
                str(req["expires_at"]).replace("Z", "+00:00")
            )
            if exp < datetime.datetime.now(datetime.timezone.utc) and req["status"] == "pending":
                supabase_request(
                    "patch",
                    "/rest/v1/dealer_info_requests",
                    params={"id": f"eq.{req['id']}"},
                    data={"status": "expired"},
                    use_service_role=True,
                )
                req["status"] = "expired"
        except Exception:
            pass

        # Resolve dealer display name (don't leak email)
        dealer_resp, dealer_status = supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "select": "first_name,company_name",
                "id": f"eq.{req['dealer_user_id']}",
                "limit": 1,
            },
            use_service_role=True,
        )
        dealer_name = None
        if dealer_status < 400 and dealer_resp:
            dealer = dealer_resp[0]
            dealer_name = dealer.get("company_name") or dealer.get("first_name") or None

        return jsonify({
            "id": req["id"],
            "documents": req.get("requested_documents") or [],
            "message": req.get("message"),
            "status": req.get("status"),
            "expires_at": req.get("expires_at"),
            "submitted_at": req.get("submitted_at"),
            "dealer_name": dealer_name,
            "uploads": req.get("dealer_info_request_uploads") or [],
        }), 200
    except Exception as e:
        logger.exception("Error fetching public info request")
        return jsonify({"error": "Failed to load request"}), 500


@app.route("/api/info-requests/<token>/upload", methods=["POST"])
def upload_public_info_request(token):
    """Public file upload against an info request token. Multipart with
    'document_label' (str) and 'file'. Marks the request as 'submitted'
    once at least one file exists for every requested document label."""
    try:
        if not token or len(token) < 16:
            return jsonify({"error": "Invalid token"}), 404

        reqs_resp, reqs_status = supabase_request(
            "get",
            "/rest/v1/dealer_info_requests",
            params={
                "select": "id,dealer_user_id,requested_documents,status,expires_at",
                "token": f"eq.{token}",
                "limit": 1,
            },
            use_service_role=True,
        )
        if reqs_status >= 400 or not reqs_resp:
            return jsonify({"error": "Not found"}), 404
        req = reqs_resp[0]

        if req["status"] not in ("pending", "submitted"):
            return jsonify({"error": f"Request is {req['status']}"}), 409

        try:
            exp = datetime.datetime.fromisoformat(
                str(req["expires_at"]).replace("Z", "+00:00")
            )
            if exp < datetime.datetime.now(datetime.timezone.utc):
                supabase_request(
                    "patch",
                    "/rest/v1/dealer_info_requests",
                    params={"id": f"eq.{req['id']}"},
                    data={"status": "expired"},
                    use_service_role=True,
                )
                return jsonify({"error": "This request has expired"}), 410
        except Exception:
            pass

        document_label = (request.form.get("document_label") or "").strip()
        if not document_label:
            return jsonify({"error": "document_label is required"}), 400
        if document_label not in (req.get("requested_documents") or []):
            return jsonify({"error": "document_label is not part of this request"}), 400

        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files["file"]
        if not file or not file.filename:
            return jsonify({"error": "No file selected"}), 400

        content_type = (file.content_type or "").lower()
        if content_type not in DEALER_DOCUMENT_ALLOWED_MIME_TYPES:
            return jsonify({"error": "Invalid file type. Allowed: JPG, PNG, PDF"}), 400

        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES:
            return jsonify({
                "error": f"File too large. Maximum size: {DEALER_DOCUMENT_FILE_SIZE_LIMIT_BYTES // (1024 * 1024)}MB"
            }), 400

        if not ensure_storage_bucket("dealer-documents"):
            return jsonify({"error": "Storage bucket not available"}), 500

        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        safe_dealer_id = re.sub(r"[^a-zA-Z0-9_-]", "_", str(req["dealer_user_id"]))
        object_path = f"{safe_dealer_id}/info-requests/{req['id']}/{uuid.uuid4().hex}.{ext}"

        upload_url = f"{SUPABASE_URL}/storage/v1/object/dealer-documents/{object_path}"
        upload_response = requests.post(
            upload_url,
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=file.read(),
            timeout=30,
        )
        if upload_response.status_code not in (200, 201):
            logger.error(
                f"Info-request upload failed: {upload_response.status_code} - {upload_response.text[:300]}"
            )
            return jsonify({"error": "Failed to upload file"}), 500

        public_url = f"{SUPABASE_URL}/storage/v1/object/public/dealer-documents/{object_path}"
        record_resp, record_status = supabase_request(
            "post",
            "/rest/v1/dealer_info_request_uploads",
            data={
                "request_id": req["id"],
                "document_label": document_label,
                "filename": secure_filename(file.filename),
                "file_type": content_type,
                "storage_path": object_path,
                "url": public_url,
            },
            use_service_role=True,
        )
        if record_status >= 400:
            logger.error(f"Failed to record info-request upload: {record_resp}")
            return jsonify({"error": "Upload recorded partially. Please retry."}), 500

        # If every requested document has at least one upload, mark submitted.
        uploads_resp, uploads_status = supabase_request(
            "get",
            "/rest/v1/dealer_info_request_uploads",
            params={"select": "document_label", "request_id": f"eq.{req['id']}"},
            use_service_role=True,
        )
        if uploads_status < 400 and isinstance(uploads_resp, list):
            uploaded_labels = {row.get("document_label") for row in uploads_resp}
            required_labels = set(req.get("requested_documents") or [])
            if required_labels and required_labels.issubset(uploaded_labels):
                supabase_request(
                    "patch",
                    "/rest/v1/dealer_info_requests",
                    params={"id": f"eq.{req['id']}"},
                    data={
                        "status": "submitted",
                        "submitted_at": _isoformat_utc(_utc_now()),
                    },
                    use_service_role=True,
                )

        return jsonify({
            "success": True,
            "url": public_url,
            "filename": file.filename,
        }), 201
    except Exception as e:
        logger.exception("Error handling info-request upload")
        return jsonify({"error": "Failed to upload"}), 500


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
        valid_types = {"car", "bike", "car-part", "part", "plate"}
        if item_type not in valid_types:
            return jsonify({"error": "Invalid item type"}), 400

        # Map item_type to table name
        table_mapping = {
            "car": "cars",
            "bike": "bikes",
            "car-part": "car_parts",
            "part": "car_parts",
            "plate": "license_plates",
        }

        table_name = table_mapping[item_type]
        delete_reason = "Removed by admin"
        if request.is_json and request.json:
            delete_reason = (
                request.json.get("reason")
                or request.json.get("deletion_reason")
                or delete_reason
            )

        # Delete the listing using service role
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

        # Fetch listing data BEFORE deletion for email notification
        owner_email = None
        listing_title = f"{item_type.title()} listing"
        try:
            fetch_url = f"{app.config['SUPABASE_URL']}/rest/v1/{table_name}?id=eq.{item_id}&select=user_id,user_email,contact_email,car_manufacturer,car_model,car_trim,bike_brand,bike_model,part_name,title,plate_code,plate_number"
            fetch_resp = requests.get(fetch_url, headers=headers)
            if fetch_resp.status_code == 200:
                fetch_data = fetch_resp.json()
                if isinstance(fetch_data, list) and fetch_data:
                    ld = fetch_data[0]
                    owner_email = ld.get("user_email") or ld.get("contact_email")
                    if not owner_email and ld.get("user_id"):
                        owner_email = get_user_email(ld["user_id"])
                    # Build human-readable title
                    if item_type in ("car", "car-part", "part"):
                        mfr = ld.get("car_manufacturer", "")
                        model = ld.get("car_model", "")
                        trim = ld.get("car_trim", "")
                        pn = ld.get("part_name") or ld.get("title", "")
                        if mfr or model:
                            listing_title = f"{mfr} {model} {trim}".strip()
                        elif pn:
                            listing_title = pn
                    elif item_type == "bike":
                        brand = ld.get("bike_brand", "")
                        model = ld.get("bike_model", "")
                        if brand or model:
                            listing_title = f"{brand} {model}".strip()
                    elif item_type == "plate":
                        code = ld.get("plate_code", "")
                        num = ld.get("plate_number", "")
                        if code or num:
                            listing_title = f"{code} {num}".strip()
        except Exception as fetch_err:
            logger.warning(f"Could not fetch listing data before delete: {fetch_err}")

        delete_response, delete_status = _soft_delete_listing(
            table_name,
            item_id,
            deleted_by_role="admin",
            deleted_by=current_user,
            reason=delete_reason,
            metadata={"endpoint": "admin_delete"},
        )

        if delete_status < 400:
            normalized_type = "part" if item_type == "car-part" else item_type

            # Send email notification to listing owner
            if owner_email and owner_email != "unknown@example.com":
                try:
                    _send_listing_deleted_email(
                        user_email=owner_email,
                        item_type=normalized_type,
                        listing_title=listing_title,
                        listing_id=item_id,
                        reason=delete_reason,
                    )
                except Exception as email_err:
                    logger.warning(
                        f"Failed to send deletion email for {item_id}: {email_err}"
                    )

            logger.info(f"Admin {current_user} deleted {item_type} {item_id}")
            return jsonify(
                {"message": f"{item_type.title()} deleted successfully"}
            ), 200
        else:
            logger.error(
                f"Failed to delete {item_type} {item_id}: {delete_status}"
            )
            return jsonify({"error": "Failed to delete listing"}), delete_status

    except Exception as e:
        logger.error(f"Error deleting {item_type} {item_id}: {str(e)}")
        return jsonify({"error": str(e)}), 500


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


@app.route("/api/recommendations", methods=["POST"])
def get_recommendations():
    """Return personalized listing recommendations based on user behavior."""
    try:
        data = request.json or {}
        viewed = data.get("viewed", [])
        preferred_types = data.get("preferredTypes", [])
        avg_price = data.get("avgPrice")
        limit = min(int(data.get("limit", 8)), 20)

        if not viewed and not preferred_types:
            return _get_newest_recommendations(limit)

        viewed_ids = {v["id"] for v in viewed if v.get("id")}
        viewed_types = [v["type"] for v in viewed if v.get("type")]
        target_types = preferred_types or list(set(viewed_types))

        type_map = {
            "car": ("cars", "expected_selling_price"),
            "bike": ("bikes", "expected_price"),
            "part": ("car_parts", "price"),
            "plate": ("license_plates", "price"),
        }

        results = []
        for t in target_types:
            if t not in type_map:
                continue
            table, price_col = type_map[t]

            query = supabase.table(table).select("*").eq("is_approved", True)

            if avg_price and price_col:
                low = avg_price * 0.6
                high = avg_price * 1.4
                query = query.gte(price_col, low).lte(price_col, high)

            items = (
                query.order("created_at", desc=True).limit(limit).execute().data or []
            )
            for item in items:
                item_id = str(item.get("id", ""))
                if item_id in viewed_ids:
                    continue
                results.append(_normalize_recommendation(item, t))

        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return jsonify({"recommendations": results[:limit]})

    except Exception as e:
        logger.error(f"Recommendations error: {e}")
        return jsonify({"recommendations": [], "error": str(e)}), 500


def _get_newest_recommendations(limit):
    """Cold start: return newest listings across all types."""
    results = []
    queries = [
        ("car", "cars"),
        ("bike", "bikes"),
        ("part", "car_parts"),
        ("plate", "license_plates"),
    ]
    for type_key, table in queries:
        items = (
            supabase.table(table)
            .select("*")
            .eq("is_approved", True)
            .order("created_at", desc=True)
            .limit(limit // len(queries) + 1)
            .execute()
            .data
            or []
        )
        for item in items:
            results.append(_normalize_recommendation(item, type_key))

    results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return jsonify({"recommendations": results[:limit]})


def _normalize_recommendation(item, item_type):
    """Normalize a listing into a consistent recommendation shape."""
    base = {
        "id": str(item.get("id", "")),
        "type": item_type,
        "created_at": item.get("created_at", ""),
    }

    if item_type == "car":
        base["title"] = (
            f"{item.get('car_manufacturer', '')} {item.get('car_model', '')}".strip()
        )
        base["subtitle"] = item.get("car_trim", "")
        base["price"] = item.get("expected_selling_price")
        base["location"] = item.get("car_city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/cars/{item.get('id')}"
    elif item_type == "bike":
        base["title"] = (
            f"{item.get('bike_brand', '')} {item.get('bike_model', '')}".strip()
        )
        base["subtitle"] = item.get("bike_type", "")
        base["price"] = item.get("expected_price")
        base["location"] = item.get("city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/bikes/{item.get('id')}"
    elif item_type == "part":
        base["title"] = item.get("part_name", item.get("title", ""))
        base["subtitle"] = item.get("category", "")
        base["price"] = item.get("price")
        base["location"] = item.get("city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/car-parts/{item.get('id')}"
    elif item_type == "plate":
        base["title"] = (
            f"{item.get('plate_code', '')} {item.get('plate_number', '')}".strip()
        )
        base["subtitle"] = item.get("plate_type", "")
        base["price"] = item.get("price")
        base["location"] = item.get("city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/plates/{item.get('id')}"

    return base


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


@app.route("/api/sitemap.xml", methods=["GET"])
@app.route("/sitemap.xml", methods=["GET"])
def sitemap_xml():
    _SITEMAP_TTL = 900
    _sitemap_cache_key = "api-cache:/api/sitemap.xml"
    sitemap_body = _with_cache(_sitemap_cache_key, _build_sitemap_xml, _SITEMAP_TTL)
    response = make_response(sitemap_body, 200)
    response.headers["Content-Type"] = "application/xml; charset=utf-8"
    response.headers["Cache-Control"] = f"public, max-age={_SITEMAP_TTL}"
    return response


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
                # SMS
                if owner.get("phone"):
                    _send_infobip_sms(
                        _normalize_phone_number(owner.get("phone"), owner.get("country_code")),
                        f"DPH Classifieds: {headline}. Re-upload at {renew_url}",
                    )
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

if __name__ == "__main__":
    logger.info("Starting Flask application on port 8000")
    debug_mode = os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    if debug_mode:
        logger.warning("!!! FLASK DEBUG MODE IS ENABLED - NOT FOR PRODUCTION !!!")

    def _run_expiry_reminders():
        CHECK_INTERVAL_SECONDS = int(
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
                logger.error(f"Expiry reminder job error: {reminder_err}")
            time.sleep(CHECK_INTERVAL_SECONDS)

    reminder_thread = threading.Thread(target=_run_expiry_reminders, daemon=True)
    reminder_thread.start()

    app.run(debug=debug_mode, host="127.0.0.1", port=8000)


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
