-- ============================================================
-- ECOSYSTEM TABLES - DPH Classifieds
-- ============================================================
-- This migration adds tables for:
-- 1. User ratings and reviews
-- 2. User verification
-- 3. Saved listings
-- 4. User followers (social graph)
-- 5. Notifications
-- 6. Transactions
-- ============================================================

-- ============================================================
-- PART 1: USER RATINGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id UUID NOT NULL REFERENCES auth.users(id),
    buyer_id UUID NOT NULL REFERENCES auth.users(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    transaction_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

COMMENT ON TABLE public.user_ratings IS 'Ratings and reviews for sellers';

-- ============================================================
-- PART 2: USER VERIFICATION TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_verification (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    verification_type VARCHAR(50) NOT NULL CHECK (verification_type IN ('email', 'phone', 'id_card', 'business_license', 'bank_account', 'address')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    document_url TEXT,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID REFERENCES auth.users(id),
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

COMMENT ON TABLE public.user_verification IS 'User verification records';

-- ============================================================
-- PART 3: SAVED LISTINGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.saved_listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    listing_id UUID NOT NULL,
    listing_type VARCHAR(20) NOT NULL CHECK (listing_type IN ('car', 'bike', 'plate', 'part')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(user_id, listing_id, listing_type)
);

COMMENT ON TABLE public.saved_listings IS 'User saved listings';

-- ============================================================
-- PART 4: USER FOLLOWERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_followers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID NOT NULL REFERENCES auth.users(id),
    following_id UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(follower_id, following_id)
);

COMMENT ON TABLE public.user_followers IS 'User follow relationships';

-- ============================================================
-- PART 5: NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    type VARCHAR(50) NOT NULL CHECK (type IN ('new_listing', 'price_drop', 'message', 'rating', 'follow', 'transaction', 'system')),
    title TEXT NOT NULL,
    content TEXT,
    listing_id UUID,
    listing_type VARCHAR(20),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

COMMENT ON TABLE public.notifications IS 'User notifications';

-- ============================================================
-- PART 6: TRANSACTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id UUID NOT NULL,
    buyer_id UUID NOT NULL REFERENCES auth.users(id),
    seller_id UUID NOT NULL REFERENCES auth.users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'disputed')),
    amount INTEGER,
    payment_method VARCHAR(50),
    completed_at TIMESTAMP WITH TIME ZONE,
    dispute_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

COMMENT ON TABLE public.transactions IS 'Car transaction records';

-- ============================================================
-- PART 7: CREATE INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_ratings_seller ON public.user_ratings(seller_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_buyer ON public.user_ratings(buyer_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_created ON public.user_ratings(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_verification_user ON public.user_verification(user_id);
CREATE INDEX IF NOT EXISTS idx_user_verification_status ON public.user_verification(status);

CREATE INDEX IF NOT EXISTS idx_saved_listings_user ON public.saved_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_listings_listing ON public.saved_listings(listing_id, listing_type);

CREATE INDEX IF NOT EXISTS idx_user_followers_follower ON public.user_followers(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_followers_following ON public.user_followers(following_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_buyer ON public.transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_seller ON public.transactions(seller_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);

-- ============================================================
-- PART 8: ENABLE ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.user_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PART 9: CREATE RLS POLICIES
-- ============================================================

-- User ratings policies
DROP POLICY IF EXISTS "Users can view ratings" ON public.user_ratings;
CREATE POLICY "Users can view ratings" ON public.user_ratings
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Users can create ratings" ON public.user_ratings;
CREATE POLICY "Users can create ratings" ON public.user_ratings
    FOR INSERT
    WITH CHECK (auth.uid() = buyer_id);

-- User verification policies
DROP POLICY IF EXISTS "Users can view own verification" ON public.user_verification;
CREATE POLICY "Users can view own verification" ON public.user_verification
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own verification" ON public.user_verification;
CREATE POLICY "Users can create own verification" ON public.user_verification
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all verification" ON public.user_verification;
CREATE POLICY "Admins can view all verification" ON public.user_verification
    FOR SELECT
    USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update verification" ON public.user_verification;
CREATE POLICY "Admins can update verification" ON public.user_verification
    FOR UPDATE
    USING (public.is_admin(auth.uid()));

-- Saved listings policies
DROP POLICY IF EXISTS "Users can view own saved listings" ON public.saved_listings;
CREATE POLICY "Users can view own saved listings" ON public.saved_listings
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create saved listings" ON public.saved_listings;
CREATE POLICY "Users can create saved listings" ON public.saved_listings
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own saved listings" ON public.saved_listings;
CREATE POLICY "Users can delete own saved listings" ON public.saved_listings
    FOR DELETE
    USING (auth.uid() = user_id);

-- User followers policies
DROP POLICY IF EXISTS "Users can view own followers" ON public.user_followers;
CREATE POLICY "Users can view own followers" ON public.user_followers
    FOR SELECT
    USING (auth.uid() = follower_id OR auth.uid() = following_id);

DROP POLICY IF EXISTS "Users can create followers" ON public.user_followers;
CREATE POLICY "Users can create followers" ON public.user_followers
    FOR INSERT
    WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can delete own followers" ON public.user_followers;
CREATE POLICY "Users can delete own followers" ON public.user_followers
    FOR DELETE
    USING (auth.uid() = follower_id);

-- Notifications policies
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create notifications" ON public.notifications;
CREATE POLICY "Users can create notifications" ON public.notifications
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Transactions policies
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions
    FOR SELECT
    USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

DROP POLICY IF EXISTS "Users can create transactions" ON public.transactions;
CREATE POLICY "Users can create transactions" ON public.transactions
    FOR INSERT
    WITH CHECK (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- ============================================================
-- PART 10: CREATE TRIGGERS
-- ============================================================

-- Update updated_at timestamp for user_ratings
DROP TRIGGER IF EXISTS update_user_ratings_updated_at ON public.user_ratings;
CREATE TRIGGER update_user_ratings_updated_at
    BEFORE UPDATE ON public.user_ratings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- Update updated_at timestamp for user_verification
DROP TRIGGER IF EXISTS update_user_verification_updated_at ON public.user_verification;
CREATE TRIGGER update_user_verification_updated_at
    BEFORE UPDATE ON public.user_verification
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- Update updated_at timestamp for transactions
DROP TRIGGER IF EXISTS update_transactions_updated_at ON public.transactions;
CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- PART 11: CREATE HELPER FUNCTIONS
-- ============================================================

-- Function to get seller rating stats
CREATE OR REPLACE FUNCTION public.get_seller_rating_stats(seller_uuid UUID)
RETURNS TABLE (
    avg_rating NUMERIC,
    total_ratings INTEGER,
    rating_breakdown JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(AVG(ur.rating), 0)::NUMERIC as avg_rating,
        COUNT(ur.id)::INTEGER as total_ratings,
        COALESCE(
            jsonb_object_agg(
                ur.rating::TEXT,
                COUNT(ur.id)
            ) FILTER (WHERE ur.rating IS NOT NULL),
            '{"1":0,"2":0,"3":0,"4":0,"5":0}'::JSONB
        ) as rating_breakdown
    FROM public.user_ratings ur
    WHERE ur.seller_id = seller_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get seller verification status
CREATE OR REPLACE FUNCTION public.get_seller_verification_status(user_uuid UUID)
RETURNS TABLE (
    is_verified BOOLEAN,
    verified_types TEXT[],
    pending_count INTEGER,
    rejected_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        EXISTS (
            SELECT 1 FROM public.user_verification 
            WHERE user_id = user_uuid AND status = 'verified'
        ) as is_verified,
        COALESCE(
            ARRAY_AGG(DISTINCT uv.verification_type) FILTER (WHERE uv.status = 'verified'),
            ARRAY[]::TEXT[]
        ) as verified_types,
        COUNT(CASE WHEN uv.status = 'pending' THEN 1 END)::INTEGER as pending_count,
        COUNT(CASE WHEN uv.status = 'rejected' THEN 1 END)::INTEGER as rejected_count
    FROM public.user_verification uv
    WHERE uv.user_id = user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get seller stats
CREATE OR REPLACE FUNCTION public.get_seller_stats(seller_uuid UUID)
RETURNS TABLE (
    total_listings INTEGER,
    active_listings INTEGER,
    completed_sales INTEGER,
    avg_rating NUMERIC,
    total_reviews INTEGER,
    member_since TIMESTAMP WITH TIME ZONE,
    last_active TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(
            (SELECT COUNT(*) FROM public.cars WHERE user_id = seller_uuid),
            0
        )::INTEGER as total_listings,
        COALESCE(
            (SELECT COUNT(*) FROM public.cars WHERE user_id = seller_uuid AND status = 'approved'),
            0
        )::INTEGER as active_listings,
        COALESCE(
            (SELECT COUNT(*) FROM public.transactions WHERE seller_id = seller_uuid AND status = 'completed'),
            0
        )::INTEGER as completed_sales,
        COALESCE(
            (SELECT AVG(rating) FROM public.user_ratings WHERE seller_id = seller_uuid),
            0
        )::NUMERIC as avg_rating,
        COALESCE(
            (SELECT COUNT(*) FROM public.user_ratings WHERE seller_id = seller_uuid),
            0
        )::INTEGER as total_reviews,
        (SELECT created_at FROM auth.users WHERE id = seller_uuid) as member_since,
        (SELECT last_login_at FROM auth.users WHERE id = seller_uuid) as last_active;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create notification
CREATE OR REPLACE FUNCTION public.create_notification(
    target_user_id UUID,
    notification_type VARCHAR(50),
    notification_title TEXT,
    notification_content TEXT,
    listing_id UUID DEFAULT NULL,
    listing_type VARCHAR(20) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    new_id UUID;
BEGIN
    INSERT INTO public.notifications (
        user_id, type, title, content, listing_id, listing_type
    ) VALUES (
        target_user_id, notification_type, notification_title, 
        notification_content, listing_id, listing_type
    )
    RETURNING id INTO new_id;
    
    RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PART 12: CREATE VIEWS
-- ============================================================

-- View for seller ratings summary
CREATE OR REPLACE VIEW public.seller_ratings_summary AS
SELECT 
    ur.seller_id,
    u.email as seller_email,
    u.username as seller_username,
    u.first_name,
    u.last_name,
    u.profile_photo_url,
    COUNT(ur.id) as total_ratings,
    COALESCE(AVG(ur.rating), 0) as avg_rating,
    MAX(ur.created_at) as last_rating_date
FROM public.user_ratings ur
JOIN auth.users u ON ur.seller_id = u.id
GROUP BY ur.seller_id, u.email, u.username, u.first_name, u.last_name, u.profile_photo_url;

-- View for user followers summary
CREATE OR REPLACE VIEW public.user_followers_summary AS
SELECT 
    uf.following_id as user_id,
    COUNT(DISTINCT uf.follower_id) as follower_count,
    COUNT(DISTINCT uf.following_id) as following_count
FROM public.user_followers uf
GROUP BY uf.following_id;

-- View for saved listings count
CREATE OR REPLACE VIEW public.saved_listings_count AS
SELECT 
    sl.user_id,
    COUNT(sl.id) as saved_count,
    COUNT(CASE WHEN sl.listing_type = 'car' THEN 1 END) as saved_cars,
    COUNT(CASE WHEN sl.listing_type = 'bike' THEN 1 END) as saved_bikes,
    COUNT(CASE WHEN sl.listing_type = 'plate' THEN 1 END) as saved_plates,
    COUNT(CASE WHEN sl.listing_type = 'part' THEN 1 END) as saved_parts
FROM public.saved_listings sl
GROUP BY sl.user_id;

-- ============================================================
-- PART 13: GRANT PERMISSIONS
-- ============================================================
GRANT ALL ON public.user_ratings TO authenticated;
GRANT ALL ON public.user_verification TO authenticated;
GRANT ALL ON public.saved_listings TO authenticated;
GRANT ALL ON public.user_followers TO authenticated;
GRANT ALL ON public.notifications TO authenticated;
GRANT ALL ON public.transactions TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_seller_rating_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_verification_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification TO authenticated;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
