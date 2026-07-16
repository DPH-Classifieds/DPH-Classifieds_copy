-- Private storage bucket for retained mulkiya/registration scan images.
-- Purpose: build a real-world dataset of UAE mulkiya photos to continuously
-- improve/train the OCR pipeline over time. Not user-facing — only the
-- backend service role writes to and reads from this bucket. No public or
-- authenticated-user RLS policy is created on purpose: storage.objects has
-- RLS enabled by default, and the service role bypasses RLS entirely, so
-- omitting policies here means no client (anon or authenticated) can ever
-- read or write this bucket directly.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'mulkiya-training-data',
    'mulkiya-training-data',
    false,
    20971520, -- 20 MB, matches backend MAX_UPLOAD_SIZE_MB default
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Path of the retained image within the bucket above, per OCR scan.
ALTER TABLE public.listing_verification_scans
ADD COLUMN IF NOT EXISTS training_image_path text;

COMMENT ON COLUMN public.listing_verification_scans.training_image_path IS
    'Object path in the private mulkiya-training-data bucket. Retained for continuous OCR training; not shown to users.';
