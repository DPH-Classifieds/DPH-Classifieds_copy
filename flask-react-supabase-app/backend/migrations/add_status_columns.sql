-- Add status columns to all listing tables for approval workflow

-- Add status column to the cars table if it exists
DO $$
BEGIN
    -- Check if the cars table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cars') THEN
        -- Check if the status column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'cars' AND column_name = 'status') THEN
            -- Add the status column with default 'pending'
            ALTER TABLE public.cars ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
            
            -- Add an index on the status column for faster queries
            CREATE INDEX idx_cars_status ON public.cars(status);
            
            RAISE NOTICE 'Added status column to cars table';
        ELSE
            RAISE NOTICE 'Status column already exists in cars table';
        END IF;
    ELSE
        -- Create the cars table if it doesn't exist
        CREATE TABLE public.cars (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID REFERENCES auth.users(id),
            user_email VARCHAR(255),
            make VARCHAR(100) NOT NULL,
            model VARCHAR(100) NOT NULL,
            year INT,
            price DECIMAL(12, 2),
            description TEXT,
            contact_email VARCHAR(255),
            contact_phone VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            status VARCHAR(20) DEFAULT 'pending'
        );
        
        -- Enable RLS
        ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
        
        -- Create RLS policies
        CREATE POLICY "Users can view approved cars" 
        ON public.cars FOR SELECT 
        USING (status = 'approved' OR auth.uid() = user_id);
        
        CREATE POLICY "Users can insert their own cars" 
        ON public.cars FOR INSERT 
        WITH CHECK (auth.uid() = user_id);
        
        CREATE POLICY "Users can update their own cars" 
        ON public.cars FOR UPDATE 
        USING (auth.uid() = user_id);
        
        CREATE POLICY "Users can delete their own cars" 
        ON public.cars FOR DELETE 
        USING (auth.uid() = user_id);
        
        RAISE NOTICE 'Created cars table with status column';
    END IF;

    -- Check if the bikes table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'bikes') THEN
        -- Check if the status column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'bikes' AND column_name = 'status') THEN
            -- Add the status column with default 'pending'
            ALTER TABLE public.bikes ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
            
            -- Add an index on the status column for faster queries
            CREATE INDEX idx_bikes_status ON public.bikes(status);
            
            RAISE NOTICE 'Added status column to bikes table';
        ELSE
            RAISE NOTICE 'Status column already exists in bikes table';
        END IF;
    ELSE
        -- Create the bikes table if it doesn't exist
        CREATE TABLE public.bikes (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID REFERENCES auth.users(id),
            user_email VARCHAR(255),
            make VARCHAR(100) NOT NULL,
            model VARCHAR(100) NOT NULL,
            year INT,
            price DECIMAL(12, 2),
            description TEXT,
            contact_email VARCHAR(255),
            contact_phone VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            status VARCHAR(20) DEFAULT 'pending'
        );
        
        -- Enable RLS
        ALTER TABLE public.bikes ENABLE ROW LEVEL SECURITY;
        
        -- Create RLS policies
        CREATE POLICY "Users can view approved bikes" 
        ON public.bikes FOR SELECT 
        USING (status = 'approved' OR auth.uid() = user_id);
        
        CREATE POLICY "Users can insert their own bikes" 
        ON public.bikes FOR INSERT 
        WITH CHECK (auth.uid() = user_id);
        
        CREATE POLICY "Users can update their own bikes" 
        ON public.bikes FOR UPDATE 
        USING (auth.uid() = user_id);
        
        CREATE POLICY "Users can delete their own bikes" 
        ON public.bikes FOR DELETE 
        USING (auth.uid() = user_id);
        
        RAISE NOTICE 'Created bikes table with status column';
    END IF;

    -- Check if the car_parts table exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'car_parts') THEN
        -- Check if the status column doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'car_parts' AND column_name = 'status') THEN
            -- Add the status column with default 'pending'
            ALTER TABLE public.car_parts ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
            
            -- Add an index on the status column for faster queries
            CREATE INDEX idx_car_parts_status ON public.car_parts(status);
            
            RAISE NOTICE 'Added status column to car_parts table';
        ELSE
            RAISE NOTICE 'Status column already exists in car_parts table';
        END IF;
    ELSE
        -- Create the car_parts table if it doesn't exist
        CREATE TABLE public.car_parts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID REFERENCES auth.users(id),
            user_email VARCHAR(255),
            name VARCHAR(255) NOT NULL,
            part_type VARCHAR(100),
            condition VARCHAR(50),
            compatibility TEXT,
            price DECIMAL(12, 2),
            description TEXT,
            contact_email VARCHAR(255),
            contact_phone VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            status VARCHAR(20) DEFAULT 'pending'
        );
        
        -- Enable RLS
        ALTER TABLE public.car_parts ENABLE ROW LEVEL SECURITY;
        
        -- Create RLS policies
        CREATE POLICY "Users can view approved car parts" 
        ON public.car_parts FOR SELECT 
        USING (status = 'approved' OR auth.uid() = user_id);
        
        CREATE POLICY "Users can insert their own car parts" 
        ON public.car_parts FOR INSERT 
        WITH CHECK (auth.uid() = user_id);
        
        CREATE POLICY "Users can update their own car parts" 
        ON public.car_parts FOR UPDATE 
        USING (auth.uid() = user_id);
        
        CREATE POLICY "Users can delete their own car parts" 
        ON public.car_parts FOR DELETE 
        USING (auth.uid() = user_id);
        
        RAISE NOTICE 'Created car_parts table with status column';
    END IF;

    -- Check if status column already exists in license_plates table
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'license_plates') THEN
        IF NOT EXISTS (SELECT FROM information_schema.columns 
                      WHERE table_schema = 'public' AND table_name = 'license_plates' AND column_name = 'status') THEN
            -- Add the status column with default 'pending'
            ALTER TABLE public.license_plates ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
            
            -- Add an index on the status column for faster queries
            CREATE INDEX idx_license_plates_status ON public.license_plates(status);
            
            RAISE NOTICE 'Added status column to license_plates table';
        ELSE
            RAISE NOTICE 'Status column already exists in license_plates table';
        END IF;
    END IF;
END
$$; 