-- Fix auto_review_reasons NOT NULL without default on cars, car_parts, license_plates.
-- bikes was already patched in 2026_06_22_fix_missing_schema_columns.sql.
-- Idempotent: SET DEFAULT is safe to re-run.

ALTER TABLE public.cars
  ALTER COLUMN auto_review_reasons SET DEFAULT '[]'::jsonb;
UPDATE public.cars
  SET auto_review_reasons = '[]'::jsonb
  WHERE auto_review_reasons IS NULL;

ALTER TABLE public.car_parts
  ALTER COLUMN auto_review_reasons SET DEFAULT '[]'::jsonb;
UPDATE public.car_parts
  SET auto_review_reasons = '[]'::jsonb
  WHERE auto_review_reasons IS NULL;

ALTER TABLE public.license_plates
  ALTER COLUMN auto_review_reasons SET DEFAULT '[]'::jsonb;
UPDATE public.license_plates
  SET auto_review_reasons = '[]'::jsonb
  WHERE auto_review_reasons IS NULL;
