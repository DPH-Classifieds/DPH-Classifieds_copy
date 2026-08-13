-- Dealer verification now requires only a Trade License and TRN certificate.
-- Keep historical company-registration rows intact for audit purposes.

ALTER TABLE public.dealer_documents
  ADD COLUMN IF NOT EXISTS ocr_expires_at date,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric,
  ADD COLUMN IF NOT EXISTS ocr_raw_text text,
  ADD COLUMN IF NOT EXISTS ocr_scanned_at timestamptz;

COMMENT ON COLUMN public.dealer_documents.ocr_expires_at
  IS 'Expiry date extracted by PaddleOCR from a trade license; admin must still review.';
COMMENT ON COLUMN public.dealer_documents.ocr_confidence
  IS 'PaddleOCR recognition confidence for the detected expiry text.';
