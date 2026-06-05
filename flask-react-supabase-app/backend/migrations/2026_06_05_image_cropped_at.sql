-- ============================================================
-- Unified Cropper migration: cropped_at column on *_images
-- Semantics:
--   cropped_at IS NULL     -> legacy row, blob is the original upload;
--                             renderer must use focal_x/focal_y CSS positioning
--   cropped_at IS NOT NULL -> blob is already a cropped JPEG at the listing
--                             kind's target aspect ratio; renderer uses plain <img>
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.car_images       ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.bike_images      ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.plate_images     ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.part_images      ADD COLUMN IF NOT EXISTS cropped_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_car_images_cropped_at_null  ON public.car_images   (cropped_at) WHERE cropped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bike_images_cropped_at_null ON public.bike_images  (cropped_at) WHERE cropped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_plate_images_cropped_at_null ON public.plate_images(cropped_at) WHERE cropped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_part_images_cropped_at_null  ON public.part_images (cropped_at) WHERE cropped_at IS NULL;

DO $$ BEGIN
    RAISE NOTICE '✅ cropped_at column added to car_images, bike_images, plate_images, part_images';
END $$;
