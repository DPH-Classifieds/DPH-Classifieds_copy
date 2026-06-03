-- One dealership per existing is_dealer=true user, owner = themselves.
DO $$
DECLARE
    u RECORD;
    new_dealership_id uuid;
    new_slug text;
    slug_suffix int;
BEGIN
    FOR u IN
        SELECT id, COALESCE(NULLIF(TRIM(username), ''), email) AS handle,
               COALESCE(NULLIF(TRIM(first_name), ''), '') AS first_name
        FROM public.users
        WHERE is_dealer = true
        AND NOT EXISTS (
            SELECT 1 FROM public.dealership_members m WHERE m.user_id = users.id
        )
    LOOP
        new_slug := LOWER(REGEXP_REPLACE(u.handle, '[^a-zA-Z0-9]+', '-', 'g'));
        new_slug := TRIM(BOTH '-' FROM new_slug);
        IF new_slug = '' THEN new_slug := 'dealer'; END IF;

        slug_suffix := 0;
        WHILE EXISTS (SELECT 1 FROM public.dealerships WHERE slug = new_slug) LOOP
            slug_suffix := slug_suffix + 1;
            new_slug := new_slug || '-' || slug_suffix::text;
        END LOOP;

        INSERT INTO public.dealerships (name, slug, owner_user_id)
        VALUES (COALESCE(NULLIF(u.first_name, ''), u.handle), new_slug, u.id)
        RETURNING id INTO new_dealership_id;

        INSERT INTO public.dealership_members (dealership_id, user_id, role, status, joined_at)
        VALUES (new_dealership_id, u.id, 'owner', 'active', now());
    END LOOP;

    RAISE NOTICE '✅ Backfilled % dealerships',
        (SELECT COUNT(*) FROM public.dealerships);
END $$;
