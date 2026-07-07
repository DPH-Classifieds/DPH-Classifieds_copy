ALTER TABLE public.bikes
  ADD COLUMN IF NOT EXISTS registration_doc_url TEXT;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS registration_doc_url TEXT;

COMMENT ON COLUMN public.bikes.registration_doc_url
  IS 'Private mulkiyya/ownership document URL for admin review.';

COMMENT ON COLUMN public.license_plates.registration_doc_url
  IS 'Private ownership document URL for admin review.';
