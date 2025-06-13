-- Add vin_number column to the cars table

DO $$
BEGIN
    -- Check if the cars table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cars') THEN
        -- Check if the vin_number column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'cars' AND column_name = 'vin_number') THEN
            -- Add the vin_number column
            ALTER TABLE public.cars ADD COLUMN vin_number VARCHAR(255);
            
            RAISE NOTICE 'Added vin_number column to cars table';
        ELSE
            RAISE NOTICE 'vin_number column already exists in cars table';
        END IF;
    ELSE
        RAISE NOTICE 'cars table does not exist';
    END IF;

    -- Check if the bikes table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bikes') THEN
        -- Check if the vin_number column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'bikes' AND column_name = 'vin_number') THEN
            -- Add the vin_number column
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