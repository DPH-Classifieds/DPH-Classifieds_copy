-- Create raw analytics event storage for the site-wide tracker
CREATE TABLE IF NOT EXISTS public.platform_events (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    event_category TEXT,
    page_path TEXT,
    page_title TEXT,
    page_kind TEXT,
    element_tag TEXT,
    element_text TEXT,
    target_url TEXT,
    listing_type TEXT,
    listing_id TEXT,
    user_id UUID,
    visitor_id TEXT,
    session_id TEXT NOT NULL,
    platform TEXT,
    occurred_at TIMESTAMPTZ DEFAULT NOW(),
    received_at TIMESTAMPTZ DEFAULT NOW(),
    duration_ms INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade databases created by the original migration, which did not have
-- the client event id used for idempotent ingestion.
ALTER TABLE public.platform_events
    ADD COLUMN IF NOT EXISTS event_id UUID;
ALTER TABLE public.platform_events
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
UPDATE public.platform_events
SET event_id = id
WHERE event_id IS NULL;
UPDATE public.platform_events
SET occurred_at = COALESCE(occurred_at, created_at, NOW()),
    received_at = COALESCE(received_at, created_at, NOW())
WHERE occurred_at IS NULL OR received_at IS NULL;
ALTER TABLE public.platform_events
    ALTER COLUMN event_id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN event_id SET NOT NULL,
    ALTER COLUMN occurred_at SET DEFAULT NOW(),
    ALTER COLUMN received_at SET DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_events_event_id
    ON public.platform_events(event_id);

CREATE INDEX IF NOT EXISTS idx_platform_events_event_name ON public.platform_events(event_name);
CREATE INDEX IF NOT EXISTS idx_platform_events_created_at ON public.platform_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_events_session_id ON public.platform_events(session_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_visitor_id ON public.platform_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_user_id ON public.platform_events(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_events_listing ON public.platform_events(listing_type, listing_id);

ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role all platform events" ON public.platform_events;
CREATE POLICY "Service role all platform events"
ON public.platform_events
FOR ALL
USING (true)
WITH CHECK (true);

GRANT ALL ON public.platform_events TO service_role;
GRANT INSERT, SELECT ON public.platform_events TO authenticated;
