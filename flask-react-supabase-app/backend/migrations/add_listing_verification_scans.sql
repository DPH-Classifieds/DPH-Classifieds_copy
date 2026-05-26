CREATE TABLE IF NOT EXISTS public.listing_verification_scans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_type text,
    listing_id text,
    user_id text,
    document_type text,
    raw_text text,
    fields jsonb NOT NULL DEFAULT '{}'::jsonb,
    vin_validation jsonb NOT NULL DEFAULT '{}'::jsonb,
    confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    needs_review boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_verification_scans_listing
    ON public.listing_verification_scans (listing_type, listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_verification_scans_user_id
    ON public.listing_verification_scans (user_id);

CREATE INDEX IF NOT EXISTS idx_listing_verification_scans_needs_review
    ON public.listing_verification_scans (needs_review);

ALTER TABLE public.listing_verification_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_verification_scans FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.listing_verification_scans IS
    'Sensitive OCR registration scans. No public RLS policy is created; backend service role writes scan records.';
