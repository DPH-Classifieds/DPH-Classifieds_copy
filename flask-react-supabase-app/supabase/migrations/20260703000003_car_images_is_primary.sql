-- Add is_primary column to car_images (and bike/part image tables) with backfill.
-- The first uploaded image per listing becomes the primary thumbnail.
-- Safe to re-run: IF NOT EXISTS + idempotent UPDATE.

ALTER TABLE public.car_images
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: mark the earliest-uploaded image per car as primary.
-- Only touches rows where no primary is already set for that car.
UPDATE public.car_images ci
SET is_primary = TRUE
WHERE ci.id IN (
  SELECT DISTINCT ON (car_id) id
  FROM public.car_images
  WHERE car_id IN (
    SELECT car_id FROM public.car_images
    GROUP BY car_id
    HAVING COUNT(*) FILTER (WHERE is_primary) = 0
  )
  ORDER BY car_id, uploaded_at ASC NULLS LAST, id ASC
);

CREATE INDEX IF NOT EXISTS idx_car_images_car_primary
  ON public.car_images (car_id, is_primary DESC, uploaded_at ASC);

-- bike_images (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bike_images') THEN
    ALTER TABLE public.bike_images ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE public.bike_images bi SET is_primary = TRUE
    WHERE bi.id IN (
      SELECT DISTINCT ON (bike_id) id FROM public.bike_images
      WHERE bike_id IN (
        SELECT bike_id FROM public.bike_images
        GROUP BY bike_id HAVING COUNT(*) FILTER (WHERE is_primary) = 0
      )
      ORDER BY bike_id, uploaded_at ASC NULLS LAST, id ASC
    );
    CREATE INDEX IF NOT EXISTS idx_bike_images_bike_primary ON public.bike_images (bike_id, is_primary DESC, uploaded_at ASC);
  END IF;
END $$;

-- part_images (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='part_images') THEN
    ALTER TABLE public.part_images ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE public.part_images pi SET is_primary = TRUE
    WHERE pi.id IN (
      SELECT DISTINCT ON (part_id) id FROM public.part_images
      WHERE part_id IN (
        SELECT part_id FROM public.part_images
        GROUP BY part_id HAVING COUNT(*) FILTER (WHERE is_primary) = 0
      )
      ORDER BY part_id, uploaded_at ASC NULLS LAST, id ASC
    );
    CREATE INDEX IF NOT EXISTS idx_part_images_part_primary ON public.part_images (part_id, is_primary DESC, uploaded_at ASC);
  END IF;
END $$;
