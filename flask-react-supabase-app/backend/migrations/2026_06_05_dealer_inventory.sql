-- ============================================================
-- Phase 3 — Bulk Inventory & DMS Ingest
-- Tables: dealer_inventory_jobs, dealer_inventory_row_errors, dealer_api_sources
-- cars.external_id column + uniqueness
-- Storage bucket policy for dealer-imports
-- ============================================================

-- 1. cars.external_id (dealer's own identifier — natural key for upserts)
ALTER TABLE public.cars
    ADD COLUMN IF NOT EXISTS external_id text;

-- A dealership can't reuse the same external_id twice. Anonymous (NULL) rows
-- skip the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cars_dealership_external_id
    ON public.cars (dealership_id, external_id)
    WHERE external_id IS NOT NULL;

-- 2. Inventory jobs
CREATE TABLE IF NOT EXISTS public.dealer_inventory_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('csv_import','xml_import','api_pull','csv_export')),
    source          text,
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','partial','succeeded','failed')),
    rows_total      int NOT NULL DEFAULT 0,
    rows_created    int NOT NULL DEFAULT 0,
    rows_updated    int NOT NULL DEFAULT 0,
    rows_skipped    int NOT NULL DEFAULT 0,
    rows_failed     int NOT NULL DEFAULT 0,
    error_summary   jsonb NOT NULL DEFAULT '{}'::jsonb,
    column_mapping  jsonb NOT NULL DEFAULT '{}'::jsonb,
    file_path       text,
    started_at      timestamptz,
    finished_at     timestamptz,
    triggered_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_inv_jobs_dealership_time
    ON public.dealer_inventory_jobs (dealership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_inv_jobs_status_time
    ON public.dealer_inventory_jobs (status, created_at ASC)
    WHERE status IN ('queued','running');

-- 3. Per-row error details for transparency
CREATE TABLE IF NOT EXISTS public.dealer_inventory_row_errors (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          uuid NOT NULL REFERENCES public.dealer_inventory_jobs(id) ON DELETE CASCADE,
    row_index       int NOT NULL,
    external_id     text,
    error_code      text NOT NULL,
    error_message   text NOT NULL,
    raw_row         jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_inv_row_errors_job_row
    ON public.dealer_inventory_row_errors (job_id, row_index);

-- 4. DMS sources
CREATE TABLE IF NOT EXISTS public.dealer_api_sources (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id       uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    label               text NOT NULL,
    adapter             text NOT NULL CHECK (adapter IN ('generic_json')),
    endpoint_url        text NOT NULL,
    auth_type           text NOT NULL CHECK (auth_type IN ('bearer','basic','hmac','none')),
    credentials_enc     text,
    field_mapping       jsonb NOT NULL DEFAULT '{}'::jsonb,
    poll_interval_min   int NOT NULL DEFAULT 60 CHECK (poll_interval_min >= 5),
    last_pulled_at      timestamptz,
    last_status         text,
    last_error          text,
    enabled             bool NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_api_sources_due
    ON public.dealer_api_sources (last_pulled_at NULLS FIRST)
    WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_dealer_api_sources_dealership
    ON public.dealer_api_sources (dealership_id);

-- 5. RLS — mirrors 2026_06_03_dealer_rls.sql pattern
ALTER TABLE public.dealer_inventory_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_inv_jobs_read" ON public.dealer_inventory_jobs;
CREATE POLICY "dealer_inv_jobs_read" ON public.dealer_inventory_jobs FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_inv_jobs_service_all" ON public.dealer_inventory_jobs;
CREATE POLICY "dealer_inv_jobs_service_all" ON public.dealer_inventory_jobs FOR ALL
USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_inventory_row_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_inv_row_errors_read" ON public.dealer_inventory_row_errors;
CREATE POLICY "dealer_inv_row_errors_read" ON public.dealer_inventory_row_errors FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.dealer_inventory_jobs j
    WHERE j.id = dealer_inventory_row_errors.job_id
      AND (public.is_dealership_member(j.dealership_id) OR public.is_admin(auth.uid()))
));
DROP POLICY IF EXISTS "dealer_inv_row_errors_service_all" ON public.dealer_inventory_row_errors;
CREATE POLICY "dealer_inv_row_errors_service_all" ON public.dealer_inventory_row_errors FOR ALL
USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_api_sources ENABLE ROW LEVEL SECURITY;
-- Read OK for members, but NEVER expose credentials_enc directly via PostgREST.
-- The backend endpoint never returns it; we still keep this policy in case of
-- direct PostgREST access, which should never happen, but defense in depth.
DROP POLICY IF EXISTS "dealer_api_sources_read" ON public.dealer_api_sources;
CREATE POLICY "dealer_api_sources_read" ON public.dealer_api_sources FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_api_sources_service_all" ON public.dealer_api_sources;
CREATE POLICY "dealer_api_sources_service_all" ON public.dealer_api_sources FOR ALL
USING (true) WITH CHECK (true);

-- 6. Realtime publication for job-status updates
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_inventory_jobs;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

DO $$ BEGIN
    RAISE NOTICE '✅ Phase 3 inventory tables + cars.external_id created';
END $$;
