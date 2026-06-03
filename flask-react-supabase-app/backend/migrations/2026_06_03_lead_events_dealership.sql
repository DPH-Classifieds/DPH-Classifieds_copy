ALTER TABLE public.lead_events
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id);

CREATE INDEX IF NOT EXISTS idx_lead_events_dealership_time
    ON public.lead_events(dealership_id, created_at DESC);

-- Backfill: derive dealership_id by joining each lead_event to its listing's dealership_id.
UPDATE public.lead_events le
SET dealership_id = c.dealership_id
FROM public.cars c
WHERE le.listing_type = 'car' AND le.listing_id::uuid = c.id AND le.dealership_id IS NULL;

UPDATE public.lead_events le
SET dealership_id = b.dealership_id
FROM public.bikes b
WHERE le.listing_type = 'bike' AND le.listing_id::uuid = b.id AND le.dealership_id IS NULL;

UPDATE public.lead_events le
SET dealership_id = p.dealership_id
FROM public.license_plates p
WHERE le.listing_type = 'plate' AND le.listing_id::uuid = p.id AND le.dealership_id IS NULL;

UPDATE public.lead_events le
SET dealership_id = cp.dealership_id
FROM public.car_parts cp
WHERE le.listing_type = 'part' AND le.listing_id::uuid = cp.id AND le.dealership_id IS NULL;

DO $$ BEGIN RAISE NOTICE '✅ lead_events backfilled with dealership_id'; END $$;
