-- Fix: add 'pending_auto_review' to the status CHECK constraint on all
-- four listing tables.  The add_auto_review_columns.sql migration
-- (commit 67beb21) wired the auto-review worker and created indexes for
-- status = 'pending_auto_review', but omitted expanding the CHECK
-- constraint.  When AUTO_REVIEW_WORKER_ENABLED=true the backend sets
-- status = 'pending_auto_review' on every new listing insert, which
-- violates the old constraint (Postgres error 23514), causing all
-- POST /api/(parts|bikes|plates|cars) to return 400.
--
-- Safe to re-run: the DO block drops any existing status-mentioning CHECK
-- before adding the new one, and NOT VALID skips the full-table scan lock.

DO $$
DECLARE
  tbl    text;
  conrow RECORD;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['cars', 'bikes', 'car_parts', 'license_plates']
  LOOP
    -- Drop every status-related CHECK constraint on this table
    FOR conrow IN
      SELECT conname
      FROM   pg_constraint
      WHERE  conrelid = format('public.%I', tbl)::regclass
        AND  contype  = 'c'
        AND  pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
        tbl, conrow.conname
      );
    END LOOP;

    -- Add the expanded constraint that includes pending_auto_review
    EXECUTE format(
      $sql$
        ALTER TABLE public.%I
          ADD CONSTRAINT %I
          CHECK (
            status IS NULL OR status IN (
              'pending',
              'pending_auto_review',
              'approved',
              'active',
              'expired',
              'deleted',
              'rejected',
              'sold',
              'draft'
            )
          ) NOT VALID
      $sql$,
      tbl,
      tbl || '_status_check'
    );
  END LOOP;
END $$;
