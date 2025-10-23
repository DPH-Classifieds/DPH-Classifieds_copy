# Quick Setup Guide - Reports Feature

## Running the Database Setup in Supabase

You don't need to run migration scripts! Just follow these simple steps:

### Step 1: Open Supabase SQL Editor

1. Go to https://app.supabase.com
2. Select your project
3. Click on **SQL Editor** in the left sidebar
4. Click **New query**

### Step 2: Copy and Run the SQL

Copy the entire SQL script below and paste it into the SQL Editor, then click **Run**:

```sql
-- Create reports table for user-submitted reports
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('car', 'bike', 'plate', 'part')),
    reporter_id UUID NOT NULL REFERENCES auth.users(id),
    reason TEXT NOT NULL CHECK (reason IN ('spam', 'fraud', 'inappropriate', 'wrong_category', 'duplicate', 'sold', 'incorrect_info', 'other')),
    details TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    admin_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE
);

-- Enable Row Level Security
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own reports" ON public.reports;
DROP POLICY IF EXISTS "Users can create reports" ON public.reports;
DROP POLICY IF EXISTS "Admins can view all reports" ON public.reports;
DROP POLICY IF EXISTS "Admins can update reports" ON public.reports;

-- Create policies
-- Users can view their own reports
CREATE POLICY "Users can view their own reports" ON public.reports
    FOR SELECT
    USING (auth.uid() = reporter_id);

-- Users can create reports (authenticated users only)
CREATE POLICY "Users can create reports" ON public.reports
    FOR INSERT
    WITH CHECK (auth.uid() = reporter_id);

-- Admins can view all reports
CREATE POLICY "Admins can view all reports" ON public.reports
    FOR SELECT
    USING (public.is_admin(auth.uid()));

-- Admins can update reports (mark as reviewed, add notes, etc.)
CREATE POLICY "Admins can update reports" ON public.reports
    FOR UPDATE
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_reports_listing ON public.reports(listing_id, listing_type);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON public.reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports(created_at DESC);

-- Grant necessary permissions
GRANT ALL ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_reports_updated_at_trigger ON public.reports;
CREATE TRIGGER update_reports_updated_at_trigger
    BEFORE UPDATE ON public.reports
    FOR EACH ROW
    EXECUTE FUNCTION public.update_reports_updated_at();

-- Add comment to table
COMMENT ON TABLE public.reports IS 'User-submitted reports for listings (cars, bikes, plates, parts)';
```

### Step 3: Verify the Table Was Created

Run this query to check:

```sql
SELECT * FROM public.reports LIMIT 5;
```

You should see an empty table with all the columns (id, listing_id, listing_type, etc.)

---

## Setting Up Your First Admin Account

### Quick Method - SQL Editor

1. First, find your user ID. Run this in SQL Editor:

```sql
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';
```

2. Copy the `id` from the result

3. Make yourself an admin:

```sql
UPDATE public.users 
SET is_admin = true 
WHERE email = 'your-email@example.com';
```

4. Verify it worked:

```sql
SELECT id, email, is_admin FROM public.users WHERE email = 'your-email@example.com';
```

You should see `is_admin` is now `true`.

5. **Important:** Log out and log back in to your application for the changes to take effect.

---

## Testing the Features

### 1. Test Report Button
- Navigate to any car/bike/plate/part detail page
- Click the "Report" button (⚠️ icon)
- Select a reason and submit

### 2. Test Admin Dashboard
- Log in with your admin account
- Go to `/admin`
- Click the "Reports" tab
- You should see any reports that were submitted

---

## Troubleshooting

### "relation 'public.reports' does not exist"
- The SQL script wasn't run successfully
- Make sure you clicked **Run** in the SQL Editor
- Check for any error messages in red

### "function public.is_admin(uuid) does not exist"
- You need to run the users table migration first
- This should have been set up when the app was initially configured
- If not, check `ADMIN_SETUP.md` for the full setup

### Can't access /admin even after setting is_admin = true
- Log out and log back in
- Clear browser cache
- Check browser console for errors
- Verify `is_admin` is actually `true` in the database

---

That's it! The database is now ready to handle reports. 🎉

