-- Add view tracking columns to all listing tables

-- Cars table
ALTER TABLE cars ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

-- Bikes table
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE bikes ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

-- License plates table
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE license_plates ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

-- Car parts table
ALTER TABLE car_parts ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;
ALTER TABLE car_parts ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_cars_view_count ON cars(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_view_count ON bikes(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_license_plates_view_count ON license_plates(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_car_parts_view_count ON car_parts(view_count DESC);

-- Create a function to increment view count
CREATE OR REPLACE FUNCTION increment_view_count(table_name TEXT, listing_id UUID)
RETURNS void AS $$
BEGIN
  EXECUTE format('
    UPDATE %I 
    SET view_count = COALESCE(view_count, 0) + 1,
        last_viewed_at = NOW()
    WHERE id = $1
  ', table_name)
  USING listing_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION increment_view_count(TEXT, UUID) TO authenticated, anon;
