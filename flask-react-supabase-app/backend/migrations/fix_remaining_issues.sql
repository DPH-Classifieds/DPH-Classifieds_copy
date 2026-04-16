-- ============================================================================
-- FIX REMAINING SECURITY ISSUES
-- ============================================================================
-- This fixes the last few security issues that weren't caught
-- ============================================================================

-- ============================================================================
-- PART 1: FIX DEALER_USERS VIEW (Still has SECURITY DEFINER somehow)
-- ============================================================================

-- Drop and recreate as a simple view (no security definer)
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

-- ============================================================================
-- PART 2: ENABLE RLS ON REMAINING TABLES
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

-- ============================================================================
-- PART 3: ADD BASIC POLICIES FOR THESE TABLES
-- ============================================================================

-- Documents: Admin-only access (safest default)
CREATE POLICY "Admins can manage documents"
  ON public.documents FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Advertisements: Public read, admin write
CREATE POLICY "Anyone can view advertisements"
  ON public.advertisements FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage advertisements"
  ON public.advertisements FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Clients: Admin-only access
CREATE POLICY "Admins can manage clients"
  ON public.clients FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Privacy policies: Public read, admin write
CREATE POLICY "Anyone can view privacy policies"
  ON public.privacy_policies FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage privacy policies"
  ON public.privacy_policies FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Requests: Admin-only access (safest default)
CREATE POLICY "Admins can manage requests"
  ON public.requests FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================================
-- PART 4: FIX REMAINING FUNCTIONS
-- ============================================================================

-- Drop and recreate increment_view_count function
DROP FUNCTION IF EXISTS public.increment_view_count(TEXT, UUID);

CREATE FUNCTION public.increment_view_count(
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

-- Update set_user_id function (no drop needed, just add search_path)
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

-- Update sync_bike_image_urls function
-- NOTE: bikes table does NOT have an image_url column. This function must only
-- sync url ↔ image_url within bike_images, NOT update the bikes table.
-- See fix_car_images_trigger.sql for the correct version.
CREATE OR REPLACE FUNCTION public.sync_bike_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
    NEW.url := NEW.image_url;
  ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
    NEW.image_url := NEW.url;
  END IF;
  RETURN NEW;
END;
$$;

-- Update sync_car_image_urls function
-- NOTE: cars table does NOT have an image_url column. This function must only
-- sync url ↔ image_url within car_images, NOT update the cars table.
-- See fix_car_images_trigger.sql for the correct version.
CREATE OR REPLACE FUNCTION public.sync_car_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.image_url IS NOT NULL AND NEW.url IS NULL THEN
    NEW.url := NEW.image_url;
  ELSIF NEW.url IS NOT NULL AND NEW.image_url IS NULL THEN
    NEW.image_url := NEW.url;
  END IF;
  RETURN NEW;
END;
$$;
