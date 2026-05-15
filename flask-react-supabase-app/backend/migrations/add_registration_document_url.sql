-- Add registration_document_url to cars table for Mulkiya verification
-- Admins can view this image during listing review and delete it after verification

ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS registration_document_url TEXT;

COMMENT ON COLUMN public.cars.registration_document_url IS 'URL of uploaded Mulkiya/car registration document for ownership and VIN verification. Deleted after admin verification.';
