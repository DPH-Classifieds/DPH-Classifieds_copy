-- Safe foundation for self-hosted vision/OCR evaluation. No production policy
-- changes are made by this migration; writes are service-role only.

CREATE TABLE IF NOT EXISTS public.moderation_image_checks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_type text NOT NULL,
    listing_id text NOT NULL,
    image_url text NOT NULL,
    image_sha256 text,
    service_mode text NOT NULL DEFAULT 'shadow',
    model_version text NOT NULL,
    scores jsonb NOT NULL DEFAULT '{}'::jsonb,
    observations jsonb NOT NULL DEFAULT '{}'::jsonb,
    recommendation text NOT NULL DEFAULT 'review',
    latency_ms integer,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_image_checks_listing
    ON public.moderation_image_checks (listing_type, listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_image_checks_model
    ON public.moderation_image_checks (model_version, created_at DESC);

CREATE TABLE IF NOT EXISTS public.moderation_labels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    check_id uuid REFERENCES public.moderation_image_checks(id) ON DELETE SET NULL,
    listing_type text NOT NULL,
    listing_id text NOT NULL,
    image_url text NOT NULL,
    label text NOT NULL CHECK (label IN ('allow', 'explicit_content', 'face_present', 'non_vehicle', 'false_positive', 'false_negative')),
    reviewer_id text,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_labels_created
    ON public.moderation_labels (created_at DESC);

CREATE TABLE IF NOT EXISTS public.model_registry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_family text NOT NULL,
    version text NOT NULL,
    status text NOT NULL CHECK (status IN ('candidate', 'shadow', 'active', 'retired')) DEFAULT 'candidate',
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
    promoted_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (model_family, version)
);

ALTER TABLE public.listing_verification_scans
    ADD COLUMN IF NOT EXISTS ocr_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS reviewer_outcome text,
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS reviewer_id text;

ALTER TABLE public.moderation_image_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_image_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_labels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_registry FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.moderation_image_checks IS 'Append-only shadow/enforcement model output audit. Service-role writes only.';
COMMENT ON TABLE public.moderation_labels IS 'Moderator corrections used for weekly quality evaluation and future training.';
COMMENT ON TABLE public.model_registry IS 'Controlled model promotion registry; no model is promoted automatically.';
