-- ============================================================================
-- SUPABASE PERFORMANCE FIXES - FINAL VERSION
-- ============================================================================
-- This optimizes RLS policies and indexes for better performance
-- Run this AFTER fix_security_issues_FINAL.sql
-- ============================================================================

-- ============================================================================
-- PART 1: OPTIMIZE USERS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Admins can update user admin status" ON public.users;
DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Service role has full access" ON public.users;

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

-- ============================================================================
-- PART 2: OPTIMIZE CAR_IMAGES TABLE POLICIES
-- ============================================================================

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

-- ============================================================================
-- PART 3: OPTIMIZE BIKES TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can delete their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can insert their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can update their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can view approved bikes" ON public.bikes;
DROP POLICY IF EXISTS "Users can manage their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Anyone can view approved bikes" ON public.bikes;
DROP POLICY IF EXISTS "Admins can manage all bikes" ON public.bikes;
DROP POLICY IF EXISTS "Anyone can view approved bikes or own bikes" ON public.bikes;

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

-- ============================================================================
-- PART 4: OPTIMIZE CAR_PARTS TABLE POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can delete their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can insert their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can update their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can view approved car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Users can manage their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Anyone can view approved car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Admins can manage all car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Anyone can view approved car parts or own parts" ON public.car_parts;

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

-- ============================================================================
-- PART 5: OPTIMIZE CARS TABLE POLICIES
-- ============================================================================

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

-- ============================================================================
-- PART 6: OPTIMIZE REPORTS TABLE POLICIES
-- ============================================================================

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

-- ============================================================================
-- PART 7: OPTIMIZE LICENSE_PLATES POLICIES
-- ============================================================================

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
DROP POLICY IF EXISTS "Users can manage their own plates" ON public.license_plates;
DROP POLICY IF EXISTS "Anyone can view approved plates or own plates" ON public.license_plates;
DROP POLICY IF EXISTS "Admins can manage all plates" ON public.license_plates;

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

-- ============================================================================
-- PART 8: ADD MISSING FOREIGN KEY INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bike_images_bike_id ON public.bike_images(bike_id);
CREATE INDEX IF NOT EXISTS idx_bikes_user_id ON public.bikes(user_id);
CREATE INDEX IF NOT EXISTS idx_car_parts_user_id ON public.car_parts(user_id);
CREATE INDEX IF NOT EXISTS idx_license_plates_user_id ON public.license_plates(user_id);
CREATE INDEX IF NOT EXISTS idx_part_images_part_id ON public.part_images(part_id);
CREATE INDEX IF NOT EXISTS idx_reports_reviewed_by ON public.reports(reviewed_by);

-- ============================================================================
-- PART 9: REMOVE UNUSED INDEXES
-- ============================================================================

DROP INDEX IF EXISTS public.idx_reports_listing;
DROP INDEX IF EXISTS public.idx_reports_status;
DROP INDEX IF EXISTS public.idx_reports_reporter;
DROP INDEX IF EXISTS public.idx_cars_view_count;
DROP INDEX IF EXISTS public.idx_bikes_view_count;
DROP INDEX IF EXISTS public.idx_license_plates_view_count;
DROP INDEX IF EXISTS public.idx_car_parts_view_count;
DROP INDEX IF EXISTS public.idx_cars_city;
DROP INDEX IF EXISTS public.idx_cars_make_year;
DROP INDEX IF EXISTS public.idx_cars_manufacturer;
DROP INDEX IF EXISTS public.idx_cars_model;
DROP INDEX IF EXISTS public.idx_cars_price;
DROP INDEX IF EXISTS public.idx_users_is_dealer;
DROP INDEX IF EXISTS public.idx_users_dealer_verified;
DROP INDEX IF EXISTS public.idx_users_city;
DROP INDEX IF EXISTS public.idx_users_emirate;
DROP INDEX IF EXISTS public.idx_users_account_status;
DROP INDEX IF EXISTS public.idx_users_first_last_name;
DROP INDEX IF EXISTS public.idx_users_username;
DROP INDEX IF EXISTS public.idx_users_email;

-- ============================================================================
-- PART 10: ADD COMPOSITE INDEXES FOR COMMON QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cars_status_created ON public.cars(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_user_status ON public.cars(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bikes_status_created ON public.bikes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_user_status ON public.bikes(user_id, status);
CREATE INDEX IF NOT EXISTS idx_car_parts_status_created ON public.car_parts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_car_parts_user_status ON public.car_parts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_license_plates_status_created ON public.license_plates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_plates_user_status ON public.license_plates(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON public.reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON public.reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_users_is_admin_active ON public.users(is_admin) WHERE is_admin = true;
