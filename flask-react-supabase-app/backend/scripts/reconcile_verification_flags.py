#!/usr/bin/env python3
import argparse
import datetime
import os
import re
from pathlib import Path

import requests
from dotenv import load_dotenv


def _load_env():
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")
    load_dotenv(root.parent / ".env")


def _headers():
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "X-Postgres-Role": "service_role",
    }


def _require_config():
    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not service_key:
        raise SystemExit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return url.rstrip("/")


def _normalize_phone(phone, country_code=None):
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
    prefix = str(country_code or "").strip() or "+971"
    prefix_digits = re.sub(r"[^\d]", "", prefix)
    if prefix and not prefix.startswith("+"):
        prefix = f"+{prefix_digits}"
    if prefix_digits and len(digits) > 10 and digits.startswith(prefix_digits):
        return f"+{digits}"
    normalized_digits = digits.lstrip("0") or digits
    return f"{prefix}{normalized_digits}"


def _infer_country_code(phone):
    digits = re.sub(r"[^\d]", "", phone or "")
    if digits.startswith("971"):
        return "+971"
    return None


def _fetch_all_auth_users(base_url):
    users = []
    page = 1
    while True:
        response = requests.get(
            f"{base_url}/auth/v1/admin/users",
            headers=_headers(),
            params={"page": page, "per_page": 1000},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json() or {}
        batch = payload.get("users") or []
        users.extend(batch)
        if len(batch) < 1000:
            break
        page += 1
    return users


def _fetch_public_users(base_url):
    response = requests.get(
        f"{base_url}/rest/v1/users",
        headers=_headers(),
        params={
            "select": "id,email_verified,phone_verified,phone_verified_at,phone,country_code"
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json() or []


def _fetch_latest_verified_phone(base_url, user_id):
    response = requests.get(
        f"{base_url}/rest/v1/phone_verifications",
        headers=_headers(),
        params={
            "select": "phone,verified_at,metadata",
            "user_id": f"eq.{user_id}",
            "status": "eq.verified",
            "order": "verified_at.desc",
            "limit": 1,
        },
        timeout=15,
    )
    response.raise_for_status()
    rows = response.json() or []
    return rows[0] if rows else None


def _patch_user(base_url, user_id, payload, write):
    if not write:
        return
    response = requests.patch(
        f"{base_url}/rest/v1/users?id=eq.{user_id}",
        headers={**_headers(), "Prefer": "return=minimal"},
        json=payload,
        timeout=15,
    )
    response.raise_for_status()


def main():
    parser = argparse.ArgumentParser(description="Reconcile verification flags in public.users")
    parser.add_argument("--write", action="store_true", help="Persist fixes instead of dry-run output")
    args = parser.parse_args()

    _load_env()
    base_url = _require_config()

    auth_users = {
        str(user.get("id")): user for user in _fetch_all_auth_users(base_url) if user.get("id")
    }
    public_users = _fetch_public_users(base_url)

    changed_users = 0
    email_repairs = 0
    phone_repairs = 0
    phone_backfills = 0
    phone_resets = 0

    for row in public_users:
        user_id = str(row.get("id") or "")
        if not user_id:
            continue

        auth_user = auth_users.get(user_id) or {}
        patch_payload = {}

        email_confirmed_at = auth_user.get("email_confirmed_at")
        if email_confirmed_at and not bool(row.get("email_verified")):
            patch_payload["email_verified"] = True
            email_repairs += 1

        phone_confirmed_at = auth_user.get("phone_confirmed_at")
        if phone_confirmed_at and not bool(row.get("phone_verified")):
            patch_payload["phone_verified"] = True
            patch_payload["phone_verified_at"] = phone_confirmed_at
            normalized_auth_phone = _normalize_phone(
                auth_user.get("phone"), row.get("country_code")
            )
            if normalized_auth_phone and not row.get("phone"):
                patch_payload["phone"] = normalized_auth_phone
                patch_payload["country_code"] = row.get("country_code") or _infer_country_code(
                    normalized_auth_phone
                )
            phone_repairs += 1

        if bool(row.get("phone_verified")) and not _normalize_phone(
            row.get("phone"), row.get("country_code")
        ):
            latest_verified = _fetch_latest_verified_phone(base_url, user_id)
            if latest_verified:
                metadata = latest_verified.get("metadata") or {}
                normalized_phone = _normalize_phone(
                    latest_verified.get("phone"),
                    metadata.get("country_code") or row.get("country_code"),
                )
                if normalized_phone:
                    patch_payload["phone"] = normalized_phone
                    patch_payload["country_code"] = (
                        metadata.get("country_code")
                        or row.get("country_code")
                        or _infer_country_code(normalized_phone)
                        or "+971"
                    )
                    if not row.get("phone_verified_at") and latest_verified.get("verified_at"):
                        patch_payload["phone_verified_at"] = latest_verified.get("verified_at")
                    phone_backfills += 1
            else:
                patch_payload["phone_verified"] = False
                patch_payload["phone_verified_at"] = None
                phone_resets += 1

        if not patch_payload:
            continue

        patch_payload["updated_at"] = (
            patch_payload.get("phone_verified_at")
            or datetime.datetime.now(datetime.timezone.utc).isoformat()
        )
        _patch_user(base_url, user_id, patch_payload, args.write)
        changed_users += 1
        print(f"{'WRITE' if args.write else 'DRY-RUN'} {user_id}: {patch_payload}")

    print(
        {
            "changed_users": changed_users,
            "email_repairs": email_repairs,
            "phone_repairs": phone_repairs,
            "phone_backfills": phone_backfills,
            "phone_resets": phone_resets,
            "write": args.write,
        }
    )


if __name__ == "__main__":
    main()
