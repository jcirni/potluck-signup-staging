-- Host edit: let the event host update any signup on their event, not just remove it.
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
