-- ============================================================================
-- SUPABASE SECURITY FIXES - FINAL VERSION
-- ============================================================================
-- This fixes the critical security issues from Supabase advisors
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Enable RLS on license_plates (CRITICAL - has policies but RLS disabled)
ALTER TABLE public.license_plates ENABLE ROW LEVEL SECURITY;

-- Add policies for bike_images table
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

-- Add policies for part_images table
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

-- Fix dealer_users view (remove SECURITY DEFINER)
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

-- Fix function search paths (prevents SQL injection)
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.users (
        id, email, is_admin, username, phone, display_name,
        first_name, last_name, is_dealer, company_name,
        company_registration_number, city, emirate, country_code,
        email_notifications, sms_notifications, marketing_emails
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
    
    IF user_record IS NULL THEN RETURN 0; END IF;
    
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
