#!/usr/bin/env python3
"""Diagnostic script to test JWT auth flow against Supabase.

Run this to check:
1. Whether the JWT secret decodes correctly
2. Whether a token can be validated locally
3. Whether the Supabase Auth API accepts the token

Usage:
    python diagnose_auth.py <access_token>
    python diagnose_auth.py  # tests without a token (config check only)
"""

import base64
import json
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")


def check_config():
    print("=" * 60)
    print("1. CONFIG CHECK")
    print("=" * 60)
    print(f"  SUPABASE_URL:              {SUPABASE_URL or 'MISSING!'}")
    print(
        f"  SUPABASE_KEY:              {'SET (' + SUPABASE_KEY[:20] + '...)' if SUPABASE_KEY else 'MISSING!'}"
    )
    print(
        f"  SUPABASE_SERVICE_ROLE_KEY: {'SET (' + SUPABASE_SERVICE_ROLE_KEY[:20] + '...)' if SUPABASE_SERVICE_ROLE_KEY else 'MISSING!'}"
    )
    print(
        f"  SUPABASE_JWT_SECRET:       {'SET (' + SUPABASE_JWT_SECRET[:20] + '...)' if SUPABASE_JWT_SECRET else 'MISSING!'}"
    )
    print()


def check_jwt_secret_decode():
    print("=" * 60)
    print("2. JWT SECRET BASE64 DECODE")
    print("=" * 60)
    if not SUPABASE_JWT_SECRET:
        print("  SKIP: No JWT secret configured")
        return None

    secret_raw = SUPABASE_JWT_SECRET
    print(f"  Raw secret (first 30 chars): {secret_raw[:30]}...")
    print(f"  Secret length: {len(secret_raw)}")
    print(f"  Ends with '==': {secret_raw.endswith('==')}")

    # Method 1: Direct decode (no extra padding)
    try:
        decoded_direct = base64.b64decode(secret_raw)
        print(f"  Decode (no extra padding): SUCCESS, {len(decoded_direct)} bytes")
    except Exception as e:
        print(f"  Decode (no extra padding): FAILED - {e}")
        decoded_direct = None

    # Method 2: With extra padding (current code behavior)
    try:
        decoded_padded = base64.b64decode(secret_raw + "==")
        print(f"  Decode (with '==' added):   SUCCESS, {len(decoded_padded)} bytes")
    except Exception as e:
        print(f"  Decode (with '==' added):   FAILED - {e}")
        decoded_padded = None

    # Compare
    if decoded_direct and decoded_padded:
        if decoded_direct == decoded_padded:
            print("  => Both methods produce IDENTICAL keys")
        else:
            print(
                f"  => WARNING: Methods produce DIFFERENT keys! ({len(decoded_direct)} vs {len(decoded_padded)} bytes)"
            )
            print(f"     Direct hex:  {decoded_direct.hex()[:40]}...")
            print(f"     Padded hex:  {decoded_padded.hex()[:40]}...")

    return decoded_direct


def test_local_jwt_validation(token, secret_bytes):
    print()
    print("=" * 60)
    print("3. LOCAL JWT VALIDATION")
    print("=" * 60)
    if not token:
        print("  SKIP: No token provided")
        return
    if not secret_bytes:
        print("  SKIP: No decoded secret available")
        return

    try:
        import jwt as pyjwt

        payload = pyjwt.decode(
            token, secret_bytes, algorithms=["HS256"], options={"verify_aud": False}
        )
        print(f"  VALID! User ID (sub): {payload.get('sub')}")
        print(f"  Email: {payload.get('email')}")
        print(f"  Expires: {payload.get('exp')}")
    except Exception as e:
        print(f"  FAILED: {e}")
        # Try with raw string as key (fallback behavior)
        try:
            import jwt as pyjwt

            payload = pyjwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
            print(f"  BUT raw string key WORKS! User ID: {payload.get('sub')}")
        except Exception as e2:
            print(f"  Raw string key also fails: {e2}")


def test_supabase_api(token):
    print()
    print("=" * 60)
    print("4. SUPABASE AUTH API VALIDATION")
    print("=" * 60)
    if not token:
        print("  SKIP: No token provided")
        return
    if not SUPABASE_URL:
        print("  SKIP: No SUPABASE_URL configured")
        return

    # Test with service_role key (what the code uses)
    api_key = SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY
    key_type = "SERVICE_ROLE" if SUPABASE_SERVICE_ROLE_KEY else "ANON"

    print(f"  Using API key type: {key_type}")
    print(f"  Endpoint: {SUPABASE_URL}/auth/v1/user")

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": api_key,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        print(f"  Response status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"  VALID! User ID: {data.get('id')}")
            print(f"  Email: {data.get('email')}")
        else:
            print(f"  FAILED: {resp.text[:200]}")
    except Exception as e:
        print(f"  ERROR: {e}")

    # Also test with anon key if we used service_role
    if SUPABASE_SERVICE_ROLE_KEY and SUPABASE_KEY:
        print()
        print(f"  Retesting with ANON key...")
        try:
            resp = requests.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                timeout=10,
            )
            print(f"  Response status (anon key): {resp.status_code}")
            if resp.status_code != 200:
                print(f"  FAILED: {resp.text[:200]}")
        except Exception as e:
            print(f"  ERROR: {e}")


def main():
    token = sys.argv[1] if len(sys.argv) > 1 else None

    check_config()
    secret_bytes = check_jwt_secret_decode()
    test_local_jwt_validation(token, secret_bytes)
    test_supabase_api(token)

    print()
    print("=" * 60)
    print("DONE")
    print("=" * 60)


if __name__ == "__main__":
    main()
