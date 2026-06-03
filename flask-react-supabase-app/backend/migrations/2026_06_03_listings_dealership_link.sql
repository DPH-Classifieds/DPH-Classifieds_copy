-- Link listings to dealerships + introduce external_id (for P3 importer upsert key).

ALTER TABLE public.cars
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.bikes
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.license_plates
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.car_parts
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;

CREATE INDEX IF NOT EXISTS idx_cars_dealership ON public.cars(dealership_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_dealership ON public.bikes(dealership_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plates_dealership ON public.license_plates(dealership_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_dealership ON public.car_parts(dealership_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cars_dealer_external
    ON public.cars(dealership_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bikes_dealer_external
    ON public.bikes(dealership_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_plates_dealer_external
    ON public.license_plates(dealership_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_parts_dealer_external
    ON public.car_parts(dealership_id, external_id) WHERE external_id IS NOT NULL;

-- Backfill from existing dealership_members (one membership per user, role=owner).
UPDATE public.cars c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

UPDATE public.bikes c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

UPDATE public.license_plates c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

UPDATE public.car_parts c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

DO $$ BEGIN RAISE NOTICE '✅ listings backfilled with dealership_id'; END $$;
