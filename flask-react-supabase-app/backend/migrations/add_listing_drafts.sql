-- Persist listing drafts so users can resume them later.
create extension if not exists pgcrypto;

create table if not exists public.listing_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  draft_key text not null,
  draft_payload jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  reminder_email_claimed_at timestamptz,
  reminder_email_sent_at timestamptz,
  reminder_email_last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, draft_key)
);

alter table public.listing_drafts
  add column if not exists draft_payload jsonb not null default '{}'::jsonb,
  add column if not exists payload jsonb not null default '{}'::jsonb,
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

create index if not exists idx_listing_drafts_user_id on public.listing_drafts(user_id);
create index if not exists idx_listing_drafts_draft_key on public.listing_drafts(draft_key);
create index if not exists idx_listing_drafts_reminder_due
  on public.listing_drafts(updated_at)
  where reminder_email_sent_at is null;
