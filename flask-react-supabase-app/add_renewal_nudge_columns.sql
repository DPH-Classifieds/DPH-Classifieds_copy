-- Migration: track admin-initiated "renew your listing" nudges
-- Run in Supabase SQL Editor.
--
-- Columns added to every listing table:
--   renewal_nudge_sent_at   - last time an admin pinged the owner
--   renewal_nudge_sent_by   - admin user_id who sent the most recent nudge
--   renewal_nudge_count     - how many nudges were sent in total
--   renewal_nudge_channels  - jsonb { email: bool, sms: bool, whatsapp: bool } for the last send

ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_by UUID,
  ADD COLUMN IF NOT EXISTS renewal_nudge_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_nudge_channels JSONB;

ALTER TABLE bikes
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_by UUID,
  ADD COLUMN IF NOT EXISTS renewal_nudge_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_nudge_channels JSONB;

ALTER TABLE car_parts
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_by UUID,
  ADD COLUMN IF NOT EXISTS renewal_nudge_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_nudge_channels JSONB;

ALTER TABLE license_plates
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS renewal_nudge_sent_by UUID,
  ADD COLUMN IF NOT EXISTS renewal_nudge_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_nudge_channels JSONB;
