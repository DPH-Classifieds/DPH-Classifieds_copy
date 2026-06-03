-- Helper: is the caller an active member of the given dealership?
CREATE OR REPLACE FUNCTION public.is_dealership_member(p_dealership_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.dealership_members
        WHERE dealership_id = p_dealership_id
        AND user_id = auth.uid()
        AND status = 'active'
    );
$$;

-- Existing is_admin(uid) helper assumed (used by other admin tables).

ALTER TABLE public.dealerships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealerships_read" ON public.dealerships;
CREATE POLICY "dealerships_read" ON public.dealerships FOR SELECT
USING (public.is_dealership_member(id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealerships_service_all" ON public.dealerships;
CREATE POLICY "dealerships_service_all" ON public.dealerships FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealership_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_read" ON public.dealership_members;
CREATE POLICY "members_read" ON public.dealership_members FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "members_service_all" ON public.dealership_members;
CREATE POLICY "members_service_all" ON public.dealership_members FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealership_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invites_read" ON public.dealership_invitations;
CREATE POLICY "invites_read" ON public.dealership_invitations FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "invites_service_all" ON public.dealership_invitations;
CREATE POLICY "invites_service_all" ON public.dealership_invitations FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_kpi_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kpi_daily_read" ON public.dealer_kpi_daily;
CREATE POLICY "kpi_daily_read" ON public.dealer_kpi_daily FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "kpi_daily_service_all" ON public.dealer_kpi_daily;
CREATE POLICY "kpi_daily_service_all" ON public.dealer_kpi_daily FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_market_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "market_read" ON public.dealer_market_snapshots;
CREATE POLICY "market_read" ON public.dealer_market_snapshots FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "market_service_all" ON public.dealer_market_snapshots;
CREATE POLICY "market_service_all" ON public.dealer_market_snapshots FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_admin_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_admin_read" ON public.dealer_admin_audit;
CREATE POLICY "audit_admin_read" ON public.dealer_admin_audit FOR SELECT
USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "audit_service_insert" ON public.dealer_admin_audit;
CREATE POLICY "audit_service_insert" ON public.dealer_admin_audit FOR INSERT WITH CHECK (true);
-- No UPDATE or DELETE policy: audit is append-only.

GRANT SELECT ON public.dealerships, public.dealership_members, public.dealership_invitations,
                public.dealer_kpi_daily, public.dealer_market_snapshots, public.dealer_admin_audit
       TO authenticated;
GRANT ALL ON public.dealerships, public.dealership_members, public.dealership_invitations,
              public.dealer_kpi_daily, public.dealer_market_snapshots, public.dealer_admin_audit
       TO service_role;
