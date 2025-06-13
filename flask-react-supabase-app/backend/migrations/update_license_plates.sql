-- Drop existing table if it exists
DROP TABLE IF EXISTS license_plates CASCADE;

-- Create license_plates table
CREATE TABLE license_plates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    city VARCHAR(100) DEFAULT 'All cities',
    code VARCHAR(100) DEFAULT 'All codes',
    digits VARCHAR(100) DEFAULT 'Any digits',
    price DECIMAL(10, 2),
    number VARCHAR(100),
    plate_format VARCHAR(100),
    contact_name VARCHAR(255),
    contact_phone VARCHAR(50),
    user_email VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE license_plates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view approved plates" ON license_plates;
DROP POLICY IF EXISTS "Users can view their own plates" ON license_plates;
DROP POLICY IF EXISTS "Users can create plates" ON license_plates;
DROP POLICY IF EXISTS "Users can update their own plates" ON license_plates;
DROP POLICY IF EXISTS "Users can delete their own plates" ON license_plates;
DROP POLICY IF EXISTS "Admins can view all plates" ON license_plates;
DROP POLICY IF EXISTS "Admins can update all plates" ON license_plates;
DROP POLICY IF EXISTS "Admins can create plates" ON license_plates;

-- Create policies
CREATE POLICY "Users can view approved plates" ON license_plates
    FOR SELECT
    USING (status = 'approved');

CREATE POLICY "Users can view their own plates" ON license_plates
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create plates" ON license_plates
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own plates" ON license_plates
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own plates" ON license_plates
    FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all plates" ON license_plates
    FOR SELECT
    USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update all plates" ON license_plates
    FOR UPDATE
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can create plates" ON license_plates
    FOR INSERT
    WITH CHECK (public.is_admin(auth.uid()));

-- Grant necessary permissions
GRANT ALL ON license_plates TO authenticated;
GRANT ALL ON license_plates TO service_role;

-- Create a function to automatically set user_id on insert
CREATE OR REPLACE FUNCTION public.set_user_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.user_id := auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically set user_id
CREATE TRIGGER set_user_id_trigger
    BEFORE INSERT ON license_plates
    FOR EACH ROW
    EXECUTE FUNCTION public.set_user_id();

-- Grant execute permission on the trigger function
GRANT EXECUTE ON FUNCTION public.set_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_id() TO service_role; 