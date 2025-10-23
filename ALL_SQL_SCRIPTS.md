# All SQL Scripts to Run in Supabase

Run these scripts in your Supabase SQL Editor in this order:

---

## Script 1: Create Reports Table

This creates the table for user-submitted reports.

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
CREATE POLICY "Users can view their own reports" ON public.reports
    FOR SELECT
    USING (auth.uid() = reporter_id);

CREATE POLICY "Users can create reports" ON public.reports
    FOR INSERT
    WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Admins can view all reports" ON public.reports
    FOR SELECT
    USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update reports" ON public.reports
    FOR UPDATE
    USING (public.is_admin(auth.uid()))
    WITH CHECK (public.is_admin(auth.uid()));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_reports_listing ON public.reports(listing_id, listing_type);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON public.reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports(created_at DESC);

-- Grant permissions
GRANT ALL ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;

-- Create update trigger
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

COMMENT ON TABLE public.reports IS 'User-submitted reports for listings';
```

---

## Script 2: Add Country Code to Tables

This adds the country_code field to all listing tables for phone numbers.

```sql
-- Add country_code field to all tables that store phone numbers

-- Cars table
ALTER TABLE public.cars 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- Bikes table  
ALTER TABLE public.bikes 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- License plates table
ALTER TABLE public.license_plates 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- Car parts table
ALTER TABLE public.car_parts 
ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT '+971';

-- Update existing records
UPDATE public.cars SET country_code = '+971' WHERE country_code IS NULL;
UPDATE public.bikes SET country_code = '+971' WHERE country_code IS NULL;
UPDATE public.license_plates SET country_code = '+971' WHERE country_code IS NULL;
UPDATE public.car_parts SET country_code = '+971' WHERE country_code IS NULL;

-- Add comments
COMMENT ON COLUMN public.cars.country_code IS 'Phone number country code (e.g., +971 for UAE)';
COMMENT ON COLUMN public.bikes.country_code IS 'Phone number country code (e.g., +971 for UAE)';
COMMENT ON COLUMN public.license_plates.country_code IS 'Phone number country code (e.g., +971 for UAE)';
COMMENT ON COLUMN public.car_parts.country_code IS 'Phone number country code (e.g., +971 for UAE)';
```

---

## Script 3: Set Your First Admin Account

Replace `your-email@example.com` with your actual email.

```sql
-- Check your user ID first
SELECT id, email, is_admin FROM public.users WHERE email = 'your-email@example.com';

-- Make yourself an admin
UPDATE public.users 
SET is_admin = true 
WHERE email = 'your-email@example.com';

-- Verify the change
SELECT id, email, is_admin, created_at FROM public.users WHERE email = 'your-email@example.com';
```

**Important:** Log out and log back in after running this!

---

## Script 4: Verify Everything Works

```sql
-- Check if reports table exists and has correct structure
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'reports'
ORDER BY ordinal_position;

-- Check if country_code was added to tables
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'country_code'
ORDER BY table_name;

-- Check admin users
SELECT id, email, is_admin, created_at 
FROM public.users 
WHERE is_admin = true;

-- Check RLS policies on reports
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'reports';
```

---

## Quick Checklist

After running all scripts, verify:

- [ ] `reports` table exists
- [ ] RLS policies are active on `reports`
- [ ] `country_code` field added to: cars, bikes, license_plates, car_parts
- [ ] At least one user has `is_admin = true`
- [ ] No SQL errors in the output

---

## Troubleshooting

### Error: "relation 'public.reports' already exists"
- This is fine! The table was already created
- Skip Script 1 or use `CREATE TABLE IF NOT EXISTS`

### Error: "column 'country_code' already exists"
- This is fine! The column was already added
- Skip Script 2 or check it already exists

### Error: "function public.is_admin(uuid) does not exist"
- You need to run the initial users table migration
- Check `backend/migrations/create_users_table.sql`

### Can't access /admin after setting is_admin = true
- Log out completely
- Clear browser cache
- Log back in
- Try again

---

## How to Run These Scripts

1. Open https://app.supabase.com
2. Select your project
3. Click **SQL Editor** (left sidebar)
4. Click **New query**
5. Copy and paste each script above
6. Click **Run** button (or press Cmd/Ctrl + Enter)
7. Check for success message
8. Move to next script

---

That's it! Your database is now fully configured. 🎉

