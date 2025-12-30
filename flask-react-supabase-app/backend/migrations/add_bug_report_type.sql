-- Allow bug reports in reports table
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_listing_type_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_listing_type_check
  CHECK (listing_type IN ('car', 'bike', 'plate', 'part', 'bug'));

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_reason_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reason_check
  CHECK (reason IN ('spam', 'fraud', 'inappropriate', 'wrong_category', 'duplicate', 'sold', 'incorrect_info', 'other', 'bug'));
