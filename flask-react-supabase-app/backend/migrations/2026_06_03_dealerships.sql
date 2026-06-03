-- Dealer panel foundation: orgs + seats + invitations

CREATE TABLE IF NOT EXISTS public.dealerships (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL,
    slug              text UNIQUE NOT NULL,
    legal_name        text,
    trade_license_no  text,
    emirate           text,
    address           text,
    phone             text,
    whatsapp          text,
    logo_url          text,
    cover_url         text,
    website           text,
    bio               text,
    owner_user_id     uuid NOT NULL REFERENCES public.users(id),
    status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealerships_owner ON public.dealerships(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_dealerships_status ON public.dealerships(status);

CREATE TABLE IF NOT EXISTS public.dealership_members (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id     uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role              text NOT NULL CHECK (role IN ('owner','manager','sales_rep')),
    status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','revoked')),
    invited_by        uuid REFERENCES public.users(id),
    invited_at        timestamptz,
    joined_at         timestamptz DEFAULT now(),
    UNIQUE(dealership_id, user_id),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_dealership_members_dealership ON public.dealership_members(dealership_id);
CREATE INDEX IF NOT EXISTS idx_dealership_members_user ON public.dealership_members(user_id);
CREATE INDEX IF NOT EXISTS idx_dealership_members_status ON public.dealership_members(status);

CREATE TABLE IF NOT EXISTS public.dealership_invitations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id     uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    email             text NOT NULL,
    role              text NOT NULL CHECK (role IN ('manager','sales_rep')),
    token             text UNIQUE NOT NULL,
    invited_by        uuid NOT NULL REFERENCES public.users(id),
    expires_at        timestamptz NOT NULL,
    accepted_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_dealership ON public.dealership_invitations(dealership_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.dealership_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.dealership_invitations(email);

DO $$ BEGIN RAISE NOTICE '✅ dealerships, dealership_members, dealership_invitations created'; END $$;
