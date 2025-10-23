# Profile Management Setup Instructions

This document contains the manual steps needed to complete the profile management setup.

## Database Schema Update Required

Since the automated migration didn't work, you need to manually run this SQL in your Supabase SQL Editor:

```sql
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
```

## New Features Added

### ✅ **Account Settings Page**
- **Location**: `/settings` route now uses `AccountSettings` component
- **Features**:
  - Profile information management (email, username, display name, phone)
  - Profile photo upload with preview
  - Password change functionality
  - Account deletion

### ✅ **Enhanced Login System**
- **Username/Email Login**: Users can now log in with either their email address or username
- **Backend Support**: Login endpoint automatically detects whether input is email or username

### ✅ **Profile Photo Management**
- **Upload**: Supports JPG, PNG, GIF files up to 5MB
- **Storage**: Uses Supabase Storage with user-specific folders
- **Display**: Shows in profile menu and throughout the application

### ✅ **Enhanced Profile Menu**
- **Profile Photos**: Shows user's profile photo when available
- **Display Names**: Shows username or display name instead of just email
- **Better UX**: More intuitive user information display

### ✅ **Backend API Endpoints**
- `PUT /api/user/update-profile` - Update user profile information
- `POST /api/user/upload-profile-photo` - Upload profile photos
- Enhanced `POST /api/auth/login` - Supports username or email login

### ✅ **Frontend Components**
- `AccountSettings.js` - Comprehensive settings management
- Updated `Login.js` - Username/email login support
- Updated `ProfileMenu.js` - Profile photo and name display
- New CSS files for styling

## Usage Instructions

1. **Complete Database Setup**: Run the SQL commands above in Supabase SQL Editor
2. **Restart Application**: Ensure both frontend and backend are running
3. **Test Profile Features**:
   - Navigate to `/settings` to manage profile
   - Try logging in with username (after setting one)
   - Upload a profile photo
   - Update profile information

## File Changes Made

### Backend Files:
- `app.py` - Added profile management endpoints
- `migrations/update_user_profiles.sql` - Database schema migration

### Frontend Files:
- `components/AccountSettings.js` - New comprehensive settings component
- `components/Login.js` - Updated for username/email login
- `components/ProfileMenu.js` - Enhanced with profile photos and names
- `context/AuthContext.js` - Added updateUser method
- `styles/AccountSettings.css` - Complete styling for settings page
- `styles/ProfileMenu.css` - Enhanced avatar and user info styling
- `App.js` - Updated to use AccountSettings component

## Next Steps

1. Run the SQL commands in Supabase
2. Test the profile management features
3. Verify username/email login functionality
4. Check profile photo upload and display
