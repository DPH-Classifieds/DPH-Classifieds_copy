# Email paths (backend)

This app can send emails via **Resend** (preferred) and has legacy **Flask-Mail (SMTP)** wiring.

## Required env (Resend)

Set these in `flask-react-supabase-app/backend/.env` (or Railway/Vercel env):

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_TO_EMAIL` (admin inbox destination for internal alerts)
- `RESEND_REPLY_TO_EMAIL` (optional; defaults to `RESEND_TO_EMAIL`)
- `SITE_URL` (used to build deep links in emails)

## What triggers email sends

### Listing lifecycle emails (Resend)

Implemented in `flask-react-supabase-app/backend/app.py`:

- Listing expiring soon: `_send_listing_expiry_reminder(...)`
- Listing expired (action needed): `_send_listing_expired_email(...)`

### Listing moderation emails (Resend)

Implemented in `flask-react-supabase-app/backend/app.py`:

- Listing approved / rejected / denied: `_send_listing_status_email(...)`
- Listing deleted by admin: `_send_listing_deleted_email(...)`

### Dealer verification emails (Resend)

Implemented in `flask-react-supabase-app/backend/app.py`:

- Dealer status updates: `_send_dealer_status_email(...)`

### Health monitoring / system alerts (Resend)

Implemented in `flask-react-supabase-app/backend/health_monitoring.py`:

- Uses Resend env vars to notify admins when health checks fail.

## How emails are sent

Resend is sent via:

- `_send_resend_email(payload)` -> `POST https://api.resend.com/emails`

Legacy SMTP/Flask-Mail helper:

- `_send_email(to, subject, html)` is a best-effort fallback when `MAIL_ENABLED` is configured.

## Quick manual verification (recommended)

1. Ensure env vars are set.
2. Trigger a listing approval/rejection in the admin UI.
3. Verify:
   - the seller receives a status email
   - the email links point to `SITE_URL` pages
   - reply-to goes where you expect (`RESEND_REPLY_TO_EMAIL`)

