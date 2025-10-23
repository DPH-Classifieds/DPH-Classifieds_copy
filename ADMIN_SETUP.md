# Admin Account Setup Guide

This guide explains how to set up and manage admin accounts in your Flask-React-Supabase classified application.

## Overview

The application uses a `is_admin` boolean flag in the `public.users` table to determine which users have administrative privileges. Admin users can:
- View and manage all listings (approve/reject)
- Access the admin dashboard at `/admin`
- View and manage user reports
- Access admin-only API endpoints

## Setting Up an Admin Account

There are several ways to set an admin account:

### Method 1: Direct Database Update (Recommended for First Admin)

1. **Access your Supabase Dashboard:**
   - Go to https://app.supabase.com
   - Select your project
   - Navigate to the **Table Editor**

2. **Find the Users Table:**
   - Click on the `users` table in the `public` schema

3. **Locate the User:**
   - Find the user you want to make an admin by their email or ID
   - If the user doesn't exist yet, they need to sign up first through the application

4. **Update the is_admin Field:**
   - Click on the row for that user
   - Find the `is_admin` column
   - Change the value from `false` to `true`
   - Save the changes

### Method 2: Using SQL Query

1. **Open the SQL Editor in Supabase:**
   - In your Supabase dashboard, navigate to **SQL Editor**

2. **Run the following query** (replace `user@example.com` with the actual email):

```sql
UPDATE public.users 
SET is_admin = true 
WHERE email = 'user@example.com';
```

3. **Verify the change:**

```sql
SELECT id, email, is_admin, created_at 
FROM public.users 
WHERE email = 'user@example.com';
```

### Method 3: Using Supabase Client (For Developers)

If you have access to the Supabase service role key, you can update users programmatically:

```python
from supabase import create_client
import os

# Use service role key for admin operations
supabase_url = os.getenv("SUPABASE_URL")
service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(supabase_url, service_role_key)

# Update user to admin
response = supabase.table('users').update({
    'is_admin': True
}).eq('email', 'user@example.com').execute()

print(response)
```

## Verifying Admin Access

After setting up an admin account:

1. **Log out** of the application if you're currently logged in
2. **Log in** with the admin account credentials
3. **Navigate to** `/admin` in your browser
4. You should see the **Admin Dashboard** with tabs for managing listings and reports

If you see "Access Denied" message, the admin flag might not be set correctly. Double-check the database.

## Database Schema

The `public.users` table structure includes:

```sql
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    email TEXT UNIQUE NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);
```

## Row Level Security (RLS)

The application uses Row Level Security policies to protect data:

- **Regular users** can only view and update their own data
- **Admin users** can view and update any user's data (including admin status)

The `is_admin` function is used in RLS policies:

```sql
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = user_id AND is_admin = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Security Best Practices

1. **Limit Admin Accounts:** Only grant admin privileges to trusted users who need them
2. **Use Strong Passwords:** Admin accounts should use strong, unique passwords
3. **Enable 2FA:** If available, enable two-factor authentication for admin accounts
4. **Regular Audits:** Periodically review who has admin access
5. **Logging:** Monitor admin actions through application logs

## Removing Admin Access

To remove admin privileges from a user:

### Using SQL:
```sql
UPDATE public.users 
SET is_admin = false 
WHERE email = 'user@example.com';
```

### Using Supabase Dashboard:
1. Navigate to Table Editor → users table
2. Find the user
3. Change `is_admin` from `true` to `false`
4. Save changes

## Admin Dashboard Features

Once logged in as an admin, you can:

### Manage Listings
- View all pending, approved, and rejected listings
- Approve or reject listings with optional notes
- View detailed information about each listing
- Organized by tabs: Plates, Cars, Bikes, and Parts

### Manage Reports
- View user-submitted reports about problematic listings
- Review report details including:
  - Listing type and ID
  - Reason for report (spam, fraud, inappropriate, etc.)
  - Additional details from reporter
  - Reporter information
- Resolve or dismiss reports
- Track report history

## Troubleshooting

### Admin Dashboard Shows "Access Denied"

**Problem:** User cannot access admin dashboard even after being set as admin.

**Solutions:**
1. Verify the `is_admin` field is set to `true` in the database
2. Log out and log back in to refresh the session
3. Clear browser cache and cookies
4. Check browser console for any errors
5. Verify the migration `create_users_table.sql` has been run

### Changes to is_admin Not Taking Effect

**Problem:** Updated admin status but no change in access.

**Solutions:**
1. User needs to log out and log back in
2. Check if the `public.users` table sync with `auth.users` is working
3. Verify the RLS policies are correctly set up
4. Check the backend logs for any authentication errors

### New Users Not Appearing in Users Table

**Problem:** Users sign up but don't appear in the `public.users` table.

**Solutions:**
1. Check if the `on_auth_user_created` trigger is active:
```sql
SELECT * FROM information_schema.triggers 
WHERE trigger_name = 'on_auth_user_created';
```

2. Re-create the trigger if needed:
```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## API Endpoints for Admin Operations

Admin users have access to these additional API endpoints:

- `GET /api/admin/plates` - Get all plate listings
- `GET /api/admin/cars` - Get all car listings
- `GET /api/admin/bikes` - Get all bike listings
- `GET /api/admin/parts` - Get all parts listings
- `GET /api/admin/reports` - Get all user reports
- `PATCH /api/reports/:id` - Update report status
- `POST /api/plates/:id/approve` - Approve plate listing
- `POST /api/plates/:id/reject` - Reject plate listing
- Similar approve/reject endpoints for cars, bikes, and parts

## Migration Files

Ensure these migration files have been executed in order:

1. `create_users_table.sql` - Creates the users table with admin field
2. `add_admin_field.sql` - Adds admin field if upgrading from older version
3. `create_reports_table.sql` - Creates the reports table for user submissions

To apply migrations:

```bash
cd backend
python apply_migration.py migrations/create_users_table.sql
python apply_migration.py migrations/create_reports_table.sql
```

## Support

If you encounter issues setting up admin accounts:
1. Check the application logs in `backend/flask.log`
2. Verify Supabase connection settings in `.env`
3. Ensure all migrations have been applied
4. Review the Supabase dashboard for any policy violations

---

**Last Updated:** October 2025
**Version:** 1.0

