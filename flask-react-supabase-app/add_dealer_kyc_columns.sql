-- Migration: dealer registration overhaul
-- Adds legal business name, TRN, per-dealer ad limit, application status,
-- and document expiry tracking. Additive only; existing rows survive.
--
-- Run in Supabase SQL Editor.

------------------------------------------------------------------
-- USERS: legal name, TRN, per-dealer ad cap, application state
------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS legal_business_name TEXT,
  ADD COLUMN IF NOT EXISTS trn VARCHAR(15),
  ADD COLUMN IF NOT EXISTS dealer_listing_limit INTEGER,
  ADD COLUMN IF NOT EXISTS dealer_application_status TEXT
    DEFAULT 'draft';

-- Constrain the application status to the four states we care about.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_name = 'users'
       AND constraint_name = 'users_dealer_application_status_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_dealer_application_status_check
        CHECK (dealer_application_status IN ('draft','submitted','approved','rejected'));
  END IF;
END $$;

-- One verified TRN per registered business.
CREATE UNIQUE INDEX IF NOT EXISTS users_trn_unique
  ON public.users (trn) WHERE trn IS NOT NULL;

------------------------------------------------------------------
-- DEALER_DOCUMENTS: expiry + soft-replace tracking
------------------------------------------------------------------
ALTER TABLE public.dealer_documents
  ADD COLUMN IF NOT EXISTS expires_at DATE,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS dealer_documents_active_idx
  ON public.dealer_documents (user_id, document_type)
  WHERE replaced_at IS NULL;

------------------------------------------------------------------
-- handle_new_user trigger: copy the new dealer fields from
-- auth.users.raw_user_meta_data into public.users on signup.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.users (
        id, email, is_admin, username, phone, display_name,
        first_name, last_name, is_dealer, company_name,
        company_registration_number, city, emirate, country_code,
        email_notifications, sms_notifications, marketing_emails,
        legal_business_name, trn, trade_license_number,
        dealer_application_status
    )
    VALUES (
        new.id,
        COALESCE(new.email, new.raw_user_meta_data->>'email'),
        COALESCE((new.raw_user_meta_data->>'is_admin')::boolean, false),
        new.raw_user_meta_data->>'username',
        new.raw_user_meta_data->>'phone',
        new.raw_user_meta_data->>'display_name',
        new.raw_user_meta_data->>'first_name',
        new.raw_user_meta_data->>'last_name',
        COALESCE((new.raw_user_meta_data->>'is_dealer')::boolean, false),
        new.raw_user_meta_data->>'company_name',
        new.raw_user_meta_data->>'company_registration_number',
        new.raw_user_meta_data->>'city',
        new.raw_user_meta_data->>'emirate',
        COALESCE(new.raw_user_meta_data->>'country_code', '+971'),
        COALESCE((new.raw_user_meta_data->>'email_notifications')::boolean, true),
        COALESCE((new.raw_user_meta_data->>'sms_notifications')::boolean, true),
        COALESCE((new.raw_user_meta_data->>'marketing_emails')::boolean, false),
        NULLIF(new.raw_user_meta_data->>'legal_business_name', ''),
        NULLIF(new.raw_user_meta_data->>'trn', ''),
        NULLIF(new.raw_user_meta_data->>'trade_license_number', ''),
        COALESCE(new.raw_user_meta_data->>'dealer_application_status', 'draft')
    );
    RETURN new;
END;
$$;

------------------------------------------------------------------
-- Backfill: already-verified dealers shouldn't get yanked back into
-- the "Finish your dealer application" wizard. Pending dealers stay
-- 'draft' and will see the resume banner on next login (intended).
------------------------------------------------------------------
UPDATE public.users
   SET dealer_application_status = 'approved'
 WHERE is_dealer = TRUE
   AND dealer_verified = TRUE
   AND dealer_application_status = 'draft';
