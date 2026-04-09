-- Apply this only after the backend forwards the caller's Supabase JWT
-- to PostgREST for user-scoped reads and writes.
--
-- Required app-side prerequisite:
--   backend/app.py must preserve request.supabase_token in token_required()
--   and supabase_request() must use that JWT when user_id is present.

BEGIN;

-- Tighten plate_images so users can only manage images belonging to their own plates.
DROP POLICY IF EXISTS "Users can view all plate images" ON public.plate_images;
DROP POLICY IF EXISTS "Users can insert their own plate images" ON public.plate_images;
DROP POLICY IF EXISTS "Users can update their own plate images" ON public.plate_images;
DROP POLICY IF EXISTS "Users can delete their own plate images" ON public.plate_images;

CREATE POLICY "Anyone can view plate images"
  ON public.plate_images FOR SELECT
  USING (true);

CREATE POLICY "Users can insert plate images for their own plates"
  ON public.plate_images FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.license_plates
      WHERE license_plates.id = plate_images.plate_id
        AND license_plates.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update plate images for their own plates"
  ON public.plate_images FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.license_plates
      WHERE license_plates.id = plate_images.plate_id
        AND license_plates.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.license_plates
      WHERE license_plates.id = plate_images.plate_id
        AND license_plates.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete plate images for their own plates"
  ON public.plate_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.license_plates
      WHERE license_plates.id = plate_images.plate_id
        AND license_plates.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can manage all plate images"
  ON public.plate_images FOR ALL
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

-- Split reports policies by operation instead of FOR ALL.
DROP POLICY IF EXISTS "Users can view and create their own reports" ON public.reports;
DROP POLICY IF EXISTS "Admins can manage all reports" ON public.reports;

CREATE POLICY "Users can view their own reports"
  ON public.reports FOR SELECT
  TO authenticated
  USING (reporter_id = (SELECT auth.uid()));

CREATE POLICY "Users can create their own reports"
  ON public.reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()));

CREATE POLICY "Admins can view all reports"
  ON public.reports FOR SELECT
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

CREATE POLICY "Admins can update all reports"
  ON public.reports FOR UPDATE
  TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

-- Remove unneeded self-service ALL rights on users.
DROP POLICY IF EXISTS "Users can view and update their own data" ON public.users;

CREATE POLICY "Users can view their own data"
  ON public.users FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own data"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

COMMIT;
