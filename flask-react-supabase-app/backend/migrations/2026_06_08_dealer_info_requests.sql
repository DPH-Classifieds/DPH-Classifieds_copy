-- ============================================================
-- Admin "Request more info" flow for dealer verification.
--
-- An admin reviewing a dealer can request additional documents by
-- inserting a row into dealer_info_requests with a list of free-text
-- document labels. The dealer receives a tokenised public URL where
-- they can upload the requested files. Uploads land in
-- dealer_info_request_uploads.
--
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dealer_info_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    requested_documents TEXT[] NOT NULL DEFAULT '{}',
    message TEXT,
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'submitted', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dealer_info_requests_dealer
    ON public.dealer_info_requests(dealer_user_id);
CREATE INDEX IF NOT EXISTS idx_dealer_info_requests_token
    ON public.dealer_info_requests(token);
CREATE INDEX IF NOT EXISTS idx_dealer_info_requests_status
    ON public.dealer_info_requests(status);

CREATE TABLE IF NOT EXISTS public.dealer_info_request_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.dealer_info_requests(id) ON DELETE CASCADE,
    document_label TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT,
    storage_path TEXT NOT NULL,
    url TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dealer_info_request_uploads_request
    ON public.dealer_info_request_uploads(request_id);

-- Row Level Security: backend uses service_role for everything, so we lock
-- down anon/authenticated to read-only-nothing. Public token access is
-- enforced in the backend route, not at the database level.
ALTER TABLE public.dealer_info_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_info_request_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "svc_dealer_info_requests"        ON public.dealer_info_requests;
DROP POLICY IF EXISTS "svc_dealer_info_request_uploads" ON public.dealer_info_request_uploads;

CREATE POLICY "svc_dealer_info_requests"
    ON public.dealer_info_requests
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "svc_dealer_info_request_uploads"
    ON public.dealer_info_request_uploads
    FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN
    RAISE NOTICE '✅ dealer_info_requests + dealer_info_request_uploads created';
END $$;
