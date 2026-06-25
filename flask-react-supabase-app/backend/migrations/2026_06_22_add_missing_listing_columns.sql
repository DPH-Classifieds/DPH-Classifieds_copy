-- Add columns that newer code expects but older DB setups may be missing.
-- All statements use ADD COLUMN IF NOT EXISTS — safe to re-run.

-- ── plate_images: add image metadata columns ──────────────────────────────
-- Old schema (bikes_schema.sql) only had: id, plate_id, url, is_main, uploaded_at
-- New code sends: url, image_url, is_primary; GET selects: url, uploaded_at
ALTER TABLE public.plate_images
  ADD COLUMN IF NOT EXISTS image_url   TEXT,
  ADD COLUMN IF NOT EXISTS display_url TEXT,
  ADD COLUMN IF NOT EXISTS focal_x     NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS focal_y     NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS crop_meta   JSONB,
  ADD COLUMN IF NOT EXISTS is_primary  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ DEFAULT NOW();


-- ── bikes: add columns the POST handler writes ────────────────────────────
ALTER TABLE public.bikes
  ADD COLUMN IF NOT EXISTS user_email  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS features    TEXT[],
  ADD COLUMN IF NOT EXISTS cylinders   INTEGER,
  ADD COLUMN IF NOT EXISTS wheels      INTEGER,
  ADD COLUMN IF NOT EXISTS area        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS emirate     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS condition   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS transmission VARCHAR(50),
  ADD COLUMN IF NOT EXISTS fuel_type   VARCHAR(50);

-- ── car_parts: add columns the POST handler writes ────────────────────────
ALTER TABLE public.car_parts
  ADD COLUMN IF NOT EXISTS user_email        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS area              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS emirate           VARCHAR(50),
  ADD COLUMN IF NOT EXISTS whatsapp_number   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS whatsapp_prefill_text TEXT,
  ADD COLUMN IF NOT EXISTS is_dealer         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS country_code      VARCHAR(10) DEFAULT '+971';

-- If compatible_years was created as VARCHAR(100) (older schema) we can't
-- change the type in-place without a rewrite.  The backend now sends it as
-- a plain string, so this is only needed if the column is missing entirely.
ALTER TABLE public.car_parts
  ADD COLUMN IF NOT EXISTS compatible_years VARCHAR(100),
  ADD COLUMN IF NOT EXISTS compatible_makes TEXT[],
  ADD COLUMN IF NOT EXISTS compatible_models TEXT[];

-- ── license_plates: add user_email if missing ────────────────────────────
ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);

-- ── cars: add user_email if missing ──────────────────────────────────────
-- The POST handler sets user_email after whitelist filtering; the original
-- schema omitted this column causing every new car insert to fail via the
-- PGRST204 path and then the lifecycle fallback wrongly strips listing_title.
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);
