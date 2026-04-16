-- Fix sync_car_image_urls trigger function
-- The previous version (from fix_remaining_issues.sql) tried to UPDATE public.cars SET image_url = ...
-- which fails because the cars table does NOT have an image_url column.
--
-- This restores the correct BEFORE INSERT/UPDATE trigger that syncs url ↔ image_url
-- within the car_images table only.
--
-- Run this in the Supabase SQL Editor.

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS sync_car_image_urls_trigger ON public.car_images;
DROP FUNCTION IF EXISTS public.sync_car_image_urls();

-- Restore the correct function: sync url ↔ image_url within car_images only
CREATE OR REPLACE FUNCTION public.sync_car_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
        NEW.url := NEW.image_url;
    ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
        NEW.image_url := NEW.url;
    END IF;
    RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER sync_car_image_urls_trigger
BEFORE INSERT OR UPDATE ON public.car_images
FOR EACH ROW EXECUTE FUNCTION sync_car_image_urls();

-- Also fix the bike_images trigger if it has the same issue
DROP TRIGGER IF EXISTS sync_bike_image_urls_trigger ON public.bike_images;
DROP FUNCTION IF EXISTS public.sync_bike_image_urls();

CREATE OR REPLACE FUNCTION public.sync_bike_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
        NEW.url := NEW.image_url;
    ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
        NEW.image_url := NEW.url;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER sync_bike_image_urls_trigger
BEFORE INSERT OR UPDATE ON public.bike_images
FOR EACH ROW EXECUTE FUNCTION sync_bike_image_urls();
