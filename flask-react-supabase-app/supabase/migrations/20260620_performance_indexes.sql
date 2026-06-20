-- Plain btree indexes on filter and sort columns. IF NOT EXISTS makes this
-- safe to run multiple times and causes no downtime on small tables.

-- cars
CREATE INDEX IF NOT EXISTS idx_cars_status ON cars (status);
CREATE INDEX IF NOT EXISTS idx_cars_manufacturer ON cars (car_manufacturer);
CREATE INDEX IF NOT EXISTS idx_cars_model ON cars (car_model);
CREATE INDEX IF NOT EXISTS idx_cars_created_at ON cars (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_price ON cars (expected_selling_price);

-- bikes
CREATE INDEX IF NOT EXISTS idx_bikes_status ON bikes (status);
CREATE INDEX IF NOT EXISTS idx_bikes_created_at ON bikes (created_at DESC);

-- license_plates
CREATE INDEX IF NOT EXISTS idx_plates_status ON license_plates (status);
CREATE INDEX IF NOT EXISTS idx_plates_created_at ON license_plates (created_at DESC);

-- car_parts
CREATE INDEX IF NOT EXISTS idx_parts_status ON car_parts (status);
CREATE INDEX IF NOT EXISTS idx_parts_created_at ON car_parts (created_at DESC);
