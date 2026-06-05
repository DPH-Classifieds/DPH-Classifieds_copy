-- ============================================================
-- Phase 4 — Outbound Webhooks
-- Tables: dealer_webhooks, dealer_webhook_deliveries
-- ============================================================

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

-- Realtime for delivery log live-updates
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_webhook_deliveries;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

DO $$ BEGIN
    RAISE NOTICE '✅ Phase 4 webhooks tables created';
END $$;
