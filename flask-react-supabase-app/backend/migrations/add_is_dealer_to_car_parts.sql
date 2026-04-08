-- Add is_dealer column to car_parts table if it doesn't exist
ALTER TABLE car_parts ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE;

-- Add index for is_dealer column
CREATE INDEX IF NOT EXISTS idx_car_parts_is_dealer ON car_parts(is_dealer);

COMMENT ON COLUMN car_parts.is_dealer IS 'Whether the seller is a dealer';
