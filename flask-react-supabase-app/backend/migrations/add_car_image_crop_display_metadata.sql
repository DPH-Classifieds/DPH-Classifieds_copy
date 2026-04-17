alter table public.car_images
  add column if not exists display_url text,
  add column if not exists focal_x double precision not null default 50,
  add column if not exists focal_y double precision not null default 50,
  add column if not exists crop_meta jsonb;
