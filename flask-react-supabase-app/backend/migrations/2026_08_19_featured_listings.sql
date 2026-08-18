-- Featured listings (admin-curated, time-boxed)
--
-- Model: admin toggles a listing as featured for an optional duration. While
-- featured, the listing renders with a "Featured" badge on the Explore page
-- and inside its category. featured_until = NULL means "until admin removes
-- it". The listing is a single source of truth — we don't denormalize onto
-- cars/bikes/plates/parts.
--
-- A single table (rather than per-type columns) keeps the schema simple and
-- the "currently active featured" query trivial.

CREATE TABLE IF NOT EXISTS public.featured_listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_type    text NOT NULL CHECK (listing_type IN ('car','bike','plate','part')),
  listing_id      uuid NOT NULL,
  featured_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  featured_at     timestamptz NOT NULL DEFAULT now(),
  featured_until  timestamptz,  -- NULL = no expiry
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One row per (listing_type, listing_id) — re-featuring a listing
  -- updates the existing row rather than creating duplicates.
  UNIQUE (listing_type, listing_id)
);

-- The hot read path: "is listing X currently featured?"
CREATE INDEX IF NOT EXISTS idx_featured_listings_lookup
  ON public.featured_listings (listing_type, listing_id)
  WHERE featured_until IS NULL OR featured_until > now();

-- The admin queue: list everything, newest first.
CREATE INDEX IF NOT EXISTS idx_featured_listings_recent
  ON public.featured_listings (featured_at DESC);

-- Auto-update the updated_at column.
CREATE OR REPLACE FUNCTION public.featured_listings_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_featured_listings_touch_updated_at ON public.featured_listings;
CREATE TRIGGER trg_featured_listings_touch_updated_at
  BEFORE UPDATE ON public.featured_listings
  FOR EACH ROW EXECUTE FUNCTION public.featured_listings_touch_updated_at();

-- Enable RLS. Backend reads/writes via the service role, which bypasses RLS.
-- Anon reads happen via the public endpoint, which runs as service role too.
ALTER TABLE public.featured_listings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN RAISE NOTICE '✅ featured_listings created'; END $$;
