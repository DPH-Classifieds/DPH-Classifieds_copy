-- Update users table to include new profile fields
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE,
ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);

-- Create index for username lookup
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);

-- Update the handle_new_user function to include new fields
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, is_admin, username, phone, display_name)
    VALUES (
        new.id, 
        COALESCE(new.email, new.raw_user_meta_data->>'email'),
        COALESCE((new.raw_user_meta_data->>'is_admin')::boolean, false),
        new.raw_user_meta_data->>'username',
        new.raw_user_meta_data->>'phone',
        new.raw_user_meta_data->>'display_name'
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to find user by email or username
CREATE OR REPLACE FUNCTION public.find_user_by_email_or_username(identifier TEXT)
RETURNS TABLE(
    id UUID,
    email TEXT,
    username VARCHAR(50),
    phone VARCHAR(20),
    profile_photo_url TEXT,
    display_name VARCHAR(100),
    is_admin BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.username, u.phone, u.profile_photo_url, u.display_name, u.is_admin, u.created_at, u.updated_at
    FROM public.users u
    WHERE u.email = identifier OR u.username = identifier;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.find_user_by_email_or_username(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_by_email_or_username(TEXT) TO service_role;

-- Create storage bucket for profile photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Create policy for profile photo uploads
CREATE POLICY "Users can upload their own profile photos" 
ON storage.objects FOR INSERT 
WITH CHECK (
    bucket_id = 'profile-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Create policy for viewing profile photos
CREATE POLICY "Profile photos are publicly viewable" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'profile-photos');

-- Create policy for updating profile photos
CREATE POLICY "Users can update their own profile photos" 
ON storage.objects FOR UPDATE 
USING (
    bucket_id = 'profile-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Create policy for deleting profile photos
CREATE POLICY "Users can delete their own profile photos" 
ON storage.objects FOR DELETE 
USING (
    bucket_id = 'profile-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
);
