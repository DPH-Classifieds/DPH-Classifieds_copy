-- Canonical dealer verification lifecycle and private document storage.
-- Run after add_dealer_kyc_columns.sql and create_dealer_documents.sql.

ALTER TABLE public.users
  ALTER COLUMN dealer_application_status SET DEFAULT 'draft';

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_dealer_application_status_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_dealer_application_status_check
  CHECK (dealer_application_status IN (
    'draft', 'ready_to_submit', 'submitted', 'under_review',
    'action_required', 'approved', 'rejected'
  ));

-- New uploads already use `replaced_at`; this index makes active-document
-- readiness and replacement checks deterministic and fast.
ALTER TABLE public.dealer_documents
  DROP CONSTRAINT IF EXISTS dealer_documents_user_id_document_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS dealer_documents_one_active_type_per_user
  ON public.dealer_documents (user_id, document_type)
  WHERE replaced_at IS NULL;

-- Dealer verification files contain legal and tax information. The application
-- now supplies time-limited signed URLs, so the bucket must not be public.
UPDATE storage.buckets
SET public = false
WHERE id = 'dealer-documents';
