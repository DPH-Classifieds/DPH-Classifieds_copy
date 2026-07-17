-- app_errors: lightweight capture of silent failures/errors surfaced to users.
-- Precursor to Sentry — read by the admin "Errors" tab. Append-only.
-- Written only by the backend (service role); no client access.
CREATE TABLE IF NOT EXISTS public.app_errors (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     UUID,
  context     TEXT        NOT NULL,           -- e.g. 'ocr_scan_registration'
  error_code  TEXT,                           -- e.g. 'ocr_timeout'
  message     TEXT        NOT NULL,
  details     JSONB,
  source      TEXT        NOT NULL DEFAULT 'backend',  -- 'backend' | 'frontend'
  url         TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_errors_created_at ON public.app_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_errors_context    ON public.app_errors (context, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_errors_user       ON public.app_errors (user_id, created_at DESC);

-- RLS on with no policies = deny all for anon/authenticated. The backend uses
-- the service role, which bypasses RLS, so only the backend can read/write.
ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
