-- ============================================================
-- Phase 2 — Lead Inbox & Pipeline
-- Tables: dealer_leads, dealer_lead_events
-- Run this whole file in Supabase SQL Editor; it is idempotent.
-- ============================================================

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

-- Lookup indexes: help the aggregator find rows to dedupe within time windows.
-- Anonymous leads use `fingerprint`; logged-in use `visitor_id`.
-- NOT UNIQUE: time-windowed dedupe (24h/30min) is enforced by the worker,
-- not the database, so after the window expires a fresh row must be insertable.
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


-- RLS — mirrors the pattern in 2026_06_03_dealer_rls.sql
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


-- Realtime: include dealer_leads in the supabase_realtime publication so the
-- frontend can subscribe via supabase.channel('...').on('postgres_changes', ...).
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_leads;
        EXCEPTION WHEN duplicate_object THEN
            -- already published; nothing to do
            NULL;
        END;
    END IF;
END $$;


-- Aggregator cursor: tracks the most recent lead_events.created_at the
-- worker has processed. Single row, single column. Initialised at first run.
CREATE TABLE IF NOT EXISTS public.dealer_lead_aggregator_cursor (
    id              int PRIMARY KEY CHECK (id = 1),
    last_processed_at timestamptz NOT NULL DEFAULT (now() - interval '7 days'),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.dealer_lead_aggregator_cursor (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;


DO $$ BEGIN
    RAISE NOTICE '✅ dealer_leads + dealer_lead_events + cursor created with RLS';
END $$;
