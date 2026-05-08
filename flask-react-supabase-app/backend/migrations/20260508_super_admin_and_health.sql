CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.users
SET
    is_super_admin = TRUE,
    is_admin = TRUE,
    account_status = 'active',
    email_verified = TRUE,
    phone_verified = TRUE,
    updated_at = NOW()
WHERE LOWER(email) = 'admin@dphclassifieds.com'
   OR LOWER(username) IN ('dphclassifieds', 'dph classifieds');

CREATE TABLE IF NOT EXISTS public.platform_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL DEFAULT 'worker',
    overall_status TEXT NOT NULL DEFAULT 'healthy',
    frontend_status TEXT NOT NULL DEFAULT 'unknown',
    backend_status TEXT NOT NULL DEFAULT 'unknown',
    redis_status TEXT NOT NULL DEFAULT 'unknown',
    worker_status TEXT NOT NULL DEFAULT 'unknown',
    frontend_latency_ms NUMERIC,
    backend_latency_ms NUMERIC,
    redis_latency_ms NUMERIC,
    worker_latency_ms NUMERIC,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.platform_health_checks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_platform_health_checks_checked_at
    ON public.platform_health_checks (checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_is_super_admin
    ON public.users (is_super_admin);
