-- Add the listing-scoped `reddit_post_open` canonical event.
--
-- Re-creates record_analytics_event with reddit_post_open added to (a) the
-- event-name allowlist and (b) the listing-identity requirement. Everything else
-- is byte-for-byte the live 20260720000002 body. Service-role-only; no client grant.

CREATE OR REPLACE FUNCTION public.record_analytics_event(p_event_id uuid, p_event_name text, p_listing_type text, p_listing_id text, p_visitor_id text, p_session_id text, p_user_id uuid, p_platform text, p_occurred_at timestamptz, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted_id uuid;
BEGIN
  IF p_event_name NOT IN ('listing_view','call_click','whatsapp_click','vin_open','vin_reveal','page_view','page_exit','session_start','session_end','form_submit','link_click','button_click','app_open','reddit_post_open') THEN RAISE EXCEPTION 'unsupported event_name'; END IF;
  IF p_event_name IN ('listing_view','call_click','whatsapp_click','vin_open','vin_reveal','reddit_post_open') AND (coalesce(p_listing_type,'') = '' OR coalesce(p_listing_id,'') = '') THEN RAISE EXCEPTION 'listing identity required'; END IF;
  INSERT INTO public.platform_events(id,event_id,event_name,listing_type,listing_id,visitor_id,session_id,user_id,platform,occurred_at,received_at,metadata,created_at)
  VALUES(gen_random_uuid(),p_event_id,p_event_name,p_listing_type,p_listing_id,p_visitor_id,p_session_id,p_user_id,p_platform,coalesce(p_occurred_at,now()),now(),coalesce(p_metadata,'{}'::jsonb),now())
  ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING RETURNING id INTO inserted_id;
  RETURN jsonb_build_object('accepted', inserted_id IS NOT NULL, 'duplicate', inserted_id IS NULL);
END; $$;

REVOKE ALL ON FUNCTION public.record_analytics_event(uuid,text,text,text,text,text,uuid,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_analytics_event(uuid,text,text,text,text,text,uuid,text,timestamptz,jsonb) TO service_role;
