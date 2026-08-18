# DPH Bot (Daily Reddit Roundup) + Dealer OCR Auto-Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
1. Make the DPH (Daily Reddit Roundup) bot post every day with a title/heading that explicitly names the two Dubai days being covered (e.g. "Cars listed on 16–17 Aug 2026").
2. Auto-approve a dealer application when both Trade License and TRN documents are uploaded AND both have OCR confidence ≥ 0.90, with a 5-minute delay, a default 4-listing cap, a dealer panel "Request more listings" flow, and an admin queue/decision UI.

**Architecture:**
- **DPH bot:** one-worker, env-driven cadence. Change `REDDIT_DAILY_POST_EVERY_DAYS` default from 2 → 1. Refactor `_window()` to return an explicit `(since_iso, until_iso, first_day, last_day, label)` tuple so the title and body both carry the date range. Update the `build_posts` heading to match the label. No new schema.
- **Dealer auto-approval:** a "delayed-action" pattern. After the second high-confidence document is uploaded, we INSERT a `dealer_pending_approvals` row with `scheduled_for = now() + 5min`. A new minute-tick worker (`dealer_auto_approval_worker.py`) reads due rows with `SELECT … FOR UPDATE SKIP LOCKED`, re-verifies confidences and document freshness, and transitions the user to `dealer_verified=true` + sends the approval email. Limit requests land in `dealer_listing_upgrade_requests` and follow the existing admin email distribution.

**Tech Stack:** Python 3 / Flask / Supabase (PostgREST) / Resend email / React frontend.

**Test runner:** `pytest` from `flask-react-supabase-app/backend/` with venv active. Full suite currently: **585 passed, 9 skipped**.

## Global Constraints

- Default dealer listing cap becomes **4** (was 20). Existing per-dealer overrides in `users.dealer_listing_limit` are preserved.
- OCR auto-approval threshold: `min(ocr_confidence across both active docs) >= 0.90`. Re-checked at fire time, not just at queue time.
- Approval email fires exactly **5 minutes** after the second high-confidence document is uploaded. Configurable via `DEALER_AUTO_APPROVAL_DELAY_SECONDS` (default 300).
- DPH bot defaults: `REDDIT_DAILY_POST_EVERY_DAYS=1`, `REDDIT_DAILY_POST_HOUR=9` (Asia/Dubai, UTC+4, no DST). Title and body must use the explicit date range.
- No external secrets, no SQL injection vectors, no public bucket for `dealer-documents` (already private per existing migration).
- All new admin email paths reuse `_fetch_all_admin_emails()` (single source of truth for the admin distribution list).
- The existing `dealer_documents.ocr_confidence` column is already added by `2026_08_13_dealer_two_document_ocr.sql` — we just read from it.

---

## File Structure

### New files
- `backend/migrations/2026_08_18_dealer_listing_upgrade_requests.sql` — request queue + limit history + pending approvals + default cap=4
- `backend/workers/dealer_auto_approval_worker.py` — minute-tick worker
- `backend/test_dealer_auto_approval_worker.py` — worker tests
- `backend/test_dealer_listing_upgrade.py` — endpoint + history tests
- `backend/test_dealer_ocr_threshold.py` — OCR confidence decision tests
- `frontend/src/components/dealer/DealerListingsLimitCard.jsx` — limit card + request modal
- `frontend/src/components/admin/AdminDealerUpgradeRequests.jsx` — admin queue page

### Modified files
- `backend/workers/reddit_daily_post_worker.py` — daily cadence, explicit-date title, matching body heading
- `backend/test_reddit_daily_post.py` — updated assertions
- `backend/services/registration_ocr.py` — add `scan_trn_document()` symmetric to `scan_trade_license_expiry()`
- `backend/test_registration_ocr.py` — tests for the TRN scanner
- `backend/app.py` — new endpoints (`/api/dealer/listing-limit`, `/api/dealer/listing-upgrade-requests`, `/api/admin/dealer/listing-upgrade-requests`), `_enforce_listing_limit()` default cap=4, OCR auto-approval scheduling inside `upload_dealer_document`, admin email helper
- `frontend/src/components/Header.js` (or wherever the dealer nav lives) — link the limit card / new tab

---

## Task 1: DPH Bot — Daily Cadence + Explicit Date Title

**Files:**
- Modify: `backend/workers/reddit_daily_post_worker.py:139-179` (build_posts/build_post), `:216-228` (_window), `:265-279` (every_days + guard)
- Modify: `backend/test_reddit_daily_post.py` — add explicit-date title + body tests

**Interfaces:**
- `build_posts(rows, first_day, last_day, site_url, max_body_chars)` — explicit two-date signature; **BREAKING** to the old single-`date_label` call sites; update them too
- `build_post(rows, first_day, last_day, site_url, max_rows)` — convenience wrapper, same break
- `_window(days)` returns `(since_iso, until_iso, first_day: date, last_day: date, label: str)`

- [ ] **Step 1: Write failing test — title shows explicit date range, body heading matches**

```python
# test_reddit_daily_post.py
def test_post_title_and_heading_use_explicit_date_range():
    from datetime import date
    from workers.reddit_daily_post_worker import build_post
    rows = [{"id": "1", "make_year": 2024, "car_manufacturer": "Toyota",
             "car_model": "Camry", "expected_selling_price": 80000}]
    first = date(2026, 8, 16)
    last  = date(2026, 8, 17)
    title, body = build_post(rows, first, last, SITE)
    assert "16–17 Aug 2026" in title
    assert "16–17 Aug 2026" in body          # body heading matches title
    assert "previous 48 hours" not in body   # no more vague heading
    assert "previous 48 hours" not in title
```

- [ ] **Step 2: Run the new test, watch it fail**

`cd backend && source venv/bin/activate && pytest test_reddit_daily_post.py::test_post_title_and_heading_use_explicit_date_range -v`
Expected: FAIL — `build_post` still takes a `date_label` string, no explicit dates.

- [ ] **Step 3: Refactor `_window()` to return `first_day`/`last_day` date objects + label**

```python
from datetime import date as _date
def _window(days=1):
    dubai_now = _now() + DUBAI_OFFSET
    start_today = dubai_now.replace(hour=0, minute=0, second=0, microsecond=0)
    until = start_today - DUBAI_OFFSET
    since = until - timedelta(days=days)
    last_day = (start_today - timedelta(days=1)).date()
    first_day = (start_today - timedelta(days=days)).date()
    label = (last_day.strftime("%-d %b %Y") if days == 1
             else f"{first_day.strftime('%-d %b')}–{last_day.strftime('%-d %b %Y')}")
    return since.isoformat(), until.isoformat(), first_day, last_day, label
```

- [ ] **Step 4: Refactor `build_post`/`build_posts` to take `first_day`/`last_day` and emit an explicit label**

```python
def _format_date_label(first_day, last_day):
    if first_day == last_day:
        return last_day.strftime("%-d %b %Y")
    if first_day.year == last_day.year and first_day.month == last_day.month:
        return f"{first_day.strftime('%-d')}–{last_day.strftime('%-d %b %Y')}"
    return f"{first_day.strftime('%-d %b')}–{last_day.strftime('%-d %b %Y')}"

def build_posts(rows, first_day, last_day, site_url=SITE_URL, max_body_chars=39000):
    if not rows: return []
    n = len(rows)
    date_label = _format_date_label(first_day, last_day)
    heading = f"**{n} car{'' if n == 1 else 's'} listed on {date_label}**\n\n"
    header = "\n".join(["| " + " | ".join(_HEADERS) + " |", _ALIGN])
    # ... (chunking unchanged) ...
    title = f"Cars listed on {date_label}"
    posts = []
    for index, lines in enumerate(chunks, start=1):
        suffix = f" — Part {index} of {total}" if total > 1 else ""
        body = heading + header + "\n" + "\n".join(lines)
        posts.append((title + suffix, body))
    return posts

def build_post(rows, first_day, last_day, site_url=SITE_URL, max_rows=None):
    source = rows if max_rows is None else rows[:max_rows]
    posts = build_posts(source, first_day, last_day, site_url)
    return posts[0] if posts else (f"Cars listed on {_format_date_label(first_day, last_day)}", "")
```

- [ ] **Step 5: Update all call sites**

Inside `run()` / `_preview()` / `_post_now()`:

```python
since_iso, until_iso, first_day, last_day, _label = _window(every_days)
rows = _fetch_listings(since_iso, until_iso)
title, body = build_post(rows, first_day, last_day, SITE_URL, max_rows)
```

- [ ] **Step 6: Default `every_days` to 1**

```python
every_days = max(1, int(os.getenv("REDDIT_DAILY_POST_EVERY_DAYS", "1")))
```

- [ ] **Step 7: Run the new test → green, run the full file → all green**

`pytest test_reddit_daily_post.py -v`
Expected: 7 passed (old 6 + new 1).

- [ ] **Step 8: Commit**

```bash
cd /Users/suhayl/Downloads/Flask-React-superbase-classified
git add flask-react-supabase-app/backend/workers/reddit_daily_post_worker.py \
        flask-react-supabase-app/backend/test_reddit_daily_post.py
git commit -m "feat(dph-bot): post every day with explicit date range title"
```

---

## Task 2: SQL Migration — Limit Requests + History + Pending Approvals

**Files:**
- Create: `backend/migrations/2026_08_18_dealer_listing_upgrade_requests.sql`

- [ ] **Step 1: Write the migration (no test — pure SQL, exercised by the integration tests in later tasks)**

```sql
-- Per-dealer cap (existing column users.dealer_listing_limit, default 4 from now on).
-- Existing per-user overrides are preserved — only the default changes.
ALTER TABLE public.users
  ALTER COLUMN dealer_listing_limit SET DEFAULT 4;

-- Upgrade-request queue (dealer-initiated limit increases)
CREATE TABLE IF NOT EXISTS public.dealer_listing_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  current_limit integer NOT NULL,
  requested_limit integer NOT NULL CHECK (requested_limit > 0 AND requested_limit <= 1000),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_listing_upgrade_requests_pending_idx
  ON public.dealer_listing_upgrade_requests(status, created_at DESC)
  WHERE status = 'pending';
-- One pending request per dealer — protects against spam
CREATE UNIQUE INDEX IF NOT EXISTS dealer_listing_upgrade_requests_one_pending
  ON public.dealer_listing_upgrade_requests(dealer_id)
  WHERE status = 'pending';

-- Audit trail of every limit change
CREATE TABLE IF NOT EXISTS public.dealer_listing_limit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  old_limit integer,
  new_limit integer NOT NULL,
  changed_by uuid REFERENCES public.users(id),
  reason text,
  source text NOT NULL CHECK (source IN ('auto_default','admin_override','upgrade_request')),
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_listing_limit_history_dealer_idx
  ON public.dealer_listing_limit_history(dealer_id, created_at DESC);

-- Pending auto-approval queue (delayed-action pattern)
CREATE TABLE IF NOT EXISTS public.dealer_pending_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger_kind text NOT NULL DEFAULT 'ocr_high_confidence',
  scheduled_for timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','fired','cancelled')),
  trade_license_doc_id uuid,
  tax_registration_doc_id uuid,
  trade_license_confidence numeric,
  tax_registration_confidence numeric,
  threshold numeric NOT NULL DEFAULT 0.90,
  fired_at timestamptz,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_pending_approvals_due_idx
  ON public.dealer_pending_approvals(state, scheduled_for)
  WHERE state = 'pending';
-- One pending per user — second doc upload replaces (cancels) the first
CREATE UNIQUE INDEX IF NOT EXISTS dealer_pending_approvals_one_pending
  ON public.dealer_pending_approvals(user_id)
  WHERE state = 'pending';

-- RLS: dealers see only their own; admins see all (mirrors existing pattern)
ALTER TABLE public.dealer_listing_upgrade_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_listing_limit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_pending_approvals ENABLE ROW LEVEL SECURITY;
-- (Service-role reads bypass RLS; explicit policies for authenticated dealer reads can be added
-- in a follow-up if we want to read these from the client without /api/. For now, all reads go
-- through the Flask service-role API.)
```

- [ ] **Step 2: Sanity-load the migration against a throwaway DB and re-verify**

This is the standard pattern in this repo — migrations run as raw SQL against Supabase via the migration runner. We do not have a local Postgres in venv. Skip local SQL exec; rely on the SQL being syntactically valid by visual review, and the downstream integration tests in Tasks 3–6 will fail loudly if the columns are wrong.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_08_18_dealer_listing_upgrade_requests.sql
git commit -m "feat(db): dealer listing upgrade requests, limit history, pending approvals"
```

---

## Task 3: Backend — Dealer Listing-Limit GET Endpoint + Cap=4 Default

**Files:**
- Modify: `backend/app.py:5379` (`_DEFAULT_DEALER_LISTING_LIMIT` → 4)
- Modify: `backend/app.py:5490-5508` (`_fetch_dealer_listing_policy` — add `used`)
- Create: `backend/test_dealer_listing_limit.py` — pure-logic tests (no Flask import)

**Interfaces (used by the panel frontend):**
```
GET /api/dealer/listing-limit
→ 200 { limit: int, used: int, remaining: int, can_request: bool, default_limit: int }
```

- [ ] **Step 1: Write failing test — `_compute_dealer_listing_limit_summary(limit, counts)`**

```python
# test_dealer_listing_limit.py
from app import _compute_dealer_listing_limit_summary, _DEFAULT_DEALER_LISTING_LIMIT

def test_default_cap_is_four():
    assert _DEFAULT_DEALER_LISTING_LIMIT == 4

def test_summary_with_zero_used():
    s = _compute_dealer_listing_limit_summary(4, {"cars":0,"bikes":0,"car_parts":0,"plates":0})
    assert s == {"limit":4,"used":0,"remaining":4,"can_request":True,"default_limit":4}

def test_summary_with_partial_usage():
    s = _compute_dealer_listing_limit_summary(4, {"cars":2,"bikes":1,"car_parts":0,"plates":0})
    assert s["used"] == 3 and s["remaining"] == 1 and s["can_request"] is False  # not at cap yet
    # 3 < 4, can still post; upgrade requests still allowed
    assert s["can_request"] is True

def test_summary_at_cap_cannot_request_when_at_or_above():
    s = _compute_dealer_listing_limit_summary(4, {"cars":4,"bikes":0,"car_parts":0,"plates":0})
    assert s["used"] == 4 and s["remaining"] == 0
    # At cap: must request more to keep posting
    assert s["can_request"] is True

def test_summary_below_threshold_cannot_request():
    # Dealers below 80% of cap shouldn't be able to request more
    s = _compute_dealer_listing_limit_summary(10, {"cars":1,"bikes":0,"car_parts":0,"plates":0})
    assert s["can_request"] is False
```

- [ ] **Step 2: Run the test, watch it fail**

`pytest test_dealer_listing_limit.py -v`
Expected: ImportError on `_compute_dealer_listing_limit_summary` and on the import of `_DEFAULT_DEALER_LISTING_LIMIT` from `app` (it lives in `app.py` but the new function doesn't exist yet).

- [ ] **Step 3: Add the pure helper in `app.py` and flip the default**

```python
# app.py around the existing _DEFAULT_DEALER_LISTING_LIMIT line
_DEFAULT_DEALER_LISTING_LIMIT = int(os.getenv("DEFAULT_DEALER_LISTING_LIMIT", "4"))
_DEALER_UPGRADE_REQUEST_MIN_USAGE_RATIO = 0.8  # require 80% of current cap used

def _compute_dealer_listing_limit_summary(limit, counts):
    used = sum(int(v or 0) for v in (counts or {}).values())
    remaining = max(0, int(limit) - used)
    can_request = used >= int(limit) * _DEALER_UPGRADE_REQUEST_MIN_USAGE_RATIO
    return {
        "limit": int(limit),
        "used": used,
        "remaining": remaining,
        "can_request": bool(can_request),
        "default_limit": _DEFAULT_DEALER_LISTING_LIMIT,
    }
```

- [ ] **Step 4: Extend `_fetch_dealer_listing_policy` to also fetch counts and return the summary**

```python
def _fetch_dealer_listing_policy(user_id):
    """Return the full limit summary a dealer panel needs in one call."""
    user_resp, status = supabase_request(
        "get",
        f"/rest/v1/users?id=eq.{user_id}&select=is_dealer,dealer_verified,dealer_listing_limit",
        use_service_role=True,
    )
    if status >= 400 or not user_resp:
        return None
    row = user_resp[0]
    if not row.get("is_dealer"):
        return None
    limit = row.get("dealer_listing_limit")
    if limit is None:
        limit = _DEFAULT_DEALER_LISTING_LIMIT
    limit = int(limit)
    counts, _err = _get_user_listing_counts_by_table(user_id, limit=2000)
    return {
        "verified": bool(row.get("dealer_verified")),
        **_compute_dealer_listing_limit_summary(limit, counts or {}),
    }
```

- [ ] **Step 5: Add the route handler**

```python
@app.route("/api/dealer/listing-limit", methods=["GET"])
@token_required
def dealer_listing_limit(current_user):
    summary = _fetch_dealer_listing_policy(current_user)
    if not summary:
        return jsonify({"error": "Not a dealer"}), 403
    return jsonify(summary), 200
```

- [ ] **Step 6: Run the new tests → green, then run `test_dealer_gate_runtime.py` and `test_dealer_application_lifecycle.py` to confirm no regressions**

`pytest test_dealer_listing_limit.py test_dealer_gate_runtime.py test_dealer_application_lifecycle.py -v`
Expected: All pass.

- [ ] **Step 7: Run the full suite**

`pytest -q`
Expected: ≥ 585 + new = 588+ passed.

- [ ] **Step 8: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_dealer_listing_limit.py
git commit -m "feat(dealer): GET /api/dealer/listing-limit with used/remaining summary (cap=4)"
```

---

## Task 4: Backend — Dealer Listing-Upgrade-Request POST + Admin Email

**Files:**
- Modify: `backend/app.py` — new POST handler, admin email helper, validate reason/length
- Create: `backend/test_dealer_listing_upgrade.py` — endpoint tests

**Interfaces:**
```
POST /api/dealer/listing-upgrade-requests
Body: { "requested_limit": int, "reason": str }
→ 201 { "id": uuid, "status": "pending", "current_limit": int, "requested_limit": int, "created_at": iso }
Errors:
  400 invalid body
  403 not a dealer / not verified
  409 a pending request already exists
  422 requested_limit out of range OR reason too short
```

- [ ] **Step 1: Write failing test — pure validator `validate_upgrade_request`**

```python
# test_dealer_listing_upgrade.py
from app import validate_upgrade_request

def test_validate_ok():
    err = validate_upgrade_request(4, 10, "We have 4 active cars and want to expand the showroom.")
    assert err is None

def test_validate_rejects_too_low():
    err = validate_upgrade_request(4, 1, "Why would we ask for fewer slots?")
    assert err is not None and err["code"] == "invalid_requested_limit"

def test_validate_rejects_zero_or_negative():
    assert validate_upgrade_request(4, 0, "0123456789") is not None
    assert validate_upgrade_request(4, -3, "0123456789") is not None

def test_validate_rejects_over_max():
    assert validate_upgrade_request(4, 1001, "0123456789") is not None
    assert validate_upgrade_request(4, 9999, "0123456789") is not None

def test_validate_rejects_short_reason():
    err = validate_upgrade_request(4, 8, "short")
    assert err is not None and err["code"] == "reason_too_short"

def test_validate_rejects_long_reason():
    err = validate_upgrade_request(4, 8, "x" * 1001)
    assert err is not None and err["code"] == "reason_too_long"

def test_validate_rejects_requested_equal_or_below_current():
    # The point of an upgrade is to grow the cap
    err = validate_upgrade_request(4, 4, "asking for the same number as we have")
    assert err is not None and err["code"] == "invalid_requested_limit"
```

- [ ] **Step 2: Run, watch fail**

`pytest test_dealer_listing_upgrade.py -v`
Expected: ImportError on `validate_upgrade_request`.

- [ ] **Step 3: Add the validator + route + admin email**

```python
# app.py
_DEALER_UPGRADE_REQUEST_REASON_MIN = 10
_DEALER_UPGRADE_REQUEST_REASON_MAX = 1000
_DEALER_UPGRADE_REQUEST_MAX_LIMIT = 1000

def validate_upgrade_request(current_limit, requested_limit, reason):
    try:
        rl = int(requested_limit)
    except (TypeError, ValueError):
        return {"code": "invalid_requested_limit", "message": "requested_limit must be a number"}
    if rl <= int(current_limit):
        return {"code": "invalid_requested_limit",
                "message": "requested_limit must be greater than your current limit"}
    if rl > _DEALER_UPGRADE_REQUEST_MAX_LIMIT:
        return {"code": "invalid_requested_limit",
                "message": f"requested_limit cannot exceed {_DEALER_UPGRADE_REQUEST_MAX_LIMIT}"}
    if not isinstance(reason, str):
        return {"code": "reason_required", "message": "reason is required"}
    r = reason.strip()
    if len(r) < _DEALER_UPGRADE_REQUEST_REASON_MIN:
        return {"code": "reason_too_short",
                "message": f"reason must be at least {_DEALER_UPGRADE_REQUEST_REASON_MIN} characters"}
    if len(r) > _DEALER_UPGRADE_REQUEST_REASON_MAX:
        return {"code": "reason_too_long",
                "message": f"reason must be at most {_DEALER_UPGRADE_REQUEST_REASON_MAX} characters"}
    return None

def _send_dealer_listing_upgrade_admin_notification(request_row, dealer_row):
    from_email = os.getenv("RESEND_FROM_EMAIL")
    if not from_email:
        return None, "Missing RESEND_FROM_EMAIL"
    admin_emails = _fetch_all_admin_emails()
    fallback = os.getenv("RESEND_TO_EMAIL") or PRIMARY_SUPER_ADMIN_EMAIL
    if not admin_emails:
        admin_emails = [fallback]
    dealer_label = (dealer_row or {}).get("legal_business_name") or (dealer_row or {}).get("company_name") or (dealer_row or {}).get("email") or "Dealer"
    subject = f"[Dealer] Listing limit upgrade request — {dealer_label}"
    html = f"""
    <div style="font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#041008;color:#f0fdf4;">
      <h2 style="color:#8bd6b4;margin-top:0;">Dealer requested a higher listing limit</h2>
      <p><strong>Dealer:</strong> {dealer_label}</p>
      <p><strong>Current limit:</strong> {request_row.get("current_limit")}</p>
      <p><strong>Requested limit:</strong> {request_row.get("requested_limit")}</p>
      <p><strong>Reason:</strong></p>
      <blockquote style="border-left:3px solid #8bd6b4;padding-left:12px;margin-left:0;">{request_row.get("reason")}</blockquote>
      <p style="margin-top:24px;"><a href="{SITE_URL}/admin/dealers?tab=upgrade-requests" style="background:#8bd6b4;color:#041008;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Review in admin panel</a></p>
    </div>
    """
    return _send_resend_email({"from": from_email, "to": admin_emails, "subject": subject, "html": html},
                              email_type="dealer_listing_upgrade_request")

@app.route("/api/dealer/listing-upgrade-requests", methods=["POST"])
@token_required
def dealer_create_listing_upgrade_request(current_user):
    body = request.get_json(silent=True) or {}
    # Confirm dealer
    policy = _fetch_dealer_listing_policy(current_user)
    if not policy:
        return jsonify({"error": "Not a dealer"}), 403
    if not policy.get("verified"):
        return jsonify({"error": "Your dealer account must be verified before requesting more listings"}), 403
    err = validate_upgrade_request(policy["limit"], body.get("requested_limit"), body.get("reason", ""))
    if err:
        status = 422 if err["code"] in ("reason_too_short", "reason_too_long", "invalid_requested_limit", "reason_required") else 400
        return jsonify(err), status
    insert, status_code = supabase_request("post", "/rest/v1/dealer_listing_upgrade_requests", data={
        "dealer_id": current_user,
        "current_limit": policy["limit"],
        "requested_limit": int(body["requested_limit"]),
        "reason": body["reason"].strip(),
    }, use_service_role=True)
    if status_code >= 400 or not insert:
        # 23505 = unique_violation: a pending request already exists
        if isinstance(insert, dict) and "duplicate" in str(insert.get("code", "")).lower():
            return jsonify({"error": "You already have a pending upgrade request", "code": "pending_request_exists"}), 409
        if isinstance(insert, dict) and "dealer_listing_upgrade_requests_one_pending" in str(insert.get("message", "")):
            return jsonify({"error": "You already have a pending upgrade request", "code": "pending_request_exists"}), 409
        return jsonify({"error": "Failed to create upgrade request"}), 500
    row = insert[0] if isinstance(insert, list) else insert
    # Notify admins (best-effort)
    try:
        dealer_row, _ = supabase_request(
            "get", f"/rest/v1/users?id=eq.{current_user}&select=email,company_name,legal_business_name",
            use_service_role=True)
        dealer = dealer_row[0] if isinstance(dealer_row, list) and dealer_row else {}
        _send_dealer_listing_upgrade_admin_notification(row, dealer)
    except Exception as exc:
        logger.warning("Dealer upgrade request admin notification failed: %s", exc)
    return jsonify(row), 201
```

- [ ] **Step 4: Run new tests → green, then run full suite**

`pytest test_dealer_listing_upgrade.py -v && pytest -q`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_dealer_listing_upgrade.py
git commit -m "feat(dealer): POST /api/dealer/listing-upgrade-requests with admin email"
```

---

## Task 5: Backend — Admin Listing-Upgrade-Request Queue + Decision Endpoints

**Files:**
- Modify: `backend/app.py` — two new admin endpoints
- Modify: `backend/test_dealer_listing_upgrade.py` — admin tests

**Interfaces:**
```
GET  /api/admin/dealer/listing-upgrade-requests?status=pending
→ 200 [{ id, dealer_id, current_limit, requested_limit, reason, status, created_at, dealer: {...} }, ...]

POST /api/admin/dealer/listing-upgrade-requests/<id>/decision
Body: { "decision": "approve" | "reject", "new_limit"?: int, "note"?: str }
On approve: 200 { new_limit, request: {...}, history: {...} }
On reject:  200 { request: {...} }
Errors: 403 not admin, 404 not found, 409 already resolved
```

- [ ] **Step 1: Write failing test — `decide_upgrade_request` pure helper**

```python
# test_dealer_listing_upgrade.py (append)
from app import decide_upgrade_request

def test_decide_approve_resolves_and_writes_history():
    # returns: new_limit, history_row, err
    nl, hist, err = decide_upgrade_request(
        current_limit=4, requested_limit=10, decision="approve", new_limit=10, admin_id="admin-1")
    assert err is None
    assert nl == 10
    assert hist["source"] == "upgrade_request"
    assert hist["new_limit"] == 10
    assert hist["old_limit"] == 4

def test_decide_approve_requires_explicit_new_limit():
    nl, hist, err = decide_upgrade_request(4, 10, "approve", new_limit=None, admin_id="admin-1")
    assert err is not None and err["code"] == "new_limit_required"

def test_decide_approve_rejects_invalid_new_limit():
    for bad in (0, -1, 1001, 9999):
        _, _, err = decide_upgrade_request(4, 10, "approve", new_limit=bad, admin_id="admin-1")
        assert err is not None and err["code"] == "invalid_new_limit"

def test_decide_reject():
    nl, hist, err = decide_upgrade_request(4, 10, "reject", new_limit=None, admin_id="admin-1")
    assert err is None
    assert nl is None and hist is None

def test_decide_unknown():
    _, _, err = decide_upgrade_request(4, 10, "weird", new_limit=None, admin_id="admin-1")
    assert err is not None and err["code"] == "invalid_decision"
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Add the pure helper and two routes**

```python
def decide_upgrade_request(current_limit, requested_limit, decision, new_limit, admin_id):
    if decision == "reject":
        return None, None, None
    if decision != "approve":
        return None, None, {"code": "invalid_decision", "message": "decision must be 'approve' or 'reject'"}
    if new_limit is None:
        return None, None, {"code": "new_limit_required", "message": "new_limit is required to approve"}
    try:
        nl = int(new_limit)
    except (TypeError, ValueError):
        return None, None, {"code": "invalid_new_limit", "message": "new_limit must be a number"}
    if nl <= 0 or nl > _DEALER_UPGRADE_REQUEST_MAX_LIMIT:
        return None, None, {"code": "invalid_new_limit",
                            "message": f"new_limit must be 1..{_DEALER_UPGRADE_REQUEST_MAX_LIMIT}"}
    history = {
        "old_limit": int(current_limit),
        "new_limit": nl,
        "changed_by": admin_id,
        "source": "upgrade_request",
    }
    return nl, history, None

@app.route("/api/admin/dealer/listing-upgrade-requests", methods=["GET"])
@token_required
def admin_list_listing_upgrade_requests(current_user):
    if not _user_has_admin_role(current_user):
        return jsonify({"error": "Admin only"}), 403
    status_filter = (request.args.get("status") or "pending").strip()
    params = {
        "select": "id,dealer_id,current_limit,requested_limit,reason,status,created_at,resolved_at,resolution_note",
        "status": f"eq.{status_filter}",
        "order": "created_at.desc",
        "limit": "100",
    }
    rows, code = supabase_request("get", "/rest/v1/dealer_listing_upgrade_requests", params=params, use_service_role=True)
    if code >= 400:
        return jsonify({"error": "Failed to fetch upgrade requests"}), 500
    # Join with dealer info in a second query
    dealer_ids = list({r["dealer_id"] for r in (rows or [])})
    dealers = {}
    if dealer_ids:
        # PostgREST `in.(...)` filter
        in_filter = ",".join(dealer_ids)
        drows, dcode = supabase_request(
            "get", "/rest/v1/users",
            params={"id": f"in.({in_filter})",
                    "select": "id,email,company_name,legal_business_name,dealer_listing_limit,is_dealer,dealer_verified"},
            use_service_role=True)
        if dcode < 400 and isinstance(drows, list):
            for d in drows:
                dealers[d["id"]] = d
    for r in (rows or []):
        r["dealer"] = dealers.get(r["dealer_id"], {"id": r["dealer_id"]})
    return jsonify(rows or []), 200

@app.route("/api/admin/dealer/listing-upgrade-requests/<request_id>/decision", methods=["POST"])
@token_required
def admin_decide_listing_upgrade_request(current_user, request_id):
    if not _user_has_admin_role(current_user):
        return jsonify({"error": "Admin only"}), 403
    body = request.get_json(silent=True) or {}
    # Fetch the request
    existing, code = supabase_request("get", f"/rest/v1/dealer_listing_upgrade_requests?id=eq.{request_id}&limit=1",
                                       use_service_role=True)
    if code >= 400 or not existing:
        return jsonify({"error": "Upgrade request not found"}), 404
    req = existing[0]
    if req["status"] != "pending":
        return jsonify({"error": "Request already resolved", "status": req["status"]}), 409
    nl, history, err = decide_upgrade_request(
        req["current_limit"], req["requested_limit"], body.get("decision"),
        body.get("new_limit"), current_user)
    if err:
        status = 400 if err["code"] in ("new_limit_required", "invalid_decision", "invalid_new_limit") else 500
        return jsonify(err), status
    now = _utc_now().isoformat()
    # Two writes: update request status; if approve, also patch user limit + insert history
    patch_resp, patch_code = supabase_request(
        "patch", f"/rest/v1/dealer_listing_upgrade_requests?id=eq.{request_id}",
        data={"status": "approved" if nl else "rejected",
              "resolved_by": current_user,
              "resolved_at": now,
              "resolution_note": (body.get("note") or "").strip() or None},
        use_service_role=True)
    if patch_code >= 400:
        return jsonify({"error": "Failed to update upgrade request"}), 500
    if nl is not None:
        # Update user limit
        _, ucode = supabase_request(
            "patch", f"/rest/v1/users?id=eq.{req['dealer_id']}",
            data={"dealer_listing_limit": nl}, use_service_role=True)
        if ucode >= 400:
            return jsonify({"error": "Failed to update dealer limit"}), 500
        history["reason"] = (body.get("note") or "").strip() or f"Approved upgrade request {request_id}"
        history["request_id"] = request_id
        supabase_request("post", "/rest/v1/dealer_listing_limit_history", data={
            "dealer_id": req["dealer_id"], **history,
        }, use_service_role=True)
        # Best-effort dealer email
        try:
            drow, _ = supabase_request("get", f"/rest/v1/users?id=eq.{req['dealer_id']}&select=email,first_name",
                                        use_service_role=True)
            if drow and drow[0].get("email"):
                from_email = os.getenv("RESEND_FROM_EMAIL")
                if from_email:
                    _send_resend_email({
                        "from": from_email,
                        "to": [drow[0]["email"]],
                        "subject": f"Your DPH Classifieds listing limit has been updated to {nl}",
                        "html": f"<p>Hi {drow[0].get('first_name') or 'there'},</p>"
                                f"<p>Your listing limit has been updated to <strong>{nl}</strong> active ads.</p>"
                                f"<p>You can now post more listings in your <a href='{SITE_URL}/dealer/inventory'>Dealer Inventory</a>.</p>",
                    }, email_type="dealer_listing_limit_updated")
        except Exception as exc:
            logger.warning("Dealer limit update email failed: %s", exc)
    return jsonify({"new_limit": nl, "request": req, "status": "approved" if nl else "rejected"}), 200
```

- [ ] **Step 4: Run new tests + the new endpoint tests → green; full suite**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_dealer_listing_upgrade.py
git commit -m "feat(admin): listing-upgrade-request queue + decision endpoints"
```

---

## Task 6: OCR Auto-Approval — Pure Decision + Service Helper

**Files:**
- Modify: `backend/services/registration_ocr.py` — add `scan_trn_document()` and pure decision `should_auto_approve_dealer(docs, threshold)`
- Create: `backend/test_dealer_ocr_threshold.py` — pure-logic tests

- [ ] **Step 1: Write failing test — `should_auto_approve_dealer`**

```python
# test_dealer_ocr_threshold.py
from services.registration_ocr import should_auto_approve_dealer

def _doc(doc_type, conf, status="approved"):
    return {"document_type": doc_type, "ocr_confidence": conf, "status": status, "replaced_at": None}

def test_both_above_threshold_approves():
    docs = [_doc("trade_license", 0.95), _doc("tax_registration", 0.92)]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is True
    assert decision["min_confidence"] == 0.92

def test_one_below_threshold_blocks():
    docs = [_doc("trade_license", 0.95), _doc("tax_registration", 0.89)]
    decision = should_auto_approve_dealer(docs, threshold=0.90)
    assert decision["approve"] is False
    assert decision["min_confidence"] == 0.89
    assert decision["blocking_field"] == "tax_registration"

def test_missing_doc_blocks():
    decision = should_auto_approve_dealer([_doc("trade_license", 0.95)], threshold=0.90)
    assert decision["approve"] is False
    assert decision["missing"] == ["tax_registration"]

def test_replaced_doc_does_not_count():
    old = _doc("trade_license", 0.95, status="approved")
    old["replaced_at"] = "2026-08-18T12:00:00Z"
    decision = should_auto_approve_dealer([old, _doc("tax_registration", 0.95)], threshold=0.90)
    assert decision["approve"] is False
    assert decision["missing"] == ["trade_license"]

def test_custom_threshold():
    docs = [_doc("trade_license", 0.80), _doc("tax_registration", 0.80)]
    assert should_auto_approve_dealer(docs, threshold=0.90)["approve"] is False
    assert should_auto_approve_dealer(docs, threshold=0.75)["approve"] is True
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement `should_auto_approve_dealer`**

```python
# services/registration_ocr.py
REQUIRED_DEALER_DOCS_FOR_AUTO_APPROVAL = ("trade_license", "tax_registration")

def should_auto_approve_dealer(active_docs, threshold=0.90):
    """Pure decision: should the dealer's KYC auto-approve at fire time?

    - Both required docs must be present and not replaced.
    - min(ocr_confidence) must be >= threshold.
    """
    by_type = {}
    for doc in (active_docs or []):
        if doc.get("replaced_at"):
            continue
        if doc.get("status") not in ("approved", "pending", None):
            # An explicit rejection disqualifies auto-approval
            continue
        by_type[doc.get("document_type")] = doc
    missing = [d for d in REQUIRED_DEALER_DOCS_FOR_AUTO_APPROVAL if d not in by_type]
    if missing:
        return {"approve": False, "missing": missing, "min_confidence": 0.0, "blocking_field": missing[0]}
    confidences = {d: float(by_type[d].get("ocr_confidence") or 0.0) for d in REQUIRED_DEALER_DOCS_FOR_AUTO_APPROVAL}
    min_conf = min(confidences.values())
    if min_conf < float(threshold):
        blocking = min(confidences, key=confidences.get)
        return {"approve": False, "missing": [], "min_confidence": min_conf, "blocking_field": blocking,
                "confidences": confidences}
    return {"approve": True, "missing": [], "min_confidence": min_conf, "blocking_field": None,
            "confidences": confidences}

def scan_trn_document(image_file, ocr_provider=None):
    """Run PaddleOCR on a TRN (Tax Registration) certificate.

    Symmetric to scan_trade_license_expiry: returns the raw text + a confidence
    value so the dealer auto-approval decision has the same shape for both
    required documents. A TRN document has no "expiry" — we only care about
    its overall OCR confidence."""
    provider = ocr_provider or get_default_ocr_provider()
    processed_image = preprocess_image(image_file)
    raw_text, lines = _ocr_extract(provider, processed_image)
    return {
        "raw_text": raw_text or "",
        "lines": lines or [],
        "confidence": round(_overall_text_confidence(lines or []), 4),
    }

def _overall_text_confidence(lines):
    if not lines:
        return 0.0
    return round(sum(float(l.get("conf") or 0) for l in lines) / len(lines), 4)
```

- [ ] **Step 4: Run new tests → green; full suite**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/registration_ocr.py \
        flask-react-supabase-app/backend/test_dealer_ocr_threshold.py
git commit -m "feat(ocr): TRN scanner + should_auto_approve_dealer decision"
```

---

## Task 7: OCR Auto-Approval — Schedule + Worker

**Files:**
- Modify: `backend/app.py` — schedule in `upload_dealer_document`; new route aliases not needed
- Create: `backend/workers/dealer_auto_approval_worker.py`
- Create: `backend/test_dealer_auto_approval_worker.py`

**Interfaces:**
- `workers/dealer_auto_approval_worker.py::run_once()` — processes due rows; idempotent
- `workers/dealer_auto_approval_worker.py::run()` — minute-tick loop wrapper (called from cron)

- [ ] **Step 1: Write failing test — pure worker decision `_fire_pending_approval(row, current_docs, threshold, delay)`**

```python
# test_dealer_auto_approval_worker.py
from workers.dealer_auto_approval_worker import _fire_pending_approval

def test_fire_approves_when_still_high_confidence():
    row = {"id": "p1", "user_id": "u1", "trade_license_confidence": 0.95,
           "tax_registration_confidence": 0.92, "threshold": 0.90, "scheduled_for": "2026-08-18T10:00:00Z"}
    docs = [
        {"document_type": "trade_license", "ocr_confidence": 0.95, "replaced_at": None},
        {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None},
    ]
    out = _fire_pending_approval(row, current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "approve"

def test_fire_cancels_if_doc_replaced():
    replaced = {"document_type": "trade_license", "ocr_confidence": 0.95, "replaced_at": "2026-08-18T10:00:00Z"}
    row = {"id": "p1", "user_id": "u1", "trade_license_confidence": 0.95,
           "tax_registration_confidence": 0.92, "threshold": 0.90, "scheduled_for": "2026-08-18T10:00:00Z"}
    docs = [replaced, {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None}]
    out = _fire_pending_approval(row, current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "cancel"
    assert out["reason"] == "trade_license_replaced"

def test_fire_cancels_if_confidence_dropped():
    row = {"id": "p1", "user_id": "u1", "trade_license_confidence": 0.95,
           "tax_registration_confidence": 0.92, "threshold": 0.90, "scheduled_for": "2026-08-18T10:00:00Z"}
    docs = [
        {"document_type": "trade_license", "ocr_confidence": 0.50, "replaced_at": None},  # dropped
        {"document_type": "tax_registration", "ocr_confidence": 0.92, "replaced_at": None},
    ]
    out = _fire_pending_approval(row, current_docs=docs, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "cancel"
    assert out["reason"] == "confidence_dropped"

def test_fire_skips_if_user_already_verified():
    out = _fire_pending_approval(
        {"id": "p1", "user_id": "u1", "trade_license_confidence": 0.95,
         "tax_registration_confidence": 0.92, "threshold": 0.90, "scheduled_for": "2026-08-18T10:00:00Z"},
        current_docs=[], user_row={"dealer_verified": True}, delay_seconds=0, threshold=0.90)
    assert out["decision"] == "skip"
    assert out["reason"] == "already_verified"
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement the worker (no Flask import, self-contained like the Reddit worker)**

```python
# workers/dealer_auto_approval_worker.py
"""Minute-tick worker that fires pending auto-approvals for dealers.

Self-contained (no `app` import) to match the reddit_daily_post_worker pattern.
The decision is re-evaluated at fire time against the live document rows; if
either required document was replaced or its OCR confidence dropped, the
pending row is cancelled and the user is not auto-approved.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from services.registration_ocr import should_auto_approve_dealer
from services.reddit_import import supabase_request as _supa_unused  # placeholder pattern

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
    import requests
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


def _fetch_due_pending(limit=20):
    """Pull pending rows that are due. The unique partial index guarantees
    at most one pending row per user."""
    body, status = supabase_request(
        "get", "/rest/v1/dealer_pending_approvals",
        params={"select": "*", "state": "eq.pending", "order": "scheduled_for.asc", "limit": str(limit)},
    )
    if status >= 400 or not isinstance(body, list):
        return []
    now = datetime.now(timezone.utc)
    return [r for r in body if r.get("scheduled_for") and
            datetime.fromisoformat(r["scheduled_for"].replace("Z", "+00:00")) <= now]


def _fetch_user(user_id):
    body, status = supabase_request(
        "get", f"/rest/v1/users?id=eq.{user_id}&select=id,is_dealer,dealer_verified,dealer_application_status",
        params={})
    if status < 400 and isinstance(body, list) and body:
        return body[0]
    return None


def _fetch_active_docs(user_id):
    body, status = supabase_request(
        "get", "/rest/v1/dealer_documents",
        params={"user_id": f"eq.{user_id}", "select": "*", "replaced_at": "is.null"})
    if status < 400 and isinstance(body, list):
        return body
    return []


def _mark(row_id, **fields):
    supabase_request("patch", f"/rest/v1/dealer_pending_approvals?id=eq.{row_id}", data=fields)


def _approve_user(user_id):
    from datetime import datetime
    supabase_request("patch", f"/rest/v1/users?id=eq.{user_id}", data={
        "dealer_verified": True,
        "dealer_verified_at": datetime.utcnow().isoformat(),
        "dealer_application_status": "approved",
    })


def _send_approval_email(user_id):
    """Best-effort approval email — the public listing path also re-uses this
    function (see app._send_dealer_status_email). We import lazily so the
    worker stays importable without the full Flask stack."""
    try:
        from app import _send_dealer_status_email
        body, _ = supabase_request("get", f"/rest/v1/users?id=eq.{user_id}&select=email,first_name")
        if body and isinstance(body, list) and body and body[0].get("email"):
            _send_dealer_status_email(
                body[0]["email"], "approved",
                display_name=body[0].get("first_name") or "Dealer",
                origin=os.getenv("SITE_URL", "https://www.dphclassifieds.com"),
            )
    except Exception as exc:
        logger.warning("Dealer approval email failed for %s: %s", user_id, exc)


def _fire_pending_approval(row, current_docs=None, user_row=None, delay_seconds=0, threshold=0.90):
    """Pure decision: what should the worker do with this pending row?

    `current_docs` and `user_row` may be injected by the test suite; the
    production caller fetches them at run time.
    """
    if delay_seconds and row.get("scheduled_for"):
        # Allow tests to simulate "still waiting"
        scheduled = datetime.fromisoformat(row["scheduled_for"].replace("Z", "+00:00"))
        if scheduled > datetime.now(timezone.utc):
            return {"decision": "wait", "reason": "not_due"}
    user = user_row or {}
    if user.get("dealer_verified"):
        return {"decision": "skip", "reason": "already_verified"}
    if not current_docs:
        current_docs = _fetch_active_docs(row["user_id"])
    decision = should_auto_approve_dealer(current_docs, threshold=threshold)
    if not decision["approve"]:
        if decision.get("missing"):
            return {"decision": "cancel", "reason": f"missing:{','.join(decision['missing'])}"}
        return {"decision": "cancel", "reason": "confidence_dropped"}
    return {"decision": "approve"}


def _process_one(row):
    decision = _fire_pending_approval(row, threshold=float(row.get("threshold") or DEFAULT_THRESHOLD))
    if decision["decision"] == "wait":
        return decision
    if decision["decision"] == "skip":
        _mark(row["id"], state="cancelled", cancelled_reason=decision["reason"], fired_at=_utc_now())
        return decision
    if decision["decision"] == "cancel":
        _mark(row["id"], state="cancelled", cancelled_reason=decision["reason"], fired_at=_utc_now())
        return decision
    # approve
    _approve_user(row["user_id"])
    _mark(row["id"], state="fired", fired_at=_utc_now())
    _send_approval_email(row["user_id"])
    return decision


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def run_once():
    if not _truthy(os.getenv("DEALER_AUTO_APPROVAL_ENABLED", "1")):
        return {"status": "disabled"}
    rows = _fetch_due_pending()
    results = {"processed": 0, "approved": 0, "cancelled": 0, "skipped": 0}
    for row in rows:
        d = _process_one(row)
        results["processed"] += 1
        if d["decision"] == "approve":
            results["approved"] += 1
        elif d["decision"] == "cancel":
            results["cancelled"] += 1
        else:
            results["skipped"] += 1
    return {"status": "ok", **results}


def run():
    """Cron entry point: tick once. Scheduler is responsible for the loop."""
    return run_once()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(run_once())
```

- [ ] **Step 4: Wire the upload route to schedule on high-confidence uploads**

Add a helper to `app.py` (placed near the dealer document code):

```python
def _schedule_dealer_auto_approval_if_eligible(user_id):
    """If both required docs are present and clear the OCR threshold, queue a
    delayed auto-approval. Idempotent: the unique partial index ensures one
    pending row per user; a new upload replaces the old pending row by
    cancelling it and inserting a fresh one."""
    from services.registration_ocr import should_auto_approve_dealer
    threshold = float(os.getenv("DEALER_AUTO_APPROVAL_OCR_THRESHOLD", "0.90"))
    delay = int(os.getenv("DEALER_AUTO_APPROVAL_DELAY_SECONDS", "300"))
    docs, code = supabase_request("get", "/rest/v1/dealer_documents",
        params={"user_id": f"eq.{user_id}", "select": "id,document_type,ocr_confidence,replaced_at,status",
                "replaced_at": "is.null"}, use_service_role=True)
    if code >= 400 or not isinstance(docs, list):
        return {"scheduled": False, "reason": "fetch_failed"}
    decision = should_auto_approve_dealer(docs, threshold=threshold)
    if not decision["approve"]:
        return {"scheduled": False, "reason": "not_eligible", "details": decision}
    # Check user is not already verified
    user_body, ucode = supabase_request("get", f"/rest/v1/users?id=eq.{user_id}&select=dealer_verified", use_service_role=True)
    if ucode < 400 and user_body and user_body[0].get("dealer_verified"):
        return {"scheduled": False, "reason": "already_verified"}
    # Cancel any existing pending row (unique partial index would block insert otherwise)
    supabase_request("patch", "/rest/v1/dealer_pending_approvals",
        params={"user_id": f"eq.{user_id}", "state": "eq.pending"},
        data={"state": "cancelled", "cancelled_reason": "rescheduled_by_new_upload"},
        use_service_role=True)
    # Insert new pending row
    from datetime import datetime, timedelta, timezone
    scheduled_for = (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat()
    by_type = {d["document_type"]: d for d in docs}
    insert_body, ic = supabase_request("post", "/rest/v1/dealer_pending_approvals",
        data={"user_id": user_id,
              "trigger_kind": "ocr_high_confidence",
              "scheduled_for": scheduled_for,
              "trade_license_doc_id": (by_type.get("trade_license") or {}).get("id"),
              "tax_registration_doc_id": (by_type.get("tax_registration") or {}).get("id"),
              "trade_license_confidence": (by_type.get("trade_license") or {}).get("ocr_confidence"),
              "tax_registration_confidence": (by_type.get("tax_registration") or {}).get("ocr_confidence"),
              "threshold": threshold},
        use_service_role=True)
    if ic >= 400:
        return {"scheduled": False, "reason": "insert_failed", "details": insert_body}
    return {"scheduled": True, "scheduled_for": scheduled_for, "min_confidence": decision["min_confidence"]}
```

Then inside `upload_dealer_document` (`app.py:9830+`), right after the document row is inserted, add:

```python
# After successful document insert
try:
    schedule_result = _schedule_dealer_auto_approval_if_eligible(current_user)
    logger.info("dealer auto-approval schedule: %s", schedule_result)
except Exception as exc:
    logger.warning("dealer auto-approval scheduling failed: %s", exc)
```

- [ ] **Step 5: Run worker tests → green; full suite**

`pytest test_dealer_auto_approval_worker.py -v && pytest -q`

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/backend/workers/dealer_auto_approval_worker.py \
        flask-react-supabase-app/backend/test_dealer_auto_approval_worker.py \
        flask-react-supabase-app/backend/app.py
git commit -m "feat(dealer): OCR auto-approval worker + 5-min delayed fire"
```

---

## Task 8: Frontend — Dealer Listings Tab Limit Card + Request Modal

**Files:**
- Create: `frontend/src/components/dealer/DealerListingsLimitCard.jsx`
- Modify: wherever the dealer Listings tab is rendered (likely `frontend/src/components/dealer/DealerInventory.jsx` or `DealerLayout.jsx`)

- [ ] **Step 1: Write failing test — pure helper `formatLimitSummary`**

If the frontend has jest configured, write a `*.test.jsx` test. Otherwise keep helpers in a small util file and skip the unit test for the component itself (the API contract test in Task 4 already covers the backend response shape).

- [ ] **Step 2: Implement the card**

```jsx
// DealerListingsLimitCard.jsx
import React, { useEffect, useState } from "react";
import { api } from "@/api";

const formatRemaining = (limit, used) => {
  const remaining = Math.max(0, limit - used);
  return `${used} / ${limit} used (${remaining} remaining)`;
};

export default function DealerListingsLimitCard({ onUpgradeResolved }) {
  const [summary, setSummary] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [pending, setPending] = useState(null);

  const refresh = async () => {
    try {
      const data = await api.get("/api/dealer/listing-limit");
      setSummary(data);
    } catch (e) {
      // Non-fatal: card silently shows "—"
    }
  };
  useEffect(() => { refresh(); }, []);

  if (!summary) return null;

  const atCap = summary.used >= summary.limit;
  const nearCap = !atCap && summary.used >= summary.limit * 0.8;
  return (
    <div className="rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <div className="text-sm text-slate-500">Current limit</div>
        <div className="text-2xl font-semibold">{summary.limit}</div>
        <div className="text-sm mt-1">
          {atCap
            ? <span className="text-red-600 font-medium">You’ve reached your limit.</span>
            : nearCap
              ? <span className="text-amber-600">Approaching your limit.</span>
              : <span className="text-slate-600">{formatRemaining(summary.limit, summary.used)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pending
          ? <span className="text-sm text-slate-500">Request pending review ({pending.requested_limit})</span>
          : (
            <button
              disabled={!summary.can_request}
              onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed">
              Request more listings
            </button>
          )}
      </div>
      {showModal && <RequestModal summary={summary} onClose={() => setShowModal(false)} onSubmitted={(r) => { setPending(r); setShowModal(false); onUpgradeResolved?.(r); }} />}
    </div>
  );
}

function RequestModal({ summary, onClose, onSubmitted }) {
  const [requested, setRequested] = useState(Math.max(summary.limit + 4, 8));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const data = await api.post("/api/dealer/listing-upgrade-requests", { requested_limit: Number(requested), reason });
      onSubmitted(data);
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to submit");
    } finally { setSubmitting(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="bg-white rounded-2xl p-6 w-full max-w-md space-y-3">
        <h3 className="text-lg font-semibold">Request more listings</h3>
        <label className="block">
          <span className="text-sm text-slate-600">Requested limit</span>
          <input type="number" min={summary.limit + 1} max={1000} required
                 value={requested} onChange={(e) => setRequested(e.target.value)}
                 className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">Reason (10–1000 chars)</span>
          <textarea required minLength={10} maxLength={1000} rows={4}
                    value={reason} onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600">Cancel</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-50">
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Mount the card in the dealer Listings tab**

Find the dealer listings component (likely `DealerInventory.jsx` or `DealerListings.jsx` — search for where listings are rendered for a dealer). Add `<DealerListingsLimitCard />` above the listings grid.

- [ ] **Step 4: Build the frontend to verify it compiles**

`cd frontend && npm run build` (or `craco build`)
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dealer/DealerListingsLimitCard.jsx \
        frontend/src/components/dealer/DealerInventory.jsx
git commit -m "feat(dealer-ui): listing limit card with request more modal"
```

---

## Task 9: Frontend — Admin Listing-Upgrade-Request Queue

**Files:**
- Create: `frontend/src/components/admin/AdminDealerUpgradeRequests.jsx`

- [ ] **Step 1: Build the page**

```jsx
// AdminDealerUpgradeRequests.jsx
import React, { useEffect, useState } from "react";
import { api } from "@/api";

const fmt = (iso) => new Date(iso).toLocaleString();

export default function AdminDealerUpgradeRequests() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const load = async () => {
    setLoading(true);
    try { setRows(await api.get("/api/admin/dealer/listing-upgrade-requests?status=pending")); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const decide = async (id, decision, newLimit) => {
    setBusy(id);
    try {
      await api.post(`/api/admin/dealer/listing-upgrade-requests/${id}/decision`,
        { decision, new_limit: newLimit });
      await load();
    } finally { setBusy(null); }
  };

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (!rows.length) return <p className="text-slate-500">No pending upgrade requests.</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-slate-200 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-sm text-slate-500">Dealer</div>
              <div className="font-semibold">{r.dealer?.legal_business_name || r.dealer?.company_name || r.dealer?.email || r.dealer_id}</div>
              <div className="text-sm mt-2"><strong>Current:</strong> {r.current_limit} → <strong>Requested:</strong> {r.requested_limit}</div>
              <p className="text-sm text-slate-600 mt-2"><strong>Reason:</strong> {r.reason}</p>
              <p className="text-xs text-slate-400 mt-1">Submitted {fmt(r.created_at)}</p>
            </div>
            <div className="flex flex-col gap-2 min-w-[200px]">
              <button disabled={busy === r.id} onClick={() => decide(r.id, "approve", r.requested_limit)}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50">
                Approve ({r.requested_limit})
              </button>
              <button disabled={busy === r.id} onClick={() => decide(r.id, "reject")}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `App.js` (or wherever admin routes are registered), add:

```jsx
<Route path="/admin/dealer-upgrade-requests" element={<AdminRoute><AdminDealerUpgradeRequests /></AdminRoute>} />
```

And add a sidebar link in `AdminSidebar.jsx` under "Dealers" → "Listing limit requests".

- [ ] **Step 3: Build the frontend**

`cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/AdminDealerUpgradeRequests.jsx \
        frontend/src/App.js \
        frontend/src/components/AdminSidebar.jsx
git commit -m "feat(admin-ui): listing-upgrade-requests queue page"
```

---

## Task 10: Final Full Test Pass + Push to GitHub

- [ ] **Step 1: Full backend test suite**

`cd backend && source venv/bin/activate && pytest -q`
Expected: ≥ all old + new tests pass.

- [ ] **Step 2: Full frontend build**

`cd frontend && npm run build`
Expected: exit 0.

- [ ] **Step 3: Verify the only-changed-checks rule (per user's instruction)**

For each new test file, run its specific test class and confirm pass:
- `pytest test_reddit_daily_post.py -v`
- `pytest test_dealer_listing_limit.py test_dealer_listing_upgrade.py test_dealer_ocr_threshold.py test_dealer_auto_approval_worker.py -v`
- `pytest test_dealer_verification.py test_dealer_application_lifecycle.py test_dealer_gate_runtime.py -v` (regression check on dealer tests)
- `pytest test_listing_lifecycle.py test_admin_approve_routes.py -v` (regression check on the listing paths that the cap change touches)

- [ ] **Step 4: Git push — single push for the whole feature**

```bash
cd /Users/suhayl/Downloads/Flask-React-superbase-classified
git add -A
git status
git commit -m "feat: DPH daily bot with explicit dates + dealer OCR auto-approval + listing limit requests"
git push -u origin main
```

- [ ] **Step 5: Done — report summary to user**

---

## Self-Review (run before executing)

- [x] Spec coverage:
  - DPH: every-day cadence → Task 1
  - DPH: title shows actual date range → Task 1
  - DPH: body heading matches title → Task 1
  - OCR auto-approval threshold ≥ 0.90 → Task 6
  - Approval email 5 min later → Task 7
  - Posting limit 4 default → Task 3
  - "Current limit: 4" UI → Task 8
  - X / 4 used UI → Task 8
  - "Request more listings" button + reason field → Task 8
  - Admin email distribution for upgrade requests → Task 4
  - Admin can change listing limit → Task 5
  - End-to-end verification → Task 10
  - Single push to GitHub → Task 10

- [x] Placeholder scan: every code step has actual code, not "TBD" / "similar to Task N" / "implement later".

- [x] Type consistency: `build_post` signature changed to `(rows, first_day, last_day, ...)` consistently across all 4 call sites. `_fetch_dealer_listing_policy` returns the same dict shape it already did plus the new summary keys — no breaking change to existing callers (no callers in this repo read those keys today).
