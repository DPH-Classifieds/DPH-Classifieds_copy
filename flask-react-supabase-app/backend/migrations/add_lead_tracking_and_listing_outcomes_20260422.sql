-- Lead tracking + listing outcome workflow

CREATE TABLE IF NOT EXISTS public.lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'part', 'plate')),
    action TEXT NOT NULL CHECK (action IN ('call_click', 'whatsapp_click', 'vin_open', 'vin_reveal')),
    user_id UUID NULL REFERENCES auth.users(id),
    session_id TEXT NULL,
    source TEXT NULL,
    user_agent TEXT NULL,
    ip_address TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_lead_events_listing ON public.lead_events(listing_type, listing_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_action ON public.lead_events(action);
CREATE INDEX IF NOT EXISTS idx_lead_events_created_at ON public.lead_events(created_at DESC);

ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read lead events" ON public.lead_events;
CREATE POLICY "Admins can read lead events" ON public.lead_events
    FOR SELECT
    USING (public.is_admin(auth.uid()));

GRANT ALL ON public.lead_events TO service_role;
GRANT SELECT ON public.lead_events TO authenticated;


CREATE TABLE IF NOT EXISTS public.listing_deletion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'part', 'plate')),
    deleted_by UUID NULL REFERENCES auth.users(id),
    deleted_by_role TEXT NOT NULL CHECK (deleted_by_role IN ('admin', 'system', 'user')),
    reason TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_listing_deletion_events_listing ON public.listing_deletion_events(listing_type, listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_deletion_events_created_at ON public.listing_deletion_events(created_at DESC);

ALTER TABLE public.listing_deletion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read deletion events" ON public.listing_deletion_events;
CREATE POLICY "Admins can read deletion events" ON public.listing_deletion_events
    FOR SELECT
    USING (public.is_admin(auth.uid()));

GRANT ALL ON public.listing_deletion_events TO service_role;
GRANT SELECT ON public.listing_deletion_events TO authenticated;


ALTER TABLE public.cars
    ADD COLUMN IF NOT EXISTS sold_status TEXT NULL CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    ADD COLUMN IF NOT EXISTS sold_status_set_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS sold_response_deadline TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS auto_removed_at TIMESTAMPTZ NULL;

ALTER TABLE public.bikes
    ADD COLUMN IF NOT EXISTS sold_status TEXT NULL CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    ADD COLUMN IF NOT EXISTS sold_status_set_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS sold_response_deadline TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS auto_removed_at TIMESTAMPTZ NULL;

ALTER TABLE public.car_parts
    ADD COLUMN IF NOT EXISTS sold_status TEXT NULL CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    ADD COLUMN IF NOT EXISTS sold_status_set_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS sold_response_deadline TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS auto_removed_at TIMESTAMPTZ NULL;

ALTER TABLE public.license_plates
    ADD COLUMN IF NOT EXISTS sold_status TEXT NULL CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    ADD COLUMN IF NOT EXISTS sold_status_set_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS sold_response_deadline TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS auto_removed_at TIMESTAMPTZ NULL;
