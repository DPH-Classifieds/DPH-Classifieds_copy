-- Live Supabase cleanup for performance, security, and RLS simplification.
-- Safe, behavior-preserving changes:
-- - add missing FK indexes
-- - drop duplicate indexes
-- - harden trigger function search_path
-- - rewrite policies to use initplan-safe auth lookups
-- - remove redundant public "svc_*" policies that are not needed because
--   service_role bypasses RLS

-- ============================================================================
-- SECURITY HARDENING
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_car_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION public.sync_bike_image_urls()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
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

-- ============================================================================
-- INDEX CLEANUP + MISSING FK INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_documents_request_id ON public.documents(request_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_user_id ON public.lead_events(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_deletion_events_deleted_by ON public.listing_deletion_events(deleted_by);

DROP INDEX IF EXISTS public.idx_cars_price;
DROP INDEX IF EXISTS public.idx_deletion_events_listing;

-- ============================================================================
-- RLS REWRITES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
DROP POLICY IF EXISTS "Admins can view and manage all users" ON public.users;
DROP POLICY IF EXISTS "svc_users" ON public.users;
DROP POLICY IF EXISTS "Service role has full access" ON public.users;
CREATE POLICY "Users and admins can manage their own data"
  ON public.users
  FOR ALL
  TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())))
  WITH CHECK (id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can manage their own cars" ON public.cars;
DROP POLICY IF EXISTS "Anyone can view approved cars or own cars" ON public.cars;
DROP POLICY IF EXISTS "Admins can manage all cars" ON public.cars;
DROP POLICY IF EXISTS "svc_cars" ON public.cars;
CREATE POLICY "Users and admins can manage cars"
  ON public.cars
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));
CREATE POLICY "Anyone can view approved cars or own cars"
  ON public.cars
  FOR SELECT
  USING (
    ((status)::text = 'approved'::text)
    OR (is_approved = true)
    OR (user_id = (SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage their own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Anyone can view approved bikes or own bikes" ON public.bikes;
DROP POLICY IF EXISTS "Admins can manage all bikes" ON public.bikes;
DROP POLICY IF EXISTS "svc_bikes" ON public.bikes;
CREATE POLICY "Users and admins can manage bikes"
  ON public.bikes
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));
CREATE POLICY "Anyone can view approved bikes or own bikes"
  ON public.bikes
  FOR SELECT
  USING (
    ((status)::text = 'approved'::text)
    OR (is_approved = true)
    OR (user_id = (SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage their own car parts" ON public.car_parts;
DROP POLICY IF EXISTS "Anyone can view approved car parts or own parts" ON public.car_parts;
DROP POLICY IF EXISTS "Admins can manage all car parts" ON public.car_parts;
DROP POLICY IF EXISTS "svc_car_parts" ON public.car_parts;
CREATE POLICY "Users and admins can manage car parts"
  ON public.car_parts
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));
CREATE POLICY "Anyone can view approved car parts or own parts"
  ON public.car_parts
  FOR SELECT
  USING (
    ((status)::text = 'approved'::text)
    OR (is_approved = true)
    OR (user_id = (SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage their own plates" ON public.license_plates;
DROP POLICY IF EXISTS "Anyone can view approved plates or own plates" ON public.license_plates;
DROP POLICY IF EXISTS "Admins can manage all plates" ON public.license_plates;
DROP POLICY IF EXISTS "svc_plates" ON public.license_plates;
CREATE POLICY "Users and admins can manage plates"
  ON public.license_plates
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())))
  WITH CHECK (user_id = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid())));
CREATE POLICY "Anyone can view approved plates or own plates"
  ON public.license_plates
  FOR SELECT
  USING (
    ((status)::text = 'approved'::text)
    OR (is_approved = true)
    OR (user_id = (SELECT auth.uid()))
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Anyone can view car images" ON public.car_images;
DROP POLICY IF EXISTS "Users can manage images for their cars" ON public.car_images;
DROP POLICY IF EXISTS "Admins can manage all car images" ON public.car_images;
DROP POLICY IF EXISTS "svc_car_images" ON public.car_images;
CREATE POLICY "Anyone can view car images"
  ON public.car_images
  FOR SELECT
  USING (true);
CREATE POLICY "Users can manage images for their cars"
  ON public.car_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cars
      WHERE cars.id = car_images.car_id
        AND cars.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cars
      WHERE cars.id = car_images.car_id
        AND cars.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Anyone can view bike images" ON public.bike_images;
DROP POLICY IF EXISTS "Users can insert images for their bikes" ON public.bike_images;
DROP POLICY IF EXISTS "Users can delete images for their bikes" ON public.bike_images;
DROP POLICY IF EXISTS "Admins can manage all bike images" ON public.bike_images;
DROP POLICY IF EXISTS "svc_bike_images" ON public.bike_images;
CREATE POLICY "Anyone can view bike images"
  ON public.bike_images
  FOR SELECT
  USING (true);
CREATE POLICY "Users can manage images for their bikes"
  ON public.bike_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bikes
      WHERE bikes.id = bike_images.bike_id
        AND bikes.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.bikes
      WHERE bikes.id = bike_images.bike_id
        AND bikes.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Anyone can view part images" ON public.part_images;
DROP POLICY IF EXISTS "Users can insert images for their parts" ON public.part_images;
DROP POLICY IF EXISTS "Users can delete images for their parts" ON public.part_images;
DROP POLICY IF EXISTS "Admins can manage all part images" ON public.part_images;
DROP POLICY IF EXISTS "svc_part_images" ON public.part_images;
CREATE POLICY "Anyone can view part images"
  ON public.part_images
  FOR SELECT
  USING (true);
CREATE POLICY "Users can manage images for their parts"
  ON public.part_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.car_parts
      WHERE car_parts.id = part_images.part_id
        AND car_parts.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.car_parts
      WHERE car_parts.id = part_images.part_id
        AND car_parts.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Anyone can view plate images" ON public.plate_images;
DROP POLICY IF EXISTS "Users can insert plate images for their own plates" ON public.plate_images;
DROP POLICY IF EXISTS "Users can update plate images for their own plates" ON public.plate_images;
DROP POLICY IF EXISTS "Users can delete plate images for their own plates" ON public.plate_images;
DROP POLICY IF EXISTS "Admins can manage all plate images" ON public.plate_images;
DROP POLICY IF EXISTS "svc_plate_images" ON public.plate_images;
CREATE POLICY "Anyone can view plate images"
  ON public.plate_images
  FOR SELECT
  USING (true);
CREATE POLICY "Users can manage images for their own plates"
  ON public.plate_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.license_plates
      WHERE license_plates.id = plate_images.plate_id
        AND license_plates.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.license_plates
      WHERE license_plates.id = plate_images.plate_id
        AND license_plates.user_id = (SELECT auth.uid())
    )
    OR public.is_admin((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Users can view own phone verifications" ON public.phone_verifications;
DROP POLICY IF EXISTS "Service role can manage phone verifications" ON public.phone_verifications;
CREATE POLICY "Users can view and manage own phone verifications"
  ON public.phone_verifications
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can manage documents" ON public.documents;
CREATE POLICY "Admins can manage documents"
  ON public.documents
  FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can manage requests" ON public.requests;
CREATE POLICY "Admins can manage requests"
  ON public.requests
  FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can manage clients" ON public.clients;
CREATE POLICY "Admins can manage clients"
  ON public.clients
  FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can manage advertisements" ON public.advertisements;
DROP POLICY IF EXISTS "Anyone can view advertisements" ON public.advertisements;
CREATE POLICY "Anyone can view advertisements"
  ON public.advertisements
  FOR SELECT
  USING (true);
CREATE POLICY "Admins can manage advertisements"
  ON public.advertisements
  FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can manage privacy policies" ON public.privacy_policies;
DROP POLICY IF EXISTS "Anyone can view privacy policies" ON public.privacy_policies;
CREATE POLICY "Anyone can view privacy policies"
  ON public.privacy_policies
  FOR SELECT
  USING (true);
CREATE POLICY "Admins can manage privacy policies"
  ON public.privacy_policies
  FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can read lead events" ON public.lead_events;
DROP POLICY IF EXISTS "svc_lead_events" ON public.lead_events;
CREATE POLICY "Admins can manage lead events"
  ON public.lead_events
  FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can read deletion events" ON public.listing_deletion_events;
DROP POLICY IF EXISTS "svc_deletion_events" ON public.listing_deletion_events;
CREATE POLICY "Admins can manage deletion events"
  ON public.listing_deletion_events
  FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));
