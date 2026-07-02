-- Repair all admin-approved listings that have stale or NULL lifecycle fields.
--
-- Context: Listings approved before the 2026-07-02 lifecycle fix may have:
--   - expires_at IS NULL or in the past (from the old 15-day window)
--   - retention_expires_at IS NULL or in the past
--   - is_archived = TRUE (set by lifecycle sweep before the fix)
--   - expired_at IS NOT NULL (wrongly set)
--   - auto_removed_at IS NOT NULL (wrongly set for approved listings)
--
-- This migration resets all of those to a clean 60-day window so the
-- lifecycle code computes them as "active" and they appear on the site.
--
-- Safe to re-run (idempotent). Does NOT touch sold_elsewhere listings.

DO $$
DECLARE
  new_expires      TIMESTAMPTZ := NOW() + INTERVAL '60 days';
  new_retention    TIMESTAMPTZ := NOW() + INTERVAL '90 days';
  rows_fixed       INTEGER;
BEGIN

  -- ── CARS ──────────────────────────────────────────────────────────────────
  UPDATE public.cars
  SET
    expires_at              = new_expires,
    retention_expires_at    = new_retention,
    expired_at              = NULL,
    is_archived             = FALSE,
    auto_removed_at         = NULL,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    sold_response_deadline  = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
  WHERE status      = 'approved'
    AND is_approved = TRUE
    AND deleted_at  IS NULL
    AND COALESCE(sold_status, '') != 'sold_elsewhere'
    AND (
      expires_at              IS NULL  OR expires_at              < NOW()  OR
      retention_expires_at    IS NULL  OR retention_expires_at    < NOW()  OR
      is_archived             = TRUE   OR
      expired_at              IS NOT NULL                                  OR
      auto_removed_at         IS NOT NULL
    );
  GET DIAGNOSTICS rows_fixed = ROW_COUNT;
  RAISE NOTICE 'cars: fixed % rows', rows_fixed;

  -- ── BIKES ─────────────────────────────────────────────────────────────────
  UPDATE public.bikes
  SET
    expires_at              = new_expires,
    retention_expires_at    = new_retention,
    expired_at              = NULL,
    is_archived             = FALSE,
    auto_removed_at         = NULL,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    sold_response_deadline  = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
  WHERE status      = 'approved'
    AND is_approved = TRUE
    AND deleted_at  IS NULL
    AND COALESCE(sold_status, '') != 'sold_elsewhere'
    AND (
      expires_at              IS NULL  OR expires_at              < NOW()  OR
      retention_expires_at    IS NULL  OR retention_expires_at    < NOW()  OR
      is_archived             = TRUE   OR
      expired_at              IS NOT NULL                                  OR
      auto_removed_at         IS NOT NULL
    );
  GET DIAGNOSTICS rows_fixed = ROW_COUNT;
  RAISE NOTICE 'bikes: fixed % rows', rows_fixed;

  -- ── CAR PARTS ─────────────────────────────────────────────────────────────
  UPDATE public.car_parts
  SET
    expires_at              = new_expires,
    retention_expires_at    = new_retention,
    expired_at              = NULL,
    is_archived             = FALSE,
    auto_removed_at         = NULL,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    sold_response_deadline  = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
  WHERE status      = 'approved'
    AND is_approved = TRUE
    AND deleted_at  IS NULL
    AND COALESCE(sold_status, '') != 'sold_elsewhere'
    AND (
      expires_at              IS NULL  OR expires_at              < NOW()  OR
      retention_expires_at    IS NULL  OR retention_expires_at    < NOW()  OR
      is_archived             = TRUE   OR
      expired_at              IS NOT NULL                                  OR
      auto_removed_at         IS NOT NULL
    );
  GET DIAGNOSTICS rows_fixed = ROW_COUNT;
  RAISE NOTICE 'car_parts: fixed % rows', rows_fixed;

  -- ── LICENSE PLATES ────────────────────────────────────────────────────────
  UPDATE public.license_plates
  SET
    expires_at              = new_expires,
    retention_expires_at    = new_retention,
    expired_at              = NULL,
    is_archived             = FALSE,
    auto_removed_at         = NULL,
    sold_status             = NULL,
    sold_status_set_at      = NULL,
    sold_response_deadline  = NULL,
    expiry_reminder_sent_at = NULL,
    expired_email_sent_at   = NULL
  WHERE status      = 'approved'
    AND is_approved = TRUE
    AND deleted_at  IS NULL
    AND COALESCE(sold_status, '') != 'sold_elsewhere'
    AND (
      expires_at              IS NULL  OR expires_at              < NOW()  OR
      retention_expires_at    IS NULL  OR retention_expires_at    < NOW()  OR
      is_archived             = TRUE   OR
      expired_at              IS NOT NULL                                  OR
      auto_removed_at         IS NOT NULL
    );
  GET DIAGNOSTICS rows_fixed = ROW_COUNT;
  RAISE NOTICE 'license_plates: fixed % rows', rows_fixed;

END $$;
