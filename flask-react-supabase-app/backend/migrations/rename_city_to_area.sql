-- City to Area Migration
-- This migration renames city columns to area for consistency and adds emirate columns

-- IMPORTANT: Run this migration during low-traffic period
-- Backup your database before running this migration

-- Step 1: Add new columns (non-breaking)
ALTER TABLE cars ADD COLUMN IF NOT EXISTS area VARCHAR(100);
ALTER TABLE cars ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);

ALTER TABLE bikes ADD COLUMN IF NOT EXISTS area VARCHAR(100);
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);

ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS area VARCHAR(100);
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);

ALTER TABLE car_parts ADD COLUMN IF NOT EXISTS area VARCHAR(100);
ALTER TABLE car_parts ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);

ALTER TABLE users ADD COLUMN IF NOT EXISTS emirate VARCHAR(50);

-- Step 2: Copy data from old columns to new columns
UPDATE cars SET area = car_city WHERE car_city IS NOT NULL AND area IS NULL;
UPDATE bikes SET area = city WHERE city IS NOT NULL AND area IS NULL;
UPDATE license_plates SET emirate = city WHERE city IS NOT NULL AND emirate IS NULL;
UPDATE car_parts SET area = city WHERE city IS NOT NULL AND area IS NULL;

-- Step 3: Create indexes on new columns
CREATE INDEX IF NOT EXISTS idx_cars_area ON cars(area);
CREATE INDEX IF NOT EXISTS idx_cars_emirate ON cars(emirate);
CREATE INDEX IF NOT EXISTS idx_bikes_area ON bikes(area);
CREATE INDEX IF NOT EXISTS idx_bikes_emirate ON bikes(emirate);
CREATE INDEX IF NOT EXISTS idx_plates_emirate ON license_plates(emirate);
CREATE INDEX IF NOT EXISTS idx_plates_area ON license_plates(area);
CREATE INDEX IF NOT EXISTS idx_parts_area ON car_parts(area);
CREATE INDEX IF NOT EXISTS idx_parts_emirate ON car_parts(emirate);
CREATE INDEX IF NOT EXISTS idx_users_emirate ON users(emirate);

-- Step 4: Drop old indexes (optional - only after verifying new columns work)
-- DROP INDEX IF EXISTS idx_cars_city;
-- DROP INDEX IF EXISTS idx_plates_city;

-- Step 5: Keep old columns for backward compatibility (recommended)
-- DO NOT drop old columns yet - wait until all code is updated
-- After full deployment and verification, you can run:
-- ALTER TABLE cars DROP COLUMN IF EXISTS car_city;
-- ALTER TABLE bikes DROP COLUMN IF EXISTS city;
-- ALTER TABLE license_plates DROP COLUMN IF EXISTS city;
-- ALTER TABLE car_parts DROP COLUMN IF EXISTS city;

-- Verification queries
SELECT 
    'cars' as table_name,
    COUNT(*) as total_rows,
    COUNT(car_city) as old_city_count,
    COUNT(area) as new_area_count,
    COUNT(emirate) as emirate_count
FROM cars
UNION ALL
SELECT 
    'bikes' as table_name,
    COUNT(*) as total_rows,
    COUNT(city) as old_city_count,
    COUNT(area) as new_area_count,
    COUNT(emirate) as emirate_count
FROM bikes
UNION ALL
SELECT 
    'license_plates' as table_name,
    COUNT(*) as total_rows,
    COUNT(city) as old_city_count,
    COUNT(area) as new_area_count,
    COUNT(emirate) as emirate_count
FROM license_plates;
