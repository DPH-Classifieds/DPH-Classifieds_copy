"""Dealer API sources CRUD endpoints.

Endpoints:
  GET    /api/dealer/api-sources            -- list sources (no credentials_enc)
  POST   /api/dealer/api-sources            -- create source (encrypts credentials)
  PATCH  /api/dealer/api-sources/<id>       -- partial update (re-encrypts if credentials present)
  DELETE /api/dealer/api-sources/<id>       -- delete
  POST   /api/dealer/api-sources/<id>/test  -- test the connection, return row count sample
"""
import logging
import os
from functools import wraps

import requests
from flask import Blueprint, Response, g, jsonify, request

from ._decorators import dealer_required, role_required
from services.dealer_credentials import KeyMissingError, encrypt_credentials, decrypt_credentials

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

# Columns returned to callers — credentials_enc is intentionally omitted.
_SOURCE_COLS = (
    "id,label,adapter,endpoint_url,auth_type,field_mapping,"
    "poll_interval_min,last_pulled_at,last_status,last_error,enabled,created_at"
)

_VALID_ADAPTERS = {"generic_json"}
_VALID_AUTH_TYPES = {"bearer", "basic", "hmac", "none"}
_MIN_POLL_INTERVAL = 5

api_sources_bp = Blueprint("dealer_api_sources", __name__, url_prefix="/api/dealer")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _token_required(fn):
    """Late-binding shim — same pattern as inventory.py."""
    from app import token_required
    wrapped = token_required(fn)
    try:
        wraps(fn)(wrapped)
        wrapped.__name__ = fn.__name__
        wrapped.__qualname__ = fn.__qualname__
    except (AttributeError, TypeError):
        pass
    return wrapped


def _svc(prefer=None):
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _strip_credentials(row: dict) -> dict:
    """Return a copy of row with credentials_enc removed."""
    out = dict(row)
    out.pop("credentials_enc", None)
    return out


def _fetch_source_for_dealership(source_id: str, dealership_id: str, include_credentials: bool = False):
    """Fetch a single source row, scoped to the given dealership.

    Returns (row_dict, None) on success, or (None, error_response) on 404/502.
    """
    select = "*" if include_credentials else _SOURCE_COLS
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(),
        params={
            "select": select,
            "id": f"eq.{source_id}",
            "dealership_id": f"eq.{dealership_id}",
            "limit": 1,
        },
        timeout=10,
    )
    if r.status_code != 200:
        return None, (jsonify({"error": {"code": "fetch_failed", "message": r.text[:200]}}), 502)
    rows = r.json()
    if not rows:
        return None, (jsonify({"error": {"code": "not_found"}}), 404)
    return rows[0], None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@api_sources_bp.route("/api-sources", methods=["GET"])
@_token_required
@dealer_required
def list_sources(current_user=None):
    """List API sources for the caller's dealership (no credentials_enc)."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(),
        params={
            "select": _SOURCE_COLS,
            "dealership_id": f"eq.{dealership_id}",
            "order": "created_at.asc",
        },
        timeout=15,
    )

    if r.status_code != 200:
        return jsonify({"error": {"code": "fetch_failed", "message": r.text[:200]}}), 502

    sources = [_strip_credentials(row) for row in r.json()]
    return jsonify({"sources": sources}), 200


@api_sources_bp.route("/api-sources", methods=["POST"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def create_source(current_user=None):
    """Create a new DMS source; credentials are encrypted at rest."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    body = request.get_json(silent=True) or {}

    # --- Validate required fields ---
    label = (body.get("label") or "").strip()
    if not label:
        return jsonify({"error": {"code": "label_required"}}), 400

    endpoint_url = (body.get("endpoint_url") or "").strip()
    if not endpoint_url:
        return jsonify({"error": {"code": "endpoint_url_required"}}), 400

    adapter = body.get("adapter")
    if adapter not in _VALID_ADAPTERS:
        return jsonify({"error": {"code": "invalid_adapter",
                                  "message": f"adapter must be one of {sorted(_VALID_ADAPTERS)}"}}), 400

    auth_type = body.get("auth_type")
    if auth_type not in _VALID_AUTH_TYPES:
        return jsonify({"error": {"code": "invalid_auth_type",
                                  "message": f"auth_type must be one of {sorted(_VALID_AUTH_TYPES)}"}}), 400

    try:
        poll_interval_min = int(body.get("poll_interval_min", _MIN_POLL_INTERVAL))
    except (TypeError, ValueError):
        poll_interval_min = _MIN_POLL_INTERVAL
    if poll_interval_min < _MIN_POLL_INTERVAL:
        return jsonify({"error": {"code": "invalid_poll_interval",
                                  "message": f"poll_interval_min must be >= {_MIN_POLL_INTERVAL}"}}), 400

    # --- Encrypt credentials ---
    credentials = body.get("credentials") or {}
    try:
        credentials_enc = encrypt_credentials(credentials)
    except KeyMissingError:
        return jsonify({"error": {"code": "encryption_unavailable"}}), 503

    # --- Insert row ---
    field_mapping = body.get("field_mapping") or {}
    payload = {
        "dealership_id": dealership_id,
        "label": label,
        "adapter": adapter,
        "endpoint_url": endpoint_url,
        "auth_type": auth_type,
        "credentials_enc": credentials_enc,
        "field_mapping": field_mapping,
        "poll_interval_min": poll_interval_min,
    }

    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(prefer="return=representation"),
        json=payload,
        timeout=10,
    )
    if r.status_code not in (200, 201) or not r.json():
        logger.error("api_source insert failed: %s %s", r.status_code, r.text[:200])
        return jsonify({"error": {"code": "insert_failed", "message": r.text[:200]}}), 502

    return jsonify({"source": _strip_credentials(r.json()[0])}), 201


@api_sources_bp.route("/api-sources/<source_id>", methods=["PATCH"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def update_source(current_user=None, source_id=None):
    """Partial update. Re-encrypts credentials if provided; otherwise leaves them alone."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    # Verify the source belongs to this dealership
    existing, err = _fetch_source_for_dealership(source_id, dealership_id)
    if err:
        return err

    body = request.get_json(silent=True) or {}

    # Build update payload from allowed mutable fields
    update = {}
    for field in ("label", "endpoint_url", "auth_type", "field_mapping",
                  "poll_interval_min", "enabled"):
        if field in body:
            update[field] = body[field]

    # Re-encrypt credentials only if caller explicitly sent them
    if "credentials" in body:
        try:
            update["credentials_enc"] = encrypt_credentials(body["credentials"])
        except KeyMissingError:
            return jsonify({"error": {"code": "encryption_unavailable"}}), 503

    if not update:
        return jsonify({"source": _strip_credentials(existing)}), 200

    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(prefer="return=representation"),
        params={
            "id": f"eq.{source_id}",
            "dealership_id": f"eq.{dealership_id}",
        },
        json=update,
        timeout=10,
    )
    if r.status_code not in (200, 204):
        return jsonify({"error": {"code": "update_failed", "message": r.text[:200]}}), 502

    # Return updated row (may be empty list on 204 — re-fetch if needed)
    rows = r.json() if r.status_code == 200 and r.text.strip() not in ("", "[]") else None
    if rows:
        return jsonify({"source": _strip_credentials(rows[0])}), 200

    # Re-fetch after 204
    updated, err2 = _fetch_source_for_dealership(source_id, dealership_id)
    if err2:
        return err2
    return jsonify({"source": _strip_credentials(updated)}), 200


@api_sources_bp.route("/api-sources/<source_id>", methods=["DELETE"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def delete_source(current_user=None, source_id=None):
    """Delete a source. 204 on success, 404 if not in this dealership."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    # Verify ownership
    _, err = _fetch_source_for_dealership(source_id, dealership_id)
    if err:
        return err

    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/dealer_api_sources",
        headers=_svc(),
        params={
            "id": f"eq.{source_id}",
            "dealership_id": f"eq.{dealership_id}",
        },
        timeout=10,
    )
    if r.status_code not in (200, 204):
        return jsonify({"error": {"code": "delete_failed", "message": r.text[:200]}}), 502

    return Response(status=204)


@api_sources_bp.route("/api-sources/<source_id>/test", methods=["POST"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def test_source(current_user=None, source_id=None):
    """Test the DMS connection: fetch, apply mapping, count valid rows.

    Does NOT update last_status — this is a read-only diagnostic call.
    Returns {rows_seen: N, rows_valid: M, sample: [first 3 valid rows]}.
    On error, returns {error: {code, message}} 502.
    """
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    # Fetch with credentials for internal use
    source, err = _fetch_source_for_dealership(source_id, dealership_id, include_credentials=True)
    if err:
        return err

    # Decrypt credentials
    credentials_enc = source.get("credentials_enc")
    if credentials_enc:
        try:
            creds = decrypt_credentials(credentials_enc)
        except KeyMissingError:
            return jsonify({"error": {"code": "encryption_unavailable",
                                      "message": "DEALER_INTEGRATIONS_KEY is unset"}}), 503
        if creds is None:
            return jsonify({"error": {"code": "credentials_unreadable",
                                      "message": "Credentials could not be decrypted"}}), 502
    else:
        creds = {}

    endpoint_url = source.get("endpoint_url", "")
    auth_type = source.get("auth_type", "none")
    field_mapping = source.get("field_mapping") or {}

    # Build auth header
    headers = {"Accept": "application/json"}
    if auth_type == "bearer":
        token = creds.get("bearer_token") or creds.get("token") or ""
        headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "basic":
        import base64
        username = creds.get("username") or creds.get("user") or ""
        password = creds.get("password") or ""
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {encoded}"
    # hmac / none: no header added in test (hmac signing deferred to poller)

    # Fetch the endpoint
    try:
        resp = requests.get(endpoint_url, headers=headers, timeout=15)
    except Exception as exc:
        return jsonify({"error": {"code": "connection_error", "message": str(exc)[:300]}}), 502

    if resp.status_code != 200:
        return jsonify({"error": {
            "code": "endpoint_error",
            "message": f"Endpoint returned {resp.status_code}: {resp.text[:200]}",
        }}), 502

    # Parse response body
    try:
        payload = resp.json()
    except Exception:
        return jsonify({"error": {"code": "parse_error",
                                  "message": "Response is not valid JSON"}}), 502

    if isinstance(payload, list):
        raw_rows = payload
    elif isinstance(payload, dict) and "listings" in payload:
        raw_rows = payload["listings"]
    else:
        return jsonify({"error": {"code": "unexpected_shape",
                                  "message": "Expected a JSON array or {listings: [...]}"}}), 502

    # Apply field_mapping and validate
    from services.dealer_inventory import apply_column_mapping, validate_row, coerce_row

    rows_seen = len(raw_rows)
    valid_rows = []
    for raw in raw_rows:
        if not isinstance(raw, dict):
            continue
        mapped = apply_column_mapping(raw, field_mapping) if field_mapping else raw
        ok, _ = validate_row(mapped)
        if ok:
            valid_rows.append(coerce_row(mapped))

    sample = valid_rows[:3]
    return jsonify({
        "rows_seen": rows_seen,
        "rows_valid": len(valid_rows),
        "sample": sample,
    }), 200
