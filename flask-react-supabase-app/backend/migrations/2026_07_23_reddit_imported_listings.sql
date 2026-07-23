-- Reddit imported listings: source identity on cars + import run audit.
--
-- Imported rows are owned by the DPH Classifieds account (REDDIT_IMPORT_OWNER_ID)
-- and distinguished from member listings by immutable source_* fields. Service-role
-- writes bypass RLS; there is no public write path.
--
-- Apply manually in the Supabase dashboard SQL editor (project ltjatsyhpmvewancqdjw),
-- BEFORE enabling the worker. Idempotent (safe to re-run).

-- 1. Source identity columns -------------------------------------------------
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS source_platform    text,
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS source_url         text,
  ADD COLUMN IF NOT EXISTS source_author      text,
  ADD COLUMN IF NOT EXISTS source_subreddit   text,
  ADD COLUMN IF NOT EXISTS source_created_at  timestamptz,
  ADD COLUMN IF NOT EXISTS source_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_removed_at  timestamptz;

COMMENT ON COLUMN public.cars.source_platform IS 'Non-null (e.g. ''reddit'') for externally imported listings; NULL for member listings.';
COMMENT ON COLUMN public.cars.source_external_id IS 'Immutable upstream id, e.g. Reddit submission fullname t3_xxxx. Dedupe key.';
COMMENT ON COLUMN public.cars.source_removed_at IS 'Set when the upstream post is deleted/removed; row is unpublished but retained for audit.';

-- 2. Reddit source contract: a reddit row must carry an id and a canonical URL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cars_reddit_source_contract'
  ) THEN
    ALTER TABLE public.cars
      ADD CONSTRAINT cars_reddit_source_contract CHECK (
        source_platform IS DISTINCT FROM 'reddit'
        OR (source_external_id IS NOT NULL AND source_url ~ '^https://www\.reddit\.com/r/')
      ) NOT VALID;
  END IF;
END $$;

-- 3. Dedupe + live lookup indexes (partial: reddit rows only).
CREATE UNIQUE INDEX IF NOT EXISTS cars_reddit_source_external_id_unique
  ON public.cars (source_external_id)
  WHERE source_platform = 'reddit';
CREATE INDEX IF NOT EXISTS cars_reddit_live_idx
  ON public.cars (source_subreddit, source_last_seen_at DESC)
  WHERE source_platform = 'reddit' AND source_removed_at IS NULL;

-- 4. Allow the 'source_removed' lifecycle status used to unpublish removed imports.
--    NOT VALID so existing rows are not re-checked; only new writes are constrained.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cars_status_check') THEN
    ALTER TABLE public.cars DROP CONSTRAINT cars_status_check;
  END IF;
  ALTER TABLE public.cars
    ADD CONSTRAINT cars_status_check CHECK (
      status IS NULL OR status IN (
        'pending','pending_auto_review','approved','active',
        'expired','deleted','rejected','sold','draft','source_removed'
      )
    ) NOT VALID;
END $$;

-- 5. Import run audit ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reddit_import_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit      text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL CHECK (status IN ('running','succeeded','partial','failed')),
  fetched_count  integer NOT NULL DEFAULT 0,
  eligible_count integer NOT NULL DEFAULT 0,
  created_count  integer NOT NULL DEFAULT 0,
  updated_count  integer NOT NULL DEFAULT 0,
  skipped_count  integer NOT NULL DEFAULT 0,
  removed_count  integer NOT NULL DEFAULT 0,
  failed_count   integer NOT NULL DEFAULT 0,
  error_summary  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reddit_import_runs_subreddit_started_idx
  ON public.reddit_import_runs (subreddit, started_at DESC);

-- Service role bypasses RLS; enabling it with no policies denies anon/authenticated.
ALTER TABLE public.reddit_import_runs ENABLE ROW LEVEL SECURITY;
