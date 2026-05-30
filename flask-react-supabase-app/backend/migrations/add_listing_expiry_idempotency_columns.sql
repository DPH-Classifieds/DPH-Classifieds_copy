-- Make listing expiry/reminder processing idempotent across scanner loops,
-- worker replicas, retries, renewal, and delete flows.

DO $$
DECLARE
  table_name TEXT;
  constraint_row RECORD;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cars', 'bikes', 'car_parts', 'license_plates']
  LOOP
    FOR constraint_row IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = format('public.%I', table_name)::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
        table_name,
        constraint_row.conname
      );
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (status IS NULL OR status IN (''pending'', ''approved'', ''active'', ''expired'', ''deleted'', ''rejected'', ''sold'', ''draft'')) NOT VALID',
      table_name,
      table_name || '_status_lifecycle_check'
    );
  END LOOP;
END $$;

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_job_id TEXT,
  ADD COLUMN IF NOT EXISTS expiration_job_id TEXT;

ALTER TABLE public.bikes
  ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_job_id TEXT,
  ADD COLUMN IF NOT EXISTS expiration_job_id TEXT;

ALTER TABLE public.car_parts
  ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_job_id TEXT,
  ADD COLUMN IF NOT EXISTS expiration_job_id TEXT;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_job_id TEXT,
  ADD COLUMN IF NOT EXISTS expiration_job_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cars_expiry_reminder_claim
  ON public.cars (status, is_archived, deleted_at, expires_at, expiry_reminder_sent_at);
CREATE INDEX IF NOT EXISTS idx_cars_expired_email_claim
  ON public.cars (status, is_archived, deleted_at, expires_at, expired_email_sent_at);

CREATE INDEX IF NOT EXISTS idx_bikes_expiry_reminder_claim
  ON public.bikes (status, is_archived, deleted_at, expires_at, expiry_reminder_sent_at);
CREATE INDEX IF NOT EXISTS idx_bikes_expired_email_claim
  ON public.bikes (status, is_archived, deleted_at, expires_at, expired_email_sent_at);

CREATE INDEX IF NOT EXISTS idx_car_parts_expiry_reminder_claim
  ON public.car_parts (status, is_archived, deleted_at, expires_at, expiry_reminder_sent_at);
CREATE INDEX IF NOT EXISTS idx_car_parts_expired_email_claim
  ON public.car_parts (status, is_archived, deleted_at, expires_at, expired_email_sent_at);

CREATE INDEX IF NOT EXISTS idx_license_plates_expiry_reminder_claim
  ON public.license_plates (status, is_archived, deleted_at, expires_at, expiry_reminder_sent_at);
CREATE INDEX IF NOT EXISTS idx_license_plates_expired_email_claim
  ON public.license_plates (status, is_archived, deleted_at, expires_at, expired_email_sent_at);
