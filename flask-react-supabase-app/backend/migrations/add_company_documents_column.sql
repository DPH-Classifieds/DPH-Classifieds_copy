-- Add company_documents JSONB column to users table for dealer document uploads
-- Stores an array of { url, filename, type, uploaded_at } objects

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS company_documents JSONB DEFAULT '[]'::jsonb;

-- Set verification_documents_submitted to true when documents are uploaded
-- This column already exists but is never set to true

COMMENT ON COLUMN public.users.company_documents IS 'Array of uploaded company document objects: [{url, filename, type, uploaded_at}]';
