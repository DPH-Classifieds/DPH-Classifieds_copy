-- Reddit imported listings: source identity on cars/bikes/license_plates/car_parts
-- + import run audit.
--
-- Imported rows are owned by the DPH Classifieds account (REDDIT_IMPORT_OWNER_ID)
-- and distinguished from member listings by immutable source_* fields. Service-role
-- writes bypass RLS; there is no public write path.
--
-- Apply manually in the Supabase dashboard SQL editor (project ltjatsyhpmvewancqdjw),
-- BEFORE enabling the worker. Idempotent (safe to re-run).

DO $$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['cars', 'bikes', 'license_plates', 'car_parts'] LOOP
    -- 1. Source identity columns.
    EXECUTE format($f$
      ALTER TABLE public.%1$I
        ADD COLUMN IF NOT EXISTS source_platform    text,
        ADD COLUMN IF NOT EXISTS source_external_id text,
        ADD COLUMN IF NOT EXISTS source_url         text,
        ADD COLUMN IF NOT EXISTS source_author      text,
        ADD COLUMN IF NOT EXISTS source_subreddit   text,
        ADD COLUMN IF NOT EXISTS source_created_at  timestamptz,
        ADD COLUMN IF NOT EXISTS source_last_seen_at timestamptz,
        ADD COLUMN IF NOT EXISTS source_removed_at  timestamptz
    $f$, t);

    -- 2. Reddit source contract: a reddit row must carry an id and a canonical URL.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_reddit_source_contract') THEN
      EXECUTE format(
        'ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK ('
        || 'source_platform IS DISTINCT FROM ''reddit'' OR '
        || '(source_external_id IS NOT NULL AND source_url ~ ''^https://www\.reddit\.com/r/'')) NOT VALID',
        t, t || '_reddit_source_contract');
    END IF;

    -- 3. Dedupe + live-lookup indexes (partial: reddit rows only).
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %2$I ON public.%1$I (source_external_id) '
      || 'WHERE source_platform = ''reddit''',
      t, t || '_reddit_source_ext_unique');
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %2$I ON public.%1$I (source_subreddit, source_last_seen_at DESC) '
      || 'WHERE source_platform = ''reddit'' AND source_removed_at IS NULL',
      t, t || '_reddit_live_idx');

    -- 4. Allow the 'source_removed' lifecycle status used to unpublish removed imports.
    --    Drop any existing status CHECK (matched by definition, not a guessed name),
    --    then re-add NOT VALID with the full allowlist + source_removed.
    --    Match by column + a known value, NOT the literal "status IN": Postgres
    --    normalizes IN(...) to "status = ANY (ARRAY[...])" in pg_get_constraintdef,
    --    so "%status IN%" never matches and the re-add below collides.
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%status%'
        AND pg_get_constraintdef(oid) ILIKE '%pending%'
    LOOP
      EXECUTE format('ALTER TABLE public.%1$I DROP CONSTRAINT %2$I', t, r.conname);
    END LOOP;
    -- Guarantee the canonical name is free even if the loop above missed it.
    EXECUTE format('ALTER TABLE public.%1$I DROP CONSTRAINT IF EXISTS %2$I', t, t || '_status_check');
    EXECUTE format(
      'ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (status IS NULL OR status IN ('
      || '''pending'',''pending_auto_review'',''approved'',''active'','
      || '''expired'',''deleted'',''rejected'',''sold'',''draft'',''source_removed'')) NOT VALID',
      t, t || '_status_check');
  END LOOP;
END $$;

COMMENT ON COLUMN public.cars.source_platform IS 'Non-null (e.g. ''reddit'') for externally imported listings; NULL for member listings.';
COMMENT ON COLUMN public.cars.source_external_id IS 'Immutable upstream id, e.g. Reddit submission fullname t3_xxxx. Dedupe key.';

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
