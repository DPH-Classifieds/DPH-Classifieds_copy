-- Migration to add VIN number field and fix image URL columns
-- Part 1: Add VIN number to cars table
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cars') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'cars' AND column_name = 'vin_number') THEN
            ALTER TABLE public.cars ADD COLUMN vin_number VARCHAR(255);
            RAISE NOTICE 'Added vin_number column to cars table';
        ELSE
            RAISE NOTICE 'vin_number column already exists in cars table';
        END IF;
    ELSE
        RAISE NOTICE 'cars table does not exist';
    END IF;
END
$$;

-- Part 2: Add VIN number to bikes table
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bikes') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'bikes' AND column_name = 'vin_number') THEN
            ALTER TABLE public.bikes ADD COLUMN vin_number VARCHAR(255);
            RAISE NOTICE 'Added vin_number column to bikes table';
        ELSE
            RAISE NOTICE 'vin_number column already exists in bikes table';
        END IF;
    ELSE
        RAISE NOTICE 'bikes table does not exist';
    END IF;
END
$$;

-- Part 3: Add url column to car_images table
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'car_images') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'car_images' AND column_name = 'url') THEN
            ALTER TABLE public.car_images ADD COLUMN url TEXT;
            UPDATE public.car_images SET url = image_url WHERE url IS NULL;
            RAISE NOTICE 'Added url column to car_images table';
        ELSE
            RAISE NOTICE 'url column already exists in car_images table';
        END IF;
    ELSE
        RAISE NOTICE 'car_images table does not exist';
    END IF;
END
$$;

-- Part 4: Add url column to bike_images table
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bike_images') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'bike_images' AND column_name = 'url') THEN
            ALTER TABLE public.bike_images ADD COLUMN url TEXT;
            UPDATE public.bike_images SET url = image_url WHERE url IS NULL;
            RAISE NOTICE 'Added url column to bike_images table';
        ELSE
            RAISE NOTICE 'url column already exists in bike_images table';
        END IF;
    ELSE
        RAISE NOTICE 'bike_images table does not exist';
    END IF;
END
$$;

-- Part 5: Create trigger for car_images table
DO $$
BEGIN
    -- Drop existing trigger and function if they exist
    DROP TRIGGER IF EXISTS sync_car_image_urls_trigger ON public.car_images;
    DROP FUNCTION IF EXISTS sync_car_image_urls();
    
    -- Create function
    CREATE OR REPLACE FUNCTION sync_car_image_urls() RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
            NEW.url := NEW.image_url;
        ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
            NEW.image_url := NEW.url;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Create trigger
    CREATE TRIGGER sync_car_image_urls_trigger
    BEFORE INSERT OR UPDATE ON public.car_images
    FOR EACH ROW EXECUTE FUNCTION sync_car_image_urls();
END
$$;

-- Part 6: Create trigger for bike_images table
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bike_images') THEN
        -- Drop existing trigger and function if they exist
        DROP TRIGGER IF EXISTS sync_bike_image_urls_trigger ON public.bike_images;
        DROP FUNCTION IF EXISTS sync_bike_image_urls();
        
        -- Create function
        CREATE OR REPLACE FUNCTION sync_bike_image_urls() RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
                NEW.url := NEW.image_url;
            ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
                NEW.image_url := NEW.url;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Create trigger
        CREATE TRIGGER sync_bike_image_urls_trigger
        BEFORE INSERT OR UPDATE ON public.bike_images
        FOR EACH ROW EXECUTE FUNCTION sync_bike_image_urls();
    END IF;
END
$$; 