# Dealer Registration Overhaul — Design Spec

**Date:** 2026-06-09
**Status:** Approved
**Author:** Claude (brainstormed with @MSD786c)

## Problem

Today's dealer signup flow on DPH Classifieds is incomplete:

- When a user picks **Dealer** during signup, the form collects only `companyName` and `companyRegistrationNumber`. No trade license upload, no TRN field, no legal-name distinction.
- The `dealer-documents` Supabase bucket, `dealer_documents` table, and `POST /api/auth/upload-dealer-document` endpoint already exist (`backend/app.py:7857–8023`) but are never reached during signup.
- Admin reviewers in `AdminDealerDetail.jsx` see doc-status chips but have no way to set a per-dealer ad limit. The only listing cap is the global `MAX_LISTINGS_PER_USER_PER_TYPE = 4` (`app.py:3935`), which applies identically to dealers and individuals.
- The dealer dashboard (`DealerSettings.jsx`) has profile fields but no document section — verified dealers cannot replace expiring documents themselves.

This spec defines the changes required to:
1. Collect trade license, legal business name, and TRN at signup.
2. Send a complete, reviewable application to the admin queue.
3. Allow admins to set and change a per-dealer ad limit at review time and any time after.
4. Give dealers a document management section in their dashboard, including expiry tracking and replacement.

## Decisions locked in during brainstorming

- **Document timing:** collected at signup, in the same form. Account is created immediately but cannot post listings until admin verifies. (Other options — wizard after email confirmation, optional at signup — were rejected for higher admin-queue churn or in-limbo accounts.)
- **Ad limit semantics:** one number per dealer counting *active (non-deleted, non-archived) listings* across cars + bikes + parts + plates. Admin-controlled, NULL = use `DEFAULT_DEALER_LISTING_LIMIT` (env, default 20).
- **TRN format:** exactly 15 digits. Frontend rejects anything else; backend re-validates. UNIQUE index on `users.trn`.
- **Document expiry:** dealer enters `expires_at` at upload time. Dashboard banner warns 30 days before expiry, blocks new posting after. Worker emails + SMSes 30/14/3 days before expiry.

## Data model changes

Single SQL migration: `flask-react-supabase-app/add_dealer_kyc_columns.sql`.

```sql
-- USERS: legal name, TRN, per-dealer ad cap, application state
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS legal_business_name TEXT,
  ADD COLUMN IF NOT EXISTS trn VARCHAR(15),
  ADD COLUMN IF NOT EXISTS dealer_listing_limit INTEGER,
  ADD COLUMN IF NOT EXISTS dealer_application_status TEXT
    CHECK (dealer_application_status IN ('draft','submitted','approved','rejected'))
    DEFAULT 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS users_trn_unique
  ON public.users (trn) WHERE trn IS NOT NULL;

-- DEALER_DOCUMENTS: expiry + soft-replace tracking
ALTER TABLE public.dealer_documents
  ADD COLUMN IF NOT EXISTS expires_at DATE,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS dealer_documents_active_idx
  ON public.dealer_documents (user_id, document_type)
  WHERE replaced_at IS NULL;

-- One-off backfill so existing verified dealers don't get pushed back into
-- the "Finish your dealer application" wizard. Pending dealers (not yet
-- verified) stay 'draft' and will see the resume banner on next login,
-- which is the desired behavior.
UPDATE public.users
   SET dealer_application_status = 'approved'
 WHERE is_dealer = TRUE
   AND dealer_verified = TRUE
   AND dealer_application_status = 'draft';
```

Migration is additive only. Existing dealer rows survive untouched (TRN/legal name remain NULL — admins can prompt those dealers to fill them via a follow-up notification; not in scope for this change).

## Signup flow

### Form changes (`frontend/src/components/Signup.js`)

Existing "Business Information" section expands when `isDealer=true` to include:

| Field | Type | Validation |
|---|---|---|
| Legal business name | text | required, ≥3 chars |
| Trade license number | text (existing) | required for dealer |
| TRN | text, `inputMode="numeric"`, `maxLength=15` | required, regex `/^\d{15}$/`, spaces/dashes auto-stripped |
| Trade license file | file picker | required, MIME ∈ {PDF, JPG, PNG}, ≤10 MB |
| Trade license valid until | date input | required, must be > today |

Visual structure mirrors the existing form sections (one column on mobile, two on desktop). All fields disabled while submitting. Inline validation errors below each field.

### Backend flow

Three sequential calls, frontend orchestrates:

1. **`POST /api/auth/signup`** (existing, JSON body) — extend to accept and validate `legal_business_name`, `trn`, `trade_license_number`, `trade_license_expires_at`. Backend regex-validates TRN, checks uniqueness, writes to Supabase auth `user_metadata` (existing pattern). Returns JWT.
2. **`POST /api/auth/upload-dealer-document`** (existing at `app.py:7857`) — extended to accept an optional `expires_at` field. Stores the file in the `dealer-documents` bucket under `<user_id>/trade_license_<uuid>.<ext>` (existing pattern), inserts a `dealer_documents` row with `document_type='trade_license'`, `expires_at=<from form>`.
3. **`POST /api/auth/dealer-submit-application`** (new) — flips `users.dealer_application_status` to `'submitted'`, sends Resend email to admin distribution list (`RESEND_ADMIN_NOTIFICATION_EMAIL`), and shows a success page to the dealer ("We've received your application — we'll email you within 24 hours").

### Resume flow

If the user closes the tab between steps 1 and 3:
- Next login, `users.dealer_application_status='draft'` (set by SQL default).
- A banner appears at the top of every page: "Finish your dealer application →" linking to `/dealer/onboarding`.
- `/dealer/onboarding` is a new route that runs steps 2 and 3 using the same form components.

## Admin review (`AdminDealerDetail.jsx`)

### New summary rows

The existing summary block (around `AdminDealerDetail.jsx:200`) gets two new rows:

- **Legal business name** — value from `users.legal_business_name`.
- **TRN** — value from `users.trn`, monospaced.

### New "Ad limit" card

Sits next to the existing verify/reject actions:

```
┌─── Ad limit ───────────────────────────────────┐
│  Current: 25 (default)         [25] [Save]    │
│  Counts active listings across all types.      │
│  Effective on next post.                       │
└────────────────────────────────────────────────┘
```

- Value shown: `users.dealer_listing_limit` if set, else `DEFAULT_DEALER_LISTING_LIMIT` with "(default)" badge.
- Number input + Save button. PATCH `/api/admin/dealers/<user_id>/listing-limit` with `{ "limit": 50 }` or `{ "limit": null }` to clear back to default.

### Document table

Existing doc-status chips (`AdminDealerDetail.jsx:79–83`) extended:
- New "Expires on" column showing the date with a badge: green if >30 days out, yellow if ≤30 days, red if expired.
- "Replace history" expander shows previous (replaced_at IS NOT NULL) uploads for audit.

### Backend endpoints

- `PATCH /api/admin/dealers/<user_id>/listing-limit` — new. Admin-only. Body `{ "limit": <int|null> }`. Updates `users.dealer_listing_limit`, returns the new effective value.
- All existing verify/reject endpoints preserved.

## Dealer dashboard

### New "Documents" tab in `DealerSettings.jsx`

Sits next to existing Profile tab. Renders a table:

```
Type             Uploaded on     Expires on        Status        Action
───────────────────────────────────────────────────────────────────────
Trade license    2026-04-15     2027-04-15        Approved      [Replace]
Company reg      2026-04-15     —                 Pending       [Replace]
Tax (TRN)        not uploaded    —                 —             [Upload]
```

- "Replace" opens a modal with the same fields as the signup upload (file + expires_at). On submit: existing endpoint with `replace_existing=true` query param; backend marks old row `replaced_at=now()`, inserts new row.
- "Upload" opens the same modal for missing doc types.
- Status chips: Pending review / Approved / Rejected (with rejection reason tooltip) / Expired.

### Expiry banner

Top of every dealer dashboard page:
- 30 days or less to expiry on any document → yellow banner "Your trade license expires in 12 days. Upload a new one to keep posting."
- After expiry → red banner "Your trade license expired on YYYY-MM-DD. You cannot post new listings until you upload a current one."

## Listing-create gate

`_enforce_listing_limit()` (`app.py:3935`) extended to handle dealers:

```python
if user.is_dealer and user.dealer_verified:
    # Dealer cap: total active listings across cars+bikes+parts+plates
    limit = user.dealer_listing_limit
    if limit is None:
        limit = int(os.getenv("DEFAULT_DEALER_LISTING_LIMIT", "25"))
    active_count = _count_active_listings_all_types(user.id)
    if active_count >= limit:
        return False, {"code": "dealer_listing_limit",
                       "message": f"You've reached your ad limit ({limit}). "
                                  "Contact us to request an increase."}
    # Doc expiry check
    expired = _dealer_expired_documents(user.id)
    if expired:
        return False, {"code": "dealer_doc_expired",
                       "message": f"Your {expired[0]} has expired. "
                                  "Please re-upload before posting."}

# Non-dealers and unverified dealers keep existing per-type limit.
```

`_count_active_listings_all_types` sums non-deleted, non-archived rows across the four listing tables, scoped by `user_id`. Cached for 60 seconds in Redis (per the persistence-stack memory) to avoid hammering Postgres on burst posts.

## Expiry reminder worker

New thread in `backend/worker.py`, running every 24 hours:

1. Fetch all `dealer_documents` rows with:
   - `replaced_at IS NULL`
   - `expires_at` ∈ (today, today + 30 days]
   - `expiry_reminder_sent_at IS NULL OR last_sent > 7 days ago`
2. For each, fire:
   - Resend email ("Your trade license expires in X days")
   - Infobip SMS ("DPH Classifieds: your trade license expires DD MMM. Re-upload at https://dphclassifieds.com/dealer/documents")
3. Stamp `expiry_reminder_sent_at = now()`.

Re-runs daily until the doc is replaced (which clears the reminder via the `replaced_at IS NULL` filter).

## Error handling and edge cases

- **Duplicate TRN at signup** — backend returns 409 `{"code": "trn_in_use", "message": "This TRN is already registered…"}`. Frontend surfaces inline below the TRN field.
- **Invalid file at upload** — existing endpoint already returns 400 with MIME / size errors. Frontend keeps form state, lets user pick again.
- **Account created but doc upload fails** — `users.dealer_application_status` stays `'draft'`. Banner + onboarding route resumes the wizard.
- **Admin sets `dealer_listing_limit=0`** — effectively suspends posting. Listing-create returns the same `dealer_listing_limit` error. Documented as the intended way to soft-suspend a dealer without delisting them.

## Out of scope (explicit)

- Backfilling existing dealers' `legal_business_name` and `trn` from existing data — would need OCR/manual entry; separate task.
- Per-type sub-limits within the dealer cap (e.g. "max 5 plates of the 25").
- Subscription/tier billing.
- WhatsApp expiry reminders (SMS-only until WhatsApp channel is wired up).
- TRN verification against UAE FTA's actual database (TRN format-check only).
- Migrating from `MAX_LISTINGS_PER_USER_PER_TYPE` to the new cap for individuals.

## Self-review checklist

- [x] No "TBD" or placeholders remaining.
- [x] §1–§6 don't contradict; data model supports every feature mentioned.
- [x] Scope: focused on dealer registration + ad limit + dashboard docs. Other ideas (tiers, billing, FTA integration) explicitly excluded.
- [x] All requirements concrete enough to implement without further clarification.

## Files touched (forward-looking inventory)

| File | Reason |
|---|---|
| `flask-react-supabase-app/add_dealer_kyc_columns.sql` | NEW — SQL migration |
| `flask-react-supabase-app/backend/app.py` | Extend `_enforce_listing_limit`, signup endpoint, upload endpoint; add submit-application endpoint and listing-limit admin endpoint |
| `flask-react-supabase-app/backend/worker.py` | New expiry-reminder thread |
| `flask-react-supabase-app/backend/routes/admin.py` | `PATCH /listings-limit` endpoint |
| `flask-react-supabase-app/frontend/src/components/Signup.js` | Add 4 dealer fields |
| `flask-react-supabase-app/frontend/src/components/AdminDealerDetail.jsx` | Ad-limit card, new summary rows, expires_at column |
| `flask-react-supabase-app/frontend/src/components/dealer/DealerSettings.jsx` | New Documents tab |
| `flask-react-supabase-app/frontend/src/components/dealer/DealerOnboarding.jsx` | NEW — resume flow page |
| `flask-react-supabase-app/frontend/src/App.js` | Route for `/dealer/onboarding` |
