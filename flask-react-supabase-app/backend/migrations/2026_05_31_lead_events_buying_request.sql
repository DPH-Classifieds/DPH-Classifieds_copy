-- Extend lead event tracking to include buying_request listing type.

ALTER TABLE public.lead_events
  DROP CONSTRAINT IF EXISTS lead_events_listing_type_check;

ALTER TABLE public.lead_events
  ADD CONSTRAINT lead_events_listing_type_check
  CHECK (listing_type IN ('car', 'bike', 'part', 'plate', 'buying_request'));

