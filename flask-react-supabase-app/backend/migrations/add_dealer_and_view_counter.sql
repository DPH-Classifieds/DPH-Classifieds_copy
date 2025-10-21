-- Add dealer field and view counter to cars table
ALTER TABLE cars 
ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

-- Add dealer field and view counter to bikes table
ALTER TABLE bikes 
ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

-- Add dealer field and view counter to license_plates table
ALTER TABLE license_plates 
ADD COLUMN IF NOT EXISTS is_dealer BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_cars_is_dealer ON cars(is_dealer);
CREATE INDEX IF NOT EXISTS idx_cars_view_count ON cars(view_count);
CREATE INDEX IF NOT EXISTS idx_bikes_is_dealer ON bikes(is_dealer);
CREATE INDEX IF NOT EXISTS idx_bikes_view_count ON bikes(view_count);
CREATE INDEX IF NOT EXISTS idx_license_plates_is_dealer ON license_plates(is_dealer);
CREATE INDEX IF NOT EXISTS idx_license_plates_view_count ON license_plates(view_count);

-- Create a view tracking table for detailed analytics
CREATE TABLE IF NOT EXISTS listing_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_type VARCHAR(20) NOT NULL, -- 'car', 'bike', 'plate'
    listing_id UUID NOT NULL,
    viewer_ip VARCHAR(45), -- IPv6 support
    user_agent TEXT,
    viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id UUID -- Track if viewer is logged in
);

-- Create indexes for the view tracking table
CREATE INDEX IF NOT EXISTS idx_listing_views_listing_type ON listing_views(listing_type);
CREATE INDEX IF NOT EXISTS idx_listing_views_listing_id ON listing_views(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_views_viewed_at ON listing_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_listing_views_user_id ON listing_views(user_id);

-- Enable RLS on the view tracking table
ALTER TABLE listing_views ENABLE ROW LEVEL SECURITY;

-- Policy for listing_views: users can insert their own views, admins can read all
CREATE POLICY "Users can insert their own views" 
ON listing_views 
FOR INSERT 
WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can view their own listing views" 
ON listing_views 
FOR SELECT 
USING (user_id = auth.uid() OR user_id IS NULL);

-- Function to increment view count
CREATE OR REPLACE FUNCTION increment_view_count(
    p_listing_type VARCHAR(20),
    p_listing_id UUID,
    p_viewer_ip VARCHAR(45) DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    new_count INTEGER;
BEGIN
    -- Insert view record
    INSERT INTO listing_views (listing_type, listing_id, viewer_ip, user_agent, user_id)
    VALUES (p_listing_type, p_listing_id, p_viewer_ip, p_user_agent, p_user_id);
    
    -- Update view count based on listing type
    IF p_listing_type = 'car' THEN
        UPDATE cars SET view_count = view_count + 1 WHERE id = p_listing_id RETURNING view_count INTO new_count;
    ELSIF p_listing_type = 'bike' THEN
        UPDATE bikes SET view_count = view_count + 1 WHERE id = p_listing_id RETURNING view_count INTO new_count;
    ELSIF p_listing_type = 'plate' THEN
        UPDATE license_plates SET view_count = view_count + 1 WHERE id = p_listing_id RETURNING view_count INTO new_count;
    END IF;
    
    RETURN new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION increment_view_count TO authenticated;
GRANT EXECUTE ON FUNCTION increment_view_count TO anon;
