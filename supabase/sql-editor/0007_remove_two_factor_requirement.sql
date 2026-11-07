-- Support Slot — 0007: two-factor authentication is no longer required.
--
-- Migration 0003 made every signed-in API call demand an aal2 session (a
-- verified authenticator-app code) as well as a good-standing account. The
-- product decision is now password-only sign-in, so this removes the aal2
-- requirement. What stays: you must be signed in, have a profile, and not be
-- suspended; staff powers still need a signed-in, non-suspended staff account;
-- identity still comes from the verified JWT (auth.uid()), never from the client.
--
-- The function names below are kept so every existing policy and function that
-- calls them keeps working. `session_is_aal2()` is now simply "signed in with a
-- profile"; it no longer looks at the aal claim. Safe on a populated project:
-- it replaces function bodies and policy names only; no rows are changed.
-- Run after 0001–0006, once.

create or replace function public.session_is_aal2()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid())
$$;

create or replace function public.session_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended_at is null)
$$;

create or replace function public._require_active_user()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid and suspended_at is not null) then
    raise exception 'account_suspended';
  end if;
  return v_uid;
end;
$$;

create or replace function public.my_account_status()
returns table(role text, has_onboarded boolean, suspended boolean, suspension_reason text, admin_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select p.role, p.has_onboarded, p.suspended_at is not null, p.suspension_reason,
           case when p.suspended_at is null then p.admin_role else null end
    from public.profiles p where p.id = auth.uid();
end;
$$;

-- The restrictive "signed in and not suspended" policy on every table gets an
-- accurate name (it used to be called aal2_active_session_required).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('drop policy if exists "aal2_active_session_required" on public.%I', t.tablename);
    execute format('drop policy if exists "active_session_required" on public.%I', t.tablename);
    execute format(
      'create policy "active_session_required" on public.%I as restrictive for all to authenticated '
      'using ((select public.session_is_active())) with check ((select public.session_is_active()))', t.tablename);
  end loop;
end $$;
