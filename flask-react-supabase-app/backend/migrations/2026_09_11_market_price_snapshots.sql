-- Daily platform asking-price snapshots by exact car make/model/year cohort.
-- Apply in Supabase SQL editor. Idempotent and service-role write only.

CREATE TABLE IF NOT EXISTS public.market_price_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_key       text NOT NULL,
  car_manufacturer text NOT NULL,
  car_model        text NOT NULL,
  make_year        int NOT NULL,
  snapshot_date    date NOT NULL,
  listing_count    int NOT NULL,
  average_price    numeric NOT NULL,
  median_price     numeric NOT NULL,
  p25_price        numeric,
  p75_price        numeric,
  min_price        numeric,
  max_price        numeric,
  source           text NOT NULL DEFAULT 'platform_cars',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cohort_key, snapshot_date)
);

CREATE INDEX IF NOT EXISTS market_price_snapshots_cohort_date_idx
  ON public.market_price_snapshots (cohort_key, snapshot_date DESC);

ALTER TABLE public.market_price_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "market_price_snapshots_service_only" ON public.market_price_snapshots;
CREATE POLICY "market_price_snapshots_service_only"
  ON public.market_price_snapshots FOR ALL
  USING (false) WITH CHECK (false);
