-- Add is_primary column to plate_images table
ALTER TABLE IF EXISTS public.plate_images 
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false;

-- Create plate_images table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.plate_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plate_id UUID REFERENCES public.license_plates(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS
ALTER TABLE public.plate_images ENABLE ROW LEVEL SECURITY;

-- Policies for plate_images
DROP POLICY IF EXISTS "Anyone can view plate images" ON public.plate_images;
CREATE POLICY "Anyone can view plate images" ON public.plate_images
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Users can insert their own plate images" ON public.plate_images;
CREATE POLICY "Users can insert their own plate images" ON public.plate_images
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.license_plates
            WHERE license_plates.id = plate_images.plate_id
            AND license_plates.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update their own plate images" ON public.plate_images;
CREATE POLICY "Users can update their own plate images" ON public.plate_images
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.license_plates
            WHERE license_plates.id = plate_images.plate_id
            AND license_plates.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete their own plate images" ON public.plate_images;
CREATE POLICY "Users can delete their own plate images" ON public.plate_images
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.license_plates
            WHERE license_plates.id = plate_images.plate_id
            AND license_plates.user_id = auth.uid()
        )
    ); 