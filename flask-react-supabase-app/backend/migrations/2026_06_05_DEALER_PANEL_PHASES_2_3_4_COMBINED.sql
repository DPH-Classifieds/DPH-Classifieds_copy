-- ============================================================================
-- DPH Dealer Panel — Phases 2, 3, 4 — combined migration
--
-- Paste this entire file into Supabase SQL Editor and Run.
-- Idempotent: safe to re-run; uses IF NOT EXISTS / DROP IF EXISTS throughout.
--
-- After this migration is applied:
--   • Create the `dealer-imports` Storage bucket in Supabase Dashboard
--     (private, 10 MB max). The backend always uploads via service role,
--     so RLS is enforced application-side.
--   • Set DEALER_INTEGRATIONS_KEY (Fernet key) in your env:
--       python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
--
-- Depends on:
--   • dealerships, dealership_members tables (Phase 1 — already in prod)
--   • is_dealership_member(uuid) and is_admin(auth.uid()) RLS helpers
--     (from 2026_06_03_dealer_rls.sql — already in prod)
--   • cars / bikes / license_plates / car_parts tables (already in prod)
-- ============================================================================


-- ============================================================================
-- PHASE 2 — Lead Inbox & Pipeline
-- Tables: dealer_leads, dealer_lead_events, dealer_lead_aggregator_cursor
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dealer_leads (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    listing_type    text NOT NULL CHECK (listing_type IN ('car','bike','plate','part')),
    listing_id      text NOT NULL,
    source          text NOT NULL CHECK (source IN ('call','whatsapp','vin_open','form')),

    -- dedupe identity
    visitor_id      text,
    fingerprint     text,   -- sha256(ip || user_agent) when visitor_id IS NULL

    first_event_at  timestamptz NOT NULL,
    last_event_at   timestamptz NOT NULL,
    event_count     int NOT NULL DEFAULT 1,

    contact_phone   text,
    contact_name    text,
    assigned_to     uuid REFERENCES public.users(id) ON DELETE SET NULL,
    status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','contacted','quoted','test_drive','won','lost')),
    lost_reason     text CHECK (lost_reason IS NULL
                    OR lost_reason IN ('price','financing','stock','unreachable','other')),
    sale_price      numeric,
    notes           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Lookup indexes for the aggregator (NOT unique — time-windowed dedupe is
-- enforced by the worker, so after the window expires we can insert a new row)
CREATE INDEX IF NOT EXISTS idx_dealer_leads_lookup_visitor
    ON public.dealer_leads (dealership_id, listing_type, listing_id, source, visitor_id)
    WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dealer_leads_lookup_fingerprint
    ON public.dealer_leads (dealership_id, listing_type, listing_id, source, fingerprint)
    WHERE visitor_id IS NULL AND fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dealer_leads_dealership_status_time
    ON public.dealer_leads (dealership_id, status, last_event_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_leads_assigned
    ON public.dealer_leads (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_dealer_leads_listing
    ON public.dealer_leads (listing_type, listing_id);


CREATE TABLE IF NOT EXISTS public.dealer_lead_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id         uuid NOT NULL REFERENCES public.dealer_leads(id) ON DELETE CASCADE,
    actor_user_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
    kind            text NOT NULL
                    CHECK (kind IN ('status_change','note','assignment','inbound_contact')),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_lead_events_lead_time
    ON public.dealer_lead_events (lead_id, created_at DESC);


-- RLS
ALTER TABLE public.dealer_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_leads_read" ON public.dealer_leads;
CREATE POLICY "dealer_leads_read" ON public.dealer_leads FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_leads_service_all" ON public.dealer_leads;
CREATE POLICY "dealer_leads_service_all" ON public.dealer_leads FOR ALL
USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_lead_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_lead_events_read" ON public.dealer_lead_events;
CREATE POLICY "dealer_lead_events_read" ON public.dealer_lead_events FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.dealer_leads dl
        WHERE dl.id = dealer_lead_events.lead_id
          AND (public.is_dealership_member(dl.dealership_id) OR public.is_admin(auth.uid()))
    )
);
DROP POLICY IF EXISTS "dealer_lead_events_service_all" ON public.dealer_lead_events;
CREATE POLICY "dealer_lead_events_service_all" ON public.dealer_lead_events FOR ALL
USING (true) WITH CHECK (true);


-- Aggregator cursor (single row)
CREATE TABLE IF NOT EXISTS public.dealer_lead_aggregator_cursor (
    id                 int PRIMARY KEY CHECK (id = 1),
    last_processed_at  timestamptz NOT NULL DEFAULT (now() - interval '7 days'),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.dealer_lead_aggregator_cursor (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PHASE 3 — Bulk Inventory & DMS Ingest
-- Tables: dealer_inventory_jobs, dealer_inventory_row_errors, dealer_api_sources
-- New column: cars.external_id
-- ============================================================================

-- 1. cars.external_id (dealer's own SKU — natural key for upserts on re-import)
ALTER TABLE public.cars
    ADD COLUMN IF NOT EXISTS external_id text;

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

-- 3. Per-row error details
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

-- 5. RLS
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
DROP POLICY IF EXISTS "dealer_api_sources_read" ON public.dealer_api_sources;
CREATE POLICY "dealer_api_sources_read" ON public.dealer_api_sources FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_api_sources_service_all" ON public.dealer_api_sources;
CREATE POLICY "dealer_api_sources_service_all" ON public.dealer_api_sources FOR ALL
USING (true) WITH CHECK (true);


-- ============================================================================
-- PHASE 4 — Outbound Webhooks
-- Tables: dealer_webhooks, dealer_webhook_deliveries
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dealer_webhooks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    label           text NOT NULL,
    url             text NOT NULL,
    secret_enc      text NOT NULL,
    events          text[] NOT NULL,
    enabled         bool NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_webhooks_dealership
    ON public.dealer_webhooks (dealership_id);
CREATE INDEX IF NOT EXISTS idx_dealer_webhooks_events
    ON public.dealer_webhooks USING gin (events)
    WHERE enabled = true;

CREATE TABLE IF NOT EXISTS public.dealer_webhook_deliveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id          uuid NOT NULL REFERENCES public.dealer_webhooks(id) ON DELETE CASCADE,
    dealership_id       uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    event_type          text NOT NULL,
    payload             jsonb NOT NULL,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','succeeded','failed','dead_letter')),
    attempt_count       int NOT NULL DEFAULT 0,
    next_retry_at       timestamptz NOT NULL DEFAULT now(),
    last_response_code  int,
    last_response_body  text,
    last_error          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    delivered_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dealer_webhook_deliveries_due
    ON public.dealer_webhook_deliveries (next_retry_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_dealer_webhook_deliveries_dealership_time
    ON public.dealer_webhook_deliveries (dealership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_webhook_deliveries_webhook_time
    ON public.dealer_webhook_deliveries (webhook_id, created_at DESC);

-- RLS
ALTER TABLE public.dealer_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_webhooks_read" ON public.dealer_webhooks;
CREATE POLICY "dealer_webhooks_read" ON public.dealer_webhooks FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_webhooks_service_all" ON public.dealer_webhooks;
CREATE POLICY "dealer_webhooks_service_all" ON public.dealer_webhooks FOR ALL
USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_webhook_deliveries_read" ON public.dealer_webhook_deliveries;
CREATE POLICY "dealer_webhook_deliveries_read" ON public.dealer_webhook_deliveries FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_webhook_deliveries_service_all" ON public.dealer_webhook_deliveries;
CREATE POLICY "dealer_webhook_deliveries_service_all" ON public.dealer_webhook_deliveries FOR ALL
USING (true) WITH CHECK (true);


-- ============================================================================
-- Realtime — publish tables the frontend subscribes to for live updates
-- ============================================================================

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_leads;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_inventory_jobs;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_webhook_deliveries;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;


-- ============================================================================
-- Done
-- ============================================================================

DO $$ BEGIN
    RAISE NOTICE '✅ DPH Dealer Panel Phases 2/3/4 migration complete.';
    RAISE NOTICE '   - Phase 2: dealer_leads, dealer_lead_events, aggregator cursor';
    RAISE NOTICE '   - Phase 3: dealer_inventory_jobs/row_errors, dealer_api_sources, cars.external_id';
    RAISE NOTICE '   - Phase 4: dealer_webhooks, dealer_webhook_deliveries';
    RAISE NOTICE '   Remember: create the `dealer-imports` Storage bucket and set DEALER_INTEGRATIONS_KEY.';
END $$;
