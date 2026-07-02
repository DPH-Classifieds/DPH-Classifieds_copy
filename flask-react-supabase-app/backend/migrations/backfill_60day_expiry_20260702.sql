-- Backfill all listings to the new 60-day expiry window.
--
-- Previously LISTING_EXPIRY_DAYS = 15. This migration migrates all existing
-- listings to follow the new 60-day window so nothing expires prematurely.
--
-- Three cases are handled for each table (cars, bikes, car_parts, license_plates):
--
--   1. ACTIVE listings (not yet expired) — extend expires_at to created_at + 60 days.
--      If created_at + 60 days is already in the past, give them 60 more days from now.
--
--   2. EXPIRED listings (status approved/active, expired_at IS NOT NULL, no user response,
--      not yet auto-removed) — clear expired_at and restore expires_at so they go live again.
--
--   3. AUTO-REMOVED listings where seller never responded (sold_status = 'no_response').
--      Listings where the seller explicitly chose 'sold_elsewhere' are NOT restored.
--
-- Idempotent: re-running is safe.

-- ─── 1. ACTIVE listings ────────────────────────────────────────────────────────

UPDATE public.cars
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND deleted_at IS NULL
  AND auto_removed_at IS NULL
  AND expired_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

UPDATE public.bikes
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND deleted_at IS NULL
  AND auto_removed_at IS NULL
  AND expired_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

UPDATE public.car_parts
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND deleted_at IS NULL
  AND auto_removed_at IS NULL
  AND expired_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

UPDATE public.license_plates
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND deleted_at IS NULL
  AND auto_removed_at IS NULL
  AND expired_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

-- ─── 2. EXPIRED listings (still approved, not yet auto-removed, seller never responded) ─

UPDATE public.cars
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    is_archived             = FALSE,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND expired_at IS NOT NULL
  AND auto_removed_at IS NULL
  AND deleted_at IS NULL
  AND sold_status_set_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

UPDATE public.bikes
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    is_archived             = FALSE,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND expired_at IS NOT NULL
  AND auto_removed_at IS NULL
  AND deleted_at IS NULL
  AND sold_status_set_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

UPDATE public.car_parts
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    is_archived             = FALSE,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND expired_at IS NOT NULL
  AND auto_removed_at IS NULL
  AND deleted_at IS NULL
  AND sold_status_set_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

UPDATE public.license_plates
SET expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    is_archived             = FALSE,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status IN ('approved', 'active')
  AND expired_at IS NOT NULL
  AND auto_removed_at IS NULL
  AND deleted_at IS NULL
  AND sold_status_set_at IS NULL
  AND sold_status IS DISTINCT FROM 'sold_elsewhere';

-- ─── 3. AUTO-REMOVED listings where seller never responded (no_response only) ──
-- Listings where the seller explicitly chose sold_elsewhere are intentionally
-- excluded — they should stay off the platform.

UPDATE public.cars
SET status                  = 'approved',
    is_approved             = TRUE,
    expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    deleted_at              = NULL,
    auto_removed_at         = NULL,
    is_archived             = FALSE,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status = 'deleted'
  AND auto_removed_at IS NOT NULL
  AND sold_status = 'no_response'
  AND sold_status_set_at IS NULL;

UPDATE public.bikes
SET status                  = 'approved',
    is_approved             = TRUE,
    expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    deleted_at              = NULL,
    auto_removed_at         = NULL,
    is_archived             = FALSE,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status = 'deleted'
  AND auto_removed_at IS NOT NULL
  AND sold_status = 'no_response'
  AND sold_status_set_at IS NULL;

UPDATE public.car_parts
SET status                  = 'approved',
    is_approved             = TRUE,
    expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    deleted_at              = NULL,
    auto_removed_at         = NULL,
    is_archived             = FALSE,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status = 'deleted'
  AND auto_removed_at IS NOT NULL
  AND sold_status = 'no_response'
  AND sold_status_set_at IS NULL;

UPDATE public.license_plates
SET status                  = 'approved',
    is_approved             = TRUE,
    expires_at              = GREATEST(created_at + INTERVAL '60 days', NOW() + INTERVAL '7 days'),
    expired_at              = NULL,
    deleted_at              = NULL,
    auto_removed_at         = NULL,
    is_archived             = FALSE,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
WHERE status = 'deleted'
  AND auto_removed_at IS NOT NULL
  AND sold_status = 'no_response'
  AND sold_status_set_at IS NULL;
