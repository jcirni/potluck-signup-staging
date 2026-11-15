-- Migration: per-event accent color. Run once in the SQL Editor on projects set up before accent existed.
-- Fresh installs do not need this: backend/supabase.sql already includes the column and the function change.

alter table public.events add column if not exists accent text not null default 'brass'
  check (accent in ('brass', 'burgundy', 'forest', 'slate'));

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
    accent = coalesce(p_patch ->> 'accent', accent)
  where id = p_event_id;
end;
$$;
