-- Add user_id column to license_plates table
ALTER TABLE license_plates
ADD COLUMN user_id UUID;

-- Create plate_images table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'plate_images') THEN
        CREATE TABLE plate_images (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            plate_id UUID REFERENCES license_plates(id) ON DELETE CASCADE,
            image_url TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        -- Enable RLS for plate_images
        ALTER TABLE plate_images ENABLE ROW LEVEL SECURITY;

        -- Policy for plate_images: users can view all images, but only edit their own
        CREATE POLICY "Users can view all plate images" 
        ON plate_images FOR SELECT 
        USING (true);

        CREATE POLICY "Users can insert their own plate images" 
        ON plate_images FOR INSERT 
        WITH CHECK (true);

        CREATE POLICY "Users can update their own plate images" 
        ON plate_images FOR UPDATE 
        USING (true);

        CREATE POLICY "Users can delete their own plate images" 
        ON plate_images FOR DELETE 
        USING (true);
    END IF;
END $$; 