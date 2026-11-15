-- Migration: event location + details (invitation / directions text). Run once in the SQL Editor.
-- Fresh installs do not need this: backend/supabase.sql already includes the columns and the function change.

alter table public.events add column if not exists location text check (char_length(location) <= 200);
alter table public.events add column if not exists details text check (char_length(details) <= 2000);

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
    headcount = coalesce((p_patch ->> 'headcount')::integer, headcount),
    targets = coalesce(p_patch -> 'targets', targets),
    dietary_needs = coalesce(p_patch -> 'dietaryNeeds', dietary_needs),
    accent = coalesce(p_patch ->> 'accent', accent),
    location = coalesce((p_patch ->> 'location')::text, location),
    details = coalesce((p_patch ->> 'details')::text, details)
  where id = p_event_id;
end;
$$;
