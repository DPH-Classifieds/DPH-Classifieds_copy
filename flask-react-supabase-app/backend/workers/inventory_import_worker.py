# flask-react-supabase-app/backend/workers/inventory_import_worker.py
"""Process queued dealer_inventory_jobs.

For each tick: claim one queued job, parse its file from storage, run rows
through the import pipeline (validate -> coerce -> upsert), record per-row
errors, set the final job status.
"""
import logging
import os
from datetime import datetime, timezone

import requests

from services.dealer_inventory import (
    apply_column_mapping, parse_csv_bytes, parse_xml_bytes,
    validate_row, coerce_row,
)

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _svc(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": prefer,
    }


def _claim_job():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs",
        headers=_svc(prefer=""),
        params={"select": "*", "status": "eq.queued",
                "order": "created_at.asc", "limit": 1},
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return None
    job = r.json()[0]
    pr = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs"
        f"?id=eq.{job['id']}&status=eq.queued",
        headers=_svc(prefer="return=representation"),
        json={"status": "running",
              "started_at": datetime.now(timezone.utc).isoformat()},
        timeout=10,
    )
    if pr.status_code not in (200, 204):
        return None
    # 204 = no content; 200 must have claimed at least one row
    if pr.status_code == 200 and isinstance(pr.json(), list) and not pr.json():
        return None
    return job


def _download_file(file_path):
    r = requests.get(
        f"{SUPABASE_URL}/storage/v1/object/{file_path}",
        headers={"apikey": SUPABASE_SERVICE_KEY,
                 "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
        timeout=30,
    )
    return r


def _build_car_payload(dealership_id, coerced):
    """Map coerced row -> cars insert payload. Mirrors PostCar.js defaults."""
    payload = {
        "dealership_id": dealership_id,
        "is_dealer": True,
        "is_approved": True,
        "status": "active",
        "external_id": coerced.get("external_id") or None,
        "make": coerced.get("make"),
        "car_model": coerced.get("car_model") or coerced.get("model"),
        "make_year": coerced.get("make_year"),
        "expected_selling_price": coerced.get("expected_selling_price"),
        "kilometers": coerced.get("kilometers"),
        "body_type": coerced.get("body_type"),
        "color": coerced.get("color"),
        "fuel_type": coerced.get("fuel_type"),
        "transmission": coerced.get("transmission"),
        "description": coerced.get("description"),
    }
    return {k: v for k, v in payload.items() if v is not None}


def _upsert_car(dealership_id, coerced):
    """Returns ('created'|'updated', car_id) or raises."""
    ext_id = coerced.get("external_id")
    if ext_id:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/cars",
            headers=_svc(prefer=""),
            params={"select": "id",
                    "dealership_id": f"eq.{dealership_id}",
                    "external_id": f"eq.{ext_id}",
                    "limit": 1},
            timeout=10,
        )
        if r.status_code == 200 and r.json():
            car_id = r.json()[0]["id"]
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                headers=_svc(prefer="return=minimal"),
                json=_build_car_payload(dealership_id, coerced),
                timeout=10,
            )
            return ("updated", car_id)
    cr = requests.post(
        f"{SUPABASE_URL}/rest/v1/cars",
        headers=_svc(prefer="return=representation"),
        json=_build_car_payload(dealership_id, coerced),
        timeout=10,
    )
    if cr.status_code in (200, 201) and cr.json():
        return ("created", cr.json()[0]["id"])
    raise RuntimeError(f"insert failed: {cr.status_code} {cr.text[:200]}")


def _emit_row_error(job_id, row_index, external_id, code, message, raw_row):
    requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_row_errors",
        headers=_svc(prefer="return=minimal"),
        json={"job_id": job_id, "row_index": row_index,
              "external_id": external_id, "error_code": code,
              "error_message": message, "raw_row": raw_row},
        timeout=10,
    )


def _finish_job(job_id, status, counts, error_summary=None):
    body = {
        "status": status,
        "rows_total": counts["total"],
        "rows_created": counts["created"],
        "rows_updated": counts["updated"],
        "rows_skipped": counts["skipped"],
        "rows_failed": counts["failed"],
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    if error_summary:
        body["error_summary"] = error_summary
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs?id=eq.{job_id}",
        headers=_svc(prefer="return=minimal"),
        json=body, timeout=10,
    )


def _rows_from_job(job, file_bytes):
    kind = job["kind"]
    if kind in ("csv_import",):
        yield from parse_csv_bytes(file_bytes)
    elif kind == "xml_import":
        yield from parse_xml_bytes(file_bytes)
    elif kind == "api_pull":
        # api_pull's payload is staged into the job's source field as a base64
        # JSON blob written by the poller. Decoded by the poller itself before
        # invoking the worker — when api_pull lands here, we expect the
        # poller to have already written rows. Skip in v1.
        return


def run():
    job = _claim_job()
    if not job:
        return 0

    counts = {"total": 0, "created": 0, "updated": 0, "skipped": 0, "failed": 0}

    try:
        if job["kind"] in ("csv_import", "xml_import"):
            dl = _download_file(job["file_path"])
            if dl.status_code != 200:
                _finish_job(job["id"], "failed", counts,
                            {"code": "file_download_failed", "status": dl.status_code})
                return 1
            file_bytes = dl.content
        else:
            file_bytes = b""

        mapping = job.get("column_mapping") or {}

        for i, raw in enumerate(_rows_from_job(job, file_bytes)):
            counts["total"] += 1
            mapped = apply_column_mapping(raw, mapping) if mapping else raw
            ok, err = validate_row(mapped)
            if not ok:
                _emit_row_error(job["id"], i, mapped.get("external_id"),
                                err.get("code", "validation_error"),
                                str(err), mapped)
                counts["failed"] += 1
                continue
            coerced = coerce_row(mapped)
            try:
                action, _ = _upsert_car(job["dealership_id"], coerced)
                counts["created" if action == "created" else "updated"] += 1
            except Exception as e:
                _emit_row_error(job["id"], i, coerced.get("external_id"),
                                "upsert_failed", str(e)[:300], mapped)
                counts["failed"] += 1

        if counts["failed"] == 0 and counts["total"] > 0:
            final = "succeeded"
        elif counts["created"] + counts["updated"] > 0:
            final = "partial"
        else:
            final = "failed"
        _finish_job(job["id"], final, counts)
    except Exception as e:
        logger.exception("import worker crashed on job %s", job.get("id"))
        _finish_job(job["id"], "failed", counts, {"code": "worker_exception", "error": str(e)[:300]})
    return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("inventory_import_worker: processed=%d", run())
