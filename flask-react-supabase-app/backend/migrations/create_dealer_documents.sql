-- ============================================================
-- Dealer Documents Table with Per-Document Approval
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================

-- 1. Create dealer_documents table
CREATE TABLE IF NOT EXISTS public.dealer_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL CHECK (document_type IN ('trade_license', 'company_registration', 'tax_registration')),
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    denial_reason TEXT,
    denial_fix TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, document_type)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_dealer_documents_user_id ON public.dealer_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_dealer_documents_status ON public.dealer_documents(status);
CREATE INDEX IF NOT EXISTS idx_dealer_documents_type ON public.dealer_documents(document_type);

-- 3. Migrate existing data from company_documents JSONB
DO $$
DECLARE
    doc RECORD;
    user_record RECORD;
    doc_obj JSONB;
    doc_type TEXT;
BEGIN
    FOR user_record IN
        SELECT id, company_documents
        FROM public.users
        WHERE company_documents IS NOT NULL
        AND jsonb_array_length(company_documents) > 0
    LOOP
        FOR doc_obj IN SELECT jsonb_array_elements(user_record.company_documents)
        LOOP
            -- Infer document type from filename or position
            doc_type := LOWER(REPLACE(
                COALESCE(
                    doc_obj->>'filename',
                    'document'
                ),
                ' ', '_'
            ));

            -- Try to match to known types
            IF doc_type ILIKE '%trade%' OR doc_type ILIKE '%license%' THEN
                doc_type := 'trade_license';
            ELSIF doc_type ILIKE '%registration%' OR doc_type ILIKE '%company%' OR doc_type ILIKE '%cr%' THEN
                doc_type := 'company_registration';
            ELSIF doc_type ILIKE '%tax%' OR doc_type ILIKE '%trn%' THEN
                doc_type := 'tax_registration';
            ELSE
                -- Default: assign based on what the user doesn't have yet
                IF NOT EXISTS (
                    SELECT 1 FROM public.dealer_documents
                    WHERE user_id = user_record.id AND document_type = 'trade_license'
                ) THEN
                    doc_type := 'trade_license';
                ELSIF NOT EXISTS (
                    SELECT 1 FROM public.dealer_documents
                    WHERE user_id = user_record.id AND document_type = 'company_registration'
                ) THEN
                    doc_type := 'company_registration';
                ELSIF NOT EXISTS (
                    SELECT 1 FROM public.dealer_documents
                    WHERE user_id = user_record.id AND document_type = 'tax_registration'
                ) THEN
                    doc_type := 'tax_registration';
                ELSE
                    doc_type := 'trade_license'; -- fallback
                END IF;
            END IF;

            -- Insert if not already exists for this user+type
            INSERT INTO public.dealer_documents (user_id, document_type, url, filename, file_type, storage_path, status, uploaded_at)
            SELECT
                user_record.id,
                doc_type,
                doc_obj->>'url',
                COALESCE(doc_obj->>'filename', 'unknown'),
                COALESCE(doc_obj->>'type', 'application/octet-stream'),
                COALESCE(doc_obj->>'storage_path', ''),
                'approved',
                COALESCE((doc_obj->>'uploaded_at')::timestamptz, NOW())
            WHERE NOT EXISTS (
                SELECT 1 FROM public.dealer_documents
                WHERE user_id = user_record.id AND document_type = doc_type
            );
        END LOOP;
    END LOOP;
END $$;

-- 4. Add all_documents_approved helper view
CREATE OR REPLACE VIEW public.dealer_documents_status AS
SELECT
    d.user_id,
    COUNT(*) FILTER (WHERE d.status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE d.status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE d.status = 'denied') AS denied_count,
    COUNT(*) AS total_count,
    (COUNT(*) FILTER (WHERE d.status = 'approved') >= 3) AS all_approved
FROM public.dealer_documents d
GROUP BY d.user_id;

-- 5. Enable RLS
ALTER TABLE public.dealer_documents ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies
CREATE POLICY "Users can view their own dealer documents"
ON public.dealer_documents FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own dealer documents"
ON public.dealer_documents FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own dealer documents"
ON public.dealer_documents FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dealer documents"
ON public.dealer_documents FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to dealer documents"
ON public.dealer_documents FOR ALL
USING (true)
WITH CHECK (true);

-- 7. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_documents TO authenticated;
GRANT ALL ON public.dealer_documents TO service_role;
GRANT SELECT ON public.dealer_documents_status TO authenticated;
GRANT SELECT ON public.dealer_documents_status TO service_role;

-- Done
DO $$ BEGIN
    RAISE NOTICE '✅ dealer_documents table created and existing data migrated';
END $$;
