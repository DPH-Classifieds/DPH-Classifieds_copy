CREATE TABLE IF NOT EXISTS public.dealer_kpi_daily (
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    date            date NOT NULL,
    listing_id      text NOT NULL DEFAULT '',
    listing_type    text NOT NULL DEFAULT '',
    impressions     int NOT NULL DEFAULT 0,
    detail_views    int NOT NULL DEFAULT 0,
    call_clicks     int NOT NULL DEFAULT 0,
    whatsapp_clicks int NOT NULL DEFAULT 0,
    vin_reveals     int NOT NULL DEFAULT 0,
    saves           int NOT NULL DEFAULT 0,
    PRIMARY KEY (dealership_id, date, listing_id, listing_type)
);
CREATE INDEX IF NOT EXISTS idx_kpi_daily_dealership_date ON public.dealer_kpi_daily(dealership_id, date DESC);

CREATE TABLE IF NOT EXISTS public.dealer_market_snapshots (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id         uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    listing_type          text NOT NULL,
    listing_id            text NOT NULL,
    snapshot_at           timestamptz NOT NULL DEFAULT now(),
    comp_count            int NOT NULL,
    median_price          numeric,
    p25_price             numeric,
    p75_price             numeric,
    median_days_on_market int,
    percentile_rank       numeric,
    signals               jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (listing_type, listing_id, snapshot_at)
);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_listing
    ON public.dealer_market_snapshots(listing_type, listing_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS public.dealer_admin_audit (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id   uuid NOT NULL REFERENCES public.users(id),
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    http_method     text NOT NULL,
    endpoint        text NOT NULL,
    payload_digest  text,
    result_status   int,
    user_agent      text,
    ip_address      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dealer_admin_audit_admin
    ON public.dealer_admin_audit(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_admin_audit_dealership
    ON public.dealer_admin_audit(dealership_id, created_at DESC);

DO $$ BEGIN RAISE NOTICE '✅ dealer_kpi_daily, dealer_market_snapshots, dealer_admin_audit created'; END $$;
