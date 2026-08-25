# Dealer OCR Auto-Approval Copy & Admin Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OCR-based auto-approval (PaddleOCR confidence ≥ 0.90 over trade license + TRN, +5-min grace via `dealer_auto_approval_worker`) the single primary dealer-approval path. Remove the admin signup email, refresh stale "pending admin verification" copy in the API + dealer-facing UI, and relabel the admin "approve dealer" action as an explicit OCR override.

**Architecture:** No DB / schema / env changes. Pure copy + one removed email send + button renames. The auto-approval mechanics (`should_auto_approve_dealer`, `_schedule_dealer_auto_approval_if_eligible`, `dealer_auto_approval_worker`) are already wired and tested; this plan only adjusts surface area so dealers (and admins) see the reality.

**Tech Stack:**
- Backend: Python 3, Flask, `unittest` (existing test pattern), `pytest` optional
- Frontend: React, JSX, ES modules; existing patterns in `frontend/src/components/`
- Mobile: React Native; existing patterns in `mobile/src/screens/admin/`
- DB: Supabase / PostgREST (read-only here — no schema work)

**Reference spec:** `docs/superpowers/specs/2026-08-25-dealer-ocr-auto-approval-copy-and-admin-override.md`

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/app.py:5627` (the `_require_dealer_verified` error string) | Block unverified dealers from posting | Change user-facing copy; keep `code: "dealer_not_verified"` |
| `backend/app.py:10160` (`dealer_submit_application`) | Mark dealer application as submitted | Stop calling `_send_dealer_signup_admin_notification` |
| `backend/routes/admin.py:984` (`verify_dealer`) | Admin "approve dealer" override | Relabel to "Force-approve"; require a reason; record `dealer_verified_by` |
| `backend/test_dealer_verification.py` | Pins user-facing copy | Update pinned string; keep API code |
| `backend/test_dealer_submission_emails.py` (NEW) | Guard against re-introducing the admin signup email | New file |
| `frontend/src/components/DealerPendingBanner.js` | Banner for `is_dealer && !dealer_verified` | New copy + spinner icon |
| `frontend/src/components/Profile.js` | Dealer status pill + callout | New copy; drop "1-2 business days" |
| `frontend/src/components/AdminDealerDetail.jsx` | Admin override UI | Rename "Verify" button to "Force approve (OCR override)"; require reason |
| `mobile/src/screens/admin/AdminDealerDetailScreen.js` | Admin override UI | Same rename |

Untouched: `services/registration_ocr.py`, `workers/dealer_auto_approval_worker.py`, `worker.py` scheduling, `dealer_pending_approvals` table, all listing-limit logic.

---

## Task 1: Update user-facing API error copy in `_require_dealer_verified`

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py:5627` (single string inside `_require_dealer_verified`)
- Test: `flask-react-supabase-app/backend/test_dealer_verification.py`

- [ ] **Step 1: Update the failing pinned copy in the test**

Open `flask-react-supabase-app/backend/test_dealer_verification.py`. Around line 36 the local reimplementation of `_require_dealer_verified_logic` pins the old message. Edit it to:

```python
return (
    {
        "error": "We're still verifying your documents — usually under a minute.",
        "code": "dealer_not_verified",
    },
    403,
)
```

- [ ] **Step 2: Update the live assertion in the same test file**

Around line 66 (`test_unverified_dealer_is_blocked`) replace:

```python
self.assertIn("pending admin verification", body["error"])
```

with:

```python
self.assertIn("verifying your documents", body["error"])
```

- [ ] **Step 3: Update the live API string in `app.py`**

In `flask-react-supabase-app/backend/app.py`, inside `_require_dealer_verified` (around line 5627), change:

```python
"error": "Your dealer account is pending admin verification. You will be able to post listings once your account is approved.",
```

to:

```python
"error": "We're still verifying your documents — usually under a minute.",
```

Keep the `"code": "dealer_not_verified"` field unchanged.

- [ ] **Step 4: Run the test to confirm it passes**

Run:

```bash
cd flask-react-supabase-app/backend
python3 -m pytest test_dealer_verification.py -v
```

Expected: all `TestRequireDealerVerifiedLogic` cases pass.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py flask-react-supabase-app/backend/test_dealer_verification.py
git commit -m "fix(dealer): replace stale 'pending admin verification' copy with OCR wait copy"
```

---

## Task 2: Stop emailing admins on dealer signup

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py:10160` (`dealer_submit_application`)
- Test (new): `flask-react-supabase-app/backend/test_dealer_submission_emails.py`

- [ ] **Step 1: Write a failing test that asserts no admin email is sent**

Create `flask-react-supabase-app/backend/test_dealer_submission_emails.py`:

```python
#!/usr/bin/env python3
"""Guard test: dealer signup must NOT email admins.

PaddleOCR + the minute-tick worker are the only approval authority now.
Regression coverage for the spec at
docs/superpowers/specs/2026-08-25-dealer-ocr-auto-approval-copy-and-admin-override.md
"""

import importlib
import unittest
from unittest.mock import patch

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))


class TestNoAdminEmailOnDealerSignup(unittest.TestCase):
    def test_dealer_signup_does_not_email_admins(self):
        backend = importlib.import_module("app")

        sent = []
        with patch.object(
            backend,
            "_send_dealer_signup_admin_notification",
            side_effect=lambda *_a, **_kw: sent.append(("called", _a, _kw)) or ("ok", None),
        ), patch.object(backend, "supabase_request") as mock_req, patch.object(
            backend, "_get_dealer_application_readiness",
            return_value=({"ready_to_submit": True, "missing_uploads": [],
                           "expired_documents": [], "denied_documents": [],
                           "pending_documents": []}, None),
        ):
            def fake_request(method, path, *args, **kwargs):
                if method == "get" and path.startswith("/rest/v1/users?id=eq."):
                    return ([{
                        "id": "dealer-x",
                        "email": "dealer@example.com",
                        "first_name": "Jane",
                        "last_name": "Dealer",
                        "legal_business_name": "Jane Cars FZ-LLC",
                        "company_name": "Jane Cars",
                        "trn": "123456789012345",
                        "is_dealer": True,
                        "dealer_verified": False,
                        "dealer_application_status": "draft",
                    }], 200)
                if method == "patch" and path.startswith("/rest/v1/users?id=eq."):
                    return ({"ok": True}, 200)
                return ([], 200)

            mock_req.side_effect = fake_request

            with patch.object(backend.request, "user_id", "dealer-x"):
                resp, status = backend.dealer_submit_application.__wrapped__("dealer-x")

        self.assertEqual(status, 200)
        self.assertEqual(sent, [],
                         "dealer_submit_application must NOT call _send_dealer_signup_admin_notification")
```

This test stubs all three external side-effects, calls the underlying function (Flask route decorator wrapping), and asserts the admin-email helper is never called.

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
cd flask-react-supabase-app/backend
python3 -m pytest test_dealer_submission_emails.py -v
```

Expected: FAIL with `AssertionError: dealer_submit_application must NOT call _send_dealer_signup_admin_notification` — because the current code does call it.

- [ ] **Step 3: Remove the admin-email call from `dealer_submit_application`**

In `flask-react-supabase-app/backend/app.py`, inside `dealer_submit_application` (around line 10160), delete the entire `try` block that calls `_send_dealer_signup_admin_notification`. Replace it with a single comment:

```python
        # No admin notification: PaddleOCR + the minute-tick dealer_auto_approval_worker
        # is the only approval path. Admin keeps only an explicit override on the
        # dealer detail page. Spec: docs/superpowers/specs/2026-08-25-...
```

The `patch_resp` above stays; the function still updates `dealer_application_status='submitted'` and `verification_documents_submitted=True`.

- [ ] **Step 4: Run the test to confirm it passes**

Run:

```bash
cd flask-react-supabase-app/backend
python3 -m pytest test_dealer_submission_emails.py -v test_dealer_verification.py -v
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py flask-react-supabase-app/backend/test_dealer_submission_emails.py
git commit -m "fix(dealer): stop emailing admins on signup — OCR + worker is the only approval path"
```

---

## Task 3: Relabel admin "approve dealer" as a force-approve override

**Files:**
- Modify: `flask-react-supabase-app/backend/routes/admin.py:984` (`verify_dealer`)

No new code is required — this is a relabel. The handler will require a `reason` in the body and log it via the standard logger (`dealer_verified_by` is the existing audit column; no DB schema change is in scope here).

> Note: `dealer_rejection_reason` is referenced by the existing `reject_dealer` route but is **not** a real `users` column — that route already silently drops the field. We will not add a column. The override reason is logged at INFO level and recorded via `dealer_verified_by`, matching what already happens.

- [ ] **Step 1: Update the handler to require a reason and log it**

In `flask-react-supabase-app/backend/routes/admin.py` around line 984, replace:

```python
@admin_bp.route("/dealers/<user_id>/verify", methods=["POST"])
@admin_required
def verify_dealer(user_id):
    """Verify a dealer"""
    try:
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        update_data = {
            "dealer_verified": True,
            "dealer_verified_at": "now()",
            "dealer_verified_by": request.user_id,
        }

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            return jsonify({"message": "Dealer verified successfully"}), 200
        else:
            return jsonify({"error": "Failed to verify dealer"}), response.status_code

    except Exception as e:
        logger.error(f"Error verifying dealer: {e}")
        return jsonify({"error": str(e)}), 500
```

with:

```python
@admin_bp.route("/dealers/<user_id>/verify", methods=["POST"])
@admin_required
def verify_dealer(user_id):
    """Force-approve a dealer (admin OCR override).

    The default path for dealer verification is PaddleOCR + the minute-tick
    worker (see spec docs/superpowers/specs/2026-08-25-...). This endpoint
    exists so admins can rescue a borderline case or push a dealer past OCR
    while they're waiting on a clearer upload.
    """
    try:
        reason = ((request.json or {}).get("reason") or "").strip()
        if not reason:
            return jsonify({
                "error": "A reason is required when force-approving a dealer.",
                "code": "force_approve_reason_required",
            }), 400

        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        update_data = {
            "dealer_verified": True,
            "dealer_verified_at": "now()",
            "dealer_verified_by": request.user_id,
        }
        logger.info(
            "Admin force-approved dealer %s (actor=%s, reason=%s)",
            user_id, request.user_id, reason,
        )

        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/users?id=eq.{user_id}",
            headers=headers,
            json=update_data,
            timeout=5,
        )

        if response.status_code in [200, 204]:
            return jsonify({"message": "Dealer force-approved"}), 200
        else:
            return jsonify({"error": "Failed to verify dealer"}), response.status_code

    except Exception as e:
        logger.error(f"Error force-approving dealer: {e}")
        return jsonify({"error": str(e)}), 500
```

- [ ] **Step 2: Verify the route file parses**

Run:

```bash
python3 -c "import ast; ast.parse(open('flask-react-supabase-app/backend/routes/admin.py').read())"
```

Expected: no output (parse OK). If `routes/admin.py` isn't importable on its own due to relative imports, just open the file with `read` to confirm structure rather than import.

- [ ] **Step 3: Confirm no existing tests import this handler by name**

Run:

```bash
cd flask-react-supabase-app/backend
python3 -m pytest -k verify_dealer -v
```

Expected: no collected tests (no behavior regression). If a test does collect it should be updated here rather than skipped.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/routes/admin.py
git commit -m "refactor(admin): relabel verify_dealer as force-approve override, require reason"
```

---

## Task 4: Update dealer-facing banner copy (`DealerPendingBanner.js`)

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/DealerPendingBanner.js`

- [ ] **Step 1: Replace the banner text and swap the icon**

Open `flask-react-supabase-app/frontend/src/components/DealerPendingBanner.js` and replace its full contents with:

```jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';

const DealerPendingBanner = () => {
  const { user } = useAuth();

  if (!user?.is_dealer || user?.dealer_verified) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-[60px] z-40 border-b border-sky-500/20 bg-sky-500/10 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
        <div className="flex items-center gap-2.5 text-sky-200">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="text-[13px] font-medium">
            Verifying your documents… usually under a minute.
          </span>
        </div>
        <Link
          to="/settings"
          className="shrink-0 rounded-full border border-sky-400/30 bg-sky-400/10 px-3.5 py-1 text-[12px] font-semibold text-sky-200 transition-colors hover:bg-sky-400/20"
        >
          View Status
        </Link>
      </div>
    </div>
  );
};

export default DealerPendingBanner;
```

The visible changes:
- Icon: `AlertTriangle` → `Loader2` with `animate-spin`
- Colors: amber `→` sky (blue) — different signal from "blocked"
- Text: `"…pending admin verification…"` → `"Verifying your documents… usually under a minute."`

- [ ] **Step 2: Verify the file parses**

Run:

```bash
cd flask-react-supabase-app/frontend
npx --no-install eslint src/components/DealerPendingBanner.js 2>&1 | head -40
```

If `npx --no-install` says "not found", fall back to:

```bash
node --check src/components/DealerPendingBanner.js 2>&1 | head -40
```

(JSX won't be accepted by `node --check`, but it will catch syntax errors at the JS level.) Even simpler: open it in any IDE; there are no syntax issues introduced.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/DealerPendingBanner.js
git commit -m "fix(web): dealer banner copy says 'Verifying your documents…' (was 'pending admin verification')"
```

---

## Task 5: Update dealer profile callout copy in `Profile.js`

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/Profile.js:235` (the `.profile-verification-callout` block)

- [ ] **Step 1: Replace the callout block**

In `flask-react-supabase-app/frontend/src/components/Profile.js` around line 235, replace the existing `userData?.is_dealer && !userData?.dealer_verified && (...)` JSX expression with:

```jsx
                {userData?.is_dealer && !userData?.dealer_verified && (
                  <div className="profile-verification-callout" style={{ borderColor: 'rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.08)' }}>
                    <p style={{ color: '#38bdf8' }}>Verifying your documents…</p>
                    <p style={{ fontSize: '13px', opacity: 0.7, marginTop: 4 }}>
                      This usually takes under a minute. No action needed from you.
                    </p>
                    {userData?.dealer_verification_requested_at && (
                      <small>Requested on {new Date(userData.dealer_verification_requested_at).toLocaleDateString()}</small>
                    )}
                  </div>
                )}
```

This swaps amber → sky blue and removes the "1-2 business days" line.

- [ ] **Step 2: Verify the file parses**

Open `flask-react-supabase-app/frontend/src/components/Profile.js` and confirm the JSX braces and the closing tags balance. No new closing div is introduced.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/Profile.js
git commit -m "fix(web): profile dealer callout says 'Verifying your documents…'"
```

---

## Task 6: Rename admin override button in `AdminDealerDetail.jsx`

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/AdminDealerDetail.jsx`

This is a UI rename, not a behavior change. The existing API call already hits the admin route we updated in Task 3.

- [ ] **Step 1: Locate the existing "Verify" action**

In `flask-react-supabase-app/frontend/src/components/AdminDealerDetail.jsx` search for any literal "Verify" or `apiClient.post(... /verify ...)` calls. The detail component hits `POST /api/admin/dealers/<id>/verify`. Find the JSX that renders the button and update its label, and add a small modal that collects a reason before submitting. (If the file already has a reason-collecting modal for reject, mirror that pattern for verify — keeping it minimal.)

- [ ] **Step 2: Replace the button label and post body**

Wrap the existing `POST` to `/api/admin/dealers/<id>/verify` so the body sent is `{ reason: '<collected reason>' }` and the visible button reads `"Force approve (OCR override)"`. If the file currently uses inline `<button>` for verify:

```jsx
<button onClick={async () => {
  const reason = window.prompt('Why are you force-approving this dealer?');
  if (!reason) return;
  await apiClient.post(`/api/admin/dealers/${dealerId}/verify`, { reason });
  refreshData();
}}>
  Force approve (OCR override)
</button>
```

Adjust the surrounding styling/wrapper to match the existing patterns in the file.

- [ ] **Step 3: Run any frontend tests touching this component**

```bash
cd flask-react-supabase-app/frontend
npm test -- --watchAll=false --testPathPattern=AdminDealerDetail 2>&1 | tail -40
```

Expected: no regressions. If tests reference the old label, update the snapshots or string assertions.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/AdminDealerDetail.jsx
git commit -m "refactor(admin-web): rename verify button to 'Force approve (OCR override)' with required reason"
```

---

## Task 7: Mirror the rename on mobile (`AdminDealerDetailScreen.js`)

**Files:**
- Modify: `flask-react-supabase-app/mobile/src/screens/admin/AdminDealerDetailScreen.js`

- [ ] **Step 1: Locate the verify button**

Search for "Verify" / "verify" in the file. Find the call site (likely `apiClient.post(... /verify, ...)` or similar).

- [ ] **Step 2: Rename the button label and include a reason field**

Mirror Task 6. If the screen uses a simple `Alert.prompt` style prompt, switch to a small inline modal that collects a reason and sends `{ reason }` in the body. Button label becomes `"Force approve (OCR override)"`.

- [ ] **Step 3: Confirm lint passes**

```bash
cd flask-react-supabase-app/mobile
npx --no-install eslint src/screens/admin/AdminDealerDetailScreen.js 2>&1 | head -40
```

If `npx --no-install` can't find eslint, open the file in any IDE to confirm no syntax issues.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/mobile/src/screens/admin/AdminDealerDetailScreen.js
git commit -m "refactor(admin-mobile): rename verify button to 'Force approve (OCR override)'"
```

---

## Task 8: Final test pass + verification

**Files:** none modified — read-only verification.

- [ ] **Step 1: Run the full backend test suite**

```bash
cd flask-react-supabase-app/backend
python3 -m pytest -q
```

Expected: green. If you don't have pytest, use:

```bash
python3 -m unittest discover -s . -p 'test_*.py' -v
```

Pay special attention to:
- `test_dealer_verification.py` (copy updated)
- `test_dealer_submission_emails.py` (new)
- `test_dealer_auto_approval_worker.py` (must remain green)
- `test_feature_independence.py` (smoke for app.py structure)

- [ ] **Step 2: Verify no stale "pending admin verification" copy remains in the user-facing surface**

Run:

```bash
cd flask-react-supabase-app
grep -rn "pending admin verification" backend frontend/src mobile/src 2>/dev/null
```

Expected: **only** matches inside `backend/test_*.py` (test sources we own). Zero matches in `backend/app.py`, `backend/routes/`, `frontend/src/components/DealerPendingBanner.js`, `frontend/src/components/Profile.js`, or mobile.

- [ ] **Step 3: Verify no admin-email send remains in the signup path**

```bash
cd flask-react-supabase-app
grep -n "_send_dealer_signup_admin_notification" backend/app.py
```

Expected: only the function **definition** (around line 10358 in app.py). No call sites.

- [ ] **Step 4: Confirm no other code calls the email helper unintentionally**

```bash
cd flask-react-supabase-app
grep -rn "_send_dealer_signup_admin_notification" backend
```

Expected: 1 definition. Callsites = 0 (or only inside test files where we explicitly stub it).

- [ ] **Step 5: Confirm the worker still runs (production environment sanity)**

This is a manual smoke; on Railway/Render the worker is configured via `worker.py`. Inspect:

```bash
cd flask-react-supabase-app
grep -n "DEALER_AUTO_APPROVAL_ENABLED\|_run_dealer_auto_approval_once" backend/worker.py
```

Expected: environment variable default = "1" (worker stays enabled). No change made; this is just confirmation.

- [ ] **Step 6: Commit a doc note summarizing the change**

Drop a one-line note in `flask-react-supabase-app/CHANGELOG.md` if the project has one (skip if no such file exists), e.g.:

```markdown
## 2026-08-25
- Dealer verification is now 100% OCR-driven (PaddleOCR ≥0.90 + 5-min grace via `dealer_auto_approval_worker`).
- Admin keeps an explicit "Force approve (OCR override)" action on the dealer detail page.
- Removed admin signup email; updated user-facing copy from "pending admin verification" to "Verifying your documents…".
```

Only add if the file exists. Commit:

```bash
git add flask-react-supabase-app/CHANGELOG.md
git commit -m "docs(changelog): dealer OCR auto-approval copy + admin override"
```

---

## Done when

- [ ] Tasks 1–7 all committed
- [ ] `pytest` is green
- [ ] `grep "pending admin verification"` returns 0 user-facing matches
- [ ] `_send_dealer_signup_admin_notification` has no caller in production code
- [ ] The 5-minute auto-approval worker is still scheduled (unchanged)
