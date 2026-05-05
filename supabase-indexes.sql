-- ============================================
-- Additional Supabase Indexes (only adds missing ones)
-- ============================================

-- Cars - ordering and filtering
CREATE INDEX IF NOT EXISTS idx_cars_created_at ON cars(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_public_feed ON cars(status, is_approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_user_id ON cars(user_id);
CREATE INDEX IF NOT EXISTS idx_cars_car_manufacturer ON cars(car_manufacturer);
CREATE INDEX IF NOT EXISTS idx_cars_car_model ON cars(car_model);
CREATE INDEX IF NOT EXISTS idx_cars_expected_selling_price ON cars(expected_selling_price);
CREATE INDEX IF NOT EXISTS idx_cars_car_city ON cars(car_city);
CREATE INDEX IF NOT EXISTS idx_cars_make_year ON cars(make_year DESC);
CREATE INDEX IF NOT EXISTS idx_car_images_car_id_created ON car_images(car_id, created_at ASC);

-- Bikes - ordering and filtering
CREATE INDEX IF NOT EXISTS idx_bikes_created_at ON bikes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_public_feed ON bikes(status, is_approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_user_id ON bikes(user_id);
CREATE INDEX IF NOT EXISTS idx_bikes_brand ON bikes(bike_brand);
CREATE INDEX IF NOT EXISTS idx_bikes_model ON bikes(bike_model);
CREATE INDEX IF NOT EXISTS idx_bikes_price ON bikes(expected_selling_price);
CREATE INDEX IF NOT EXISTS idx_bikes_location ON bikes(city);
CREATE INDEX IF NOT EXISTS idx_bike_images_bike_id_created ON bike_images(bike_id, created_at ASC);

-- Car parts - ordering and filtering (uses part_type, not category)
CREATE INDEX IF NOT EXISTS idx_car_parts_created_at ON car_parts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_car_parts_public_feed ON car_parts(status, is_approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_car_parts_user_id ON car_parts(user_id);
CREATE INDEX IF NOT EXISTS idx_car_parts_part_type ON car_parts(part_type);
CREATE INDEX IF NOT EXISTS idx_car_parts_price ON car_parts(price);
CREATE INDEX IF NOT EXISTS idx_car_parts_city ON car_parts(city);
CREATE INDEX IF NOT EXISTS idx_part_images_part_id_created ON part_images(part_id, created_at ASC);

-- License plates - ordering and filtering
CREATE INDEX IF NOT EXISTS idx_license_plates_created_at ON license_plates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_plates_public_feed ON license_plates(status, is_approved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_plates_user_id ON license_plates(user_id);
CREATE INDEX IF NOT EXISTS idx_license_plates_city ON license_plates(city);
CREATE INDEX IF NOT EXISTS idx_license_plates_price ON license_plates(price);
CREATE INDEX IF NOT EXISTS idx_license_plates_number ON license_plates(number);
CREATE INDEX IF NOT EXISTS idx_plate_images_plate_id_created ON plate_images(plate_id, created_at ASC);

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
