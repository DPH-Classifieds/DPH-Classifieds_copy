-- Enhanced User Profiles Migration
-- This migration adds comprehensive user profile fields for a production-ready classifieds platform

-- Add new profile fields to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS first_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS last_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS bio TEXT,
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
ADD COLUMN IF NOT EXISTS dealer_verified_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS company_registration_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS tax_registration_number VARCHAR(100),

-- Social media and contact
ADD COLUMN IF NOT EXISTS website_url TEXT,
ADD COLUMN IF NOT EXISTS facebook_url TEXT,
ADD COLUMN IF NOT EXISTS instagram_url TEXT,
ADD COLUMN IF NOT EXISTS twitter_url TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20),

-- Account settings and preferences
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS sms_notifications BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS marketing_emails BOOLEAN DEFAULT FALSE,

-- Account status and verification
ADD COLUMN IF NOT EXISTS account_status VARCHAR(50) DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'banned', 'pending_verification')),
ADD COLUMN IF NOT EXISTS verification_documents_submitted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45),

-- Profile completeness tracking
ADD COLUMN IF NOT EXISTS profile_completion_percentage INTEGER DEFAULT 0;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_is_dealer ON public.users(is_dealer);
CREATE INDEX IF NOT EXISTS idx_users_dealer_verified ON public.users(dealer_verified);
CREATE INDEX IF NOT EXISTS idx_users_city ON public.users(city);
CREATE INDEX IF NOT EXISTS idx_users_emirate ON public.users(emirate);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON public.users(account_status);
CREATE INDEX IF NOT EXISTS idx_users_first_last_name ON public.users(first_name, last_name);

-- Update the handle_new_user function to include all new fields
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

-- Function to calculate profile completion percentage
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
    
    -- Basic info (30 points total)
    IF user_record.email IS NOT NULL AND user_record.email != '' THEN
        completion := completion + 10;
    END IF;
    IF user_record.phone IS NOT NULL AND user_record.phone != '' THEN
        completion := completion + 10;
    END IF;
    IF user_record.first_name IS NOT NULL AND user_record.first_name != '' THEN
        completion := completion + 5;
    END IF;
    IF user_record.last_name IS NOT NULL AND user_record.last_name != '' THEN
        completion := completion + 5;
    END IF;
    
    -- Profile details (20 points)
    IF user_record.username IS NOT NULL AND user_record.username != '' THEN
        completion := completion + 10;
    END IF;
    IF user_record.profile_photo_url IS NOT NULL AND user_record.profile_photo_url != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Location (15 points)
    IF user_record.city IS NOT NULL AND user_record.city != '' THEN
        completion := completion + 10;
    END IF;
    IF user_record.emirate IS NOT NULL AND user_record.emirate != '' THEN
        completion := completion + 5;
    END IF;
    
    -- Verification (20 points)
    IF user_record.email_verified THEN
        completion := completion + 10;
    END IF;
    IF user_record.phone_verified THEN
        completion := completion + 10;
    END IF;
    
    -- Additional info (15 points)
    IF user_record.bio IS NOT NULL AND user_record.bio != '' THEN
        completion := completion + 5;
    END IF;
    IF user_record.is_dealer AND user_record.company_name IS NOT NULL THEN
        completion := completion + 10;
    END IF;
    
    RETURN LEAST(completion, 100);
END;
$$ LANGUAGE plpgsql;

-- Function to update profile completion automatically
CREATE OR REPLACE FUNCTION public.update_profile_completion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.profile_completion_percentage := public.calculate_profile_completion(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update profile completion
DROP TRIGGER IF EXISTS trigger_update_profile_completion ON public.users;
CREATE TRIGGER trigger_update_profile_completion
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_profile_completion();

-- Create a view for dealer users (useful for admin panel)
CREATE OR REPLACE VIEW public.dealer_users AS
SELECT 
    u.*,
    COUNT(DISTINCT c.id) as total_car_listings,
    COUNT(DISTINCT b.id) as total_bike_listings,
    COUNT(DISTINCT p.id) as total_plate_listings,
    COUNT(DISTINCT cp.id) as total_part_listings
FROM public.users u
LEFT JOIN public.cars c ON c.user_id = u.id
LEFT JOIN public.bikes b ON b.user_id = u.id
LEFT JOIN public.license_plates p ON p.user_id = u.id
LEFT JOIN public.car_parts cp ON cp.user_id = u.id
WHERE u.is_dealer = true
GROUP BY u.id;

-- Grant permissions
GRANT SELECT ON public.dealer_users TO authenticated;
GRANT SELECT ON public.dealer_users TO service_role;

-- Add comments for documentation
COMMENT ON COLUMN public.users.is_dealer IS 'Flag indicating if user is a dealer/business';
COMMENT ON COLUMN public.users.dealer_verified IS 'Flag indicating if dealer status has been verified by admin';
COMMENT ON COLUMN public.users.dealer_verification_requested_at IS 'Timestamp when dealer verification was requested';
COMMENT ON COLUMN public.users.company_name IS 'Business/Company name for dealers';
COMMENT ON COLUMN public.users.company_registration_number IS 'Official company registration number';
COMMENT ON COLUMN public.users.trade_license_number IS 'Trade license number for UAE businesses';
COMMENT ON COLUMN public.users.profile_completion_percentage IS 'Automatically calculated profile completion percentage (0-100)';
COMMENT ON COLUMN public.users.account_status IS 'Current account status (active, suspended, banned, pending_verification)';

-- Update profile completion for existing users
UPDATE public.users 
SET profile_completion_percentage = public.calculate_profile_completion(id);

-- Create a function to get user statistics
CREATE OR REPLACE FUNCTION public.get_user_statistics(user_id UUID)
RETURNS TABLE(
    total_listings INTEGER,
    active_listings INTEGER,
    sold_listings INTEGER,
    pending_listings INTEGER,
    total_views INTEGER,
    member_since TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*)::INTEGER FROM (
            SELECT id FROM public.cars WHERE user_id = get_user_statistics.user_id
            UNION ALL
            SELECT id FROM public.bikes WHERE user_id = get_user_statistics.user_id
            UNION ALL
            SELECT id FROM public.license_plates WHERE user_id = get_user_statistics.user_id
            UNION ALL
            SELECT id FROM public.car_parts WHERE user_id = get_user_statistics.user_id
        ) AS all_listings) as total_listings,
        
        (SELECT COUNT(*)::INTEGER FROM (
            SELECT id FROM public.cars WHERE user_id = get_user_statistics.user_id AND status = 'approved'
            UNION ALL
            SELECT id FROM public.bikes WHERE user_id = get_user_statistics.user_id AND status = 'approved'
            UNION ALL
            SELECT id FROM public.license_plates WHERE user_id = get_user_statistics.user_id AND status = 'approved'
            UNION ALL
            SELECT id FROM public.car_parts WHERE user_id = get_user_statistics.user_id AND status = 'approved'
        ) AS active) as active_listings,
        
        0::INTEGER as sold_listings, -- Placeholder for future sold tracking
        
        (SELECT COUNT(*)::INTEGER FROM (
            SELECT id FROM public.cars WHERE user_id = get_user_statistics.user_id AND status = 'pending'
            UNION ALL
            SELECT id FROM public.bikes WHERE user_id = get_user_statistics.user_id AND status = 'pending'
            UNION ALL
            SELECT id FROM public.license_plates WHERE user_id = get_user_statistics.user_id AND status = 'pending'
            UNION ALL
            SELECT id FROM public.car_parts WHERE user_id = get_user_statistics.user_id AND status = 'pending'
        ) AS pending) as pending_listings,
        
        (SELECT COALESCE(SUM(view_count), 0)::INTEGER FROM (
            SELECT COALESCE(view_count, 0) as view_count FROM public.cars WHERE user_id = get_user_statistics.user_id
            UNION ALL
            SELECT COALESCE(view_count, 0) FROM public.bikes WHERE user_id = get_user_statistics.user_id
            UNION ALL
            SELECT COALESCE(view_count, 0) FROM public.license_plates WHERE user_id = get_user_statistics.user_id
        ) AS all_views) as total_views,
        
        (SELECT created_at FROM public.users WHERE id = get_user_statistics.user_id) as member_since;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_user_statistics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_statistics(UUID) TO service_role;

