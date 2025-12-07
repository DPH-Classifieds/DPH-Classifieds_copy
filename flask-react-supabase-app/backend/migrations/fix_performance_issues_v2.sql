-- ============================================================================
-- SUPABASE PERFORMANCE FIXES V2
-- ============================================================================
-- This migration addresses performance issues identified by Supabase
-- CORRECTED VERSION - Compatible with your existing schema
-- Run this AFTER fix_security_issues_v2.sql
-- ============================================================================

-- ============================================================================
-- PART 1: FIX AUTH RLS INITPLAN ISSUES
-- ============================================================================
-- Replace auth.uid() with (SELECT auth.uid()) to prevent re-evaluation per row

-- Drop and recreate users table policies with optimized auth calls
DROP POLICY IF EXISTS "Admins can update user admin status" ON public.users;
DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Service role has full access" ON public.users;

-- Create consolidated, optimized policies for users table
CREATE POLICY "Users can view and update their own data"
  ON public.users FOR ALL
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "Admins can view and manage all users"
  ON public.users FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

CREATE POLICY "Service role has full access"
  ON public.users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

RAISE NOTICE '✓ Optimized users table policies';

-- Drop and recreate car_images policies
DROP POLICY IF EXISTS "Users can delete images for their cars" ON public.car_images;
DROP POLICY IF EXISTS "Users can insert images for their cars" ON public.car_images;
DROP POLICY IF EXISTS "Users can update images for their cars" ON public.car_images;
DROP POLICY IF EXISTS "Users can manage images for their cars" ON public.car_images;
DROP POLICY IF EXISTS "Admins can manage all car images" ON public.car_images;
DROP POLICY IF EXISTS "Anyone can view car images" ON public.car_images;

CREATE POLICY "Anyone can view car images"
  ON public.car_images FOR SELECT
  USING (true);

CREATE POLICY "Users can manage images for their cars"
  ON public.car_images FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = car_images.car_id
      AND cars.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = car_images.car_id
      AND cars.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can manage all car images"
  ON public.car_images FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

RAISE NOTICE '✓ Optimized car_images table policies';

-- Drop and recreate bikes policies
DROP POLICY IF EXISTS "Users can delete their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can insert their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can update their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can view approved bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can manage their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Anyone can view approved bikes" ON public.bikes;
DROP POLICY IF EXISTS "Admins can manage all bikes" ON public.bikes;

CREATE POLICY "Users can manage their own bikes"
  ON public.bikes FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Anyone can view approved bikes or own bikes"
  ON public.bikes FOR SELECT
  USING (status = 'approved' OR user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all bikes"
  ON public.bikes FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

RAISE NOTICE '✓ Optimized bikes table policies';

-- Drop and recreate car_parts policies
DROP POLICY IF EXISTS "Users can delete their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can insert their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can update their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can view approved car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can manage their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Anyone can view approved car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Admins can manage all car parts" ON public.car_parts;

CREATE POLICY "Users can manage their own car parts"
  ON public.car_parts FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Anyone can view approved car parts or own parts"
  ON public.car_parts FOR SELECT
  USING (status = 'approved' OR user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all car parts"
  ON public.car_parts FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

RAISE NOTICE '✓ Optimized car_parts table policies';

-- Drop and recreate cars policies
DROP POLICY IF EXISTS "Users can delete their own cars" ON public.cars;
DROP POLICY IF EXISTS "Users can insert their own cars" ON public.cars;
DROP POLICY IF EXISTS "Users can update their own cars" ON public.cars;
DROP POLICY IF EXISTS "Users can view approved cars" ON public.cars;
DROP POLICY IF EXISTS "Users can view their own unapproved cars" ON public.cars;
DROP POLICY IF EXISTS "Users can manage their own cars" ON public.cars;
DROP POLICY IF EXISTS "Anyone can view approved cars or own cars" ON public.cars;
DROP POLICY IF EXISTS "Admins can manage all cars" ON public.cars;

CREATE POLICY "Users can manage their own cars"
  ON public.cars FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Anyone can view approved cars or own cars"
  ON public.cars FOR SELECT
  USING (status = 'approved' OR user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all cars"
  ON public.cars FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

RAISE NOTICE '✓ Optimized cars table policies';

-- Drop and recreate reports policies
DROP POLICY IF EXISTS "Users can view their own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can create reports" ON public.reports;
DROP POLICY IF EXISTS "Admins can view all reports" ON public.reports;
DROP POLICY IF EXISTS "Admins can update reports" ON public.reports;
DROP POLICY IF EXISTS "Users can view and create their own reports" ON public.reports;
DROP POLICY IF EXISTS "Admins can manage all reports" ON public.reports;

CREATE POLICY "Users can view and create their own reports"
  ON public.reports FOR ALL
  TO authenticated
  USING (reporter_id = (SELECT auth.uid()))
  WITH CHECK (reporter_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all reports"
  ON public.reports FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

RAISE NOTICE '✓ Optimized reports table policies';

-- Optimize license_plates policies (if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'license_plates') THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS "Admins can create plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Admins can update all plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Admins can view all plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Anyone can insert license_plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.license_plates;
        DROP POLICY IF EXISTS "Users can create plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Users can delete their own plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Users can update their own plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Users can view approved plates" ON public.license_plates;
        DROP POLICY IF EXISTS "Users can view their own plates" ON public.license_plates;
        
        -- Create consolidated policies
        CREATE POLICY "Users can manage their own plates"
          ON public.license_plates FOR ALL
          TO authenticated
          USING (user_id = (SELECT auth.uid()))
          WITH CHECK (user_id = (SELECT auth.uid()));

        CREATE POLICY "Anyone can view approved plates or own plates"
          ON public.license_plates FOR SELECT
          USING (status = 'approved' OR user_id = (SELECT auth.uid()));

        CREATE POLICY "Admins can manage all plates"
          ON public.license_plates FOR ALL
          TO authenticated
          USING (public.is_admin((SELECT auth.uid())));
          
        RAISE NOTICE '✓ Optimized license_plates table policies';
    END IF;
END $$;

-- ============================================================================
-- PART 2: ADD MISSING INDEXES FOR FOREIGN KEYS
-- ============================================================================

-- Index for bike_images.bike_id
CREATE INDEX IF NOT EXISTS idx_bike_images_bike_id ON public.bike_images(bike_id);

-- Index for bikes.user_id
CREATE INDEX IF NOT EXISTS idx_bikes_user_id ON public.bikes(user_id);

-- Index for car_parts.user_id
CREATE INDEX IF NOT EXISTS idx_car_parts_user_id ON public.car_parts(user_id);

-- Index for documents.request_id (if columns exist)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'documents' 
        AND column_name = 'request_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_documents_request_id ON public.documents(request_id);
        RAISE NOTICE '✓ Created index on documents.request_id';
    END IF;
END $$;

-- Index for license_plates.user_id
CREATE INDEX IF NOT EXISTS idx_license_plates_user_id ON public.license_plates(user_id);

-- Index for part_images.part_id
CREATE INDEX IF NOT EXISTS idx_part_images_part_id ON public.part_images(part_id);

-- Index for reports.reviewed_by
CREATE INDEX IF NOT EXISTS idx_reports_reviewed_by ON public.reports(reviewed_by);

RAISE NOTICE '✓ Created missing foreign key indexes';

-- ============================================================================
-- PART 3: REMOVE UNUSED INDEXES
-- ============================================================================

-- Reports table unused indexes
DROP INDEX IF EXISTS public.idx_reports_listing;
DROP INDEX IF EXISTS public.idx_reports_status;
DROP INDEX IF EXISTS public.idx_reports_reporter;

-- View count indexes (unused)
DROP INDEX IF EXISTS public.idx_cars_view_count;
DROP INDEX IF EXISTS public.idx_bikes_view_count;
DROP INDEX IF EXISTS public.idx_license_plates_view_count;
DROP INDEX IF EXISTS public.idx_car_parts_view_count;

-- Cars table unused indexes
DROP INDEX IF EXISTS public.idx_cars_city;
DROP INDEX IF EXISTS public.idx_cars_make_year;
DROP INDEX IF EXISTS public.idx_cars_manufacturer;
DROP INDEX IF EXISTS public.idx_cars_model;
DROP INDEX IF EXISTS public.idx_cars_price;

-- Users table unused indexes
DROP INDEX IF EXISTS public.idx_users_is_dealer;
DROP INDEX IF EXISTS public.idx_users_dealer_verified;
DROP INDEX IF EXISTS public.idx_users_city;
DROP INDEX IF EXISTS public.idx_users_emirate;
DROP INDEX IF EXISTS public.idx_users_account_status;
DROP INDEX IF EXISTS public.idx_users_first_last_name;
DROP INDEX IF EXISTS public.idx_users_username;
DROP INDEX IF EXISTS public.idx_users_email;

RAISE NOTICE '✓ Removed unused indexes';

-- ============================================================================
-- PART 4: ADD COMPOSITE INDEXES FOR COMMON QUERIES
-- ============================================================================

-- Cars: status + created_at for listing queries
CREATE INDEX IF NOT EXISTS idx_cars_status_created ON public.cars(status, created_at DESC);

-- Cars: user_id + status for user's listings
CREATE INDEX IF NOT EXISTS idx_cars_user_status ON public.cars(user_id, status);

-- Bikes: status + created_at for listing queries
CREATE INDEX IF NOT EXISTS idx_bikes_status_created ON public.bikes(status, created_at DESC);

-- Bikes: user_id + status for user's listings
CREATE INDEX IF NOT EXISTS idx_bikes_user_status ON public.bikes(user_id, status);

-- Car parts: status + created_at for listing queries
CREATE INDEX IF NOT EXISTS idx_car_parts_status_created ON public.car_parts(status, created_at DESC);

-- Car parts: user_id + status for user's listings
CREATE INDEX IF NOT EXISTS idx_car_parts_user_status ON public.car_parts(user_id, status);

-- License plates: status + created_at for listing queries
CREATE INDEX IF NOT EXISTS idx_license_plates_status_created ON public.license_plates(status, created_at DESC);

-- License plates: user_id + status for user's listings
CREATE INDEX IF NOT EXISTS idx_license_plates_user_status ON public.license_plates(user_id, status);

-- Reports: status + created_at for admin dashboard
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON public.reports(status, created_at DESC);

-- Reports: reporter_id for user's reports
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON public.reports(reporter_id);

-- Users: is_admin for admin checks (partial index - only true values)
CREATE INDEX IF NOT EXISTS idx_users_is_admin_active ON public.users(is_admin) WHERE is_admin = true;

RAISE NOTICE '✓ Created composite indexes for common queries';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ PERFORMANCE FIXES MIGRATION V2 COMPLETE!';
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ Optimized RLS policies (auth.uid() → SELECT auth.uid())';
    RAISE NOTICE '✅ Consolidated duplicate policies';
    RAISE NOTICE '✅ Added missing foreign key indexes';
    RAISE NOTICE '✅ Removed unused indexes';
    RAISE NOTICE '✅ Added composite indexes for common queries';
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ Your database performance should be significantly improved!';
    RAISE NOTICE '✅ ============================================================';
END $$;
