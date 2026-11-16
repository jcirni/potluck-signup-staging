-- Potluck signup backend: Supabase (free Postgres). Run once in the SQL Editor.
-- Userless and public: identity is a token; only SHA-256 token hashes are stored.
-- RLS allows anon read/insert only; edits go through the token-checked functions below.
-- Design, free-tier limits, and setup: docs/BACKEND.md.

create table if not exists public.events (
  id text primary key,
  name text not null check (char_length(name) between 1 and 120),
  date date,
  start_time text check (start_time is null or start_time = '' or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  headcount integer not null default 0 check (headcount >= 0),
  location text check (char_length(location) <= 200),
  details text check (char_length(details) <= 2000),
  targets jsonb not null default '{"Appetizers":2,"Mains":3,"Veggies":2,"Sides":3,"Desserts":2,"Drinks":3,"Supplies":4}'::jsonb,
  dietary_needs jsonb not null default '{"vegetarian":0,"vegan":0,"glutenFree":0,"noPork":0}'::jsonb,
  accent text not null default 'brass' check (accent in ('brass', 'burgundy', 'forest', 'slate')),
  admin_token_hash text not null,
  created_at timestamptz not null default now()
);

-- Column guards so re-running on an earlier draft adds missing columns instead of failing.
alter table public.events add column if not exists dietary_needs jsonb not null default '{"vegetarian":0,"vegan":0,"glutenFree":0,"noPork":0}'::jsonb;
alter table public.events add column if not exists accent text not null default 'brass' check (accent in ('brass', 'burgundy', 'forest', 'slate'));
alter table public.events add column if not exists location text check (char_length(location) <= 200);
alter table public.events add column if not exists details text check (char_length(details) <= 2000);
alter table public.events add column if not exists start_time text check (start_time is null or start_time = '' or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create table if not exists public.signups (
  id text primary key,
  event_id text not null references public.events (id) on delete cascade,
  dish_id text check (dish_id is null or char_length(dish_id) <= 80),
  scale numeric check (scale is null or (scale > 0 and scale <= 10)),
  name text not null check (char_length(name) between 1 and 80),
  dish text not null check (char_length(dish) between 1 and 120),
  course text not null check (course in ('Appetizers', 'Mains', 'Veggies', 'Sides', 'Desserts', 'Drinks', 'Supplies')),
  need_oven boolean not null default false,
  allergies text not null default '' check (char_length(allergies) <= 200),
  servings integer not null default 0 check (servings >= 0 and servings <= 500),
  edit_token_hash text,
  created_at timestamptz not null default now()
);

alter table public.signups add column if not exists dish_id text check (dish_id is null or char_length(dish_id) <= 80);
alter table public.signups add column if not exists scale numeric check (scale is null or (scale > 0 and scale <= 10));

create index if not exists signups_event_id_idx on public.signups (event_id);

-- RSVPs: who is coming, separate from what they are bringing.
create table if not exists public.rsvps (
  id text primary key,
  event_id text not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  adults integer not null default 1 check (adults >= 0 and adults <= 50),
  kids integer not null default 0 check (kids >= 0 and kids <= 50),
  edit_token_hash text,
  created_at timestamptz not null default now()
);

create index if not exists rsvps_event_id_idx on public.rsvps (event_id);

-- Dish suggestions: recipes guests share from the signup form when their dish is not in the catalog.
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

-- Abuse armor, part 1: at most 100 signups per event.
create or replace function public.check_signup_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.signups where event_id = NEW.event_id) >= 100 then
    raise exception 'Event is full (100 signups).';
  end if;
  return NEW;
end;
$$;

drop trigger if exists signup_cap on public.signups;
create trigger signup_cap before insert on public.signups
  for each row execute function public.check_signup_cap();

-- Abuse armor, part 2: at most 200 RSVPs per event.
create or replace function public.check_rsvp_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.rsvps where event_id = NEW.event_id) >= 200 then
    raise exception 'Event is full (200 RSVPs).';
  end if;
  return NEW;
end;
$$;

drop trigger if exists rsvp_cap on public.rsvps;
create trigger rsvp_cap before insert on public.rsvps
  for each row execute function public.check_rsvp_cap();

-- Abuse armor, part 3: at most 1000 dish suggestions overall.
create or replace function public.check_suggestion_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.dish_suggestions) >= 1000 then
    raise exception 'Suggestion box is full (1000 suggestions).';
  end if;
  return NEW;
end;
$$;

drop trigger if exists suggestion_cap on public.dish_suggestions;
create trigger suggestion_cap before insert on public.dish_suggestions
  for each row execute function public.check_suggestion_cap();

-- Abuse armor, part 4: at most 200 events created per UTC day.
create or replace function public.check_event_daily_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.events
      where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) >= 200 then
    raise exception 'Too many events created today (200 per day).';
  end if;
  return NEW;
end;
$$;

drop trigger if exists event_daily_cap on public.events;
create trigger event_daily_cap before insert on public.events
  for each row execute function public.check_event_daily_cap();

alter table public.events enable row level security;
alter table public.signups enable row level security;
alter table public.rsvps enable row level security;
alter table public.dish_suggestions enable row level security;

drop policy if exists "potluck read events" on public.events;
create policy "potluck read events" on public.events
  for select using (true);

drop policy if exists "potluck create events" on public.events;
create policy "potluck create events" on public.events
  for insert with check (true);

drop policy if exists "potluck read signups" on public.signups;
create policy "potluck read signups" on public.signups
  for select using (true);

drop policy if exists "potluck add signups" on public.signups;
create policy "potluck add signups" on public.signups
  for insert with check (true);

drop policy if exists "potluck read rsvps" on public.rsvps;
create policy "potluck read rsvps" on public.rsvps
  for select using (true);

drop policy if exists "potluck add rsvps" on public.rsvps;
create policy "potluck add rsvps" on public.rsvps
  for insert with check (true);

-- Suggestions are write-only for guests; reading and curating them happens in the dashboard.
drop policy if exists "potluck add dish suggestions" on public.dish_suggestions;
create policy "potluck add dish suggestions" on public.dish_suggestions
  for insert with check (true);

-- Edits/deletes only via these token-checked functions; p_patch keys are camelCase and whitelisted.

create or replace function public.update_signup(p_signup_id text, p_token_hash text, p_patch jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select edit_token_hash into v_hash from public.signups where id = p_signup_id;
  if v_hash is null or v_hash <> p_token_hash then
    raise exception 'Not authorized to edit this signup.';
  end if;
  update public.signups set
    dish_id = coalesce((p_patch ->> 'dishId')::text, dish_id),
    scale = coalesce((p_patch ->> 'scale')::numeric, scale),
    name = coalesce((p_patch ->> 'name')::text, name),
    dish = coalesce((p_patch ->> 'dish')::text, dish),
    course = coalesce((p_patch ->> 'course')::text, course),
    need_oven = coalesce((p_patch ->> 'needOven')::boolean, need_oven),
    allergies = coalesce((p_patch ->> 'allergies')::text, allergies),
    servings = coalesce((p_patch ->> 'servings')::integer, servings)
  where id = p_signup_id;
end;
$$;

create or replace function public.delete_signup(p_signup_id text, p_token_hash text)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select edit_token_hash into v_hash from public.signups where id = p_signup_id;
  if v_hash is null or v_hash <> p_token_hash then
    raise exception 'Not authorized to remove this signup.';
  end if;
  delete from public.signups where id = p_signup_id;
end;
$$;

create or replace function public.delete_signup_as_admin(p_event_id text, p_admin_token_hash text, p_signup_id text)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select admin_token_hash into v_hash from public.events where id = p_event_id;
  if v_hash is null or v_hash <> p_admin_token_hash then
    raise exception 'Not authorized for this event.';
  end if;
  delete from public.signups where id = p_signup_id and event_id = p_event_id;
end;
$$;

create or replace function public.update_signup_as_admin(p_event_id text, p_admin_token_hash text, p_signup_id text, p_patch jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select admin_token_hash into v_hash from public.events where id = p_event_id;
  if v_hash is null or v_hash <> p_admin_token_hash then
    raise exception 'Not authorized for this event.';
  end if;
  update public.signups set
    dish_id = coalesce((p_patch ->> 'dishId')::text, dish_id),
    scale = coalesce((p_patch ->> 'scale')::numeric, scale),
    name = coalesce((p_patch ->> 'name')::text, name),
    dish = coalesce((p_patch ->> 'dish')::text, dish),
    course = coalesce((p_patch ->> 'course')::text, course),
    need_oven = coalesce((p_patch ->> 'needOven')::boolean, need_oven),
    allergies = coalesce((p_patch ->> 'allergies')::text, allergies),
    servings = coalesce((p_patch ->> 'servings')::integer, servings)
  where id = p_signup_id and event_id = p_event_id;
end;
$$;

create or replace function public.update_rsvp(p_rsvp_id text, p_token_hash text, p_patch jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select edit_token_hash into v_hash from public.rsvps where id = p_rsvp_id;
  if v_hash is null or v_hash <> p_token_hash then
    raise exception 'Not authorized to edit this RSVP.';
  end if;
  update public.rsvps set
    name = coalesce((p_patch ->> 'name')::text, name),
    adults = coalesce((p_patch ->> 'adults')::integer, adults),
    kids = coalesce((p_patch ->> 'kids')::integer, kids)
  where id = p_rsvp_id;
end;
$$;

create or replace function public.delete_rsvp(p_rsvp_id text, p_token_hash text)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select edit_token_hash into v_hash from public.rsvps where id = p_rsvp_id;
  if v_hash is null or v_hash <> p_token_hash then
    raise exception 'Not authorized to remove this RSVP.';
  end if;
  delete from public.rsvps where id = p_rsvp_id;
end;
$$;

create or replace function public.delete_rsvp_as_admin(p_event_id text, p_admin_token_hash text, p_rsvp_id text)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select admin_token_hash into v_hash from public.events where id = p_event_id;
  if v_hash is null or v_hash <> p_admin_token_hash then
    raise exception 'Not authorized for this event.';
  end if;
  delete from public.rsvps where id = p_rsvp_id and event_id = p_event_id;
end;
$$;

create or replace function public.update_event_as_admin(p_event_id text, p_admin_token_hash text, p_patch jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_hash text;
begin
  select admin_token_hash into v_hash from public.events where id = p_event_id;
  if v_hash is null or v_hash <> p_admin_token_hash then
    raise exception 'Not authorized for this event.';
  end if;
  update public.events set
    name = coalesce((p_patch ->> 'name')::text, name),
    date = coalesce((p_patch ->> 'date')::date, date),
    start_time = coalesce((p_patch ->> 'startTime')::text, start_time),
    headcount = coalesce((p_patch ->> 'headcount')::integer, headcount),
    targets = coalesce(p_patch -> 'targets', targets),
    dietary_needs = coalesce(p_patch -> 'dietaryNeeds', dietary_needs),
    accent = coalesce(p_patch ->> 'accent', accent),
    location = coalesce((p_patch ->> 'location')::text, location),
    details = coalesce((p_patch ->> 'details')::text, details)
  where id = p_event_id;
end;
$$;
