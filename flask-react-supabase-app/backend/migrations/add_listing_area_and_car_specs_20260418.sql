-- Add missing listing fields used by frontend forms/detail pages.
-- Applied to Supabase project: ltjatsyhpmvewancqdjw

alter table public.cars
  add column if not exists color text,
  add column if not exists cylinders text,
  add column if not exists doors text,
  add column if not exists warranty text,
  add column if not exists service_history text,
  add column if not exists area text,
  add column if not exists emirate text;

alter table public.license_plates
  add column if not exists area text,
  add column if not exists emirate text;

alter table public.bikes
  add column if not exists bike_brand text,
  add column if not exists bike_model text,
  add column if not exists bike_type text,
  add column if not exists engine_size text,
  add column if not exists location text,
  add column if not exists contact_number text,
  add column if not exists features jsonb default '[]'::jsonb,
  add column if not exists transmission text,
  add column if not exists fuel_type text,
  add column if not exists area text,
  add column if not exists emirate text;

alter table public.car_parts
  add column if not exists compatible_makes text[] default '{}'::text[],
  add column if not exists compatible_models text[] default '{}'::text[],
  add column if not exists compatible_years text[] default '{}'::text[],
  add column if not exists location text,
  add column if not exists area text,
  add column if not exists emirate text,
  add column if not exists contact_number text,
  add column if not exists is_negotiable boolean default false;
