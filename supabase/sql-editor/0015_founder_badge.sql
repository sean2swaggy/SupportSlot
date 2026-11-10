-- Support Slot — 0015: a "Founder" badge on an artist's profile.
--
-- A small mark shown next to the name of the person who founded Support Slot. It is
-- set by hand in SQL by the platform (like verification) and cannot be set or changed
-- from the app. It does nothing else: it never affects booking, ranking or visibility.
--
-- Run after 0001–0014, once.

alter table public.artists add column is_founder boolean not null default false;

-- Clients can update their own artist row, so the flag needs the same protection as
-- `verification`: the app can read it but never write it.
create or replace function public.guard_founder_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'authenticated' or current_setting('app.staff_bypass', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_founder then raise exception 'The founder badge can only be set by the platform.'; end if;
  elsif new.is_founder is distinct from old.is_founder then
    raise exception 'The founder badge can only be changed by the platform.';
  end if;
  return new;
end;
$$;

-- Trigger-only: not callable as an API function (same rule as 0011).
revoke all on function public.guard_founder_flag() from public, anon, authenticated;

create trigger artists_founder_guard before insert or update on public.artists
  for each row execute function public.guard_founder_flag();
