-- 48-hour repeatable reminder system
-- Safe to re-run: all statements use IF NOT EXISTS / IF NOT EXISTS guards.
-- NOTE: email_events already exists with a different schema — we use outbound_emails instead.

-- listing_drafts: repeatable reminder columns
ALTER TABLE public.listing_drafts
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_count          INTEGER NOT NULL DEFAULT 0;

-- saved_listings: repeatable reminder columns
ALTER TABLE public.saved_listings
  ADD COLUMN IF NOT EXISTS reminder_sent_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_claimed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_last_error     TEXT,
  ADD COLUMN IF NOT EXISTS reminder_count          INTEGER NOT NULL DEFAULT 0;

-- saved_searches: alert columns
ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS alert_sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alert_claimed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alert_last_error        TEXT,
  ADD COLUMN IF NOT EXISTS alert_count             INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alert_last_result_count INTEGER;

-- cars/bikes/parts/plates: draft reminder tracking
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.bikes
  ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.car_parts
  ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS draft_reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_reminder_count      INTEGER NOT NULL DEFAULT 0;

-- outbound_emails: tracks every email sent + Resend webhook updates
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

CREATE INDEX IF NOT EXISTS idx_outbound_emails_sent_at   ON public.outbound_emails (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_emails_type      ON public.outbound_emails (email_type, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_emails_user      ON public.outbound_emails (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_emails_resend_id ON public.outbound_emails (resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- Performance indexes for reminder job queries (plain B-tree — no NOW() in predicate)
CREATE INDEX IF NOT EXISTS idx_listing_drafts_last_reminder ON public.listing_drafts  (last_reminder_sent_at);
CREATE INDEX IF NOT EXISTS idx_saved_listings_reminder      ON public.saved_listings   (reminder_sent_at);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alert         ON public.saved_searches   (alert_sent_at);
CREATE INDEX IF NOT EXISTS idx_cars_draft_reminder          ON public.cars             (draft_reminder_sent_at)
  WHERE status = 'draft' AND deleted_at IS NULL;
