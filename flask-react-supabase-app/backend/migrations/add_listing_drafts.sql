-- Persist car drafts so users can resume them later.
create table if not exists public.listing_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  draft_key text not null,
  draft_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, draft_key)
);

create index if not exists idx_listing_drafts_user_id on public.listing_drafts(user_id);
create index if not exists idx_listing_drafts_draft_key on public.listing_drafts(draft_key);
