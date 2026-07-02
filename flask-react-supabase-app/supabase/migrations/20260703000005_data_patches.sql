-- Data integrity patches.
-- Safe to re-run: all statements are idempotent.

-- 1. Fix 2 deleted cars that have status='deleted' but NULL deleted_at.
--    Use updated_at as the best-available timestamp.
UPDATE public.cars
SET deleted_at = COALESCE(updated_at, created_at, now())
WHERE status = 'deleted'
  AND deleted_at IS NULL;

-- 2. Mark stale legacy email_events as skipped.
--    These 235 rows were written by DB triggers (dropped June 2026).
--    The inline Resend path already sent these emails; retroactively
--    sending them would double-notify users about months-old events.
UPDATE public.email_events
SET status = 'skipped'
WHERE status = 'pending'
  AND created_at < '2026-07-01 00:00:00+00';
