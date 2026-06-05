"""Dealer webhooks CRUD, send-test, and delivery history endpoints."""
import json
import os
import uuid
from datetime import datetime, timezone

import requests
from flask import Blueprint, g, jsonify, request

from ._decorators import dealer_required, role_required
from services.dealer_secrets import decrypt_secret, encrypt_secret, KeyMissingError
from services.webhook_signing import sign

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

ALLOWED_EVENTS = {
    "lead.created", "lead.status_changed", "lead.assigned",
    "listing.sold", "listing.view_milestone", "inventory.import_completed",
}

webhooks_bp = Blueprint("dealer_webhooks", __name__, url_prefix="/api/dealer")


def _svc(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": prefer,
    }


def _token_required(fn):
    """Late-binding shim so app.py imports cleanly before routes register."""
    from app import token_required
    return token_required(fn)


def _strip_secret(row):
    """Return a copy of the row with secret_enc removed."""
    row = dict(row)
    row.pop("secret_enc", None)
    return row


@webhooks_bp.route("/webhooks", methods=["GET"])
@_token_required
@dealer_required
def list_webhooks(current_user):
    ctx = g.dealer_ctx
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer=""),
        params={
            "select": "id,dealership_id,label,url,events,enabled,created_at,updated_at",
            "dealership_id": f"eq.{ctx['dealership_id']}",
            "order": "created_at.asc",
        },
        timeout=10,
    )
    return jsonify({"webhooks": r.json() if r.status_code == 200 else []})


@webhooks_bp.route("/webhooks", methods=["POST"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def create_webhook(current_user):
    ctx = g.dealer_ctx
    body = request.get_json(silent=True) or {}

    label = (body.get("label") or "").strip()
    url = (body.get("url") or "").strip()
    events = body.get("events")
    secret = body.get("secret") or ""

    if not label:
        return jsonify({"error": {"code": "invalid_label", "message": "label is required"}}), 400
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        return jsonify({"error": {"code": "invalid_url", "message": "url must start with http:// or https://"}}), 400
    if not events or not isinstance(events, list) or len(events) == 0:
        return jsonify({"error": {"code": "invalid_events", "message": "events must be a non-empty list"}}), 400
    unknown = [e for e in events if e not in ALLOWED_EVENTS]
    if unknown:
        return jsonify({"error": {"code": "unknown_event", "message": f"Unknown events: {unknown}"}}), 400
    if not isinstance(secret, str) or len(secret) < 16:
        return jsonify({"error": {"code": "invalid_secret", "message": "secret must be a string of at least 16 characters"}}), 400

    try:
        secret_enc = encrypt_secret(secret)
    except KeyMissingError:
        return jsonify({"error": {"code": "encryption_unavailable"}}), 503

    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(),
        json={
            "dealership_id": ctx["dealership_id"],
            "label": label,
            "url": url,
            "events": events,
            "secret_enc": secret_enc,
            "enabled": True,
        },
        timeout=10,
    )
    if r.status_code not in (200, 201):
        return jsonify({"error": {"code": "create_failed", "message": r.text}}), 500
    rows = r.json()
    row = rows[0] if isinstance(rows, list) else rows
    return jsonify({"webhook": _strip_secret(row)}), 201


@webhooks_bp.route("/webhooks/<webhook_id>", methods=["PATCH"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def update_webhook(current_user, webhook_id):
    ctx = g.dealer_ctx
    body = request.get_json(silent=True) or {}

    # Check ownership
    existing = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer=""),
        params={"select": "id,dealership_id", "id": f"eq.{webhook_id}", "limit": 1},
        timeout=10,
    )
    if existing.status_code != 200 or not existing.json():
        return jsonify({"error": {"code": "not_found"}}), 404
    if existing.json()[0].get("dealership_id") != ctx["dealership_id"]:
        return jsonify({"error": {"code": "not_found"}}), 404

    allowed_fields = {"label", "url", "events", "enabled"}
    update = {k: v for k, v in body.items() if k in allowed_fields}

    # Validate url if present
    if "url" in update:
        url = (update["url"] or "").strip()
        if not url or not (url.startswith("http://") or url.startswith("https://")):
            return jsonify({"error": {"code": "invalid_url"}}), 400
        update["url"] = url

    # Validate events if present
    if "events" in update:
        events = update["events"]
        if not isinstance(events, list) or len(events) == 0:
            return jsonify({"error": {"code": "invalid_events"}}), 400
        unknown = [e for e in events if e not in ALLOWED_EVENTS]
        if unknown:
            return jsonify({"error": {"code": "unknown_event", "message": f"Unknown events: {unknown}"}}), 400

    # Encrypt secret only if provided and non-empty
    secret = body.get("secret")
    if secret and isinstance(secret, str) and len(secret) > 0:
        try:
            update["secret_enc"] = encrypt_secret(secret)
        except KeyMissingError:
            return jsonify({"error": {"code": "encryption_unavailable"}}), 503

    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(),
        params={"id": f"eq.{webhook_id}", "dealership_id": f"eq.{ctx['dealership_id']}"},
        json=update,
        timeout=10,
    )
    if r.status_code not in (200, 204):
        return jsonify({"error": {"code": "update_failed", "message": r.text}}), 500
    rows = r.json()
    row = rows[0] if isinstance(rows, list) and rows else {}
    return jsonify({"webhook": _strip_secret(row)})


@webhooks_bp.route("/webhooks/<webhook_id>", methods=["DELETE"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def delete_webhook(current_user, webhook_id):
    ctx = g.dealer_ctx

    # Check ownership
    existing = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer=""),
        params={"select": "id,dealership_id", "id": f"eq.{webhook_id}", "limit": 1},
        timeout=10,
    )
    if existing.status_code != 200 or not existing.json():
        return jsonify({"error": {"code": "not_found"}}), 404
    if existing.json()[0].get("dealership_id") != ctx["dealership_id"]:
        return jsonify({"error": {"code": "not_found"}}), 404

    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer="return=minimal"),
        params={"id": f"eq.{webhook_id}", "dealership_id": f"eq.{ctx['dealership_id']}"},
        timeout=10,
    )
    if r.status_code not in (200, 204):
        return jsonify({"error": {"code": "delete_failed", "message": r.text}}), 500
    return "", 204


@webhooks_bp.route("/webhooks/<webhook_id>/test", methods=["POST"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def send_test(current_user, webhook_id):
    ctx = g.dealer_ctx

    # Fetch webhook including secret_enc
    wh_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer=""),
        params={
            "select": "id,dealership_id,url,secret_enc",
            "id": f"eq.{webhook_id}",
            "dealership_id": f"eq.{ctx['dealership_id']}",
            "limit": 1,
        },
        timeout=10,
    )
    if wh_resp.status_code != 200 or not wh_resp.json():
        return jsonify({"error": {"code": "not_found"}}), 404

    webhook = wh_resp.json()[0]

    try:
        secret = decrypt_secret(webhook["secret_enc"])
    except KeyMissingError:
        return jsonify({"error": {"code": "encryption_unavailable"}}), 503

    if secret is None:
        return jsonify({"error": {"code": "secret_unreadable"}}), 503

    now_iso = datetime.now(timezone.utc).isoformat()
    delivery_id = f"test-{uuid.uuid4()}"
    payload = {
        "id": delivery_id,
        "event": "test.ping",
        "delivered_at": now_iso,
        "data": {"message": "Hello from DPH"},
    }
    body_bytes = json.dumps(payload, sort_keys=True).encode("utf-8")
    signature = sign(secret, body_bytes)
    headers = {
        "Content-Type": "application/json",
        "X-DPH-Signature": signature,
        "X-DPH-Delivery": delivery_id,
        "X-DPH-Event": "test.ping",
    }

    try:
        resp = requests.post(webhook["url"], data=body_bytes, headers=headers, timeout=(10, 10))
        return jsonify({
            "status_code": resp.status_code,
            "response_body": (resp.text or "")[:500],
            "signature": signature,
        })
    except Exception as exc:
        return jsonify({
            "status_code": None,
            "response_body": str(exc)[:500],
            "signature": signature,
        })


@webhooks_bp.route("/webhooks/<webhook_id>/deliveries", methods=["GET"])
@_token_required
@dealer_required
def get_webhook_deliveries(current_user, webhook_id):
    ctx = g.dealer_ctx

    # Verify ownership
    wh_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhooks",
        headers=_svc(prefer=""),
        params={
            "select": "id,dealership_id",
            "id": f"eq.{webhook_id}",
            "dealership_id": f"eq.{ctx['dealership_id']}",
            "limit": 1,
        },
        timeout=10,
    )
    if wh_resp.status_code != 200 or not wh_resp.json():
        return jsonify({"error": {"code": "not_found"}}), 404

    limit = min(int(request.args.get("limit", 20)), 100)
    offset = int(request.args.get("offset", 0))

    count_headers = {**_svc(prefer="count=exact"), "Range-Unit": "items",
                     "Range": f"{offset}-{offset + limit - 1}"}

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhook_deliveries",
        headers=count_headers,
        params={
            "select": "id,webhook_id,dealership_id,event_type,status,attempt_count,"
                      "next_retry_at,delivered_at,last_response_code,last_response_body,"
                      "last_error,created_at",
            "webhook_id": f"eq.{webhook_id}",
            "dealership_id": f"eq.{ctx['dealership_id']}",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        },
        timeout=10,
    )

    total = None
    content_range = r.headers.get("Content-Range", "")
    if "/" in content_range:
        try:
            total = int(content_range.split("/")[-1])
        except ValueError:
            pass

    return jsonify({
        "deliveries": r.json() if r.status_code in (200, 206) else [],
        "limit": limit,
        "offset": offset,
        "total": total,
    })


@webhooks_bp.route("/webhooks/deliveries", methods=["GET"])
@_token_required
@dealer_required
def get_all_deliveries(current_user):
    ctx = g.dealer_ctx

    limit = min(int(request.args.get("limit", 20)), 100)
    offset = int(request.args.get("offset", 0))

    count_headers = {**_svc(prefer="count=exact"), "Range-Unit": "items",
                     "Range": f"{offset}-{offset + limit - 1}"}

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_webhook_deliveries",
        headers=count_headers,
        params={
            "select": "id,webhook_id,dealership_id,event_type,status,attempt_count,"
                      "next_retry_at,delivered_at,last_response_code,last_response_body,"
                      "last_error,created_at",
            "dealership_id": f"eq.{ctx['dealership_id']}",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        },
        timeout=10,
    )

    total = None
    content_range = r.headers.get("Content-Range", "")
    if "/" in content_range:
        try:
            total = int(content_range.split("/")[-1])
        except ValueError:
            pass

    return jsonify({
        "deliveries": r.json() if r.status_code in (200, 206) else [],
        "limit": limit,
        "offset": offset,
        "total": total,
    })
