-- Extend expiry/deletion event tracking to include buying_request listing type.
-- This table is used for listing expiry notice events as well (reason='expiry_notice').

ALTER TABLE public.listing_deletion_events
  DROP CONSTRAINT IF EXISTS listing_deletion_events_listing_type_check;

ALTER TABLE public.listing_deletion_events
  ADD CONSTRAINT listing_deletion_events_listing_type_check
  CHECK (listing_type IN ('car', 'bike', 'part', 'plate', 'buying_request'));

