-- Dealer listing upgrade requests, limit history, and pending auto-approvals.
-- This migration introduces:
--   1) dealer_listing_upgrade_requests — dealer-initiated cap-increase queue
--   2) dealer_listing_limit_history   — audit trail of every limit change
--   3) dealer_pending_approvals       — delayed-action queue for OCR auto-approval
--   4) DEFAULT 4 on users.dealer_listing_limit (existing per-user overrides preserved)

-- 1) Default dealer cap drops to 4 (was 20).
ALTER TABLE public.users
  ALTER COLUMN dealer_listing_limit SET DEFAULT 4;

-- 2) Upgrade-request queue (dealer-initiated)
CREATE TABLE IF NOT EXISTS public.dealer_listing_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  current_limit integer NOT NULL,
  requested_limit integer NOT NULL CHECK (requested_limit > 0 AND requested_limit <= 1000),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_listing_upgrade_requests_pending_idx
  ON public.dealer_listing_upgrade_requests(status, created_at DESC)
  WHERE status = 'pending';
-- One pending request per dealer — protects against spam
CREATE UNIQUE INDEX IF NOT EXISTS dealer_listing_upgrade_requests_one_pending
  ON public.dealer_listing_upgrade_requests(dealer_id)
  WHERE status = 'pending';

-- 3) Limit history (audit trail)
CREATE TABLE IF NOT EXISTS public.dealer_listing_limit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  old_limit integer,
  new_limit integer NOT NULL,
  changed_by uuid REFERENCES public.users(id),
  reason text,
  source text NOT NULL CHECK (source IN ('auto_default','admin_override','upgrade_request')),
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_listing_limit_history_dealer_idx
  ON public.dealer_listing_limit_history(dealer_id, created_at DESC);

-- 4) Pending auto-approval queue (delayed-action pattern)
CREATE TABLE IF NOT EXISTS public.dealer_pending_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger_kind text NOT NULL DEFAULT 'ocr_high_confidence',
  scheduled_for timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','fired','cancelled')),
  trade_license_doc_id uuid,
  tax_registration_doc_id uuid,
  trade_license_confidence numeric,
  tax_registration_confidence numeric,
  threshold numeric NOT NULL DEFAULT 0.90,
  fired_at timestamptz,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_pending_approvals_due_idx
  ON public.dealer_pending_approvals(state, scheduled_for)
  WHERE state = 'pending';
-- One pending per user — re-uploads cancel + replace
CREATE UNIQUE INDEX IF NOT EXISTS dealer_pending_approvals_one_pending
  ON public.dealer_pending_approvals(user_id)
  WHERE state = 'pending';

-- 5) Enable RLS on the new tables. The backend reads/writes via the service
-- role key, which bypasses RLS. Authenticated clients that need to read these
-- tables directly (not yet) can have explicit policies added later.
ALTER TABLE public.dealer_listing_upgrade_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_listing_limit_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_pending_approvals       ENABLE ROW LEVEL SECURITY;
