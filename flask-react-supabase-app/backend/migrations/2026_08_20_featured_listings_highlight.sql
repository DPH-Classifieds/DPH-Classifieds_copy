-- Per-listing highlight toggle for featured listings.
--
-- A featured listing always gets priority placement (it's in the pattern
-- rotation). `highlight` controls only the visual treatment on top of that:
-- true = yellow border + "Featured" tag on the card, false = the listing is
-- silently boosted (placed early) with no special styling, so it reads as
-- an organic result.

ALTER TABLE public.featured_listings
  ADD COLUMN IF NOT EXISTS highlight boolean NOT NULL DEFAULT true;

DO $$ BEGIN RAISE NOTICE '✅ featured_listings.highlight added'; END $$;
