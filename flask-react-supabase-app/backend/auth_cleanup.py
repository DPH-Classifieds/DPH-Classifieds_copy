import datetime
import logging
import os
from urllib.parse import urlencode

import requests

logger = logging.getLogger("auth-cleanup")


def _supabase_url():
    return (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")


def _service_role_headers():
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def _now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def _parse_iso_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime.datetime):
        return value if value.tzinfo else value.replace(tzinfo=datetime.timezone.utc)
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _auth_user_is_verified(user_row):
    if not isinstance(user_row, dict):
        return False
    return bool(
        user_row.get("email_confirmed_at")
        or user_row.get("phone_confirmed_at")
        or user_row.get("confirmed_at")
    )


def _iter_auth_users(per_page=200):
    base_url = _supabase_url()
    if not base_url:
        raise RuntimeError("SUPABASE_URL is not configured")

    headers = _service_role_headers()
    page = 1
    while True:
        params = {"page": page, "per_page": per_page}
        url = f"{base_url}/auth/v1/admin/users?{urlencode(params)}"
        response = requests.get(url, headers=headers, timeout=25)
        if response.status_code != 200:
            raise RuntimeError(
                f"Failed to list auth users (status={response.status_code}): {response.text}"
            )

        payload = {}
        try:
            payload = response.json()
        except Exception as exc:
            raise RuntimeError(f"Auth users list response was not JSON: {exc}") from exc

        if isinstance(payload, list):
            users = payload
        else:
            users = payload.get("users") or []

        if not users:
            return

        for user_row in users:
            if isinstance(user_row, dict):
                yield user_row

        if isinstance(payload, dict):
            total_pages = payload.get("total_pages")
            if total_pages and page >= int(total_pages):
                return

        if len(users) < per_page:
            return

        page += 1


def cleanup_unverified_accounts(
    *,
    max_age_hours=48,
    per_page=200,
    limit=500,
    dry_run=False,
):
    """Delete auth users that have not confirmed email/phone within max_age_hours.

    This uses the Supabase GoTrue Admin API, so it requires `SUPABASE_SERVICE_ROLE_KEY`.
    """
    cutoff = _now_utc() - datetime.timedelta(hours=float(max_age_hours))
    base_url = _supabase_url()
    headers = _service_role_headers()

    deleted_auth = 0
    deleted_profile_rows = 0
    candidates = []

    for user_row in _iter_auth_users(per_page=per_page):
        user_id = user_row.get("id")
        created_at = _parse_iso_datetime(user_row.get("created_at"))
        if not user_id or not created_at:
            continue
        if created_at > cutoff:
            continue
        if _auth_user_is_verified(user_row):
            continue
        candidates.append({"id": user_id, "created_at": created_at.isoformat()})
        if len(candidates) >= int(limit):
            break

    if dry_run:
        return {
            "dry_run": True,
            "cutoff": cutoff.isoformat(),
            "candidates": candidates,
            "deleted_auth": 0,
            "deleted_user_rows": 0,
        }

    for candidate in candidates:
        user_id = candidate["id"]
        try:
            auth_resp = requests.delete(
                f"{base_url}/auth/v1/admin/users/{user_id}",
                headers=headers,
                timeout=25,
            )
            if auth_resp.status_code in (200, 204, 404):
                deleted_auth += 1 if auth_resp.status_code != 404 else 0
            else:
                logger.warning(
                    "Failed deleting auth user %s: %s - %s",
                    user_id,
                    auth_resp.status_code,
                    auth_resp.text,
                )
                continue

            db_resp = requests.delete(
                f"{base_url}/rest/v1/users?id=eq.{user_id}",
                headers=headers,
                timeout=25,
            )
            if db_resp.status_code in (200, 204):
                deleted_profile_rows += 1
            else:
                logger.warning(
                    "Failed deleting users row %s: %s - %s",
                    user_id,
                    db_resp.status_code,
                    db_resp.text,
                )
        except Exception as exc:
            logger.warning("Exception deleting unverified user %s: %s", user_id, exc)

    return {
        "dry_run": False,
        "cutoff": cutoff.isoformat(),
        "candidates": candidates,
        "deleted_auth": deleted_auth,
        "deleted_user_rows": deleted_profile_rows,
    }

