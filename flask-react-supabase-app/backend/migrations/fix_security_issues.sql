-- ============================================================================
-- SUPABASE SECURITY FIXES - CRITICAL PRIORITY
-- ============================================================================
-- This migration addresses all critical security issues identified by Supabase
-- Run this first before performance optimizations
-- ============================================================================

-- ============================================================================
-- PART 1: ENABLE RLS ON TABLES WITHOUT IT
-- ============================================================================

-- Enable RLS on documents table
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Enable RLS on advertisements table
ALTER TABLE public.advertisements ENABLE ROW LEVEL SECURITY;

-- Enable RLS on clients table
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Enable RLS on privacy_policies table
ALTER TABLE public.privacy_policies ENABLE ROW LEVEL SECURITY;

-- Enable RLS on requests table
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

-- Enable RLS on license_plates table (it has policies but RLS is disabled)
ALTER TABLE public.license_plates ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 2: ADD RLS POLICIES FOR TABLES THAT NEED THEM
-- ============================================================================

-- Documents table policies
CREATE POLICY "Users can view their own documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can view all documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Users can insert their own documents"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all documents"
  ON public.documents FOR ALL
  TO authenticated
  USING (public.is_admin());

-- Advertisements table policies
CREATE POLICY "Anyone can view active advertisements"
  ON public.advertisements FOR SELECT
  USING (status = 'active');

CREATE POLICY "Admins can manage advertisements"
  ON public.advertisements FOR ALL
  TO authenticated
  USING (public.is_admin());

-- Clients table policies
CREATE POLICY "Admins can view all clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can manage clients"
  ON public.clients FOR ALL
  TO authenticated
  USING (public.is_admin());

-- Privacy policies table policies
CREATE POLICY "Anyone can view privacy policies"
  ON public.privacy_policies FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage privacy policies"
  ON public.privacy_policies FOR ALL
  TO authenticated
  USING (public.is_admin());

-- Requests table policies
CREATE POLICY "Users can view their own requests"
  ON public.requests FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can view all requests"
  ON public.requests FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Users can create requests"
  ON public.requests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all requests"
  ON public.requests FOR ALL
  TO authenticated
  USING (public.is_admin());

-- ============================================================================
-- PART 3: ADD POLICIES FOR TABLES WITH RLS BUT NO POLICIES
-- ============================================================================

-- Bike images policies
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
      AND bikes.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete images for their bikes"
  ON public.bike_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bikes
      WHERE bikes.id = bike_images.bike_id
      AND bikes.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can manage all bike images"
  ON public.bike_images FOR ALL
  TO authenticated
  USING (public.is_admin());

-- Part images policies
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
      AND car_parts.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete images for their parts"
  ON public.part_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.car_parts
      WHERE car_parts.id = part_images.part_id
      AND car_parts.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can manage all part images"
  ON public.part_images FOR ALL
  TO authenticated
  USING (public.is_admin());

-- ============================================================================
-- PART 4: FIX SECURITY DEFINER VIEW
-- ============================================================================

-- Recreate dealer_users view without SECURITY DEFINER
DROP VIEW IF EXISTS public.dealer_users;

CREATE VIEW public.dealer_users AS
SELECT 
  id,
  email,
  first_name,
  last_name,
  phone_number,
  city,
  emirate,
  is_dealer,
  dealer_verified,
  created_at
FROM public.users
WHERE is_dealer = true;

-- Add RLS policy for the view if needed
-- Note: Views inherit RLS from underlying tables

-- ============================================================================
-- PART 5: FIX FUNCTION SEARCH PATHS
-- ============================================================================

-- Fix calculate_profile_completion function
CREATE OR REPLACE FUNCTION public.calculate_profile_completion()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  completion INTEGER := 0;
  user_rec RECORD;
BEGIN
  SELECT * INTO user_rec FROM public.users WHERE id = auth.uid();
  
  IF user_rec.first_name IS NOT NULL AND user_rec.first_name != '' THEN
    completion := completion + 20;
  END IF;
  
  IF user_rec.last_name IS NOT NULL AND user_rec.last_name != '' THEN
    completion := completion + 20;
  END IF;
  
  IF user_rec.phone_number IS NOT NULL AND user_rec.phone_number != '' THEN
    completion := completion + 20;
  END IF;
  
  IF user_rec.city IS NOT NULL AND user_rec.city != '' THEN
    completion := completion + 20;
  END IF;
  
  IF user_rec.emirate IS NOT NULL AND user_rec.emirate != '' THEN
    completion := completion + 20;
  END IF;
  
  RETURN completion;
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
  INSERT INTO public.users (id, email, created_at)
  VALUES (NEW.id, NEW.email, NEW.created_at);
  RETURN NEW;
END;
$$;

-- Fix increment_view_count function
CREATE OR REPLACE FUNCTION public.increment_view_count(
  listing_type TEXT,
  listing_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF listing_type = 'car' THEN
    UPDATE public.cars SET view_count = view_count + 1 WHERE id = listing_id;
  ELSIF listing_type = 'bike' THEN
    UPDATE public.bikes SET view_count = view_count + 1 WHERE id = listing_id;
  ELSIF listing_type = 'part' THEN
    UPDATE public.car_parts SET view_count = view_count + 1 WHERE id = listing_id;
  ELSIF listing_type = 'plate' THEN
    UPDATE public.license_plates SET view_count = view_count + 1 WHERE id = listing_id;
  END IF;
END;
$$;

-- Fix is_admin function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND is_admin = true
  );
END;
$$;

-- Fix set_user_id function
CREATE OR REPLACE FUNCTION public.set_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$$;

-- Fix sync_bike_image_urls function
CREATE OR REPLACE FUNCTION public.sync_bike_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Update bike with aggregated image URLs
  UPDATE public.bikes
  SET image_url = (
    SELECT array_agg(image_url ORDER BY created_at)
    FROM public.bike_images
    WHERE bike_id = NEW.bike_id
  )
  WHERE id = NEW.bike_id;
  
  RETURN NEW;
END;
$$;

-- Fix sync_car_image_urls function
CREATE OR REPLACE FUNCTION public.sync_car_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Update car with aggregated image URLs
  UPDATE public.cars
  SET image_url = (
    SELECT array_agg(image_url ORDER BY created_at)
    FROM public.car_images
    WHERE car_id = NEW.car_id
  )
  WHERE id = NEW.car_id;
  
  RETURN NEW;
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
  NEW.profile_completion := public.calculate_profile_completion();
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
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check RLS is enabled on all public tables
-- Run this after migration to verify:
-- SELECT schemaname, tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename;
