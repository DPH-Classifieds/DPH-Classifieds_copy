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

