-- Admin moderation audit log + performance indexes for scale (10k+ users).
-- Adds: admin_actions table, banned status path, composite indexes on hot admin filter columns.

-- =====================================================================
-- 1. admin_actions: audit log for every moderator action on a user/listing
-- =====================================================================
create table if not exists public.admin_actions (
    id uuid primary key default gen_random_uuid(),
    admin_user_id uuid not null references public.users(id) on delete restrict,
    action text not null check (action in (
        'user_ban', 'user_unban', 'user_suspend', 'user_delete',
        'user_make_admin', 'user_remove_admin',
        'listing_renew', 'listing_bulk_renew',
        'listing_approve', 'listing_reject', 'listing_delete'
    )),
    target_user_id uuid references public.users(id) on delete set null,
    target_listing_type text,
    target_listing_id uuid,
    reason text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_admin_actions_admin_created
    on public.admin_actions (admin_user_id, created_at desc);
create index if not exists idx_admin_actions_target_user_created
    on public.admin_actions (target_user_id, created_at desc)
    where target_user_id is not null;
create index if not exists idx_admin_actions_target_listing
    on public.admin_actions (target_listing_type, target_listing_id, created_at desc)
    where target_listing_id is not null;
create index if not exists idx_admin_actions_action_created
    on public.admin_actions (action, created_at desc);

alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_read_admins on public.admin_actions;
create policy admin_actions_read_admins on public.admin_actions
    for select using (
        exists (
            select 1 from public.users u
            where u.id = auth.uid() and u.is_admin = true
        )
    );

drop policy if exists admin_actions_insert_service on public.admin_actions;
create policy admin_actions_insert_service on public.admin_actions
    for insert with check (false); -- service-role only via PostgREST

-- =====================================================================
-- 2. Ensure account_status allows 'banned' (existing constraint already
--    allows it per enhance_user_profiles.sql, but be defensive)
-- =====================================================================
do $$
begin
    -- Add ban_reason + banned_at columns for quick read without joining admin_actions
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'users' and column_name = 'ban_reason'
    ) then
        alter table public.users add column ban_reason text;
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'users' and column_name = 'banned_at'
    ) then
        alter table public.users add column banned_at timestamptz;
    end if;
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'users' and column_name = 'banned_by'
    ) then
        alter table public.users add column banned_by uuid references public.users(id) on delete set null;
    end if;
end$$;

-- =====================================================================
-- 2b. Defensive: ensure listing-renewal columns exist on every listing
-- table. The user-facing renewal flow PATCHes these; if an older migration
-- (add_listing_expiry_idempotency_columns.sql) hasn't run on a given env,
-- renewals 400 out. Re-applying this migration heals that.
-- =====================================================================
do $$
declare
    tbl text;
begin
    foreach tbl in array array['cars', 'bikes', 'car_parts', 'license_plates']
    loop
        execute format('alter table public.%I add column if not exists renewed_at timestamptz', tbl);
        execute format('alter table public.%I add column if not exists reminder_job_id text', tbl);
        execute format('alter table public.%I add column if not exists expiration_job_id text', tbl);
        execute format('alter table public.%I add column if not exists expiry_reminder_sent_at timestamptz', tbl);
        execute format('alter table public.%I add column if not exists expired_email_sent_at timestamptz', tbl);
        execute format('alter table public.%I add column if not exists auto_removed_at timestamptz', tbl);
        execute format('alter table public.%I add column if not exists retention_expires_at timestamptz', tbl);
        execute format('alter table public.%I add column if not exists sold_response_deadline timestamptz', tbl);
        execute format('alter table public.%I add column if not exists is_archived boolean default false', tbl);
        execute format('alter table public.%I add column if not exists extension_count integer default 0', tbl);
        execute format('alter table public.%I add column if not exists last_extended_at timestamptz', tbl);
    end loop;
end$$;

-- =====================================================================
-- 3. Composite indexes for admin list views (the slow ones)
-- =====================================================================
create index if not exists idx_users_account_status_created
    on public.users (account_status, created_at desc);

create index if not exists idx_users_is_admin_created
    on public.users (is_admin, created_at desc)
    where is_admin = true;

-- Listings: admin filters by status + recency on every page
create index if not exists idx_cars_status_created
    on public.cars (status, created_at desc);
create index if not exists idx_bikes_status_created
    on public.bikes (status, created_at desc);
create index if not exists idx_car_parts_status_created
    on public.car_parts (status, created_at desc);
create index if not exists idx_license_plates_status_created
    on public.license_plates (status, created_at desc);

-- Worker sweep: expiring soon, not yet reminded
create index if not exists idx_cars_expires_at_status
    on public.cars (expires_at) where status in ('approved', 'active');
create index if not exists idx_bikes_expires_at_status
    on public.bikes (expires_at) where status in ('approved', 'active');
create index if not exists idx_car_parts_expires_at_status
    on public.car_parts (expires_at) where status in ('approved', 'active');
create index if not exists idx_license_plates_expires_at_status
    on public.license_plates (expires_at) where status in ('approved', 'active');

-- User-scoped listing lookups (used by /api/user/listings)
create index if not exists idx_cars_user_id_created on public.cars (user_id, created_at desc);
create index if not exists idx_bikes_user_id_created on public.bikes (user_id, created_at desc);
create index if not exists idx_car_parts_user_id_created on public.car_parts (user_id, created_at desc);
create index if not exists idx_license_plates_user_id_created on public.license_plates (user_id, created_at desc);
