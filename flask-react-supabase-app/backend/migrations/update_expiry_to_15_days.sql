-- Update listing expiry from 30 days to 15 days for new listings
-- Existing listings keep their current expiry dates

-- Add listing_title column to license_plates if not present
ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS listing_title TEXT;

-- Backfill listing_title for existing plates
UPDATE public.license_plates
SET listing_title = TRIM(CONCAT(COALESCE(city, ''), ' ', COALESCE(code, ''), ' ', COALESCE(number, '')))
WHERE listing_title IS NULL;

-- Note: LISTING_EXPIRY_DAYS is now 15 in app.py
-- New listings will automatically get expires_at = created_at + 15 days
-- Existing listings are unaffected (they keep their original expires_at)
