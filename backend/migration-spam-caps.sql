-- Migration: spam caps for dish suggestions and event creation. Run once in the SQL Editor.
-- Fresh installs do not need this: backend/supabase.sql already includes both triggers.

-- At most 1000 dish suggestions overall.
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

-- At most 200 events created per UTC day.
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
