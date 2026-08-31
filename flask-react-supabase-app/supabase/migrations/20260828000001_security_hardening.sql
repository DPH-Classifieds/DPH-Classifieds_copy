-- Security hardening from the 2026-08 audit.
-- Backend workers use service_role; clients must never receive these tables.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dealerships', 'dealership_members', 'dealership_invitations', 'dealer_kpi_daily',
    'dealer_market_snapshots', 'dealer_leads', 'dealer_lead_events',
    'dealer_webhooks', 'dealer_webhook_deliveries', 'dealer_inventory_jobs',
    'dealer_inventory_row_errors', 'dealer_api_sources', 'dealer_info_requests',
    'dealer_info_request_uploads', 'cars', 'car_images', 'bikes', 'bike_images',
    'car_parts', 'part_images', 'license_plates', 'plate_images', 'lead_events',
    'listing_deletion_events'
  ] LOOP
    FOR policy_name IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
        AND (qual::text = '(true)' OR qual IS NULL)
        AND (with_check::text = '(true)' OR with_check IS NULL)
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
    END LOOP;
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END $$;

-- Keep both signatures during migration convergence; old policies using the
-- UUID overload and newer policies using auth.uid() remain valid.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.users WHERE id = auth.uid()), false)
$$;

-- This helper is only an internal policy primitive. Never leave a
-- SECURITY DEFINER function executable by PUBLIC; otherwise anonymous and
-- authenticated clients receive an unnecessary privileged entry point.
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND COALESCE(is_admin, false) = false
              AND COALESCE(is_super_admin, false) = false);

CREATE INDEX IF NOT EXISTS idx_cars_active_created
  ON public.cars (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;
CREATE INDEX IF NOT EXISTS idx_bikes_active_created
  ON public.bikes (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;
CREATE INDEX IF NOT EXISTS idx_car_parts_active_created
  ON public.car_parts (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;
CREATE INDEX IF NOT EXISTS idx_license_plates_active_created
  ON public.license_plates (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;
