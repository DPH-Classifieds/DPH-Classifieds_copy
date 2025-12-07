-- ============================================================================
-- SUPABASE SECURITY FIXES V2 - CRITICAL PRIORITY
-- ============================================================================
-- This migration addresses all critical security issues identified by Supabase
-- CORRECTED VERSION - Compatible with your existing schema
-- ============================================================================

-- ============================================================================
-- PART 1: CHECK WHICH TABLES EXIST AND THEIR COLUMNS
-- ============================================================================

-- First, let's check if these tables exist and what columns they have
DO $$
BEGIN
    RAISE NOTICE 'Checking table structures...';
END $$;

-- ============================================================================
-- PART 2: ENABLE RLS ON TABLES WITHOUT IT (IF THEY EXIST)
-- ============================================================================

-- Enable RLS on documents table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'documents') THEN
        ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✓ Enabled RLS on documents table';
    ELSE
        RAISE NOTICE '⊘ documents table does not exist, skipping';
    END IF;
END $$;

-- Enable RLS on advertisements table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'advertisements') THEN
        ALTER TABLE public.advertisements ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✓ Enabled RLS on advertisements table';
    ELSE
        RAISE NOTICE '⊘ advertisements table does not exist, skipping';
    END IF;
END $$;

-- Enable RLS on clients table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clients') THEN
        ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✓ Enabled RLS on clients table';
    ELSE
        RAISE NOTICE '⊘ clients table does not exist, skipping';
    END IF;
END $$;

-- Enable RLS on privacy_policies table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'privacy_policies') THEN
        ALTER TABLE public.privacy_policies ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✓ Enabled RLS on privacy_policies table';
    ELSE
        RAISE NOTICE '⊘ privacy_policies table does not exist, skipping';
    END IF;
END $$;

-- Enable RLS on requests table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'requests') THEN
        ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✓ Enabled RLS on requests table';
    ELSE
        RAISE NOTICE '⊘ requests table does not exist, skipping';
    END IF;
END $$;

-- Enable RLS on license_plates table (it has policies but RLS might be disabled)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'license_plates') THEN
        ALTER TABLE public.license_plates ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✓ Enabled RLS on license_plates table';
    ELSE
        RAISE NOTICE '⊘ license_plates table does not exist, skipping';
    END IF;
END $$;

-- ============================================================================
-- PART 3: ADD RLS POLICIES FOR TABLES THAT NEED THEM
-- ============================================================================

-- Documents table policies (if table exists and has user_id column)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'documents' 
        AND column_name = 'user_id'
    ) THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS "Users can view their own documents" ON public.documents;
        DROP POLICY IF EXISTS "Admins can view all documents" ON public.documents;
        DROP POLICY IF EXISTS "Users can insert their own documents" ON public.documents;
        DROP POLICY IF EXISTS "Admins can manage all documents" ON public.documents;
        
        -- Create new policies
        CREATE POLICY "Users can view their own documents"
          ON public.documents FOR SELECT
          TO authenticated
          USING (user_id = auth.uid());

        CREATE POLICY "Admins can view all documents"
          ON public.documents FOR SELECT
          TO authenticated
          USING (public.is_admin(auth.uid()));

        CREATE POLICY "Users can insert their own documents"
          ON public.documents FOR INSERT
          TO authenticated
          WITH CHECK (user_id = auth.uid());

        CREATE POLICY "Admins can manage all documents"
          ON public.documents FOR ALL
          TO authenticated
          USING (public.is_admin(auth.uid()));
          
        RAISE NOTICE '✓ Created policies for documents table';
    ELSE
        RAISE NOTICE '⊘ documents table does not have user_id column, skipping policies';
    END IF;
END $$;

-- Advertisements table policies (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'advertisements') THEN
        DROP POLICY IF EXISTS "Anyone can view active advertisements" ON public.advertisements;
        DROP POLICY IF EXISTS "Admins can manage advertisements" ON public.advertisements;
        
        CREATE POLICY "Anyone can view active advertisements"
          ON public.advertisements FOR SELECT
          USING (
            CASE 
              WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'advertisements' AND column_name = 'status')
              THEN status = 'active'
              ELSE true
            END
          );

        CREATE POLICY "Admins can manage advertisements"
          ON public.advertisements FOR ALL
          TO authenticated
          USING (public.is_admin(auth.uid()));
          
        RAISE NOTICE '✓ Created policies for advertisements table';
    END IF;
END $$;

-- Clients table policies (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clients') THEN
        DROP POLICY IF EXISTS "Admins can view all clients" ON public.clients;
        DROP POLICY IF EXISTS "Admins can manage clients" ON public.clients;
        
        CREATE POLICY "Admins can view all clients"
          ON public.clients FOR SELECT
          TO authenticated
          USING (public.is_admin(auth.uid()));

        CREATE POLICY "Admins can manage clients"
          ON public.clients FOR ALL
          TO authenticated
          USING (public.is_admin(auth.uid()));
          
        RAISE NOTICE '✓ Created policies for clients table';
    END IF;
END $$;

-- Privacy policies table policies (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'privacy_policies') THEN
        DROP POLICY IF EXISTS "Anyone can view privacy policies" ON public.privacy_policies;
        DROP POLICY IF EXISTS "Admins can manage privacy policies" ON public.privacy_policies;
        
        CREATE POLICY "Anyone can view privacy policies"
          ON public.privacy_policies FOR SELECT
          USING (true);

        CREATE POLICY "Admins can manage privacy policies"
          ON public.privacy_policies FOR ALL
          TO authenticated
          USING (public.is_admin(auth.uid()));
          
        RAISE NOTICE '✓ Created policies for privacy_policies table';
    END IF;
END $$;

-- Requests table policies (if table exists and has user_id column)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'requests' 
        AND column_name = 'user_id'
    ) THEN
        DROP POLICY IF EXISTS "Users can view their own requests" ON public.requests;
        DROP POLICY IF EXISTS "Admins can view all requests" ON public.requests;
        DROP POLICY IF EXISTS "Users can create requests" ON public.requests;
        DROP POLICY IF EXISTS "Admins can manage all requests" ON public.requests;
        
        CREATE POLICY "Users can view their own requests"
          ON public.requests FOR SELECT
          TO authenticated
          USING (user_id = auth.uid());

        CREATE POLICY "Admins can view all requests"
          ON public.requests FOR SELECT
          TO authenticated
          USING (public.is_admin(auth.uid()));

        CREATE POLICY "Users can create requests"
          ON public.requests FOR INSERT
          TO authenticated
          WITH CHECK (user_id = auth.uid());

        CREATE POLICY "Admins can manage all requests"
          ON public.requests FOR ALL
          TO authenticated
          USING (public.is_admin(auth.uid()));
          
        RAISE NOTICE '✓ Created policies for requests table';
    ELSE
        RAISE NOTICE '⊘ requests table does not have user_id column, skipping policies';
    END IF;
END $$;

-- ============================================================================
-- PART 4: ADD POLICIES FOR TABLES WITH RLS BUT NO POLICIES
-- ============================================================================

-- Bike images policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bike_images') THEN
        DROP POLICY IF EXISTS "Anyone can view bike images" ON public.bike_images;
        DROP POLICY IF EXISTS "Users can insert images for their bikes" ON public.bike_images;
        DROP POLICY IF EXISTS "Users can delete images for their bikes" ON public.bike_images;
        DROP POLICY IF EXISTS "Admins can manage all bike images" ON public.bike_images;
        
        CREATE POLICY "Anyone can view bike images"
          ON public.bike_images FOR SELECT
          USING (true);

        CREATE POLICY "Users can insert images for their bikes"
          ON public.bike_images FOR INSERT
          TO authenticated
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM public.bikes
              WHERE bikes.id = bike_images.bike_id
              AND bikes.user_id = auth.uid()
            )
          );

        CREATE POLICY "Users can delete images for their bikes"
          ON public.bike_images FOR DELETE
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM public.bikes
              WHERE bikes.id = bike_images.bike_id
              AND bikes.user_id = auth.uid()
            )
          );

        CREATE POLICY "Admins can manage all bike images"
          ON public.bike_images FOR ALL
          TO authenticated
          USING (public.is_admin(auth.uid()));
          
        RAISE NOTICE '✓ Created policies for bike_images table';
    END IF;
END $$;

-- Part images policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'part_images') THEN
        DROP POLICY IF EXISTS "Anyone can view part images" ON public.part_images;
        DROP POLICY IF EXISTS "Users can insert images for their parts" ON public.part_images;
        DROP POLICY IF EXISTS "Users can delete images for their parts" ON public.part_images;
        DROP POLICY IF EXISTS "Admins can manage all part images" ON public.part_images;
        
        CREATE POLICY "Anyone can view part images"
          ON public.part_images FOR SELECT
          USING (true);

        CREATE POLICY "Users can insert images for their parts"
          ON public.part_images FOR INSERT
          TO authenticated
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM public.car_parts
              WHERE car_parts.id = part_images.part_id
              AND car_parts.user_id = auth.uid()
            )
          );

        CREATE POLICY "Users can delete images for their parts"
          ON public.part_images FOR DELETE
          TO authenticated
          USING (
            EXISTS (
              SELECT 1 FROM public.car_parts
              WHERE car_parts.id = part_images.part_id
              AND car_parts.user_id = auth.uid()
            )
          );

        CREATE POLICY "Admins can manage all part images"
          ON public.part_images FOR ALL
          TO authenticated
          USING (public.is_admin(auth.uid()));
          
        RAISE NOTICE '✓ Created policies for part_images table';
    END IF;
END $$;

-- ============================================================================
-- PART 5: FIX SECURITY DEFINER VIEW (if it exists)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'dealer_users') THEN
        -- Recreate dealer_users view without SECURITY DEFINER
        DROP VIEW IF EXISTS public.dealer_users CASCADE;

        CREATE VIEW public.dealer_users AS
        SELECT 
          id,
          email,
          first_name,
          last_name,
          phone,
          city,
          emirate,
          is_dealer,
          dealer_verified,
          created_at
        FROM public.users
        WHERE is_dealer = true;
        
        RAISE NOTICE '✓ Recreated dealer_users view without SECURITY DEFINER';
    END IF;
END $$;

-- ============================================================================
-- PART 6: FIX FUNCTION SEARCH PATHS
-- ============================================================================

-- Fix is_admin function (already exists, just add search_path)
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = user_id AND is_admin = true
    );
END;
$$;

-- Fix handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.users (
        id, 
        email, 
        is_admin, 
        username, 
        phone, 
        display_name,
        first_name,
        last_name,
        is_dealer,
        company_name,
        company_registration_number,
        city,
        emirate,
        country_code,
        email_notifications,
        sms_notifications,
        marketing_emails
    )
    VALUES (
        new.id, 
        COALESCE(new.email, new.raw_user_meta_data->>'email'),
        COALESCE((new.raw_user_meta_data->>'is_admin')::boolean, false),
        new.raw_user_meta_data->>'username',
        new.raw_user_meta_data->>'phone',
        new.raw_user_meta_data->>'display_name',
        new.raw_user_meta_data->>'first_name',
        new.raw_user_meta_data->>'last_name',
        COALESCE((new.raw_user_meta_data->>'is_dealer')::boolean, false),
        new.raw_user_meta_data->>'company_name',
        new.raw_user_meta_data->>'company_registration_number',
        new.raw_user_meta_data->>'city',
        new.raw_user_meta_data->>'emirate',
        COALESCE(new.raw_user_meta_data->>'country_code', '+971'),
        COALESCE((new.raw_user_meta_data->>'email_notifications')::boolean, true),
        COALESCE((new.raw_user_meta_data->>'sms_notifications')::boolean, true),
        COALESCE((new.raw_user_meta_data->>'marketing_emails')::boolean, false)
    );
    RETURN new;
END;
$$;

-- Fix calculate_profile_completion function
CREATE OR REPLACE FUNCTION public.calculate_profile_completion(user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    completion INTEGER := 0;
    user_record RECORD;
BEGIN
    SELECT * INTO user_record FROM public.users WHERE id = user_id;
    
    IF user_record IS NULL THEN
        RETURN 0;
    END IF;
    
    IF user_record.email IS NOT NULL AND user_record.email != '' THEN
        completion := completion + 10;
    END IF;
    
    IF user_record.phone IS NOT NULL AND user_record.phone != '' THEN
        completion := completion + 10;
    END IF;
    
    IF user_record.first_name IS NOT NULL AND user_record.first_name != '' THEN
        completion := completion + 10;
    END IF;
    
    IF user_record.last_name IS NOT NULL AND user_record.last_name != '' THEN
        completion := completion + 10;
    END IF;
    
    IF user_record.city IS NOT NULL AND user_record.city != '' THEN
        completion := completion + 10;
    END IF;
    
    IF user_record.profile_photo_url IS NOT NULL AND user_record.profile_photo_url != '' THEN
        completion := completion + 10;
    END IF;
    
    IF user_record.bio IS NOT NULL AND user_record.bio != '' THEN
        completion := completion + 5;
    END IF;
    
    IF user_record.emirate IS NOT NULL AND user_record.emirate != '' THEN
        completion := completion + 5;
    END IF;
    
    IF user_record.address IS NOT NULL AND user_record.address != '' THEN
        completion := completion + 5;
    END IF;
    
    IF user_record.phone_verified THEN
        completion := completion + 10;
    END IF;
    
    IF user_record.email_verified THEN
        completion := completion + 5;
    END IF;
    
    IF user_record.is_dealer AND user_record.company_name IS NOT NULL AND user_record.company_name != '' THEN
        completion := completion + 10;
    END IF;
    
    RETURN LEAST(completion, 100);
END;
$$;

-- Fix update_profile_completion function
CREATE OR REPLACE FUNCTION public.update_profile_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.profile_completion_percentage := calculate_profile_completion(NEW.id);
    RETURN NEW;
END;
$$;

-- Fix update_reports_updated_at function
CREATE OR REPLACE FUNCTION public.update_reports_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$;

-- Fix increment_view_count function (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_view_count') THEN
        EXECUTE '
        CREATE OR REPLACE FUNCTION public.increment_view_count(
          listing_type TEXT,
          listing_id UUID
        )
        RETURNS VOID
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $func$
        BEGIN
          IF listing_type = ''car'' THEN
            UPDATE public.cars SET view_count = view_count + 1 WHERE id = listing_id;
          ELSIF listing_type = ''bike'' THEN
            UPDATE public.bikes SET view_count = view_count + 1 WHERE id = listing_id;
          ELSIF listing_type = ''part'' THEN
            UPDATE public.car_parts SET view_count = view_count + 1 WHERE id = listing_id;
          ELSIF listing_type = ''plate'' THEN
            UPDATE public.license_plates SET view_count = view_count + 1 WHERE id = listing_id;
          END IF;
        END;
        $func$;
        ';
        RAISE NOTICE '✓ Fixed increment_view_count function';
    END IF;
END $$;

-- Fix sync functions (if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_car_image_urls') THEN
        EXECUTE '
        CREATE OR REPLACE FUNCTION public.sync_car_image_urls()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $func$
        BEGIN
          UPDATE public.cars
          SET image_url = (
            SELECT array_agg(image_url ORDER BY created_at)
            FROM public.car_images
            WHERE car_id = NEW.car_id
          )
          WHERE id = NEW.car_id;
          
          RETURN NEW;
        END;
        $func$;
        ';
        RAISE NOTICE '✓ Fixed sync_car_image_urls function';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_bike_image_urls') THEN
        EXECUTE '
        CREATE OR REPLACE FUNCTION public.sync_bike_image_urls()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $func$
        BEGIN
          UPDATE public.bikes
          SET image_url = (
            SELECT array_agg(image_url ORDER BY created_at)
            FROM public.bike_images
            WHERE bike_id = NEW.bike_id
          )
          WHERE id = NEW.bike_id;
          
          RETURN NEW;
        END;
        $func$;
        ';
        RAISE NOTICE '✓ Fixed sync_bike_image_urls function';
    END IF;
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ SECURITY FIXES MIGRATION V2 COMPLETE!';
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ Enabled RLS on all applicable tables';
    RAISE NOTICE '✅ Added RLS policies for data protection';
    RAISE NOTICE '✅ Fixed function search paths';
    RAISE NOTICE '✅ Fixed security definer view';
    RAISE NOTICE '✅ ============================================================';
END $$;
