-- Add user preference for how seller identity is displayed on public listings.

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS show_username_on_listings boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.show_username_on_listings IS
  'If true, public listings will display the user''s username instead of their full name.';

