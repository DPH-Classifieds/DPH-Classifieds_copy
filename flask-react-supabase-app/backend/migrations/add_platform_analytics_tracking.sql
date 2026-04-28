-- Create raw analytics event storage for the site-wide tracker
CREATE TABLE IF NOT EXISTS public.platform_events (
    id UUID PRIMARY KEY,
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
    duration_ms INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
