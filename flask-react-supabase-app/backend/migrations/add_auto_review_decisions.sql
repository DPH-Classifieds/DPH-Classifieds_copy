-- Append-only audit log of automated approval decisions.
-- Service-role-only writes. No public RLS policy is created on purpose.
CREATE TABLE IF NOT EXISTS public.auto_review_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_type text NOT NULL,
    listing_id text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('approved', 'queued')),
    reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    signals jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_review_decisions_listing
    ON public.auto_review_decisions (listing_type, listing_id);

CREATE INDEX IF NOT EXISTS idx_auto_review_decisions_decision_time
    ON public.auto_review_decisions (decision, created_at DESC);

ALTER TABLE public.auto_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_review_decisions FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.auto_review_decisions IS
    'Append-only audit of automated approval decisions. Service-role writes only.';
