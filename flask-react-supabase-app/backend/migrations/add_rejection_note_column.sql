-- Add rejection_note column to all listing tables for storing rejection reasons

-- Add rejection_note column to the cars table
DO $$
BEGIN
    -- Check if the cars table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cars') THEN
        -- Check if the rejection_note column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'cars' AND column_name = 'rejection_note') THEN
            -- Add the rejection_note column
            ALTER TABLE public.cars ADD COLUMN rejection_note TEXT;
            
            RAISE NOTICE 'Added rejection_note column to cars table';
        ELSE
            RAISE NOTICE 'rejection_note column already exists in cars table';
        END IF;
    END IF;

    -- Check if the bikes table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bikes') THEN
        -- Check if the rejection_note column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'bikes' AND column_name = 'rejection_note') THEN
            -- Add the rejection_note column
            ALTER TABLE public.bikes ADD COLUMN rejection_note TEXT;
            
            RAISE NOTICE 'Added rejection_note column to bikes table';
        ELSE
            RAISE NOTICE 'rejection_note column already exists in bikes table';
        END IF;
    END IF;

    -- Check if the car_parts table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'car_parts') THEN
        -- Check if the rejection_note column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'car_parts' AND column_name = 'rejection_note') THEN
            -- Add the rejection_note column
            ALTER TABLE public.car_parts ADD COLUMN rejection_note TEXT;
            
            RAISE NOTICE 'Added rejection_note column to car_parts table';
        ELSE
            RAISE NOTICE 'rejection_note column already exists in car_parts table';
        END IF;
    END IF;

    -- Check if the license_plates table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'license_plates') THEN
        -- Check if the rejection_note column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'license_plates' AND column_name = 'rejection_note') THEN
            -- Add the rejection_note column
            ALTER TABLE public.license_plates ADD COLUMN rejection_note TEXT;
            
            RAISE NOTICE 'Added rejection_note column to license_plates table';
        ELSE
            RAISE NOTICE 'rejection_note column already exists in license_plates table';
        END IF;
    END IF;
END
$$;
