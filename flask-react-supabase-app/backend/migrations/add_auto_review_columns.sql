-- Adds auto-review tracking columns to all four listing tables and expands
-- the status CHECK constraint to allow 'pending_auto_review'.
-- Idempotent: safe to re-run.
-- Apply against the DPH classifieds Supabase project before enabling
-- AUTO_REVIEW_WORKER_ENABLED=true.
DO $$
DECLARE
    t      text;
    conrow RECORD;
BEGIN
    FOREACH t IN ARRAY ARRAY['cars', 'bikes', 'car_parts', 'license_plates']
    LOOP
        -- Add auto-review tracking columns
        EXECUTE format(
            'ALTER TABLE public.%I '
            'ADD COLUMN IF NOT EXISTS auto_review_state text NULL, '
            'ADD COLUMN IF NOT EXISTS auto_review_reasons jsonb NOT NULL DEFAULT ''[]''::jsonb, '
            'ADD COLUMN IF NOT EXISTS auto_review_decided_at timestamptz NULL',
            t
        );

        -- Expand the status CHECK constraint to include pending_auto_review
        FOR conrow IN
            SELECT conname
            FROM   pg_constraint
            WHERE  conrelid = format('public.%I', t)::regclass
              AND  contype  = 'c'
              AND  pg_get_constraintdef(oid) ILIKE '%status%'
        LOOP
            EXECUTE format(
                'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                t, conrow.conname
            );
        END LOOP;

        EXECUTE format(
            $sql$
                ALTER TABLE public.%I
                    ADD CONSTRAINT %I
                    CHECK (
                        status IS NULL OR status IN (
                            'pending', 'pending_auto_review', 'approved',
                            'active', 'expired', 'deleted', 'rejected',
                            'sold', 'draft'
                        )
                    ) NOT VALID
            $sql$,
            t, t || '_status_check'
        );

        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_%I_pending_auto_review '
            'ON public.%I (status, auto_review_decided_at) '
            'WHERE status = ''pending_auto_review''',
            t, t
        );
    END LOOP;
END $$;
