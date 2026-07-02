-- Outbound email tracking table + 48-hour reminder system columns.
-- Safe to re-run: IF NOT EXISTS / IF NOT EXISTS guards throughout.

-- outbound_emails: tracks every email sent via Resend + webhook lifecycle updates
CREATE TABLE IF NOT EXISTS public.outbound_emails (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_email_id TEXT,
  email_type      TEXT        NOT NULL,
  user_id         UUID,
  to_email        TEXT        NOT NULL,
  subject         TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  bounced_at      TIMESTAMPTZ,
  spam_at         TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  open_count      INTEGER     NOT NULL DEFAULT 0,
  click_count     INTEGER     NOT NULL DEFAULT 0,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbound_emails_sent_at
  ON public.outbound_emails (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_emails_type
  ON public.outbound_emails (email_type, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_emails_user
  ON public.outbound_emails (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_emails_resend_id
  ON public.outbound_emails (resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- Enable RLS; service_role bypasses it for backend writes
ALTER TABLE public.outbound_emails ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='outbound_emails'
      AND policyname='allow_service_role_outbound_emails'
  ) THEN
    CREATE POLICY "allow_service_role_outbound_emails"
      ON public.outbound_emails FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- saved_listings: reminder tracking columns
ALTER TABLE public.saved_listings
  ADD COLUMN IF NOT EXISTS saved_email_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS saved_email_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS saved_email_last_error TEXT,
  ADD COLUMN IF NOT EXISTS saved_email_count      INTEGER NOT NULL DEFAULT 0;

-- saved_searches: alert tracking columns
ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS alert_sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alert_claimed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alert_last_error        TEXT,
  ADD COLUMN IF NOT EXISTS alert_count             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alert_last_result_count INTEGER;

-- listing_drafts: reminder columns (table may not exist on all envs)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='listing_drafts'
  ) THEN
    ALTER TABLE public.listing_drafts
      ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reminder_count        INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- cars/bikes/car_parts/license_plates: draft reminder tracking
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bikes') THEN
    ALTER TABLE public.bikes
      ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

ALTER TABLE public.car_parts
  ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;

-- Performance indexes for reminder queries
CREATE INDEX IF NOT EXISTS idx_saved_listings_saved_email ON public.saved_listings (saved_email_sent_at);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alert ON public.saved_searches (alert_sent_at);
CREATE INDEX IF NOT EXISTS idx_cars_draft_reminder ON public.cars (draft_reminder_sent_at)
  WHERE status = 'draft' AND deleted_at IS NULL;
