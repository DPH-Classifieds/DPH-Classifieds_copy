-- Enhanced User Profiles Migration (FIXED VERSION)
-- This migration adds comprehensive user profile fields for dealer management

-- ============================================================
-- STEP 1: Add ALL new columns to users table
-- ============================================================

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS username VARCHAR(100) UNIQUE,
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

-- Add constraint for account_status (only if it doesn't exist)
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
-- STEP 2: Create indexes for better query performance
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
-- STEP 3: Update the handle_new_user function
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
-- STEP 4: Create profile completion calculation function
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
-- STEP 5: Create trigger to auto-update profile completion
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
-- STEP 6: Create a view for dealers
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
-- STEP 7: Add helpful comments
-- ============================================================

COMMENT ON COLUMN public.users.dealer_verified IS 'Flag indicating if dealer account has been verified by admin';
COMMENT ON COLUMN public.users.dealer_verification_requested_at IS 'Timestamp when dealer verification was requested';
COMMENT ON COLUMN public.users.company_name IS 'Business/Company name for dealer accounts';
COMMENT ON COLUMN public.users.company_registration_number IS 'Official company registration number';
COMMENT ON COLUMN public.users.trade_license_number IS 'Trade license number for UAE businesses';
COMMENT ON COLUMN public.users.profile_completion_percentage IS 'Automatically calculated profile completeness (0-100)';
COMMENT ON COLUMN public.users.account_status IS 'Current account status: active, suspended, banned, or pending_verification';

-- ============================================================
-- STEP 8: Update existing user profile completion percentages
-- ============================================================

UPDATE public.users 
SET profile_completion_percentage = calculate_profile_completion(id)
WHERE profile_completion_percentage = 0 OR profile_completion_percentage IS NULL;

-- ============================================================
-- STEP 9: Enable Row Level Security (RLS) policies
-- ============================================================

-- Enable RLS on users table if not already enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users;
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
-- Migration Complete
-- ============================================================

-- Log completion
DO $$ 
BEGIN
    RAISE NOTICE 'Enhanced user profiles migration completed successfully!';
    RAISE NOTICE 'Added dealer management, profile fields, and RLS policies.';
END $$;

