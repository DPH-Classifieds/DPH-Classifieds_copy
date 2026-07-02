-- push_tokens: Expo push notification token registry (one row per device).
-- Safe to re-run: IF NOT EXISTS guards throughout.

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  expo_push_token TEXT        NOT NULL UNIQUE,
  platform        TEXT,
  device_id       TEXT,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON public.push_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_enabled
  ON public.push_tokens (enabled) WHERE enabled = TRUE;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='push_tokens'
      AND policyname='allow_service_role_push_tokens'
  ) THEN
    CREATE POLICY "allow_service_role_push_tokens"
      ON public.push_tokens FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
