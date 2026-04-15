-- ============================================
-- Additional Supabase Indexes (only adds missing ones)
-- ============================================

-- Cars - ordering and filtering
CREATE INDEX IF NOT EXISTS idx_cars_created_at ON cars(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_car_manufacturer ON cars(car_manufacturer);
CREATE INDEX IF NOT EXISTS idx_cars_car_model ON cars(car_model);
CREATE INDEX IF NOT EXISTS idx_cars_expected_selling_price ON cars(expected_selling_price);
CREATE INDEX IF NOT EXISTS idx_cars_car_city ON cars(car_city);
CREATE INDEX IF NOT EXISTS idx_cars_make_year ON cars(make_year DESC);

-- Bikes - ordering and filtering
CREATE INDEX IF NOT EXISTS idx_bikes_created_at ON bikes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_make ON bikes(make);
CREATE INDEX IF NOT EXISTS idx_bikes_model ON bikes(model);
CREATE INDEX IF NOT EXISTS idx_bikes_price ON bikes(price);
CREATE INDEX IF NOT EXISTS idx_bikes_location ON bikes(location);

-- Car parts - ordering and filtering (uses part_type, not category)
CREATE INDEX IF NOT EXISTS idx_car_parts_created_at ON car_parts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_car_parts_part_type ON car_parts(part_type);
CREATE INDEX IF NOT EXISTS idx_car_parts_price ON car_parts(price);
CREATE INDEX IF NOT EXISTS idx_car_parts_emirate ON car_parts(emirate);

-- License plates - ordering and filtering
CREATE INDEX IF NOT EXISTS idx_license_plates_created_at ON license_plates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_plates_city ON license_plates(city);
CREATE INDEX IF NOT EXISTS idx_license_plates_price ON license_plates(price);
CREATE INDEX IF NOT EXISTS idx_license_plates_number ON license_plates(number);

-- For listing expiry jobs (critical!)
CREATE INDEX IF NOT EXISTS idx_cars_expires_at ON cars(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_bikes_expires_at ON bikes(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_car_parts_expires_at ON car_parts(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_license_plates_expires_at ON license_plates(expires_at) WHERE status = 'active';

-- Analyze for query planner
ANALYZE cars;
ANALYZE bikes;
ANALYZE car_parts;
ANALYZE license_plates;