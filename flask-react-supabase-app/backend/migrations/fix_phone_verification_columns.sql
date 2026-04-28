-- Fix phone verification columns in users table
-- This migration adds missing columns needed for phone verification flow

-- Add phone column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'phone'
    ) THEN
        ALTER TABLE public.users ADD COLUMN phone VARCHAR(30);
    END IF;
END $$;

-- Add country_code column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'country_code'
    ) THEN
        ALTER TABLE public.users ADD COLUMN country_code VARCHAR(10) DEFAULT '+971';
    END IF;
END $$;

-- Ensure phone_verified_at column exists (may already exist from add_phone_verifications.sql)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Copy data from phone_number to phone if both columns exist and phone is empty
DO $$
BEGIN
    -- Check if phone_number column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'phone_number'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'phone'
    ) THEN
        UPDATE public.users
        SET phone = phone_number
        WHERE phone IS NULL AND phone_number IS NOT NULL;
    END IF;
END $$;

-- Add index on phone for faster lookups (only if phone column exists)
DROP INDEX IF EXISTS idx_users_phone;
CREATE INDEX idx_users_phone ON public.users(phone);

-- Add comments
COMMENT ON COLUMN public.users.phone IS 'User phone number (normalized international format)';
COMMENT ON COLUMN public.users.country_code IS 'User country code (default +971 for UAE)';
COMMENT ON COLUMN public.users.phone_verified_at IS 'Timestamp of latest successful phone verification';

-- Create trigger to sync phone_number and phone columns (only if phone_number exists)
DO $$
BEGIN
    -- Check if phone_number column exists before creating trigger
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'phone_number'
    ) THEN
        CREATE OR REPLACE FUNCTION public.sync_phone_columns()
        RETURNS TRIGGER AS $$
        BEGIN
            -- If phone_number changes, update phone
            IF NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
                NEW.phone = NEW.phone_number;
            END IF;

            -- If phone changes, update phone_number
            IF NEW.phone IS DISTINCT FROM OLD.phone THEN
                NEW.phone_number = NEW.phone;
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS sync_phone_columns_trigger ON public.users;
        CREATE TRIGGER sync_phone_columns_trigger
            AFTER INSERT OR UPDATE ON public.users
            FOR EACH ROW
            EXECUTE FUNCTION public.sync_phone_columns();
    END IF;
END $$;
