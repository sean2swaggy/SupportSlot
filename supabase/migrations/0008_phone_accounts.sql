-- Support Slot — 0008: accounts can sign up with a phone number instead of an email.
--
-- Supabase Auth keeps the phone number (verified by a texted code) on the login
-- itself. This migration makes the rest of the database cope with a person who
-- has no email address:
--   1. profiles.email may be null (a phone-only account has none).
--   2. The support form: a signed-in person with no email on file must give a
--      reply-to address, exactly like a visitor (it used to read the profile's email).
--   3. "Download my data" includes the phone number held on the login.
-- Run after 0001–0007, once. No rows are changed.

-- 1. -------------------------------------------------------------------------
alter table public.profiles alter column email drop not null;

-- 2. -------------------------------------------------------------------------
create or replace function public.submit_support_request(p_topic text, p_message text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_ip text;
  v_id uuid;
begin
  if v_uid is not null and not public.session_is_aal2() then v_uid := null; end if; -- no profile yet: treat as a visitor
  if p_topic is null or p_topic not in ('account', 'booking', 'bug', 'other') then
    raise exception 'support_invalid: choose what this is about';
  end if;
  if length(btrim(coalesce(p_message, ''))) < 10 then
    raise exception 'support_invalid: please tell us a little more (at least 10 characters)';
  end if;
  if length(p_message) > 4000 then raise exception 'support_invalid: that message is too long'; end if;

  if v_uid is not null then
    select email into v_email from public.profiles where id = v_uid;
  end if;
  if v_email is null then
    -- a visitor, or a phone-only account: they must give an address we can reply to
    v_email := lower(btrim(coalesce(p_email, '')));
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
      raise exception 'support_invalid: enter an email address we can reply to';
    end if;
  end if;

  begin
    v_ip := split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then
    v_ip := '';
  end;
  if not public.rate_limit_hit('support:' || coalesce(v_uid::text, v_email), 5, 3600)
     or (coalesce(v_ip, '') <> '' and not public.rate_limit_hit('support-ip:' || v_ip, 15, 3600)) then
    raise exception 'rate_limited: you''ve sent a few requests already — please wait a while';
  end if;

  insert into public.support_requests (profile_id, email, topic, message)
  values (v_uid, v_email, p_topic, btrim(p_message))
  returning id into v_id;
  return v_id;
end;
$$;

-- 3. -------------------------------------------------------------------------
-- Keep the long export function as it is (renamed, closed to clients) and wrap it.
alter function public.export_my_data() rename to _export_my_data_core;
revoke execute on function public._export_my_data_core() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_core jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_core := public._export_my_data_core();
  return jsonb_set(v_core, '{account,phone}', coalesce(to_jsonb((select u.phone from auth.users u where u.id = v_uid)), 'null'::jsonb));
end;
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
