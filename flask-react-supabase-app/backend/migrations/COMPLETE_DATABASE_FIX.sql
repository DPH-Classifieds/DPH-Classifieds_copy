-- ============================================================
-- COMPLETE DATABASE FIX - Run this in Supabase SQL Editor
-- ============================================================
-- This migration fixes ALL database issues in one go:
-- 1. Adds dealer management columns to users table
-- 2. Adds rejection_note columns to all listing tables
-- 3. Creates all necessary functions and triggers
-- ============================================================

-- ============================================================
-- PART 1: FIX LISTING TABLES (Cars, Bikes, Parts, Plates)
-- ============================================================

-- Add rejection_note column to cars table
ALTER TABLE public.cars 
ADD COLUMN IF NOT EXISTS rejection_note TEXT;

-- Add rejection_note column to bikes table  
ALTER TABLE public.bikes 
ADD COLUMN IF NOT EXISTS rejection_note TEXT;

-- Add rejection_note column to car_parts table
ALTER TABLE public.car_parts 
ADD COLUMN IF NOT EXISTS rejection_note TEXT;

-- Add rejection_note column to license_plates table
ALTER TABLE public.license_plates 
ADD COLUMN IF NOT EXISTS rejection_note TEXT;

-- ============================================================
-- PART 2: FIX USERS TABLE (Dealer Management)
-- ============================================================

-- Add ALL new profile fields to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS username VARCHAR(100),
ADD COLUMN IF NOT EXISTS display_name VARCHAR(150),
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20),
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,

-- Location fields
ADD COLUMN IF NOT EXISTS location VARCHAR(255),
ADD COLUMN IF NOT EXISTS city VARCHAR(100),
ADD COLUMN IF NOT EXISTS emirate VARCHAR(50),
ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'United Arab Emirates',
ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) DEFAULT '+971',
ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20),
ADD COLUMN IF NOT EXISTS address TEXT,

-- Dealer/Business related fields
ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS dealer_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS dealer_verification_requested_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS dealer_verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS dealer_verified_by UUID,
ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS company_registration_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS tax_registration_number VARCHAR(100),

-- Social media and contact
ADD COLUMN IF NOT EXISTS website_url TEXT,
ADD COLUMN IF NOT EXISTS facebook_url TEXT,
ADD COLUMN IF NOT EXISTS instagram_url TEXT,
ADD COLUMN IF NOT EXISTS twitter_url TEXT,

-- Account settings and preferences
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS sms_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS marketing_emails BOOLEAN DEFAULT FALSE,

-- Account status and verification
ADD COLUMN IF NOT EXISTS account_status VARCHAR(50) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS rejection_note TEXT,
ADD COLUMN IF NOT EXISTS verification_documents_submitted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45),

-- Profile completeness tracking
ADD COLUMN IF NOT EXISTS profile_completion_percentage INTEGER DEFAULT 0;

-- Add username unique constraint if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_username_key'
    ) THEN
        ALTER TABLE public.users 
        ADD CONSTRAINT users_username_key UNIQUE (username);
    END IF;
END $$;

-- Add account_status constraint if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_account_status_check'
    ) THEN
        ALTER TABLE public.users 
        ADD CONSTRAINT users_account_status_check 
        CHECK (account_status IN ('active', 'suspended', 'banned', 'pending_verification'));
    END IF;
END $$;

-- ============================================================
-- PART 3: CREATE INDEXES FOR PERFORMANCE
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_is_dealer ON public.users(is_dealer);
CREATE INDEX IF NOT EXISTS idx_users_dealer_verified ON public.users(dealer_verified);
CREATE INDEX IF NOT EXISTS idx_users_city ON public.users(city);
CREATE INDEX IF NOT EXISTS idx_users_emirate ON public.users(emirate);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON public.users(account_status);
CREATE INDEX IF NOT EXISTS idx_users_first_last_name ON public.users(first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- ============================================================
-- PART 4: UPDATE handle_new_user FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (
        id, 
        email, 
        is_admin, 
        username, 
        phone, 
        display_name,
        first_name,
        last_name,
        is_dealer,
        company_name,
        company_registration_number,
        city,
        emirate,
        country_code,
        email_notifications,
        sms_notifications,
        marketing_emails
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
        COALESCE((new.raw_user_meta_data->>'marketing_emails')::boolean, false)
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PART 5: CREATE PROFILE COMPLETION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.calculate_profile_completion(user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    completion INTEGER := 0;
    user_record RECORD;
BEGIN
    SELECT * INTO user_record FROM public.users WHERE id = user_id;
    
    IF user_record IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Email (required, always counted)
    IF user_record.email IS NOT NULL AND user_record.email != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Phone number
    IF user_record.phone IS NOT NULL AND user_record.phone != '' THEN
        completion := completion + 10;
    END IF;
    
    -- First name
    IF user_record.first_name IS NOT NULL AND user_record.first_name != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Last name
    IF user_record.last_name IS NOT NULL AND user_record.last_name != '' THEN
        completion := completion + 10;
    END IF;
    
    -- City
    IF user_record.city IS NOT NULL AND user_record.city != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Profile photo
    IF user_record.profile_photo_url IS NOT NULL AND user_record.profile_photo_url != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Bio
    IF user_record.bio IS NOT NULL AND user_record.bio != '' THEN
        completion := completion + 5;
    END IF;
    
    -- Emirate
    IF user_record.emirate IS NOT NULL AND user_record.emirate != '' THEN
        completion := completion + 5;
    END IF;
    
    -- Address
    IF user_record.address IS NOT NULL AND user_record.address != '' THEN
        completion := completion + 5;
    END IF;
    
    -- Phone verified
    IF user_record.phone_verified THEN
        completion := completion + 10;
    END IF;
    
    -- Email verified
    IF user_record.email_verified THEN
        completion := completion + 5;
    END IF;
    
    -- Dealer specific fields
    IF user_record.is_dealer AND user_record.company_name IS NOT NULL AND user_record.company_name != '' THEN
        completion := completion + 10;
    END IF;
    
    RETURN LEAST(completion, 100);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PART 6: CREATE AUTO-UPDATE TRIGGER FOR PROFILE COMPLETION
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_profile_completion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.profile_completion_percentage := calculate_profile_completion(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_profile_completion ON public.users;

CREATE TRIGGER trigger_update_profile_completion
    BEFORE INSERT OR UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_profile_completion();

-- ============================================================
-- PART 7: CREATE DEALER VIEW
-- ============================================================

CREATE OR REPLACE VIEW public.dealer_users AS
SELECT 
    id,
    email,
    first_name,
    last_name,
    company_name,
    company_registration_number,
    trade_license_number,
    is_dealer,
    dealer_verified,
    dealer_verified_at,
    created_at,
    phone,
    city,
    emirate,
    profile_completion_percentage
FROM public.users
WHERE is_dealer = true;

-- Grant permissions
GRANT SELECT ON public.dealer_users TO authenticated;
GRANT SELECT ON public.dealer_users TO service_role;

-- ============================================================
-- PART 8: ADD HELPFUL COMMENTS
-- ============================================================

COMMENT ON COLUMN public.users.dealer_verified IS 'Flag indicating if dealer account has been verified by admin';
COMMENT ON COLUMN public.users.dealer_verification_requested_at IS 'Timestamp when dealer verification was requested';
COMMENT ON COLUMN public.users.company_name IS 'Business/Company name for dealer accounts';
COMMENT ON COLUMN public.users.company_registration_number IS 'Official company registration number';
COMMENT ON COLUMN public.users.trade_license_number IS 'Trade license number for UAE businesses';
COMMENT ON COLUMN public.users.profile_completion_percentage IS 'Automatically calculated profile completeness (0-100)';
COMMENT ON COLUMN public.users.account_status IS 'Current account status: active, suspended, banned, or pending_verification';

COMMENT ON COLUMN public.cars.rejection_note IS 'Admin note explaining why the listing was rejected';
COMMENT ON COLUMN public.bikes.rejection_note IS 'Admin note explaining why the listing was rejected';
COMMENT ON COLUMN public.car_parts.rejection_note IS 'Admin note explaining why the listing was rejected';
COMMENT ON COLUMN public.license_plates.rejection_note IS 'Admin note explaining why the listing was rejected';

-- ============================================================
-- PART 9: UPDATE EXISTING DATA
-- ============================================================

-- Update existing user profile completion percentages
UPDATE public.users 
SET profile_completion_percentage = calculate_profile_completion(id)
WHERE profile_completion_percentage = 0 OR profile_completion_percentage IS NULL;

-- ============================================================
-- PART 10: ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on users table if not already enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Service role has full access" ON public.users;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view their own profile"
ON public.users
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update their own profile"
ON public.users
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy: Service role has full access
CREATE POLICY "Service role has full access"
ON public.users
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================
-- MIGRATION COMPLETE - LOG SUCCESS
-- ============================================================

DO $$ 
BEGIN
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ COMPLETE DATABASE FIX MIGRATION SUCCESSFUL!';
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ Added rejection_note columns to all listing tables';
    RAISE NOTICE '✅ Added dealer management columns to users table';
    RAISE NOTICE '✅ Created profile completion tracking';
    RAISE NOTICE '✅ Created indexes for performance';
    RAISE NOTICE '✅ Set up Row Level Security policies';
    RAISE NOTICE '✅ ============================================================';
    RAISE NOTICE '✅ Your database is now ready!';
    RAISE NOTICE '✅ ============================================================';
END $$;

