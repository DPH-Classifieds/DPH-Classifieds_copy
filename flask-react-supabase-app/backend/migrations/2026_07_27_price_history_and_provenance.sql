-- Price history tracking + imported-field provenance.
--
-- Apply manually in the Supabase SQL editor (project ltjatsyhpmvewancqdjw).
-- Idempotent (safe to re-run).

-- 1. Price history: one row per observed price for a listing, so a listing's
--    price can be tracked end to end (initial import + every change).
CREATE TABLE IF NOT EXISTS public.listing_price_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_type text NOT NULL,                 -- car | bike | plate | part
  listing_id   uuid NOT NULL,
  price        numeric,
  currency     text NOT NULL DEFAULT 'AED',
  source       text NOT NULL DEFAULT 'import', -- import | admin | seller
  recorded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_price_history_listing_idx
  ON public.listing_price_history (listing_type, listing_id, recorded_at DESC);
-- Service role bypasses RLS; enabling with no policies denies anon/authenticated.
ALTER TABLE public.listing_price_history ENABLE ROW LEVEL SECURITY;

-- 2. Provenance: which source populated each imported field
--    (title / vin / description / default) — powers the admin verify view.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cars', 'bikes', 'license_plates', 'car_parts'] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS import_field_sources jsonb', t);
  END LOOP;
END $$;
