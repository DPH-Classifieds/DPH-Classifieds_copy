-- Saved searches, draft reminders, and saved-car reminder support.
create extension if not exists pgcrypto;

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  search_key text not null,
  name text,
  category text not null default 'all',
  route_path text,
  query_text text,
  filters jsonb not null default '{}'::jsonb,
  result_count integer,
  last_result_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, search_key)
);

create index if not exists idx_saved_searches_user_updated
  on public.saved_searches(user_id, updated_at desc);
create index if not exists idx_saved_searches_category_created
  on public.saved_searches(category, created_at desc);
create index if not exists idx_saved_searches_search_key
  on public.saved_searches(search_key);

alter table public.saved_searches enable row level security;

drop policy if exists "Users can view own saved searches" on public.saved_searches;
create policy "Users can view own saved searches"
  on public.saved_searches for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own saved searches" on public.saved_searches;
create policy "Users can create own saved searches"
  on public.saved_searches for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own saved searches" on public.saved_searches;
create policy "Users can update own saved searches"
  on public.saved_searches for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own saved searches" on public.saved_searches;
create policy "Users can delete own saved searches"
  on public.saved_searches for delete
  using (auth.uid() = user_id);

alter table public.listing_drafts
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists draft_payload jsonb not null default '{}'::jsonb,
  add column if not exists reminder_email_claimed_at timestamptz,
  add column if not exists reminder_email_sent_at timestamptz,
  add column if not exists reminder_email_last_error text;

update public.listing_drafts
set payload = draft_payload
where (payload is null or payload = '{}'::jsonb)
  and draft_payload is not null
  and draft_payload <> '{}'::jsonb;

update public.listing_drafts
set draft_payload = payload
where (draft_payload is null or draft_payload = '{}'::jsonb)
  and payload is not null
  and payload <> '{}'::jsonb;

create index if not exists idx_listing_drafts_reminder_due
  on public.listing_drafts(updated_at)
  where reminder_email_sent_at is null;

alter table public.saved_listings
  add column if not exists saved_email_claimed_at timestamptz,
  add column if not exists saved_email_sent_at timestamptz,
  add column if not exists saved_email_last_error text;

create index if not exists idx_saved_listings_car_email_due
  on public.saved_listings(created_at)
  where listing_type = 'car' and saved_email_sent_at is null;
