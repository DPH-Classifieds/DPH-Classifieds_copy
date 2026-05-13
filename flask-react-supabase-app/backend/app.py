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
import datetime
import hashlib
import threading
import logging
import json
import uuid
import os
import re
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
from werkzeug.utils import secure_filename
from xml.sax.saxutils import escape as xml_escape

from analytics_metrics import build_platform_metrics, classify_platform_path

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
LISTING_EXPIRY_DAYS = 15
LISTING_RETENTION_DAYS = 30
LISTING_SOLD_RESPONSE_WINDOW_HOURS = int(
    os.getenv("LISTING_SOLD_RESPONSE_WINDOW_HOURS", "48")
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
LEAD_EVENT_ACTIONS = {"call_click", "whatsapp_click", "vin_open", "vin_reveal"}
LISTING_OUTCOME_OPTIONS = {"sold_on_dph", "sold_elsewhere", "not_sold_renew"}
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
}
LISTING_IMAGE_SELECTS = {
    "cars": "id,car_id,image_url,url,display_url,focal_x,focal_y,crop_meta,uploaded_at",
    "bikes": "id,bike_id,image_url,url,uploaded_at",
    "car_parts": "id,part_id,image_url,uploaded_at",
    "license_plates": "id,plate_id,image_url,created_at,updated_at",
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
API_CACHE_TTL_SECONDS = int(os.getenv("API_CACHE_TTL_SECONDS", "45"))
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
    if redis_client:
        try:
            cached = redis_client.get(key)
            if cached:
                return json.loads(cached)
        except Exception as cache_err:
            logger.warning(f"Redis cache read failed: {cache_err}")
    now_ts = time.time()
    with _MEMORY_API_CACHE_LOCK:
        hit = _MEMORY_API_CACHE.get(key)
        if hit and hit.get("expires_at", 0) > now_ts:
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
        except Exception as cache_err:
            logger.warning(f"Redis cache write failed: {cache_err}")
    with _MEMORY_API_CACHE_LOCK:
        _MEMORY_API_CACHE[key] = {
            "payload": payload,
            "expires_at": time.time() + ttl_seconds,
        }


def _cached_json_response(payload, status_code=200, ttl_seconds=API_CACHE_TTL_SECONDS):
    response = make_response(jsonify(payload), status_code)
    response.headers["Cache-Control"] = f"public, max-age={ttl_seconds}"
    return response


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

    sold_response_deadline = _parse_datetime(record.get("sold_response_deadline"))
    if not sold_response_deadline and expired_at:
        sold_response_deadline = expired_at + datetime.timedelta(
            hours=LISTING_SOLD_RESPONSE_WINDOW_HOURS
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
        "sold_response_deadline": sold_response_deadline,
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
    record["sold_response_deadline"] = _isoformat_utc(
        lifecycle["sold_response_deadline"]
    )
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


def _sync_listing_lifecycle(table_name, record, *, hard_delete_archived=False):
    if not isinstance(record, dict):
        return record

    lifecycle = _compute_listing_lifecycle(record)
    updates = {}
    just_expired = False

    if record.get("expires_at") is None:
        updates["expires_at"] = _isoformat_utc(lifecycle["expires_at"])
    if lifecycle["is_expired"] and record.get("expired_at") is None:
        updates["expired_at"] = _isoformat_utc(lifecycle["expired_at"])
        just_expired = True  # First time we're marking this as expired
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
        and record.get("status") not in {"deleted", "rejected", "sold"}
    ):
        updates["status"] = "deleted"
        updates["auto_removed_at"] = _isoformat_utc(_utc_now())
        updates["sold_status"] = record.get("sold_status") or "sold_elsewhere"
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
                listing_type = next(
                    (
                        key
                        for key, cfg in LISTING_TABLE_CONFIG.items()
                        if cfg["table"] == table_name
                    ),
                    None,
                )
                if listing_type:
                    _record_listing_deletion_event(
                        listing_id=record.get("id"),
                        listing_type=listing_type,
                        reason="No listing outcome selected within 48 hours of expiry",
                        deleted_by_role="system",
                        metadata={
                            "expired_at": record.get("expired_at"),
                            "sold_response_deadline": record.get(
                                "sold_response_deadline"
                            ),
                        },
                    )

    _apply_listing_lifecycle_metadata(record)

    # Send expiry email on first detection of expiry
    if (
        just_expired
        and record.get("user_email")
        and record.get("status") not in {"deleted", "rejected"}
    ):
        try:
            listing_title = (
                record.get("listing_title")
                or f"{record.get('city', '')} {record.get('code', '')} {record.get('number', '')}".strip()
                or record.get("name")
                or "Your listing"
            )
            _send_listing_expired_email(
                record["user_email"],
                listing_title,
                table_name,
                record.get("id"),
                record.get("days_until_deletion", 30),
            )
        except Exception as email_err:
            logger.warning(f"Failed sending expiry email: {email_err}")

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
        "extras",
    }
    return {key: value for key, value in payload.items() if key not in lifecycle_keys}


def _create_listing_with_lifecycle_fallback(path, payload, *, user_id):
    response, status_code = supabase_request(
        "post", path, data=payload, user_id=user_id
    )
    if status_code < 400:
        return response, status_code

    error_text = json.dumps(response).lower()
    # Check for any lifecycle column errors
    lifecycle_error_keywords = [
        "expires_at",
        "retention_expires_at",
        "expired_at",
        "last_extended_at",
        "extension_count",
        "is_archived",
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

    return _send_resend_email(payload)


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

    return _send_resend_email(payload)


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
    car_params = {
        "select": (
            "id,user_id,car_manufacturer,car_model,trim,make_year,car_city,"
            "expected_selling_price,kilometer_driven,car_description,created_at,updated_at,"
            "status,is_approved,view_count,lady_driven,"
            "whatsapp_number,whatsapp_prefill_text,vin_number,car_images("
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
            "display_url,status,is_approved,featured,views,bike_images("
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
            "part_images(" + LISTING_IMAGE_SELECTS["car_parts"] + ")"
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
            "plate_images(" + LISTING_IMAGE_SELECTS["license_plates"] + ")"
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
    try:
        return f"AED {int(float(value)):,}"
    except (TypeError, ValueError):
        return f"AED {value}"


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
        "isUnavailable": not bool(listing),
    }
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
            _sync_listing_lifecycle(config["table"], record, hard_delete_archived=False)

        records_by_type[listing_type] = record_map

    cards = []
    saved_ids = []
    counts = {key: 0 for key in SAVED_LISTING_TYPE_CONFIG.keys()}

    for row in saved_rows:
        listing_type = _normalize_saved_listing_type(row.get("listing_type"))
        if not listing_type:
            continue
        saved_ids.append(f"{listing_type}:{row.get('listing_id')}")
        counts[listing_type] = counts.get(listing_type, 0) + 1
        record = records_by_type.get(listing_type, {}).get(row.get("listing_id"))
        cards.append(_build_saved_listing_card(listing_type, record, row))

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

    _sync_listing_lifecycle(config["table"], listing, hard_delete_archived=False)
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

# Enable compression for better performance
try:
    from flask_compress import Compress

    app.config.setdefault("COMPRESS_LEVEL", 6)
    app.config.setdefault("COMPRESS_ALGORITHM", ["br", "gzip"])
    Compress(app)
    logger.info("Flask-Compress enabled with Gzip and Brotli")
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
        return True, response.json()
    except Exception as exc:
        logger.error(f"Infobip SMS send error: {exc}", exc_info=True)
        return False, {"message": str(exc)}


def _get_user_profile_for_verification(user_id):
    if not user_id:
        return None

    resp, status = supabase_request(
        "get",
        f"/rest/v1/users?id=eq.{user_id}&select=id,email,email_verified,phone,country_code,phone_verified,phone_verified_at",
        use_service_role=True,
    )
    if status >= 400 or not resp:
        return None
    return resp[0]


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
        "metadata": metadata or {},
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

    supabase_request(
        "patch",
        f"/rest/v1/users?id=eq.{verification_record.get('user_id')}",
        data={
            "phone_verified": True,
            "phone_verified_at": _isoformat_utc(now),
            "updated_at": _isoformat_utc(now),
        },
        use_service_role=True,
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
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://*.railway.app; connect-src 'self' https://*.supabase.co https://dph-classifieds-production.up.railway.app https://dphclassifieds.com https://www.dphclassifieds.com https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com;",
    )
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
    tables = ["cars", "bikes", "license_plates"]
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
    if _is_super_admin_user(user_id):
        return None

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


def _require_dealer_verified(user_id):
    """Block unverified dealers from creating listings. Returns error response or None."""
    try:
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_KEY"))
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        resp = requests.get(
            f"{os.getenv('SUPABASE_URL')}/rest/v1/users?id=eq.{user_id}&select=is_dealer,dealer_verified",
            headers=headers,
            timeout=10,
        )
        if resp.status_code >= 400:
            return None  # Don't block on query errors
        rows = resp.json()
        if rows and rows[0].get("is_dealer") and not rows[0].get("dealer_verified"):
            return jsonify(
                {
                    "error": "Your dealer account is pending admin verification. You will be able to post listings once your account is approved.",
                    "code": "dealer_not_verified",
                }
            ), 403

        # Check that all 3 required documents are approved
        if rows and rows[0].get("is_dealer") and rows[0].get("dealer_verified"):
            docs_resp = requests.get(
                f"{os.getenv('SUPABASE_URL')}/rest/v1/dealer_documents?user_id=eq.{user_id}&select=document_type,status",
                headers=headers,
                timeout=10,
            )
            if docs_resp.status_code == 200:
                docs = docs_resp.json()
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
    current = int(listing_count or 0)
    return {
        "current": current,
        "max": MAX_LISTINGS_PER_USER,
        "remaining": max(0, MAX_LISTINGS_PER_USER - current),
        "unlimited": False,
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
        filtered_params["select"] = (
            "id,user_id,car_manufacturer,car_model,trim,make_year,car_city,"
            "expected_selling_price,kilometer_driven,car_description,created_at,updated_at,"
            "status,is_approved,view_count,lady_driven,"
            "whatsapp_number,whatsapp_prefill_text,vin_number,car_images("
            + LISTING_IMAGE_SELECTS["cars"]
            + ")"
        )

        # Use service role for public fetches to ensure all approved listings and images are visible
        response, status_code = supabase_request(
            "get", "/rest/v1/cars", params=filtered_params, use_service_role=True
        )

        if status_code >= 400:
            logger.error(f"Error response from Supabase: {response}")
            return jsonify(
                {"error": response.get("error", "Unknown error"), "data": []}
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
            car["images"] = car_images

        # Fetch seller info for each car
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
            car["images"] = images_response
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

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        dealer_check = _require_dealer_verified(current_user)
        if dealer_check:
            return dealer_check

        car_data = request.json
        car_data["user_id"] = current_user
        car_data.update(_new_listing_lifecycle_fields())

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

            # Validate horsepower is not empty
            if not car_data.get("horsepower"):
                logger.error("horsepower is required")
                return jsonify({"error": "Horsepower is required"}), 400

            _validate_description_word_count(
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
        }
        car_data = {k: v for k, v in car_data.items() if k in allowed_fields}

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
            logger.error(f"Database insert failed: {data}")
            return jsonify(data), status_code

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

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            _send_new_listing_admin_notification("car", data[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "car", data[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

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
        }
        # Sanitize update data to ensure 'id' is NOT sent to Supabase as part of the body
        # (Supabase/PostgREST rejects updates where the primary key is in the body)
        update_data.pop("id", None)

        # Strictly apply allowed fields filter
        update_data = {k: v for k, v in update_data.items() if k in allowed_fields}

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
                    }
                )

            if not image_inserts:
                return jsonify({"error": "At least one valid image is required."}), 400

            supabase_request(
                "delete",
                "/rest/v1/car_images",
                params={"car_id": f"eq.{car_id}"},
                user_id=current_user,
            )

            images_response, images_status = supabase_request(
                "post",
                "/rest/v1/car_images",
                data=image_inserts,
                user_id=current_user,
            )

            if images_status >= 400:
                inserted_images = []
                for image_insert in image_inserts:
                    single_image_response, single_image_status = supabase_request(
                        "post",
                        "/rest/v1/car_images",
                        data=image_insert,
                        user_id=current_user,
                    )
                    if single_image_status < 400 and single_image_response:
                        if isinstance(single_image_response, list):
                            inserted_images.extend(single_image_response)
                        else:
                            inserted_images.append(single_image_response)

                if not inserted_images:
                    logger.error(
                        f"Failed to replace car images for {car_id}: "
                        f"{images_status} - {images_response}"
                    )
                    return jsonify({"error": "Failed to save listing images."}), 500

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
            car["images"] = images_data
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

        if bucket_name not in {"listing-images", "profile-photos", "dealer-documents"}:
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
        for index, image_url in enumerate(image_urls):
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
    user_email, item_type, listing, status, request_origin=None, rejection_fix=None
):
    if not user_email:
        return None, "Missing recipient email"
    if not EMAIL_REGEX.match(user_email):
        return None, "Invalid recipient email"

    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"

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

    return _send_resend_email(payload)


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

    return _send_resend_email(payload)


def _send_new_listing_admin_notification(item_type, listing, user_email):
    from_email = os.getenv("RESEND_FROM_EMAIL")
    to_email = os.getenv("RESEND_TO_EMAIL")
    if not from_email or not to_email:
        return None, "Missing RESEND_FROM_EMAIL or RESEND_TO_EMAIL"

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
        "to": [to_email],
        "subject": subject,
        "html": html_content,
    }

    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    return _send_resend_email(payload)


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

    return _send_resend_email(payload)


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
        if response_status >= 400:
            return jsonify(response), response_status
        _api_cache_set(cache_key, response)
        return _cached_json_response(response)
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
    """Upload a dealer document (trade_license, company_registration, or tax_registration)"""
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

        existing_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_documents?user_id=eq.{current_user}&document_type=eq.{document_type}&select=id,storage_path",
            headers=headers,
            timeout=10,
        )

        if existing_resp.status_code == 200 and existing_resp.json():
            existing_doc = existing_resp.json()[0]
            old_path = existing_doc.get("storage_path")
            if old_path:
                del_url = (
                    f"{SUPABASE_URL}/storage/v1/object/dealer-documents/{old_path}"
                )
                requests.delete(
                    del_url,
                    headers={
                        "apikey": SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    },
                    timeout=10,
                )

            update_resp = requests.patch(
                f"{SUPABASE_URL}/rest/v1/dealer_documents?id=eq.{existing_doc['id']}",
                headers={**headers, "Prefer": "return=representation"},
                json={
                    "url": public_url,
                    "filename": file.filename,
                    "file_type": content_type,
                    "storage_path": object_path,
                    "status": "pending",
                    "denial_reason": None,
                    "denial_fix": None,
                    "reviewed_at": None,
                    "reviewed_by": None,
                    "uploaded_at": "now()",
                },
                timeout=10,
            )
            if update_resp.status_code not in [200, 204]:
                logger.error(f"Failed to update document record: {update_resp.text}")
                return jsonify({"error": "Failed to save document"}), 500

            doc_data = (
                update_resp.json()[0]
                if update_resp.status_code == 200
                else {
                    "id": existing_doc["id"],
                    "url": public_url,
                    "filename": file.filename,
                    "document_type": document_type,
                    "status": "pending",
                    "storage_path": object_path,
                }
            )
        else:
            insert_resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/dealer_documents",
                headers={**headers, "Prefer": "return=representation"},
                json={
                    "user_id": current_user,
                    "document_type": document_type,
                    "url": public_url,
                    "filename": file.filename,
                    "file_type": content_type,
                    "storage_path": object_path,
                    "status": "pending",
                },
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

    requested_username = _normalize_username_value(cleaned_metadata.get("username"))
    if not requested_username:
        return jsonify(
            {"message": "Username is required", "code": "username_required", "field": "username"}
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
                "message": username_check.get("message") or _username_conflict_message(),
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
            return jsonify({"draft": drafts[0] if drafts else None}), 200

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
        record = {
            "user_id": current_user,
            "draft_key": normalized_key,
            "payload": draft_payload,
            "updated_at": _isoformat_utc(_utc_now()),
        }
        # Replace any existing draft for this user/key pair so the latest edit wins.
        supabase_request(
            "delete",
            f"/rest/v1/{draft_table}?user_id=eq.{current_user}&draft_key=eq.{normalized_key}",
            use_service_role=True,
        )
        insert_response, insert_status = supabase_request(
            "post",
            f"/rest/v1/{draft_table}",
            data=record,
            use_service_role=True,
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
            user_role = auth_user_data.get("role", "")
            is_superadmin = user_role == "superadmin"
            logger.info(
                f"[_get_user_details_with_admin_status] Found user in auth system. Email: {auth_email}, Role: {user_role}, Superadmin: {is_superadmin}"
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
    phone_verified = phone_verified or False

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
                "&select=id,user_id,bike_brand,bike_model,make_year,bike_category,engine_capacity,"
                "expected_selling_price,kilometer_driven,description,created_at,updated_at,image_url,url,"
                "display_url,status,is_approved,featured,views,bike_images("
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
                        if image_url:
                            normalized_images.append(
                                {
                                    "id": img.get("id"),
                                    "image_url": image_url,
                                    "url": image_url,
                                }
                            )
                    bike["images"] = normalized_images
                    # Fallback for main image
                    if not bike["images"]:
                        if bike.get("image_url") or bike.get("url"):
                            main_url = bike.get("image_url") or bike.get("url")
                            bike["images"] = [
                                {"id": "main", "url": main_url, "image_url": main_url}
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
                _api_cache_set(cache_key, response)
                return _cached_json_response(response)
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

    # Get listing count against limit (cars + bikes + plates, parts excluded)
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
        "sold_status": "not_sold_renew",
        "sold_status_set_at": _isoformat_utc(now),
        "sold_response_deadline": None,
        "auto_removed_at": None,
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

        dealer_check = _require_dealer_verified(current_user)
        if dealer_check:
            return dealer_check

        bike_data = request.json
        bike_data["user_id"] = current_user
        bike_data["status"] = "pending"  # Set status as pending for admin approval
        bike_data.update(_new_listing_lifecycle_fields())

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

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            _send_new_listing_admin_notification("bike", data[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "bike", data[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

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
        }
        # Sanitize update data to ensure 'id' is NOT sent to Supabase as part of the body
        update_data.pop("id", None)

        update_data = {k: v for k, v in update_data.items() if k in bike_allowed_fields}

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

        # Build query - only get approved plates
        # Build query with join for images
        url = (
            f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?status=eq.approved&order=created_at.desc"
            f"&limit={limit}&offset={offset}&select=id,user_id,city,code,digits,price,number,plate_format,"
            "description,created_at,updated_at,image_url,url,display_url,status,is_approved,featured,views,"
            "plate_images(" + LISTING_IMAGE_SELECTS["license_plates"] + ")"
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
                    }
                    for img in plate_images
                    if img.get("url") or img.get("image_url")
                ]
                # Fallback for main image if images list is empty but one of these fields exists
                if not plate["images"]:
                    if plate.get("image_url") or plate.get("url"):
                        main_url = plate.get("image_url") or plate.get("url")
                        plate["images"] = [
                            {"id": "main", "url": main_url, "image_url": main_url}
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

        # Use service role for consistent data fetching
        service_role_key = app.config["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }

        # Use join for images
        url = f"{app.config['SUPABASE_URL']}/rest/v1/license_plates?id=eq.{plate_id}&select=*,plate_images(*)"
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
                }
                for img in plate_images
            ]

            _enrich_listing_seller(plate, headers=headers)
            return jsonify(plate), 200
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
        }

        for key in allowed_fields:
            if key in data:
                update_data[key] = data[key]
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "plates")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        # Sanitize
        update_data.pop("id", None)

        # Update
        data, status_code = supabase_request(
            "patch",
            f"/rest/v1/license_plates",
            params={"id": f"eq.{plate_id}"},
            data=update_data,
            user_id=current_user,
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
                "&select=id,user_id,category,part_type,brand,model,condition,price,description,city,"
                "created_at,updated_at,image_url,url,display_url,status,is_approved,featured,views,"
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
                        }
                        for img in part_images
                        if img.get("url") or img.get("image_url")
                    ]
                    # Fallback for main image
                    if not part["images"]:
                        if part.get("image_url") or part.get("url"):
                            main_url = part.get("image_url") or part.get("url")
                            part["images"] = [
                                {"id": "main", "url": main_url, "image_url": main_url}
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
                _api_cache_set(cache_key, response)
                return _cached_json_response(response)
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
        part_data["status"] = "pending"  # Set status as pending for admin approval
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

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            _send_new_listing_admin_notification("part", data[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "part", data[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

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
            }
            for img in part_images
            if img.get("url") or img.get("image_url")
        ]

        if not part["images"] and (part.get("image_url") or part.get("url")):
            main_url = part.get("image_url") or part.get("url")
            part["images"] = [{"id": "main", "url": main_url, "image_url": main_url}]

        _enrich_listing_seller(part, headers=headers)
        return jsonify(part), 200

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
        try:
            _require_whatsapp_prefill_and_phone_alignment(update_data, "parts")
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

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

        # Handle image updates from JSON payload (uploaded URLs)
        if images is not None:
            supabase_request(
                "delete",
                "/rest/v1/part_images",
                params={"part_id": f"eq.{part_id}"},
                user_id=current_user,
            )

            if images:
                image_inserts = []
                for image_url in images:
                    image_inserts.append(
                        {
                            "part_id": part_id,
                            "url": image_url,
                            "image_url": image_url,
                        }
                    )

                supabase_request(
                    "post",
                    "/rest/v1/part_images",
                    data=image_inserts,
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

        protected = _protect_super_admin_target(user_id, "change its status")
        if protected:
            return protected

        data = request.get_json(silent=True) or {}
        next_status = (data.get("status") or "").strip().lower()
        if next_status not in {"active", "suspended", "banned"}:
            return jsonify(
                {"error": "Status must be active, suspended, or banned"}
            ), 400

        status_reason = (data.get("reason") or data.get("note") or "").strip()

        update_data = {"account_status": next_status}
        if status_reason:
            update_data["rejection_note"] = status_reason

        response, status_code = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{user_id}",
            data=update_data,
            use_service_role=True,
        )

        if status_code not in [200, 204]:
            logger.error(f"Failed updating user status for {user_id}: {response}")
            return jsonify({"error": "Failed to update user status"}), status_code

        payload = {"message": f"User marked as {next_status}", "status": next_status}
        if status_reason:
            payload["reason"] = status_reason
        return jsonify(payload), 200
    except Exception as e:
        logger.error(f"Error updating admin user status: {str(e)}")
        return jsonify({"error": "An error occurred while updating user status"}), 500


@app.route("/api/admin/users/<user_id>/make-admin", methods=["POST"])
@token_required
def make_admin_user(current_user, user_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        protected = _protect_super_admin_target(user_id, "modify admin access for")
        if protected:
            return protected

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


@app.route("/api/admin/users/<user_id>", methods=["DELETE"])
@token_required
def delete_admin_user(current_user, user_id):
    try:
        if not _require_admin_api_user(current_user):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        if user_id == current_user:
            return jsonify({"error": "You cannot delete your own account"}), 400

        protected = _protect_super_admin_target(user_id, "delete")
        if protected:
            return protected

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
        except ValueError as validation_error:
            return jsonify({"error": str(validation_error)}), 400

        limit_response = _enforce_listing_limit(current_user)
        if limit_response:
            return limit_response

        # Create plate entry
        plate_number_str = str(number).strip() if number is not None else ""
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
            "status": "pending",  # Set status as pending for admin approval
        }
        plate_data.update(_new_listing_lifecycle_fields())
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
        text = f"{city} {code} {plate_number_str}"
        text_width = draw.textlength(text, font=font)
        draw.text(
            ((plate_width - text_width) / 2, plate_height / 3),
            text,
            fill=(0, 0, 0),
            font=font,
        )

        # Save the image
        image_filename = f"plate_{city}_{code}_{plate_number_str}.png"
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

        # Send email notifications
        try:
            user_details = _get_user_email_by_id(current_user)
            user_email = user_details.get("email") if user_details else None
            _send_new_listing_admin_notification("plate", response[0], user_email)
            if user_email:
                _send_new_listing_user_confirmation(user_email, "plate", response[0])
        except Exception as email_err:
            logger.warning(f"Failed to send listing notification emails: {email_err}")

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

        _, update_status = supabase_request(
            "patch",
            f"/rest/v1/users?id=eq.{owner_id}",
            data={
                "phone_verified": True,
                "phone_verified_at": _isoformat_utc(_utc_now()),
                "updated_at": _isoformat_utc(_utc_now()),
            },
            use_service_role=True,
        )
        if update_status >= 400:
            return jsonify({"error": "Failed to unlock VIN for owner"}), update_status

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
            enriched_listings.append(item_copy)

        return jsonify(enriched_listings), 200
    except Exception as e:
        logger.error(f"Exception in api_admin_list_items: {e}")
        return jsonify({"error": "Failed to fetch listings"}), 500


@app.route("/api/admin/approve/<item_type>/<item_id>/approve", methods=["POST"])
@token_required
def api_admin_approve_item(current_user, item_type, item_id):
    return api_approve_item(current_user, item_type, item_id)


@app.route("/api/admin/approve/<item_type>/<item_id>/reject", methods=["POST"])
@token_required
def api_admin_reject_item(current_user, item_type, item_id):
    return api_reject_item(current_user, item_type, item_id)


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


# ... (End of admin_bp blueprint, before app.register_blueprint(admin_bp) if it was moved, or before if __name__ ...)

# =====================
# Lead + Lifecycle APIs
# =====================


@app.route("/api/analytics/events", methods=["POST"])
def track_platform_event():
    """Persist a raw platform analytics event."""
    try:
        payload = request.json or {}
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
        user_id = _get_optional_user_id_from_auth_header()

        row = {
            "id": str(uuid.uuid4()),
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
            "visitor_id": str(visitor_id),
            "session_id": str(session_id),
            "duration_ms": int(
                payload.get("duration_ms") or metadata.get("duration_ms") or 0
            ),
            "metadata": metadata,
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
            logger.error(f"Failed to store platform event: {response}")
            return jsonify({"error": "Failed to track event"}), 500

        return jsonify({"success": True}), 201
    except Exception as e:
        logger.error(f"Error tracking platform event: {e}")
        return jsonify({"error": "Failed to track event"}), 500


@app.route("/api/admin/metrics/overview", methods=["GET"])
@token_required
def get_admin_metrics_overview(current_user):
    """Return user, car, and plate analytics for the admin metrics page."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        days = max(min(int(request.args.get("days", 30)), 90), 1)
        cutoff = (_utc_now() - datetime.timedelta(days=days)).isoformat()

        events_resp, events_status = supabase_request(
            "get",
            "/rest/v1/platform_events",
            params={
                "select": "*",
                "created_at": f"gte.{cutoff}",
                "order": "created_at.desc",
                "limit": "5000",
            },
            use_service_role=True,
        )
        if events_status >= 400:
            return jsonify({"error": "Failed to fetch analytics events"}), events_status

        car_rows_resp, car_status = supabase_request(
            "get",
            "/rest/v1/cars",
            params={
                "select": "id,car_manufacturer,car_model,make_year,body_type,vehicle_type,expected_selling_price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
                "limit": "1000",
            },
            use_service_role=True,
        )
        if car_status >= 400:
            car_rows_resp = []

        plate_rows_resp, plate_status = supabase_request(
            "get",
            "/rest/v1/license_plates",
            params={
                "select": "id,city,code,number,digits,price,plate_format,view_count,status,user_id,created_at",
                "order": "created_at.desc",
                "limit": "1000",
            },
            use_service_role=True,
        )
        if plate_status >= 400:
            plate_rows_resp = []

        bike_rows_resp, bike_status = supabase_request(
            "get",
            "/rest/v1/bikes",
            params={
                "select": "id,make,model,make_year,body_type,vehicle_type,price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
                "limit": "1000",
            },
            use_service_role=True,
        )
        if bike_status >= 400:
            bike_rows_resp = []

        part_rows_resp, part_status = supabase_request(
            "get",
            "/rest/v1/car_parts",
            params={
                "select": "id,title,name,price,view_count,status,user_id,created_at",
                "order": "created_at.desc",
                "limit": "1000",
            },
            use_service_role=True,
        )
        if part_status >= 400:
            part_rows_resp = []

        user_rows_resp, user_status = supabase_request(
            "get",
            "/rest/v1/users",
            params={
                "select": "id,username,display_name,first_name,last_name,email,created_at,is_dealer,account_status,phone_verified,email_verified",
                "order": "created_at.desc",
                "limit": "2000",
            },
            use_service_role=True,
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

        return jsonify(metrics), 200
    except Exception as e:
        logger.error(f"Error fetching admin metrics overview: {str(e)}")
        return jsonify({"error": "Failed to fetch admin metrics"}), 500


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

        return (
            jsonify(
                {
                    "window_seconds": lookback_seconds,
                    "live_visitors": len(visitors),
                    "timestamp": _isoformat_utc(_utc_now()),
                }
            ),
            200,
        )
    except Exception as exc:
        logger.error(f"Failed to compute live visitors: {exc}")
        return jsonify({"error": "Failed to compute live visitors"}), 500


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
        return jsonify(snapshot), 200 if snapshot[
            "overall_status"
        ] == "healthy" else 503
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
            params={"id": f"eq.{item_id}", "select": "id", "limit": 1},
            use_service_role=True,
        )
        if listing_status >= 400:
            return jsonify({"error": "Failed to validate listing"}), listing_status
        if not listing_resp:
            return jsonify({"error": "Listing not found"}), 404

        user_id = _get_optional_user_id_from_auth_header()
        event_payload = {
            "listing_id": str(item_id),
            "listing_type": normalized_type,
            "action": action,
            "user_id": user_id,
            "session_id": payload.get("session_id"),
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

        return jsonify({"message": "Lead event tracked"}), 201
    except Exception as e:
        logger.error(f"Error tracking lead event: {e}")
        return jsonify({"error": "Failed to track lead event"}), 500


@app.route("/api/user/listings/<item_type>/<item_id>/outcome", methods=["POST"])
@token_required
def set_listing_outcome(current_user, item_type, item_id):
    """Handle listing outcome popup action after expiry."""
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

    listing = _sync_listing_lifecycle(
        config["table"], listing, hard_delete_archived=False
    )
    if not listing:
        return jsonify({"error": "Listing is no longer available"}), 410

    now = _utc_now()
    updates = {
        "sold_status": outcome,
        "sold_status_set_at": _isoformat_utc(now),
    }

    if outcome == "not_sold_renew":
        expiry_anchor = _parse_datetime(listing.get("expires_at")) or now
        if expiry_anchor < now:
            expiry_anchor = now
        new_expires_at = expiry_anchor + datetime.timedelta(days=LISTING_EXPIRY_DAYS)
        updates.update(
            {
                "status": "approved",
                "expires_at": _isoformat_utc(new_expires_at),
                "expired_at": None,
                "retention_expires_at": _isoformat_utc(
                    new_expires_at + datetime.timedelta(days=LISTING_RETENTION_DAYS)
                ),
                "sold_response_deadline": None,
                "auto_removed_at": None,
                "last_extended_at": _isoformat_utc(now),
                "extension_count": int(listing.get("extension_count") or 0) + 1,
                "is_archived": False,
            }
        )
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
        user_id=current_user,
    )
    if patch_status >= 400:
        return jsonify({"error": "Failed to update listing outcome"}), patch_status

    refreshed_resp, refreshed_status = supabase_request(
        "get",
        f"/rest/v1/{config['table']}",
        params={"id": f"eq.{item_id}", "select": "*", "limit": 1},
        user_id=current_user,
    )
    if refreshed_status < 400 and refreshed_resp:
        refreshed = _sync_listing_lifecycle(
            config["table"], refreshed_resp[0], hard_delete_archived=False
        )

        # Send renewal notification email if renewed
        if outcome == "not_sold_renew":
            try:
                user_email = refreshed.get("user_email") or refreshed.get(
                    "contact_email"
                )
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


@app.route("/api/admin/lead-metrics", methods=["GET"])
@token_required
def get_admin_lead_metrics(current_user):
    """Admin lead metrics summary + recent events."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        days = max(min(int(request.args.get("days", 30)), 90), 1)
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


@app.route("/api/user/lead-metrics", methods=["GET"])
@token_required
def get_user_lead_metrics(current_user):
    """Lead metrics scoped to listings owned by the authenticated user."""
    try:
        days = max(min(int(request.args.get("days", 30)), 90), 1)
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
    """Admin history of auto/user/admin removed listings."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Unauthorized - Admin access required"}), 403

        limit = max(min(int(request.args.get("limit", 200)), 500), 1)
        response, status_code = supabase_request(
            "get",
            "/rest/v1/listing_deletion_events",
            params={"select": "*", "order": "created_at.desc", "limit": str(limit)},
            use_service_role=True,
        )
        if status_code >= 400:
            return jsonify({"error": "Failed to fetch listing history"}), status_code
        return jsonify(response or []), 200
    except Exception as e:
        logger.error(f"Error fetching listing history: {e}")
        return jsonify({"error": "Failed to fetch listing history"}), 500


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

        # Map item_type to table name and image table
        table_mapping = {
            "car": "cars",
            "bike": "bikes",
            "car-part": "car_parts",
            "part": "car_parts",
            "plate": "license_plates",
        }
        image_table_mapping = {
            "car": "car_images",
            "bike": "bike_images",
            "car-part": "part_images",
            "part": "part_images",
            "plate": "plate_images",
        }

        table_name = table_mapping[item_type]
        image_table_name = image_table_mapping.get(item_type)
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

        # First, delete associated images if image table exists
        if image_table_name:
            try:
                img_url = f"{app.config['SUPABASE_URL']}/rest/v1/{image_table_name}?listing_id=eq.{item_id}"
                img_response = requests.delete(img_url, headers=headers)
                if img_response.status_code not in (200, 204):
                    logger.warning(
                        f"Failed to delete images for {item_type} {item_id}: {img_response.status_code}"
                    )
            except Exception as img_err:
                logger.warning(
                    f"Error deleting images for {item_type} {item_id}: {img_err}"
                )

        url = f"{app.config['SUPABASE_URL']}/rest/v1/{table_name}?id=eq.{item_id}"

        response = requests.delete(url, headers=headers)

        if response.status_code == 200 or response.status_code == 204:
            normalized_type = "part" if item_type == "car-part" else item_type
            _record_listing_deletion_event(
                listing_id=item_id,
                listing_type=normalized_type,
                reason=delete_reason,
                deleted_by_role="admin",
                deleted_by=current_user,
                metadata={"endpoint": "admin_delete"},
            )

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
                f"Failed to delete {item_type} {item_id}: {response.status_code}"
            )
            return jsonify({"error": "Failed to delete listing"}), response.status_code

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

        if listing_type and listing_type in ("car", "bike", "part", "plate"):
            params["listing_type"] = f"eq.{listing_type}"

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
    sitemap_body = _build_sitemap_xml()
    response = make_response(sitemap_body, 200)
    response.headers["Content-Type"] = "application/xml; charset=utf-8"
    response.headers["Cache-Control"] = "public, max-age=900"
    return response


# Admin routes are registered at the top of the file (after imports)
# No need to register again here

if __name__ == "__main__":
    logger.info("Starting Flask application on port 8000")
    debug_mode = os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    if debug_mode:
        logger.warning("!!! FLASK DEBUG MODE IS ENABLED - NOT FOR PRODUCTION !!!")

    # Start background expiry reminder thread
    def _run_expiry_reminders():
        """Check listings daily and send renewal reminders 3 days before expiry."""
        REMINDER_DAYS_BEFORE = 3
        CHECK_INTERVAL_SECONDS = 86400  # 24 hours
        while True:
            try:
                with app.app_context():
                    for item_type, config in LISTING_TABLE_CONFIG.items():
                        table = config["table"]
                        now = _utc_now()
                        reminder_threshold = now + datetime.timedelta(
                            days=REMINDER_DAYS_BEFORE
                        )
                        # Fetch listings expiring within the reminder window that haven't expired yet
                        records, status = supabase_request(
                            "get",
                            f"/rest/v1/{table}",
                            params={
                                "select": "id,user_email,expires_at,city,code,number,listing_title,name,status",
                                "expires_at": f"lte.{_isoformat_utc(reminder_threshold)}",
                                "expired_at": "is.null",
                                "status": "eq.approved",
                                "is_archived": "eq.false",
                            },
                            use_service_role=True,
                        )
                        if status >= 400 or not records:
                            continue
                        for record in records:
                            if not record.get("user_email"):
                                continue
                            expires_at = _parse_datetime(record.get("expires_at"))
                            if not expires_at or expires_at <= now:
                                continue
                            days_left = max((expires_at - now).days, 1)
                            listing_title = (
                                record.get("listing_title")
                                or f"{record.get('city', '')} {record.get('code', '')} {record.get('number', '')}".strip()
                                or record.get("name")
                                or "Your listing"
                            )
                            _send_listing_expiry_reminder(
                                record["user_email"],
                                listing_title,
                                table,
                                record["id"],
                                days_left,
                            )
            except Exception as reminder_err:
                logger.error(f"Expiry reminder job error: {reminder_err}")
            time.sleep(CHECK_INTERVAL_SECONDS)

    reminder_thread = threading.Thread(target=_run_expiry_reminders, daemon=True)
    reminder_thread.start()

    app.run(debug=debug_mode, host="127.0.0.1", port=8000)
