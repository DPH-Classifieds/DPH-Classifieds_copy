-- Adds auto-review tracking columns to all four listing tables.
-- Idempotent: safe to re-run.
-- Apply against the DPH classifieds Supabase project before enabling
-- AUTO_REVIEW_WORKER_ENABLED=true.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['cars', 'bikes', 'car_parts', 'license_plates']
    LOOP
        EXECUTE format(
            'ALTER TABLE public.%I '
            'ADD COLUMN IF NOT EXISTS auto_review_state text NULL, '
            'ADD COLUMN IF NOT EXISTS auto_review_reasons jsonb NOT NULL DEFAULT ''[]''::jsonb, '
            'ADD COLUMN IF NOT EXISTS auto_review_decided_at timestamptz NULL',
            t
        );
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_%I_pending_auto_review '
            'ON public.%I (status, auto_review_decided_at) '
            'WHERE status = ''pending_auto_review''',
            t, t
        );
    END LOOP;
END $$;
