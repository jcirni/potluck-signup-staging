-- Migration: dish_suggestions table, for recipes guests share from the signup form when their dish is not in the catalog.
-- Run once in the SQL Editor. Fresh installs do not need this: backend/supabase.sql already includes the table.

create table if not exists public.dish_suggestions (
  id uuid primary key default gen_random_uuid(),
  dish_name text not null check (char_length(dish_name) between 1 and 120),
  ingredients text not null check (char_length(ingredients) <= 4000),
  steps text check (char_length(steps) <= 4000),
  cuisine text check (char_length(cuisine) <= 40),
  servings integer check (servings >= 0 and servings <= 500),
  submitter_name text check (char_length(submitter_name) <= 80),
  event_id text,
  created_at timestamptz not null default now()
);

alter table public.dish_suggestions enable row level security;

-- Guests may only add suggestions; reading and curating them happens in the dashboard.
drop policy if exists "potluck add dish suggestions" on public.dish_suggestions;
create policy "potluck add dish suggestions" on public.dish_suggestions
  for insert with check (true);
