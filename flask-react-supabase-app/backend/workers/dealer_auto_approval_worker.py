"""Minute-tick worker that fires pending auto-approvals for dealers.

Self-contained (no `app` import) to match the reddit_daily_post_worker pattern.
The decision is re-evaluated at fire time against the live document rows; if
either required document was replaced or its OCR confidence dropped, the
pending row is cancelled and the user is NOT auto-approved.

The delayed-action pattern protects against:
  - app redeploys between the upload and the approval moment
  - a dealer uploading, getting auto-approved, then immediately replacing the
    doc with garbage
  - a multi-replica worker trying to fire the same row twice
    (handled by transitioning state to 'fired'/'cancelled' inside a single
    PostgREST PATCH; the unique partial index on state='pending' is the
    real concurrency guard at the DB level)
"""
import logging
import os
from datetime import datetime, timezone

import requests

from services.registration_ocr import should_auto_approve_dealer

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY", "")
)
DEFAULT_DELAY_SECONDS = int(os.getenv("DEALER_AUTO_APPROVAL_DELAY_SECONDS", "300"))
DEFAULT_THRESHOLD = float(os.getenv("DEALER_AUTO_APPROVAL_OCR_THRESHOLD", "0.90"))


def _truthy(value):
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def supabase_request(method, path, data=None, params=None):
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }
    try:
        resp = requests.request(method.upper(), url, json=data, params=params,
                                 headers=headers, timeout=20)
        body = resp.json() if resp.content else {}
    except Exception as exc:
        return {"error": str(exc)}, 500
    return body, resp.status_code


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _fetch_due_pending(limit=20):
    """Pull pending rows whose scheduled_for has arrived."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return []
    body, status = supabase_request(
        "get", "/rest/v1/dealer_pending_approvals",
        params={
            "select": "*",
            "state": "eq.pending",
            "order": "scheduled_for.asc",
            "limit": str(limit),
        },
    )
    if status >= 400 or not isinstance(body, list):
        return []
    now = datetime.now(timezone.utc)
    return [r for r in body
            if r.get("scheduled_for")
            and (lambda dt: dt is not None and dt <= now)(_parse_iso(r["scheduled_for"]))]


def _fetch_user(user_id):
    body, status = supabase_request(
        "get", f"/rest/v1/users?id=eq.{user_id}&select=id,is_dealer,dealer_verified,dealer_application_status",
    )
    if status < 400 and isinstance(body, list) and body:
        return body[0]
    return None


def _fetch_active_docs(user_id):
    body, status = supabase_request(
        "get", "/rest/v1/dealer_documents",
        params={
            "user_id": f"eq.{user_id}",
            "select": "*",
            "replaced_at": "is.null",
        },
    )
    if status < 400 and isinstance(body, list):
        return body
    return []


def _mark(row_id, **fields):
    supabase_request("patch", f"/rest/v1/dealer_pending_approvals?id=eq.{row_id}", data=fields)


def _approve_user(user_id):
    """Transition the user to verified + approved. Idempotent."""
    supabase_request("patch", f"/rest/v1/users?id=eq.{user_id}", data={
        "dealer_verified": True,
        "dealer_verified_at": datetime.utcnow().isoformat(),
        "dealer_application_status": "approved",
    })


def _send_approval_email(user_id):
    """Best-effort approval email.

    We import the helper lazily so the worker stays importable without the
    full Flask stack (e.g. when run from a one-off CLI invocation).
    """
    try:
        from app import _send_dealer_status_email
        body, _ = supabase_request(
            "get", f"/rest/v1/users?id=eq.{user_id}&select=email,first_name")
        if body and isinstance(body, list) and body and body[0].get("email"):
            _send_dealer_status_email(
                body[0]["email"], "approved",
                display_name=body[0].get("first_name") or "Dealer",
                origin=os.getenv("SITE_URL", "https://www.dphclassifieds.com"),
            )
    except Exception as exc:
        logger.warning("Dealer approval email failed for %s: %s", user_id, exc)


def _fire_pending_approval(row, current_docs=None, user_row=None,
                            delay_seconds=0, threshold=0.90):
    """Pure decision: what should the worker do with this pending row?

    `current_docs` and `user_row` may be injected by tests; the production
    caller fetches them at run time.
    """
    if delay_seconds and row.get("scheduled_for"):
        scheduled = _parse_iso(row["scheduled_for"])
        if scheduled and scheduled > datetime.now(timezone.utc):
            return {"decision": "wait", "reason": "not_due"}
    user = user_row or {}
    if user.get("dealer_verified"):
        return {"decision": "skip", "reason": "already_verified"}
    docs = current_docs if current_docs is not None else _fetch_active_docs(row["user_id"])
    decision = should_auto_approve_dealer(docs, threshold=threshold)
    if not decision["approve"]:
        if decision.get("missing"):
            return {"decision": "cancel", "reason": f"missing:{','.join(decision['missing'])}"}
        return {"decision": "cancel", "reason": "confidence_dropped"}
    return {"decision": "approve"}


def _process_one(row):
    """Apply the pure decision to one row + persist the transition."""
    threshold = float(row.get("threshold") or DEFAULT_THRESHOLD)
    decision = _fire_pending_approval(row, threshold=threshold)
    if decision["decision"] == "wait":
        return decision
    if decision["decision"] == "skip":
        _mark(row["id"], state="cancelled", cancelled_reason=decision["reason"],
              fired_at=_utc_now_iso())
        return decision
    if decision["decision"] == "cancel":
        _mark(row["id"], state="cancelled", cancelled_reason=decision["reason"],
              fired_at=_utc_now_iso())
        return decision
    # approve
    _approve_user(row["user_id"])
    _mark(row["id"], state="fired", fired_at=_utc_now_iso())
    _send_approval_email(row["user_id"])
    return decision


def run_once():
    if not _truthy(os.getenv("DEALER_AUTO_APPROVAL_ENABLED", "1")):
        return {"status": "disabled"}
    rows = _fetch_due_pending()
    results = {"processed": 0, "approved": 0, "cancelled": 0, "skipped": 0, "wait": 0}
    for row in rows:
        d = _process_one(row)
        results["processed"] += 1
        if d["decision"] == "approve":
            results["approved"] += 1
        elif d["decision"] == "cancel":
            results["cancelled"] += 1
        elif d["decision"] == "skip":
            results["skipped"] += 1
        else:
            results["wait"] += 1
    return {"status": "ok", **results}


def run():
    """Cron entry point: tick once. The scheduler is responsible for the loop."""
    return run_once()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(run_once())
