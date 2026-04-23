-- ============================================================
-- DPH Classifieds - Complete Supabase Schema Fix
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================

-- 1. Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Users table
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

-- 3. Cars table (with ALL columns the backend expects)
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

-- 4. Car images
CREATE TABLE IF NOT EXISTS public.car_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    car_id UUID REFERENCES public.cars(id) ON DELETE CASCADE,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Bikes
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

-- 6. Bike images
CREATE TABLE IF NOT EXISTS public.bike_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bike_id UUID REFERENCES public.bikes(id) ON DELETE CASCADE,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Car parts
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

-- 8. Part images
CREATE TABLE IF NOT EXISTS public.part_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_id UUID REFERENCES public.car_parts(id) ON DELETE CASCADE,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. License plates
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

-- 10. Plate images
CREATE TABLE IF NOT EXISTS public.plate_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_id UUID REFERENCES public.license_plates(id) ON DELETE CASCADE,
    url TEXT,
    image_url TEXT NOT NULL,
    display_url TEXT,
    focal_x NUMERIC(5,2) DEFAULT 50,
    focal_y NUMERIC(5,2) DEFAULT 50,
    crop_meta JSONB,
    is_primary BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Lead events
CREATE TABLE IF NOT EXISTS public.lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'part', 'plate')),
    action TEXT NOT NULL CHECK (action IN ('call_click', 'whatsapp_click', 'vin_open', 'vin_reveal')),
    user_id UUID,
    session_id TEXT,
    source TEXT,
    user_agent TEXT,
    ip_address TEXT,
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Listing deletion events
CREATE TABLE IF NOT EXISTS public.listing_deletion_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'part', 'plate')),
    deleted_by UUID,
    deleted_by_role TEXT NOT NULL CHECK (deleted_by_role IN ('admin', 'system', 'user')),
    reason TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Indexes
CREATE INDEX IF NOT EXISTS idx_cars_user_id ON public.cars(user_id);
CREATE INDEX IF NOT EXISTS idx_cars_status ON public.cars(status);
CREATE INDEX IF NOT EXISTS idx_cars_is_approved ON public.cars(is_approved);
CREATE INDEX IF NOT EXISTS idx_cars_make_year ON public.cars(make_year);
CREATE INDEX IF NOT EXISTS idx_cars_price ON public.cars(expected_selling_price);
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
CREATE INDEX IF NOT EXISTS idx_deletion_events_listing ON public.listing_deletion_events(listing_type, listing_id);

-- 14. RLS
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
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Service role bypass policies (all tables)
DROP POLICY IF EXISTS "svc_cars" ON public.cars;
CREATE POLICY "svc_cars" ON public.cars FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_car_images" ON public.car_images;
CREATE POLICY "svc_car_images" ON public.car_images FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_bikes" ON public.bikes;
CREATE POLICY "svc_bikes" ON public.bikes FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_bike_images" ON public.bike_images;
CREATE POLICY "svc_bike_images" ON public.bike_images FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_car_parts" ON public.car_parts;
CREATE POLICY "svc_car_parts" ON public.car_parts FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_part_images" ON public.part_images;
CREATE POLICY "svc_part_images" ON public.part_images FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_plates" ON public.license_plates;
CREATE POLICY "svc_plates" ON public.license_plates FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_plate_images" ON public.plate_images;
CREATE POLICY "svc_plate_images" ON public.plate_images FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_lead_events" ON public.lead_events;
CREATE POLICY "svc_lead_events" ON public.lead_events FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_deletion_events" ON public.listing_deletion_events;
CREATE POLICY "svc_deletion_events" ON public.listing_deletion_events FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "svc_users" ON public.users;
CREATE POLICY "svc_users" ON public.users FOR ALL USING (true) WITH CHECK (true);

-- Read policies for approved listings
DROP POLICY IF EXISTS "read_approved_cars" ON public.cars;
CREATE POLICY "read_approved_cars" ON public.cars FOR SELECT USING (status = 'approved' OR is_approved = TRUE);
DROP POLICY IF EXISTS "read_approved_bikes" ON public.bikes;
CREATE POLICY "read_approved_bikes" ON public.bikes FOR SELECT USING (status = 'approved' OR is_approved = TRUE);
DROP POLICY IF EXISTS "read_approved_parts" ON public.car_parts;
CREATE POLICY "read_approved_parts" ON public.car_parts FOR SELECT USING (status = 'approved' OR is_approved = TRUE);
DROP POLICY IF EXISTS "read_approved_plates" ON public.license_plates;
CREATE POLICY "read_approved_plates" ON public.license_plates FOR SELECT USING (status = 'approved' OR is_approved = TRUE);

-- Public read for images
DROP POLICY IF EXISTS "read_car_images" ON public.car_images;
CREATE POLICY "read_car_images" ON public.car_images FOR SELECT USING (true);
DROP POLICY IF EXISTS "read_bike_images" ON public.bike_images;
CREATE POLICY "read_bike_images" ON public.bike_images FOR SELECT USING (true);
DROP POLICY IF EXISTS "read_part_images" ON public.part_images;
CREATE POLICY "read_part_images" ON public.part_images FOR SELECT USING (true);
DROP POLICY IF EXISTS "read_plate_images" ON public.plate_images;
CREATE POLICY "read_plate_images" ON public.plate_images FOR SELECT USING (true);

-- 15. Grants
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Done! All tables created.
