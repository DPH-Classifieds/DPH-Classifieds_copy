# flask-react-supabase-app/backend/routes/dealer/inventory.py
"""Dealer inventory import/export endpoints.

Endpoints:
  POST /api/dealer/inventory/imports          -- multipart upload (owner/manager only)
  GET  /api/dealer/inventory/jobs             -- paginated job list (dealership-scoped)
  GET  /api/dealer/inventory/jobs/<job_id>    -- job detail + first 200 row errors
  GET  /api/dealer/inventory/jobs/<job_id>/errors  -- paginated row errors
  GET  /api/dealer/inventory/export.csv       -- stream CSV of all active listings
"""
import csv
import io
import json
import logging
import os
from functools import wraps
from uuid import uuid4

import requests
from flask import Blueprint, Response, g, jsonify, request
from werkzeug.utils import secure_filename

from ._decorators import dealer_required, role_required

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

inventory_bp = Blueprint("dealer_inventory", __name__, url_prefix="/api/dealer")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _token_required(fn):
    """Late-binding shim so app.py imports cleanly before routes register.

    Uses functools.wraps to preserve the original function name, preventing
    Flask endpoint-name collisions when multiple routes use this decorator.
    """
    from app import token_required
    wrapped = token_required(fn)
    # Preserve __name__ and __wrapped__ so Flask uses the real function name
    # as the endpoint rather than '<lambda>'.
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@inventory_bp.route("/inventory/jobs", methods=["GET"])
@_token_required
@dealer_required
def list_jobs(current_user=None):
    """Paginated list of inventory jobs for the authenticated dealership."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    page = max(1, int(request.args.get("page", 1)))
    per_page = max(1, min(100, int(request.args.get("per_page", 20))))
    offset = (page - 1) * per_page

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs",
        headers=_svc(prefer="count=exact"),
        params={
            "select": "*",
            "dealership_id": f"eq.{dealership_id}",
            "order": "created_at.desc",
            "limit": per_page,
            "offset": offset,
        },
        timeout=15,
    )

    if r.status_code != 200:
        return jsonify({"error": {"code": "fetch_failed", "message": r.text[:200]}}), 502

    jobs = r.json()
    total = None
    cr = r.headers.get("content-range", "")
    if "/" in cr:
        try:
            total = int(cr.split("/")[1])
        except (ValueError, IndexError):
            pass

    return jsonify({"jobs": jobs, "total": total, "page": page, "per_page": per_page}), 200


@inventory_bp.route("/inventory/jobs/<job_id>", methods=["GET"])
@_token_required
@dealer_required
def get_job(current_user=None, job_id=None):
    """Job detail + first 200 row errors."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    jr = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs",
        headers=_svc(),
        params={
            "select": "*",
            "id": f"eq.{job_id}",
            "dealership_id": f"eq.{dealership_id}",
            "limit": 1,
        },
        timeout=10,
    )
    if jr.status_code != 200 or not jr.json():
        return jsonify({"error": {"code": "not_found"}}), 404

    job = jr.json()[0]

    er = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_row_errors",
        headers=_svc(),
        params={
            "select": "*",
            "job_id": f"eq.{job_id}",
            "order": "row_index.asc",
            "limit": 200,
        },
        timeout=10,
    )
    errors = er.json() if er.status_code == 200 else []

    return jsonify({"job": job, "errors": errors}), 200


@inventory_bp.route("/inventory/jobs/<job_id>/errors", methods=["GET"])
@_token_required
@dealer_required
def list_job_errors(current_user=None, job_id=None):
    """Paginated error list for a job."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    # Verify job belongs to this dealership
    jr = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs",
        headers=_svc(),
        params={
            "select": "id",
            "id": f"eq.{job_id}",
            "dealership_id": f"eq.{dealership_id}",
            "limit": 1,
        },
        timeout=10,
    )
    if jr.status_code != 200 or not jr.json():
        return jsonify({"error": {"code": "not_found"}}), 404

    page = max(1, int(request.args.get("page", 1)))
    per_page = max(1, min(200, int(request.args.get("per_page", 50))))
    offset = (page - 1) * per_page

    er = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_row_errors",
        headers=_svc(prefer="count=exact"),
        params={
            "select": "*",
            "job_id": f"eq.{job_id}",
            "order": "row_index.asc",
            "limit": per_page,
            "offset": offset,
        },
        timeout=10,
    )

    errors = er.json() if er.status_code == 200 else []
    total = None
    cr = er.headers.get("content-range", "")
    if "/" in cr:
        try:
            total = int(cr.split("/")[1])
        except (ValueError, IndexError):
            pass

    return jsonify({"errors": errors, "total": total, "page": page, "per_page": per_page}), 200


@inventory_bp.route("/inventory/imports", methods=["POST"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def post_import(current_user=None):
    """Multipart upload: file + mapping (JSON string) + kind."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    if "file" not in request.files:
        return jsonify({"error": {"code": "file_required"}}), 400

    upload = request.files["file"]
    file_bytes = upload.read()

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        return jsonify({"error": {"code": "file_too_large",
                                  "message": f"File exceeds {MAX_UPLOAD_BYTES} bytes"}}), 413

    kind = request.form.get("kind", "csv_import")
    if kind not in ("csv_import", "xml_import"):
        return jsonify({"error": {"code": "invalid_kind",
                                  "message": "kind must be csv_import or xml_import"}}), 400

    mapping_raw = request.form.get("mapping", "{}")
    try:
        mapping = json.loads(mapping_raw)
        if not isinstance(mapping, dict):
            raise ValueError("not a dict")
    except (ValueError, TypeError):
        return jsonify({"error": {"code": "invalid_mapping"}}), 400

    job_id = str(uuid4())
    # The client filename is metadata only. Storage names are generated from
    # the server UUID and a fixed import kind, so traversal/control characters
    # can never become part of an object path.
    original_filename = upload.filename or ""
    if any(ord(char) < 32 or ord(char) == 127 for char in original_filename):
        return jsonify({"error": {"code": "invalid_filename"}}), 400
    source_filename = secure_filename(original_filename)
    if not source_filename:
        return jsonify({"error": {"code": "invalid_filename"}}), 400
    extension = "xml" if kind == "xml_import" else "csv"
    storage_path = f"dealer-imports/{dealership_id}/{job_id}.{extension}"
    content_type = upload.content_type or "application/octet-stream"

    # Upload to Supabase Storage
    storage_url = f"{SUPABASE_URL}/storage/v1/object/{storage_path}?upsert=true"
    sr = requests.post(
        storage_url,
        headers={
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": content_type,
        },
        data=file_bytes,
        timeout=30,
    )
    if sr.status_code not in (200, 201):
        logger.error("storage upload failed: %s %s", sr.status_code, sr.text[:200])
        return jsonify({"error": {"code": "storage_upload_failed",
                                  "message": sr.text[:200]}}), 502

    # Insert job row
    user_id = getattr(request, "user_id", None)
    job_payload = {
        "id": job_id,
        "dealership_id": dealership_id,
        "kind": kind,
        "status": "queued",
        "file_path": storage_path,
        "column_mapping": mapping,
        "triggered_by": user_id,
    }

    ir = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs",
        headers=_svc(prefer="return=representation"),
        json=job_payload,
        timeout=10,
    )
    if ir.status_code not in (200, 201) or not ir.json():
        logger.error("job insert failed: %s %s", ir.status_code, ir.text[:200])
        return jsonify({"error": {"code": "job_insert_failed",
                                  "message": ir.text[:200]}}), 502

    from app import capture_posthog_event

    capture_posthog_event(
        "dealer_inventory_import_started",
        current_user,
        {"import_kind": kind},
    )
    return jsonify({"job": ir.json()[0]}), 201


# Export CSV columns (subset of cars table columns we expose)
_EXPORT_COLS = [
    "id", "external_id", "make", "car_model", "make_year",
    "expected_selling_price", "kilometers", "body_type", "color",
    "fuel_type", "transmission", "description", "status", "created_at",
]


@inventory_bp.route("/inventory/export.csv", methods=["GET"])
@_token_required
@dealer_required
@role_required("owner", "manager")
def export_csv(current_user=None):
    """Stream CSV of all active cars for the dealership."""
    ctx = g.dealer_ctx
    dealership_id = ctx["dealership_id"]

    cr = requests.get(
        f"{SUPABASE_URL}/rest/v1/cars",
        headers=_svc(),
        params={
            "select": ",".join(_EXPORT_COLS),
            "dealership_id": f"eq.{dealership_id}",
            "limit": 10000,
        },
        timeout=30,
    )

    rows = cr.json() if cr.status_code == 200 else []

    def generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=_EXPORT_COLS, extrasaction="ignore",
                                lineterminator="\r\n")
        writer.writeheader()
        yield buf.getvalue()
        for row in rows:
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=_EXPORT_COLS, extrasaction="ignore",
                                    lineterminator="\r\n")
            writer.writerow({col: row.get(col, "") for col in _EXPORT_COLS})
            yield buf.getvalue()

    return Response(
        generate(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=dealership-inventory.csv"},
    )
