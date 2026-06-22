-- Fix missing columns identified by live DB inspection on 2026-06-22.
-- All statements are safe to re-run (IF NOT EXISTS / SET DEFAULT is idempotent).

-- ── part_images: missing url, display_url, focal_*, crop_meta ─────────────
-- Original schema only had: id, part_id, image_url, uploaded_at, cropped_at.
-- Backend sends url, display_url, focal_x, focal_y, crop_meta on every insert.
ALTER TABLE public.part_images
  ADD COLUMN IF NOT EXISTS url          TEXT,
  ADD COLUMN IF NOT EXISTS display_url  TEXT,
  ADD COLUMN IF NOT EXISTS focal_x      NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS focal_y      NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS crop_meta    JSONB;

-- ── bike_images: missing display_url, focal_*, crop_meta ──────────────────
ALTER TABLE public.bike_images
  ADD COLUMN IF NOT EXISTS display_url  TEXT,
  ADD COLUMN IF NOT EXISTS focal_x      NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS focal_y      NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS crop_meta    JSONB;

-- ── bikes: missing mileage, color, whatsapp_number ────────────────────────
ALTER TABLE public.bikes
  ADD COLUMN IF NOT EXISTS mileage          INTEGER,
  ADD COLUMN IF NOT EXISTS color            VARCHAR(50),
  ADD COLUMN IF NOT EXISTS whatsapp_number  VARCHAR(30);

-- ── bikes: auto_review_reasons is NOT NULL without a default ──────────────
-- Every new INSERT must supply it; give it an empty-array default so existing
-- rows and future INSERTs that omit it don't violate the constraint.
ALTER TABLE public.bikes
  ALTER COLUMN auto_review_reasons SET DEFAULT '{}'::text[];
UPDATE public.bikes
  SET auto_review_reasons = '{}'
  WHERE auto_review_reasons IS NULL;

-- ── license_plates: missing listing_title, whatsapp_number ────────────────
ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS listing_title    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS whatsapp_number  VARCHAR(30);

-- ── license_plates: proof_document_url for ownership verification ─────────
-- Stored server-side only; never exposed in public listing responses.
ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS proof_document_url TEXT;
