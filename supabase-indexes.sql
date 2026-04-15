-- ============================================
-- Supabase Database Indexes for Performance
-- ============================================

-- Cars table indexes
CREATE INDEX IF NOT EXISTS idx_cars_status ON cars(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_cars_created_at ON cars(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_user_id ON cars(user_id);
CREATE INDEX IF NOT EXISTS idx_cars_car_manufacturer ON cars(car_manufacturer);
CREATE INDEX IF NOT EXISTS idx_cars_car_model ON cars(car_model);
CREATE INDEX IF NOT EXISTS idx_cars_make_year ON cars(make_year DESC);
CREATE INDEX IF NOT EXISTS idx_cars_expected_selling_price ON cars(expected_selling_price);
CREATE INDEX IF NOT EXISTS idx_cars_city ON cars(city);

-- Bikes table indexes
CREATE INDEX IF NOT EXISTS idx_bikes_status ON bikes(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bikes_created_at ON bikes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_user_id ON bikes(user_id);
CREATE INDEX IF NOT EXISTS idx_bikes_manufacturer ON bikes(manufacturer);
CREATE INDEX IF NOT EXISTS idx_bikes_model ON bikes(model);
CREATE INDEX IF NOT EXISTS idx_bikes_price ON bikes(price);
CREATE INDEX IF NOT EXISTS idx_bikes_location ON bikes(location);

-- Car parts table indexes
CREATE INDEX IF NOT EXISTS idx_car_parts_status ON car_parts(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_car_parts_created_at ON car_parts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_car_parts_user_id ON car_parts(user_id);
CREATE INDEX IF NOT EXISTS idx_car_parts_category ON car_parts(category);
CREATE INDEX IF NOT EXISTS idx_car_parts_price ON car_parts(price);
CREATE INDEX IF NOT EXISTS idx_car_parts_emirate ON car_parts(emirate);

-- License plates table indexes
CREATE INDEX IF NOT EXISTS idx_license_plates_status ON license_plates(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_license_plates_created_at ON license_plates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_plates_user_id ON license_plates(user_id);
CREATE INDEX IF NOT EXISTS idx_license_plates_city ON license_plates(city);
CREATE INDEX IF NOT EXISTS idx_license_plates_price ON license_plates(price);
CREATE INDEX IF NOT EXISTS idx_license_plates_number ON license_plates(number);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_cars_location_price ON cars(city, expected_selling_price);
CREATE INDEX IF NOT EXISTS idx_cars_make_model ON cars(car_manufacturer, car_model);
CREATE INDEX IF NOT EXISTS idx_bikes_location_price ON bikes(location, price);

-- Listings lifecycle indexes (for expiry jobs)
CREATE INDEX IF NOT EXISTS idx_cars_expires_at ON cars(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bikes_expires_at ON bikes(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_car_parts_expires_at ON car_parts(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_license_plates_expires_at ON license_plates(expires_at) WHERE status = 'active';

-- Enable parallel queries for better performance
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;

-- Analyze tables to update statistics
ANALYZE cars;
ANALYZE bikes;
ANALYZE car_parts;
ANALYZE license_plates;