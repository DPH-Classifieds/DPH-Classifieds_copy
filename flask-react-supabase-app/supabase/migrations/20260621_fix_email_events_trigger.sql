-- Fix: "new row violates row-level security policy for table email_events"
--
-- Root cause: a Postgres trigger on the listing tables (cars/bikes/license_plates/car_parts)
-- calls a function that tries to INSERT into email_events. The email_events table has
-- restrictive RLS that blocks this insert, causing the entire listing insert to roll back.
--
-- This migration:
-- 1. Finds and drops any such triggers on listing tables
-- 2. Adds a service_role bypass policy on email_events as a safety net
--
-- Run this in the Supabase dashboard SQL editor for project ltjatsyhpmvewancqdjw.

-- Step 1: Drop triggers on listing tables whose function body references email_events
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT DISTINCT
            t.tgname  AS trigger_name,
            c.relname AS table_name
        FROM pg_trigger t
        JOIN pg_class c   ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p    ON p.oid = t.tgfoid
        WHERE n.nspname = 'public'
          AND c.relname IN ('cars', 'bikes', 'license_plates', 'car_parts')
          AND pg_get_functiondef(p.oid) ILIKE '%email_events%'
          AND NOT t.tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', rec.trigger_name, rec.table_name);
        RAISE NOTICE 'Dropped trigger % on table %', rec.trigger_name, rec.table_name;
    END LOOP;
END;
$$;

-- Step 2: Belt-and-suspenders — allow service_role to write to email_events
-- in case other code paths still reference it.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'email_events'
    ) THEN
        DROP POLICY IF EXISTS "allow_service_role_email_events" ON public.email_events;
        CREATE POLICY "allow_service_role_email_events"
            ON public.email_events
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
        RAISE NOTICE 'Added service_role bypass policy on public.email_events';
    END IF;
END;
$$;
