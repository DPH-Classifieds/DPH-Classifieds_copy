-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES FOR DPH CLASSIFIEDS
-- Run this in Supabase SQL Editor
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_plates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plate_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_images ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- USERS TABLE POLICIES
-- =====================================================

-- Users can read their own profile
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile (but not admin status)
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Service role always has full access (bypasses RLS)
CREATE POLICY "Service role full access" ON public.users
  FOR ALL USING (current_setting('request.jwt.claim.role', true) = 'service_role');

-- =====================================================
-- CARS TABLE POLICIES
-- =====================================================

-- Anyone can view approved cars
CREATE POLICY "Anyone can view approved cars" ON public.cars
  FOR SELECT USING (status = 'approved');

-- Users can create cars
CREATE POLICY "Users can create cars" ON public.cars
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own cars
CREATE POLICY "Users can update own cars" ON public.cars
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own cars
CREATE POLICY "Users can delete own cars" ON public.cars
  FOR DELETE USING (auth.uid() = user_id);

-- Admins can do anything
CREATE POLICY "Admins can do anything with cars" ON public.cars
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- =====================================================
-- CAR IMAGES POLICIES
-- =====================================================

-- Anyone can view images for approved cars
CREATE POLICY "Anyone can view car images" ON public.car_images
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.cars WHERE id = car_id AND status = 'approved')
  );

-- Users can add images to their own cars
CREATE POLICY "Users can add car images" ON public.car_images
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.cars WHERE id = car_id AND user_id = auth.uid())
  );

-- Users can delete their own car images
CREATE POLICY "Users can delete car images" ON public.car_images
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.cars WHERE id = car_id AND user_id = auth.uid())
  );

-- Admins can do anything
CREATE POLICY "Admins car images" ON public.car_images
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- =====================================================
-- BIKES TABLE POLICIES
-- =====================================================

-- Anyone can view approved bikes
CREATE POLICY "Anyone can view approved bikes" ON public.bikes
  FOR SELECT USING (status = 'approved');

-- Users can create bikes
CREATE POLICY "Users can create bikes" ON public.bikes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own bikes
CREATE POLICY "Users can update own bikes" ON public.bikes
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own bikes
CREATE POLICY "Users can delete own bikes" ON public.bikes
  FOR DELETE USING (auth.uid() = user_id);

-- Admins can do anything
CREATE POLICY "Admins can do anything with bikes" ON public.bikes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- =====================================================
-- LICENSE PLATES POLICIES
-- =====================================================

-- Anyone can view approved plates
CREATE POLICY "Anyone can view approved plates" ON public.license_plates
  FOR SELECT USING (status = 'approved');

-- Users can create plates
CREATE POLICY "Users can create plates" ON public.license_plates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own plates
CREATE POLICY "Users can update own plates" ON public.license_plates
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own plates
CREATE POLICY "Users can delete own plates" ON public.license_plates
  FOR DELETE USING (auth.uid() = user_id);

-- Admins can do anything
CREATE POLICY "Admins can do anything with plates" ON public.license_plates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- =====================================================
-- CAR PARTS POLICIES
-- =====================================================

-- Anyone can view approved parts
CREATE POLICY "Anyone can view approved parts" ON public.car_parts
  FOR SELECT USING (status = 'approved');

-- Users can create parts
CREATE POLICY "Users can create parts" ON public.car_parts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own parts
CREATE POLICY "Users can update own parts" ON public.car_parts
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own parts
CREATE POLICY "Users can delete own parts" ON public.car_parts
  FOR DELETE USING (auth.uid() = user_id);

-- Admins can do anything
CREATE POLICY "Admins can do anything with parts" ON public.car_parts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- =====================================================
-- REPORTING/ADMIN TABLES - READ ACCESS FOR ADMINS
-- =====================================================

-- Admins can view reports
CREATE POLICY "Admins can view reports" ON public.reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- Admins can update reports
CREATE POLICY "Admins can update reports" ON public.reports
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- Admins can view dealers
CREATE POLICY "Admins can view dealers" ON public.dealers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- Admins can update dealers
CREATE POLICY "Admins can update dealers" ON public.dealers
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
  );

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant standard permissions
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.users TO anon;
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;
GRANT SELECT ON public.cars TO authenticated;
GRANT SELECT ON public.cars TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cars TO authenticated;
GRANT SELECT ON public.car_images TO authenticated;
GRANT SELECT ON public.car_images TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.car_images TO authenticated;
GRANT SELECT ON public.bikes TO authenticated;
GRANT SELECT ON public.bikes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bikes TO authenticated;
GRANT SELECT ON public.bike_images TO authenticated;
GRANT SELECT ON public.bike_images TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bike_images TO authenticated;
GRANT SELECT ON public.license_plates TO authenticated;
GRANT SELECT ON public.license_plates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.license_plates TO authenticated;
GRANT SELECT ON public.plate_images TO authenticated;
GRANT SELECT ON public.plate_images TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plate_images TO authenticated;
GRANT SELECT ON public.car_parts TO authenticated;
GRANT SELECT ON public.car_parts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.car_parts TO authenticated;
GRANT SELECT ON public.part_images TO authenticated;
GRANT SELECT ON public.part_images TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_images TO authenticated;
GRANT SELECT, UPDATE ON public.reports TO authenticated;
GRANT SELECT, UPDATE ON public.dealers TO authenticated;
GRANT ALL ON public.reports TO service_role;
GRANT ALL ON public.dealers TO service_role;

-- =====================================================
-- DISABLE SERVICE ROLE BYPASS IN APP (OPTIONAL)
-- =====================================================
-- After setting up RLS policies, you can remove the X-Postgres-Role: service_role
-- header from non-admin operations in the backend code.
-- This forces the app to respect RLS policies.