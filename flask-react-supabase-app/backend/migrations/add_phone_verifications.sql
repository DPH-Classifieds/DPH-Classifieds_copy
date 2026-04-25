-- Phone verification support for Infobip SMS OTP flows

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.phone_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'phone_change', 'profile_verify', 'vin_reveal')),
    listing_id UUID,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'failed')),
    code_hash TEXT NOT NULL,
    code_salt TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    send_count INTEGER NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    verified_ip VARCHAR(45),
    verified_user_agent TEXT,
    last_sent_at TIMESTAMPTZ,
    last_error TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_user_id
    ON public.phone_verifications(user_id);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_status
    ON public.phone_verifications(status);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_purpose
    ON public.phone_verifications(purpose);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_listing_id
    ON public.phone_verifications(listing_id);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_expires_at
    ON public.phone_verifications(expires_at);

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own phone verifications" ON public.phone_verifications;
CREATE POLICY "Users can view own phone verifications"
    ON public.phone_verifications
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage phone verifications" ON public.phone_verifications;
CREATE POLICY "Service role can manage phone verifications"
    ON public.phone_verifications
    FOR ALL
    USING (public.is_admin(auth.uid()));

COMMENT ON TABLE public.phone_verifications IS 'Infobip-backed phone verification state and audit trail';
COMMENT ON COLUMN public.users.phone_verified_at IS 'Timestamp of the latest successful phone verification';
