-- Migration to add VIN number field and fix image URL columns
-- Run this script directly in the Supabase SQL Editor

-- Part 1: Add VIN number to cars table
ALTER TABLE IF EXISTS public.cars ADD COLUMN IF NOT EXISTS vin_number VARCHAR(255);

-- Part 2: Add VIN number to bikes table
ALTER TABLE IF EXISTS public.bikes ADD COLUMN IF NOT EXISTS vin_number VARCHAR(255);

-- Part 3: Add url column to car_images table
ALTER TABLE IF EXISTS public.car_images ADD COLUMN IF NOT EXISTS url TEXT;
UPDATE public.car_images SET url = image_url WHERE url IS NULL;

-- Part 4: Add url column to bike_images table (if it exists)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bike_images') THEN
        EXECUTE 'ALTER TABLE public.bike_images ADD COLUMN IF NOT EXISTS url TEXT';
        EXECUTE 'UPDATE public.bike_images SET url = image_url WHERE url IS NULL';
    END IF;
END $$;

-- Part 5: Create trigger for car_images table
DROP TRIGGER IF EXISTS sync_car_image_urls_trigger ON public.car_images;
DROP FUNCTION IF EXISTS sync_car_image_urls();

CREATE OR REPLACE FUNCTION sync_car_image_urls() RETURNS TRIGGER AS $func$
BEGIN
    IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
        NEW.url := NEW.image_url;
    ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
        NEW.image_url := NEW.url;
    END IF;
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

CREATE TRIGGER sync_car_image_urls_trigger
BEFORE INSERT OR UPDATE ON public.car_images
FOR EACH ROW EXECUTE FUNCTION sync_car_image_urls();

-- Part 6: Check if bike_images table exists
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bike_images') THEN
        RAISE NOTICE 'bike_images table exists, will create trigger';
    ELSE
        RAISE NOTICE 'bike_images table does not exist, skipping trigger creation';
        RETURN;
    END IF;
END $$;

-- Part 7: Create trigger for bike_images table (only runs if the table exists)
DROP TRIGGER IF EXISTS sync_bike_image_urls_trigger ON public.bike_images;
DROP FUNCTION IF EXISTS sync_bike_image_urls();

CREATE OR REPLACE FUNCTION sync_bike_image_urls() RETURNS TRIGGER AS $func$
BEGIN
    IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
        NEW.url := NEW.image_url;
    ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
        NEW.image_url := NEW.url;
    END IF;
    RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

CREATE TRIGGER sync_bike_image_urls_trigger
BEFORE INSERT OR UPDATE ON public.bike_images
FOR EACH ROW EXECUTE FUNCTION sync_bike_image_urls(); 