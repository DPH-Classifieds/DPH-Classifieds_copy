-- Fixes for defects found driving the live signup/posting flows end to end.

-- 1. dealer_admin_messages was referenced by routes/dealer_verification.py but
--    never created, so GET /api/dealer/verification/messages 500'd on every
--    load of the dealer verification page and every "Talk to the admin team"
--    send was silently dropped.
CREATE TABLE IF NOT EXISTS public.dealer_admin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'verification_update',
  context text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_admin_messages_dealer_created
  ON public.dealer_admin_messages (dealer_id, created_at DESC);

ALTER TABLE public.dealer_admin_messages ENABLE ROW LEVEL SECURITY;

-- Backend workers use service_role; clients must never read this table
-- directly. Same posture as the other dealer tables in 20260828000001.
DROP POLICY IF EXISTS service_role_all ON public.dealer_admin_messages;
CREATE POLICY service_role_all ON public.dealer_admin_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. public.users.id -> auth.users.id had no ON DELETE CASCADE, so deleting an
--    auth user always failed with 23503 users_id_fkey and the profile row had
--    to be removed by hand first.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;
ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. dealer_application_status defaulted to 'draft' for everyone, so ordinary
--    individual signups looked like half-finished dealer applications. Only
--    the signup route sets it, and only for dealers.
ALTER TABLE public.users ALTER COLUMN dealer_application_status DROP DEFAULT;

UPDATE public.users
SET dealer_application_status = NULL
WHERE COALESCE(is_dealer, false) = false
  AND dealer_application_status = 'draft';
