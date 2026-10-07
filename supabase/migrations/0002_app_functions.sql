-- Support Slot — functions the native app calls directly.
--
-- The app talks to Supabase only (there is no website or server of our own),
-- so everything that used to need a server route is a database function that
-- checks who is asking: deleting your account, downloading your data, the
-- support form, and expiring stale offers. Run after 0001_initial_schema.sql.
--
-- Also removes the email outbox: with no server there is nothing to send mail,
-- so notifications are in-app only and nothing claims an email was sent.

-- ---------------------------------------------------------------------------
-- 1. No email machinery.
-- ---------------------------------------------------------------------------
drop function public.claim_email_outbox(integer);
drop table public.email_outbox;
alter table public.profiles drop column email_notifications;

-- Same signature as before so every caller keeps working; p_email is ignored.
create or replace function public.notify(
  p_profile_id uuid, p_type text, p_text text, p_href text,
  p_dedupe_key text default null, p_email boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_profile_id is null then return; end if;
  insert into public.notifications (profile_id, type, text, href, dedupe_key)
  values (p_profile_id, p_type, p_text, p_href, p_dedupe_key)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Delete my account. Refuses while there is an upcoming confirmed booking;
--    otherwise winds down anything in flight and removes the login (profile,
--    messages and saved gigs go with it; past booking records stay, unlinked,
--    with the names they were made with).
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.rate_limit_hit('delete-account:' || v_uid::text, 5, 3600) then
    raise exception 'rate_limited: too many attempts, try again later';
  end if;
  perform public.prepare_account_deletion(v_uid); -- raises deletion_blocked
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Download my data. SECURITY INVOKER: row-level security decides what is
--    included, so it can never contain anyone else's private records.
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'artist', (select to_jsonb(a) from public.artists a where a.id = v_uid),
    'promoter', (select to_jsonb(p) from public.promoters p where p.id = v_uid),
    'tracks', coalesce((select jsonb_agg(to_jsonb(t)) from public.artist_tracks t where t.artist_id = v_uid), '[]'),
    'applications', coalesce((select jsonb_agg(to_jsonb(x)) from public.applications x), '[]'),
    'bookings', coalesce((select jsonb_agg(to_jsonb(x)) from public.bookings x), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(x)) from public.notifications x where x.profile_id = v_uid), '[]'),
    'saved_slots', coalesce((select jsonb_agg(to_jsonb(x)) from public.saved_slots x where x.profile_id = v_uid), '[]'),
    'message_threads', coalesce((select jsonb_agg(to_jsonb(x)) from public.message_threads x), '[]'),
    'messages', coalesce((select jsonb_agg(to_jsonb(x)) from public.messages x), '[]'),
    'reports_made', coalesce((select jsonb_agg(to_jsonb(x)) from public.reports x where x.reporter_id = v_uid), '[]'),
    'support_requests', coalesce((select jsonb_agg(to_jsonb(x)) from public.support_requests x where x.profile_id = v_uid), '[]')
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Contact support — works signed in or out (someone locked out can't be
--    asked to log in first). Limited per account / per address / per network
--    address so it can't be used to flood the staff inbox.
-- ---------------------------------------------------------------------------
create or replace function public.submit_support_request(p_topic text, p_message text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
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
revoke all on function public.submit_support_request(text, text, text) from public;
grant execute on function public.submit_support_request(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Expire stale offers. There is no scheduler, so the app asks (it is safe
--    and idempotent: only offers already past their deadline are touched).
--    Optionally also schedule it with pg_cron:
--      select cron.schedule('expire-offers', '*/15 * * * *', 'select public.expire_stale_offers()');
-- ---------------------------------------------------------------------------
create or replace function public.refresh_expired_offers()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.rate_limit_hit('expire-offers:' || auth.uid()::text, 20, 60) then return 0; end if;
  return public.expire_stale_offers();
end;
$$;
revoke all on function public.refresh_expired_offers() from public, anon;
grant execute on function public.refresh_expired_offers() to authenticated;
