CREATE TABLE IF NOT EXISTS public.price_drops (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_type   TEXT NOT NULL CHECK (listing_type IN ('cars', 'bikes', 'car_parts', 'license_plates')),
  listing_id     uuid NOT NULL,
  old_price      INTEGER NOT NULL,
  new_price      INTEGER NOT NULL,
  drop_pct       NUMERIC(5,2) GENERATED ALWAYS AS (
    ROUND(((old_price - new_price)::numeric / NULLIF(old_price, 0)) * 100, 2)
  ) STORED,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ,
  notified_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_price_drops_unprocessed
  ON public.price_drops (created_at)
  WHERE processed_at IS NULL;
