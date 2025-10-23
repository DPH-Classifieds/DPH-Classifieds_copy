-- Performance Indexes Migration
-- This migration adds indexes to frequently queried columns for better performance

-- Cars table indexes
CREATE INDEX IF NOT EXISTS idx_cars_manufacturer ON cars(car_manufacturer);
CREATE INDEX IF NOT EXISTS idx_cars_model ON cars(car_model);
CREATE INDEX IF NOT EXISTS idx_cars_year ON cars(make_year);
CREATE INDEX IF NOT EXISTS idx_cars_price ON cars(expected_selling_price);
CREATE INDEX IF NOT EXISTS idx_cars_status ON cars(status);
CREATE INDEX IF NOT EXISTS idx_cars_created_desc ON cars(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_user_id ON cars(user_id);
CREATE INDEX IF NOT EXISTS idx_cars_approved ON cars(is_approved) WHERE is_approved = true;
CREATE INDEX IF NOT EXISTS idx_cars_city ON cars(car_city);

-- Bikes table indexes
CREATE INDEX IF NOT EXISTS idx_bikes_make ON bikes(make);
CREATE INDEX IF NOT EXISTS idx_bikes_model ON bikes(model);
CREATE INDEX IF NOT EXISTS idx_bikes_year ON bikes(make_year);
CREATE INDEX IF NOT EXISTS idx_bikes_status ON bikes(status);
CREATE INDEX IF NOT EXISTS idx_bikes_created_desc ON bikes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_user_id ON bikes(user_id);

-- License plates indexes
CREATE INDEX IF NOT EXISTS idx_plates_city ON license_plates(city);
CREATE INDEX IF NOT EXISTS idx_plates_code ON license_plates(code);
CREATE INDEX IF NOT EXISTS idx_plates_status ON license_plates(status);
CREATE INDEX IF NOT EXISTS idx_plates_created_desc ON license_plates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plates_user_id ON license_plates(user_id);

-- Car parts indexes
CREATE INDEX IF NOT EXISTS idx_parts_status ON car_parts(status);
CREATE INDEX IF NOT EXISTS idx_parts_created_desc ON car_parts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_user_id ON car_parts(user_id);

-- Reports table indexes
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_listing_id ON reports(listing_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_desc ON reports(created_at DESC);

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS idx_users_is_dealer ON users(is_dealer) WHERE is_dealer = true;
CREATE INDEX IF NOT EXISTS idx_users_dealer_verified ON users(dealer_verified) WHERE dealer_verified = true;

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_cars_status_created ON cars(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_manufacturer_model ON cars(car_manufacturer, car_model);
CREATE INDEX IF NOT EXISTS idx_cars_price_year ON cars(expected_selling_price, make_year);

-- Verify indexes were created
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
    AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
