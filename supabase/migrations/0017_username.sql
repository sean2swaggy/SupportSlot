-- Support Slot — global, unique usernames across both roles (an artist and
-- a promoter can never pick the same one), plus a pre-signup availability
-- check. Lives on `profiles` (not `artists.handle` or `promoters.company`)
-- since it's an account-identity concept shared by both roles, not a
-- role-specific display field.

alter table public.profiles add column username text;

-- Case-insensitive uniqueness ("Sean" and "sean" can't both exist) while
-- still storing/displaying the casing the user chose.
create unique index profiles_username_unique_idx on public.profiles (lower(username));

alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-zA-Z0-9_]{3,20}$');

-- Callable by any authenticated user (including one who hasn't finished
-- onboarding yet, i.e. hasn't written a username of their own) to check
-- availability live as they type, without widening the "select own row"
-- policy on profiles to expose everyone's data.
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(p_username)
  );
$$;

grant execute on function public.is_username_available(text) to authenticated;
