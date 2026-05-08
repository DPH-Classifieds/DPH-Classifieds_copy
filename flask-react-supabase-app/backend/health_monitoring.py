import datetime
import json
import os
import threading
import time
import uuid

import requests

try:
    import redis
except ImportError:  # pragma: no cover - redis is installed in production
    redis = None


HEALTH_TABLE = "platform_health_checks"
HEALTH_HTTP_TIMEOUT_SECONDS = float(os.getenv("HEALTH_HTTP_TIMEOUT_SECONDS", "8"))
HEALTH_ALERT_COOLDOWN_SECONDS = int(
    os.getenv("HEALTH_ALERT_COOLDOWN_SECONDS", str(30 * 60))
)
HEALTH_CHECK_INTERVAL_SECONDS = int(
    os.getenv("HEALTH_CHECK_INTERVAL_SECONDS", str(30 * 60))
)
WORKER_HEARTBEAT_INTERVAL_SECONDS = int(
    os.getenv("WORKER_HEARTBEAT_INTERVAL_SECONDS", "30")
)
WORKER_HEARTBEAT_TTL_SECONDS = int(
    os.getenv("WORKER_HEARTBEAT_TTL_SECONDS", "120")
)
WORKER_HEARTBEAT_KEY = os.getenv(
    "WORKER_HEARTBEAT_KEY", "dph:health:worker:heartbeat"
)
HEALTH_ALERT_SENT_KEY = os.getenv(
    "HEALTH_ALERT_SENT_KEY", "dph:health:alert:last_sent"
)
SITE_URL = os.getenv("SITE_URL", "").strip().rstrip("/")
HEALTH_FRONTEND_URL = (
    os.getenv("HEALTH_FRONTEND_URL", "").strip().rstrip("/")
    or SITE_URL
    or "http://localhost:3000"
)
HEALTH_BACKEND_URL = (
    os.getenv("HEALTH_BACKEND_URL", "").strip().rstrip("/")
    or os.getenv("RAILWAY_SERVICE_DPH_CLASSIFIEDS_URL", "").strip().rstrip("/")
    or os.getenv("API_URL", "").strip().rstrip("/")
    or os.getenv("PUBLIC_API_URL", "").strip().rstrip("/")
    or "http://localhost:8000"
)

_REDIS_CLIENT = None
_REDIS_CLIENT_LOCK = threading.Lock()


def _service_role_headers():
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def _supabase_url():
    return (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")


def _now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def _iso(dt):
    if isinstance(dt, str):
        return dt
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).isoformat()


def _safe_json(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    return {"value": value}


def get_redis_client():
    global _REDIS_CLIENT
    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT

    if redis is None:
        return None

    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        return None

    with _REDIS_CLIENT_LOCK:
        if _REDIS_CLIENT is None:
            _REDIS_CLIENT = redis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
    return _REDIS_CLIENT


def check_redis_health():
    client = get_redis_client()
    start = time.perf_counter()
    if client is None:
        return {
            "ok": False,
            "status": "unavailable",
            "message": "Redis client unavailable",
            "latency_ms": None,
        }

    try:
        client.ping()
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        return {
            "ok": True,
            "status": "healthy",
            "message": "Redis reachable",
            "latency_ms": latency_ms,
        }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        return {
            "ok": False,
            "status": "down",
            "message": str(exc),
            "latency_ms": latency_ms,
        }


def _check_http_health(url, label, expected_paths=None):
    start = time.perf_counter()
    if not url:
        return {
            "ok": False,
            "status": "unconfigured",
            "message": f"{label} URL not configured",
            "latency_ms": None,
            "checked_url": None,
        }

    candidates = [url]
    if expected_paths:
        base = url.rstrip("/")
        candidates = [f"{base}{path}" for path in expected_paths]

    last_error = None
    for candidate in candidates:
        try:
            response = requests.get(
                candidate,
                timeout=HEALTH_HTTP_TIMEOUT_SECONDS,
                allow_redirects=True,
            )
            latency_ms = round((time.perf_counter() - start) * 1000, 2)
            ok = response.status_code < 500
            return {
                "ok": ok,
                "status": "healthy" if ok else "down",
                "message": f"{label} returned {response.status_code}",
                "latency_ms": latency_ms,
                "checked_url": candidate,
                "status_code": response.status_code,
            }
        except Exception as exc:
            last_error = exc

    latency_ms = round((time.perf_counter() - start) * 1000, 2)
    return {
        "ok": False,
        "status": "down",
        "message": str(last_error) if last_error else f"Failed to check {label}",
        "latency_ms": latency_ms,
        "checked_url": candidates[-1] if candidates else url,
    }


def check_frontend_health():
    return _check_http_health(HEALTH_FRONTEND_URL, "frontend")


def check_backend_health():
    backend_url = HEALTH_BACKEND_URL.rstrip("/")
    if backend_url.endswith("/api/health/live"):
        return _check_http_health(backend_url, "backend")
    if backend_url.endswith("/api/health"):
        backend_url = backend_url[:-len("/api/health")]
    return _check_http_health(
        backend_url,
        "backend",
        expected_paths=["/api/health/live"],
    )


def get_worker_heartbeat(client=None):
    client = client or get_redis_client()
    if client is None:
        return {
            "ok": False,
            "status": "unavailable",
            "message": "Redis unavailable for heartbeat lookup",
            "last_seen_at": None,
            "age_seconds": None,
        }

    try:
        raw_value = client.get(WORKER_HEARTBEAT_KEY)
        if not raw_value:
            return {
                "ok": False,
                "status": "down",
                "message": "Worker heartbeat not found",
                "last_seen_at": None,
                "age_seconds": None,
            }

        try:
            heartbeat_at = datetime.datetime.fromisoformat(raw_value)
        except ValueError:
            heartbeat_at = datetime.datetime.fromtimestamp(
                float(raw_value), tz=datetime.timezone.utc
            )

        if heartbeat_at.tzinfo is None:
            heartbeat_at = heartbeat_at.replace(tzinfo=datetime.timezone.utc)

        age_seconds = max(0, int((_now_utc() - heartbeat_at).total_seconds()))
        healthy = age_seconds <= (WORKER_HEARTBEAT_TTL_SECONDS * 2)
        return {
            "ok": healthy,
            "status": "healthy" if healthy else "down",
            "message": "Worker heartbeat present" if healthy else "Worker heartbeat stale",
            "last_seen_at": _iso(heartbeat_at),
            "age_seconds": age_seconds,
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": "down",
            "message": str(exc),
            "last_seen_at": None,
            "age_seconds": None,
        }


def build_health_snapshot(include_frontend=True, include_backend=True, include_redis=True):
    client = get_redis_client()
    frontend = check_frontend_health() if include_frontend else None
    backend = check_backend_health() if include_backend else None
    redis_health = check_redis_health() if include_redis else None
    worker = get_worker_heartbeat(client)

    components = {
        "frontend": frontend,
        "backend": backend,
        "redis": redis_health,
        "worker": worker,
    }
    overall_ok = all(component.get("ok") for component in components.values() if component)
    overall_status = "healthy" if overall_ok else "degraded"

    snapshot = {
        "id": str(uuid.uuid4()),
        "checked_at": _iso(_now_utc()),
        "overall_status": overall_status,
        "frontend_status": frontend["status"] if frontend else "skipped",
        "backend_status": backend["status"] if backend else "skipped",
        "redis_status": redis_health["status"] if redis_health else "skipped",
        "worker_status": worker["status"],
        "frontend_latency_ms": frontend.get("latency_ms") if frontend else None,
        "backend_latency_ms": backend.get("latency_ms") if backend else None,
        "redis_latency_ms": redis_health.get("latency_ms") if redis_health else None,
        "worker_latency_ms": None,
        "details": {
            "frontend": frontend,
            "backend": backend,
            "redis": redis_health,
            "worker": worker,
        },
    }
    return snapshot


def store_health_snapshot(snapshot):
    url = _supabase_url()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not service_key:
        return False, "Supabase not configured"

    row = {
        "id": snapshot["id"],
        "checked_at": snapshot["checked_at"],
        "source": snapshot.get("source", "worker"),
        "overall_status": snapshot.get("overall_status", "degraded"),
        "frontend_status": snapshot.get("frontend_status"),
        "backend_status": snapshot.get("backend_status"),
        "redis_status": snapshot.get("redis_status"),
        "worker_status": snapshot.get("worker_status"),
        "frontend_latency_ms": snapshot.get("frontend_latency_ms"),
        "backend_latency_ms": snapshot.get("backend_latency_ms"),
        "redis_latency_ms": snapshot.get("redis_latency_ms"),
        "worker_latency_ms": snapshot.get("worker_latency_ms"),
        "details": _safe_json(snapshot.get("details")),
    }
    response = requests.post(
        f"{url}/rest/v1/{HEALTH_TABLE}",
        headers=_service_role_headers(),
        json=row,
        timeout=10,
    )
    if response.status_code not in (200, 201, 204):
        return False, f"{response.status_code}: {response.text}"
    return True, None


def fetch_latest_health_snapshot():
    url = _supabase_url()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not service_key:
        return None, "Supabase not configured"

    response = requests.get(
        f"{url}/rest/v1/{HEALTH_TABLE}",
        headers={**_service_role_headers(), "Prefer": "return=representation"},
        params={"select": "*", "order": "checked_at.desc", "limit": 1},
        timeout=10,
    )
    if response.status_code >= 400:
        return None, f"{response.status_code}: {response.text}"

    rows = response.json() if response.text else []
    return (rows[0] if rows else None), None


def record_worker_heartbeat(client=None):
    client = client or get_redis_client()
    if client is None:
        return False, "Redis unavailable"

    heartbeat_value = _iso(_now_utc())
    try:
        client.setex(WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS, heartbeat_value)
        return True, heartbeat_value
    except Exception as exc:
        return False, str(exc)


def _health_alert_cooldown_ok(client):
    if client is None:
        return True
    try:
        last_sent = client.get(HEALTH_ALERT_SENT_KEY)
        if not last_sent:
            return True
        last_sent_at = datetime.datetime.fromisoformat(last_sent)
        if last_sent_at.tzinfo is None:
            last_sent_at = last_sent_at.replace(tzinfo=datetime.timezone.utc)
        return (_now_utc() - last_sent_at).total_seconds() >= HEALTH_ALERT_COOLDOWN_SECONDS
    except Exception:
        return True


def _mark_health_alert_sent(client):
    if client is None:
        return
    try:
        client.setex(
            HEALTH_ALERT_SENT_KEY,
            max(HEALTH_ALERT_COOLDOWN_SECONDS, 60),
            _iso(_now_utc()),
        )
    except Exception:
        pass


def send_health_alert(snapshot):
    if not snapshot or snapshot.get("overall_status") == "healthy":
        return False, "Healthy snapshot"

    api_key = os.getenv("RESEND_API_KEY")
    from_email = os.getenv("RESEND_FROM_EMAIL")
    to_email = os.getenv("RESEND_TO_EMAIL")
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL")
    if not api_key or not from_email or not to_email:
        return False, "Resend not configured"

    client = get_redis_client()
    if client is not None and not _health_alert_cooldown_ok(client):
        return False, "Cooldown active"

    summary = snapshot.get("details") or {}
    subject = f"DPH Classifieds health alert: {snapshot.get('overall_status', 'degraded')}"
    html = f"""
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Platform health alert</h2>
      <p><strong>Status:</strong> {snapshot.get("overall_status")}</p>
      <p><strong>Checked at:</strong> {snapshot.get("checked_at")}</p>
      <ul>
        <li>Frontend: {json.dumps(summary.get("frontend"))}</li>
        <li>Backend: {json.dumps(summary.get("backend"))}</li>
        <li>Redis: {json.dumps(summary.get("redis"))}</li>
        <li>Worker: {json.dumps(summary.get("worker"))}</li>
      </ul>
    </div>
    """
    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html,
    }
    if reply_to:
        payload["reply_to"] = reply_to

    response = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    if response.status_code >= 400:
        return False, f"{response.status_code}: {response.text}"

    if client is not None:
        _mark_health_alert_sent(client)
    return True, response.text
