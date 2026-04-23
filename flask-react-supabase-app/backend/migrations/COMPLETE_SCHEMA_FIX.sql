-- ============================================================
-- DPH Classifieds - Complete Supabase Schema Fix
-- Run this in Supabase SQL Editor to fix all schema issues
-- ============================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create or fix users table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    profile_photo_url TEXT,
    is_dealer BOOLEAN DEFAULT FALSE,
    dealer_verified BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    phone_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create or fix cars table
CREATE TABLE IF NOT EXISTS public.cars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    car_manufacturer VARCHAR(100) NOT NULL,
    car_model VARCHAR(100) NOT NULL,
    trim VARCHAR(100),
    regional_spec VARCHAR(25) NOT NULL,
    make_year INT NOT NULL,
    kilometer_driven INT,
    body_type VARCHAR(100),
    is_insured BOOLEAN DEFAULT FALSE,
    expected_selling_price INT NOT NULL,
    car_owner_phone_number VARCHAR(20),
    country_code VARCHAR(10) DEFAULT '+971',
    whatsapp_number VARCHAR(30),
    whatsapp_prefill_text TEXT,
    vin_number VARCHAR(50),
    car_city VARCHAR(50) NOT NULL,
    listing_title VARCHAR(200) NOT NULL,
    tour_url VARCHAR(400),
    car_description TEXT,
    fuel_type VARCHAR(50) NOT NULL,
    transmission_type VARCHAR(25) NOT NULL,
    seating_capacity VARCHAR(25),
    horsepower VARCHAR(25) NOT NULL,
    engine_capacity VARCHAR(25),
    steering_side VARCHAR(25) NOT NULL,
    color VARCHAR(50),
    cylinders VARCHAR(25),
    doors VARCHAR(25),
    warranty VARCHAR(100),
    service_history VARCHAR(100),
    car_location VARCHAR(200),
    area VARCHAR(100),
    emirate VARCHAR(50),
    vehicle_type VARCHAR(25) NOT NULL DEFAULT 'Used',
    is_approved BOOLEAN DEFAULT FALSE,
    is_dealer BOOLEAN DEFAULT FALSE,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    -- Extras/Features
    climate_control BOOLEAN DEFAULT FALSE,
    dvd_player BOOLEAN DEFAULT FALSE,
    keyless_entry BOOLEAN DEFAULT FALSE,
    navigation_system BOOLEAN DEFAULT FALSE,
    premium_sound_system BOOLEAN DEFAULT FALSE,
    cooled_seats BOOLEAN DEFAULT FALSE,
    front_wheel_drive BOOLEAN DEFAULT FALSE,
    leather_seats BOOLEAN DEFAULT FALSE,
    parking_sensors BOOLEAN DEFAULT FALSE,
    rear_view_camera BOOLEAN DEFAULT FALSE,
    lady_driven BOOLEAN DEFAULT FALSE,
    mallu_doctor_driven BOOLEAN DEFAULT FALSE,
    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_note TEXT,
    -- Lifecycle
    expires_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    retention_expires_at TIMESTAMPTZ,
    last_extended_at TIMESTAMPTZ,
    extension_count INT DEFAULT 0,
    is_archived BOOLEAN DEFAULT FALSE,
    -- Sold status
    sold_status TEXT CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    sold_status_set_at TIMESTAMPTZ,
    sold_response_deadline TIMESTAMPTZ,
    auto_removed_at TIMESTAMPTZ,
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create car_images table
CREATE TABLE IF NOT EXISTS public.car_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    car_id UUID REFERENCES public.cars ON DELETE CASCADE NOT NULL,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create bikes table
CREATE TABLE IF NOT EXISTS public.bikes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    bike_brand VARCHAR(100),
    bike_model VARCHAR(100),
    year INT,
    bike_type VARCHAR(50),
    engine_size VARCHAR(50),
    mileage INT,
    color VARCHAR(50),
    condition VARCHAR(50),
    price INT,
    location VARCHAR(200),
    area VARCHAR(100),
    emirate VARCHAR(50),
    description TEXT,
    contact_number VARCHAR(30),
    country_code VARCHAR(10) DEFAULT '+971',
    whatsapp_number VARCHAR(30),
    whatsapp_prefill_text TEXT,
    vin_number VARCHAR(50),
    is_dealer BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_note TEXT,
    expires_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    retention_expires_at TIMESTAMPTZ,
    last_extended_at TIMESTAMPTZ,
    extension_count INT DEFAULT 0,
    is_archived BOOLEAN DEFAULT FALSE,
    sold_status TEXT CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    sold_status_set_at TIMESTAMPTZ,
    sold_response_deadline TIMESTAMPTZ,
    auto_removed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create bike_images table
CREATE TABLE IF NOT EXISTS public.bike_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bike_id UUID REFERENCES public.bikes ON DELETE CASCADE NOT NULL,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Create car_parts table
CREATE TABLE IF NOT EXISTS public.car_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    name VARCHAR(200) NOT NULL,
    part_type VARCHAR(100),
    condition VARCHAR(50),
    price INT,
    location VARCHAR(200),
    area VARCHAR(100),
    emirate VARCHAR(50),
    description TEXT,
    contact_number VARCHAR(30),
    country_code VARCHAR(10) DEFAULT '+971',
    whatsapp_number VARCHAR(30),
    whatsapp_prefill_text TEXT,
    is_negotiable BOOLEAN DEFAULT FALSE,
    is_dealer BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_note TEXT,
    expires_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    retention_expires_at TIMESTAMPTZ,
    last_extended_at TIMESTAMPTZ,
    extension_count INT DEFAULT 0,
    is_archived BOOLEAN DEFAULT FALSE,
    sold_status TEXT CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    sold_status_set_at TIMESTAMPTZ,
    sold_response_deadline TIMESTAMPTZ,
    auto_removed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Create part_images table
CREATE TABLE IF NOT EXISTS public.part_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_id UUID REFERENCES public.car_parts ON DELETE CASCADE NOT NULL,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Create license_plates table
CREATE TABLE IF NOT EXISTS public.license_plates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    city VARCHAR(100),
    code VARCHAR(100),
    digits VARCHAR(100),
    number VARCHAR(100),
    plate_format VARCHAR(100),
    price DECIMAL(10,2),
    contact_name VARCHAR(100),
    contact_phone VARCHAR(30),
    country_code VARCHAR(10) DEFAULT '+971',
    whatsapp_number VARCHAR(30),
    whatsapp_prefill_text TEXT,
    area VARCHAR(100),
    emirate VARCHAR(50),
    description TEXT,
    is_dealer BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_note TEXT,
    expires_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    retention_expires_at TIMESTAMPTZ,
    last_extended_at TIMESTAMPTZ,
    extension_count INT DEFAULT 0,
    is_archived BOOLEAN DEFAULT FALSE,
    sold_status TEXT CHECK (sold_status IN ('sold_on_dph', 'sold_elsewhere', 'not_sold_renew')),
    sold_status_set_at TIMESTAMPTZ,
    sold_response_deadline TIMESTAMPTZ,
    auto_removed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Create plate_images table
CREATE TABLE IF NOT EXISTS public.plate_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_id UUID REFERENCES public.license_plates ON DELETE CASCADE NOT NULL,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    is_primary BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Create lead_events table
CREATE TABLE IF NOT EXISTS public.lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'part', 'plate')),
    action TEXT NOT NULL CHECK (action IN ('call_click', 'whatsapp_click', 'vin_open', 'vin_reveal')),
    user_id UUID NULL,
    session_id TEXT NULL,
    source TEXT NULL,
    user_agent TEXT NULL,
    ip_address TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 12. Create listing_deletion_events table
CREATE TABLE IF NOT EXISTS public.listing_deletion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'part', 'plate')),
    deleted_by UUID NULL,
    deleted_by_role TEXT NOT NULL CHECK (deleted_by_role IN ('admin', 'system', 'user')),
    reason TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 13. Create indexes
CREATE INDEX IF NOT EXISTS idx_cars_user_id ON public.cars(user_id);
CREATE INDEX IF NOT EXISTS idx_cars_status ON public.cars(status);
CREATE INDEX IF NOT EXISTS idx_cars_is_approved ON public.cars(is_approved);
CREATE INDEX IF NOT EXISTS idx_cars_created_at ON public.cars(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_car_images_car_id ON public.car_images(car_id);
CREATE INDEX IF NOT EXISTS idx_bikes_user_id ON public.bikes(user_id);
CREATE INDEX IF NOT EXISTS idx_bike_images_bike_id ON public.bike_images(bike_id);
CREATE INDEX IF NOT EXISTS idx_car_parts_user_id ON public.car_parts(user_id);
CREATE INDEX IF NOT EXISTS idx_part_images_part_id ON public.part_images(part_id);
CREATE INDEX IF NOT EXISTS idx_license_plates_user_id ON public.license_plates(user_id);
CREATE INDEX IF NOT EXISTS idx_plate_images_plate_id ON public.plate_images(plate_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_listing ON public.lead_events(listing_type, listing_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_action ON public.lead_events(action);
CREATE INDEX IF NOT EXISTS idx_lead_events_created_at ON public.lead_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_deletion_events_listing ON public.listing_deletion_events(listing_type, listing_id);

-- 14. Add missing columns to existing tables (safe ALTER TABLE IF NOT EXISTS)
DO $$
BEGIN
    -- Cars table
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) DEFAULT '+971';
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(30);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS whatsapp_prefill_text TEXT;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS vin_number VARCHAR(50);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS color VARCHAR(50);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS cylinders VARCHAR(25);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS doors VARCHAR(25);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS warranty VARCHAR(100);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS service_history VARCHAR(100);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS area VARCHAR(100);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7);
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS lady_driven BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS mallu_doctor_driven BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS rejection_note TEXT;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS last_extended_at TIMESTAMPTZ;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS extension_count INT DEFAULT 0;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS sold_status TEXT;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS sold_status_set_at TIMESTAMPTZ;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS sold_response_deadline TIMESTAMPTZ;
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS auto_removed_at TIMESTAMPTZ;

    -- Car images table
    ALTER TABLE public.car_images ADD COLUMN IF NOT EXISTS url TEXT;
    ALTER TABLE public.car_images ADD COLUMN IF NOT EXISTS display_url TEXT;
    ALTER TABLE public.car_images ADD COLUMN IF NOT EXISTS focal_x NUMERIC(5,2) DEFAULT 50;
    ALTER TABLE public.car_images ADD COLUMN IF NOT EXISTS focal_y NUMERIC(5,2) DEFAULT 50;
    ALTER TABLE public.car_images ADD COLUMN IF NOT EXISTS crop_meta JSONB;

    -- Users table
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30);
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dealer_verified BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_confirmed_at TIMESTAMPTZ;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

EXCEPTION WHEN duplicate_column THEN
    NULL;
END $$;

-- 15. RLS Policies
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_plates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plate_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_deletion_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate cleanly
DROP POLICY IF EXISTS "Public read approved cars" ON public.cars;
DROP POLICY IF EXISTS "Users read own cars" ON public.cars;
DROP POLICY IF EXISTS "Service role all cars" ON public.cars;
DROP POLICY IF EXISTS "Public read car images" ON public.car_images;
DROP POLICY IF EXISTS "Service role all car images" ON public.car_images;

-- Cars policies
CREATE POLICY "Public read approved cars" ON public.cars FOR SELECT USING (status = 'approved' OR is_approved = TRUE);
CREATE POLICY "Users read own cars" ON public.cars FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own cars" ON public.cars FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own cars" ON public.cars FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own cars" ON public.cars FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role all cars" ON public.cars FOR ALL USING (true) WITH CHECK (true);

-- Car images policies
CREATE POLICY "Public read car images" ON public.car_images FOR SELECT USING (true);
CREATE POLICY "Service role all car images" ON public.car_images FOR ALL USING (true) WITH CHECK (true);

-- Similar policies for other tables
CREATE POLICY "Public read approved bikes" ON public.bikes FOR SELECT USING (status = 'approved' OR is_approved = TRUE);
CREATE POLICY "Users read own bikes" ON public.bikes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bikes" ON public.bikes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own bikes" ON public.bikes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role all bikes" ON public.bikes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read bike images" ON public.bike_images FOR SELECT USING (true);
CREATE POLICY "Service role all bike images" ON public.bike_images FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read approved parts" ON public.car_parts FOR SELECT USING (status = 'approved' OR is_approved = TRUE);
CREATE POLICY "Users read own parts" ON public.car_parts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own parts" ON public.car_parts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own parts" ON public.car_parts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role all parts" ON public.car_parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read part images" ON public.part_images FOR SELECT USING (true);
CREATE POLICY "Service role all part images" ON public.part_images FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read approved plates" ON public.license_plates FOR SELECT USING (status = 'approved' OR is_approved = TRUE);
CREATE POLICY "Users read own plates" ON public.license_plates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own plates" ON public.license_plates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own plates" ON public.license_plates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role all plates" ON public.license_plates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read plate images" ON public.plate_images FOR SELECT USING (true);
CREATE POLICY "Service role all plate images" ON public.plate_images FOR ALL USING (true) WITH CHECK (true);

-- Lead events and deletion events
CREATE POLICY "Service role all lead events" ON public.lead_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role all deletion events" ON public.listing_deletion_events FOR ALL USING (true) WITH CHECK (true);

-- 16. Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
