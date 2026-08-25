# Dealer verification: drop the admin gate, OCR-only auto-approval

**Date:** 2026-08-25
**Status:** Approved for implementation

## Problem

Dealers currently see "Your dealer account is pending admin verification" after signup, but no admin reviews the application anymore — the `dealer_auto_approval_worker` flips `dealer_verified=true` ~5 minutes after both required documents clear PaddleOCR with confidence ≥ 0.90. The user-facing copy is stale and misleads dealers into believing they are waiting on a human, when in fact they are waiting on OCR.

## Goal

Make the OCR-based auto-approval the single, primary dealer approval path. Admin keeps an "override" action only as a rescue / revocation channel. No changes to the listing-cap default or the dealer-initiated upgrade flow.

## Lifecycle (target)

```
signup (isDealer=true, TRN, legal name)
   │
   ▼
upload trade_license  ── OCR ──┐
upload tax_registration ─ OCR ─┤── both present + min(confidence)>=0.90
                              ▼
            dealer_pending_approvals (state=pending, +5min)
                              ▼
        dealer_auto_approval_worker (minute tick)
          re-eval at fire time, cancel if doc replaced
                              ▼
            users.dealer_verified = true          (dealer can post)
              limit = DEFAULT_DEALER_LISTING_LIMIT (4)
                              ▼
              dealer posts until 4/4 → requests upgrade
              → admin raises dealer_listing_limit
```

## Approved design choices

| Decision | Choice |
|---|---|
| Auto-approval timing | Keep 5-min OCR grace window via `dealer_auto_approval_worker` |
| Admin override | Keep. Dealer still self-approves on docs; admin "Force approve (OCR override)" remains for rescue, plus revoke |
| Wait-window copy | "Verifying your documents…" |
| Listing-limit upgrade flow | Keep `dealer_listing_upgrade_requests` unchanged |

## Behavior changes

| # | File / location | Before | After |
|---|---|---|---|
| 1 | `backend/app.py:5627` (the `_require_dealer_verified` error message) | `"Your dealer account is pending admin verification. You will be able to post listings once your account is approved."` | `"We're still verifying your documents — usually under a minute."` (keep `code: "dealer_not_verified"`) |
| 2 | `frontend/src/components/DealerPendingBanner.js:19` | `"Your dealer account is pending admin verification. You cannot post listings until approved."` | `"Verifying your documents…"` plus a small spinner / refresh hint |
| 3 | `frontend/src/components/Profile.js:237` | `"Your dealer account is pending admin verification."` (+ the "1-2 business days" subline) | `"Verifying your documents… usually under a minute."` |
| 4 | `backend/app.py:10160 dealer_submit_application` | Calls `_send_dealer_signup_admin_notification` → email to every admin | Remove the call. No email is sent on signup; worker is the only authority |
| 5 | `backend/workers/dealer_auto_approval_worker.py` minute tick | (already primary) | Unchanged. Still flips `dealer_verified=true` and sends the welcome email to the dealer |
| 6 | `backend/routes/admin.py:997` admin "approve dealer" POST | Primary action | Relabel to "Force-approve (OCR override)". Require a reason. Keep audit fields |
| 7 | `backend/app.py:19531` legacy `api_admin_approve_item` dealer type | Primary action | Same — relabel only. Keep code for back-compat |
| 8 | `frontend/src/components/AdminDealerDetail.jsx` action button(s) | Primary "Approve" | Single "Force approve (OCR override)" with reason field; keep existing Revoke |
| 9 | `mobile/src/screens/admin/AdminDealersScreen.js` and `AdminDealerDetailScreen.js` | "Verified / Pending" badges | Keep badges; tooltip on "Pending" → "Awaiting OCR" |
| 10 | `backend/app.py:_require_dealer_verified` blocker | unchanged | unchanged; API code stays `dealer_not_verified` |
| 11 | Listing cap (default 4) and `dealer_listing_upgrade_requests` flow | unchanged | unchanged |
| 12 | `backend/test_dealer_verification.py` and friends | pin the old admin-gate copy | re-pin to the new copy + still assert `code == "dealer_not_verified"` |

## Out of scope

- No changes to `should_auto_approve_dealer()` semantics or threshold
- No changes to `dealer_pending_approvals` schema or unique partial index
- No changes to `_DEALER_REQUIRED_DOCS` (`trade_license`, `tax_registration`)
- No changes to `dealer_documents` table or storage
- No new env vars
- No email-template redesign — the existing "approved" dealer email stays
- No changes to limit / upgrade mechanics

## Failure / edge cases

- **OCR fails / low confidence** → `should_auto_approve_dealer` returns `approve=false`, no pending row inserted, dealer stays unverified, sees "Verifying your documents…", re-uploads a clearer doc which restarts the 5-min window
- **Worker falls behind (app redeploy)** → `scheduled_for` is wall-clock; next tick re-evaluates and either fires or cancels
- **Dealer replaces a doc between upload and fire** → worker sees `replaced_at != null`, cancels pending row, dealer stays unverified (existing behavior)
- **Admin override needed** → AdminDealerDetail force-approve button uses the existing admin route, writes `dealer_verified=true` + `dealer_verified_by`, audit row in `dealer_listing_limit_history` only on cap changes (unchanged)

## Test plan

- `test_dealer_auto_approval_worker.py` (existing) — covers happy / cancel / replace paths; no change needed
- New `test_dealer_submission_emails.py` — assert `_send_dealer_signup_admin_notification` is **not** called from `dealer_submit_application`. Stub the Resend call.
- `test_dealer_verification.py` — update pinned string to the new copy; keep assertion that `code == "dealer_not_verified"`
- `test_signup_no_admin_email_for_dealer.py` — assert `_send_dealer_signup_admin_notification` is invoked 0 times across a dealer signup flow
- Manual smoke: signup as dealer → upload both docs with clear scans → after ~5 min, refresh, `dealer_verified=true`, banner gone, listing-create succeeds

## Acceptance criteria

1. A dealer who uploads both required documents with OCR confidence ≥ 0.90 becomes `dealer_verified=true` automatically within 5 minutes without any human action
2. No email is sent to admins on dealer signup
3. The user-facing copy says "Verifying your documents…" while the worker is in flight; never references admins
4. Admin can still force-approve or revoke a dealer from AdminDealerDetail; both actions are logged
5. All existing tests pass after copy updates; new tests for "no admin email on signup" pass
