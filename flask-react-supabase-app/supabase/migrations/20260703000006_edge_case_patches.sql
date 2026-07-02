-- Edge case data patches discovered in second audit.
-- Safe to re-run: all conditions are idempotent.

-- 1. Soft-delete the single rejected listing whose retention period expired
--    over a year ago (created 2025-03-18, retention expired 2025-05-02).
--    Rejected listings should be purged once retention_expires_at passes.
UPDATE public.cars
SET
  status     = 'deleted',
  deleted_at = COALESCE(retention_expires_at, NOW())
WHERE status = 'rejected'
  AND retention_expires_at < NOW()
  AND deleted_at IS NULL;

-- 2. Mark sold_response_deadline-exceeded approved listings as no_response.
--    These 6 listings had a "did you sell?" deadline in May 2026 that passed
--    without a seller response. The lifecycle worker sets this state; these
--    were missed because the deadline pre-dates the worker's current run window.
--    Setting no_response records the correct outcome; the worker can clean up
--    on its next cycle if configured to do so.
UPDATE public.cars
SET sold_status = 'no_response'
WHERE status = 'approved'
  AND sold_status IS NULL
  AND sold_response_deadline IS NOT NULL
  AND sold_response_deadline < NOW() - INTERVAL '7 days';
