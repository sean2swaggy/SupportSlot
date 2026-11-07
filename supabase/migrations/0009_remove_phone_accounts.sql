-- Support Slot — 0009: sign-up is by email only; undo 0008 (phone accounts).
--
-- The phone-number option was removed from the app. This puts the database
-- back as it was before 0008:
--   1. profiles.email is required again (refuses to run if a profile has none).
--   2. The support form reads the signed-in person's profile email again.
--   3. "Download my data" is the original function again (no phone number).
-- Run after 0001–0008, once. No rows are changed.

-- 1. -------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.profiles where email is null) then
    raise exception 'cannot require an email: a profile without one exists (a phone-only account). Remove or fix it first.';
  end if;
end $$;
alter table public.profiles alter column email set not null;

-- 2. -------------------------------------------------------------------------
create or replace function public.submit_support_request(p_topic text, p_message text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := case when public.session_is_aal2() then auth.uid() else null end;
  v_email text;
  v_ip text;
  v_id uuid;
begin
  if p_topic is null or p_topic not in ('account', 'booking', 'bug', 'other') then
    raise exception 'support_invalid: choose what this is about';
  end if;
  if length(btrim(coalesce(p_message, ''))) < 10 then
    raise exception 'support_invalid: please tell us a little more (at least 10 characters)';
  end if;
  if length(p_message) > 4000 then raise exception 'support_invalid: that message is too long'; end if;

  if v_uid is not null then
    select email into v_email from public.profiles where id = v_uid;
  else
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
drop function public.export_my_data();
alter function public._export_my_data_core() rename to export_my_data;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
