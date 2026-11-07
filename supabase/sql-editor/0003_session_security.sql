-- Support Slot — 0003: database-enforced 2FA, suspension, and permission hardening.
--
-- Run after 0001 and 0002, once. Safe on a populated project: it only adds
-- policies, tightens grants and replaces function bodies; no rows are changed
-- (one constraint is widened, see section 9).
--
-- Why: until now two-factor authentication was enforced by the app only, so a
-- person holding a password-only (aal1) session could call the REST API
-- directly. Supabase's guidance is to check the `aal` claim of the JWT in
-- row-level security. This file does that, in one place, and adds the
-- suspension check to the same place so that a session issued BEFORE an
-- account was suspended stops working on the very next request.
--
-- Three levels of access:
--   public visitor (anon key, no login)  -> public listings, public artist and
--                                           promoter profiles, venues, tracks,
--                                           past/upcoming shows, search_slots(),
--                                           submit_support_request().
--   signed in, password only (aal1)      -> NOTHING from the data API. The person
--                                           may enrol or verify a TOTP factor
--                                           (that is the Auth API, not this one)
--                                           and may submit a support request as
--                                           if anonymous.
--   signed in with a verified factor     -> (aal2) what their role and the row
--     (aal2) and not suspended              policies allow.
--   aal2 but suspended                   -> my_account_status(), export_my_data(),
--                                           delete_my_account() and
--                                           submit_support_request() only.
-- See docs/PERMISSIONS.md for the full matrix; tests/db/session-security.test.ts
-- proves it.

-- ---------------------------------------------------------------------------
-- 1. Session helpers. Identity and assurance come from the verified JWT
--    (auth.uid(), auth.jwt()), never from anything the client sends.
-- ---------------------------------------------------------------------------

-- aal2 session for an existing account (suspended or not).
create or replace function public.session_is_aal2()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.profiles p where p.id = auth.uid())
$$;

-- aal2 session for an account in good standing. This is what every policy checks.
create or replace function public.session_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended_at is null)
$$;

create or replace function public._require_active_user()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'mfa_required'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid and suspended_at is not null) then
    raise exception 'account_suspended';
  end if;
  return v_uid;
end;
$$;

-- Staff powers need a live aal2 session too.
create or replace function public.current_admin_role()
returns text language sql stable security definer set search_path = public as $$
  select p.admin_role from public.profiles p where p.id = auth.uid() and public.session_is_active()
$$;

create or replace function public._staff_actor(p_min text default 'moderator')
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_role text := public.current_admin_role();
begin
  if v_role is null or (p_min = 'admin' and v_role <> 'admin') then
    raise exception 'not_authorized';
  end if;
  return v_uid;
end;
$$;

-- What the app asks first, once it holds an aal2 session: who am I, am I set
-- up, am I suspended? Works for a suspended account (the one thing it can see).
create or replace function public.my_account_status()
returns table(role text, has_onboarded boolean, suspended boolean, suspension_reason text, admin_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'mfa_required'; end if;
  return query
    select p.role, p.has_onboarded, p.suspended_at is not null, p.suspension_reason,
           case when p.suspended_at is null then p.admin_role else null end
    from public.profiles p where p.id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Restrictive policy on EVERY table in public: signed-in API calls need an
--    aal2 session in good standing, whatever the permissive policies say.
--    (Restrictive policies are ANDed with the permissive ones. service_role and
--    the postgres owner bypass RLS, as before. Anonymous visitors are not the
--    `authenticated` role, so public reads are unaffected.)
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('drop policy if exists "aal2_active_session_required" on public.%I', t.tablename);
    execute format(
      'create policy "aal2_active_session_required" on public.%I as restrictive for all to authenticated '
      'using ((select public.session_is_active())) with check ((select public.session_is_active()))', t.tablename);
  end loop;
end $$;

-- Policy helper functions: also false for anything but an active aal2 session,
-- so they cannot be used as an oracle from a password-only session.
create or replace function public.caller_is_promoter() returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_is_active()
     and exists (select 1 from public.profiles where id = auth.uid() and role = 'promoter');
$$;
create or replace function public.is_open_availability_request(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_is_active() and exists (
    select 1 from public.availability_requests
    where id = p_request_id and status = 'sent' and response_deadline > now());
$$;
create or replace function public.is_recipient_of_availability_request(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_is_active() and exists (
    select 1 from public.availability_request_recipients
    where request_id = p_request_id and artist_id = auth.uid());
$$;
create or replace function public.owns_availability_request(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_is_active() and exists (
    select 1 from public.availability_requests where id = p_request_id and promoter_id = auth.uid());
$$;
create or replace function public.owns_schedule_template(p_template_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_is_active() and exists (
    select 1 from public.schedule_templates where id = p_template_id and promoter_id = auth.uid());
$$;
create or replace function public.owns_show_schedule(p_schedule_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_is_active() and exists (
    select 1 from public.show_schedules where id = p_schedule_id and promoter_id = auth.uid());
$$;

-- Needs an active session (it used to answer anyone, which allowed
-- enumerating usernames from the anon key).
create or replace function public.is_username_available(p_username text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_active_user();
  return not exists (select 1 from public.profiles where lower(username) = lower(p_username));
end;
$$;

create or replace function public.claim_schedule_version(p_schedule_id uuid, p_expected_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_new_version integer;
begin
  perform public._require_active_user();
  if not public.caller_is_promoter() then raise exception 'promoter_required'; end if;
  update public.show_schedules
    set version = version + 1, updated_at = now()
    where id = p_schedule_id and promoter_id = auth.uid() and version = p_expected_version
    returning version into v_new_version;
  if v_new_version is null then raise exception 'stale_schedule_version'; end if;
  return v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Account functions. Export and deletion work for a suspended person (they
--    are rights, not features) but need aal2: it is a destructive, sensitive
--    action and the session must have proved the second factor.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.session_is_aal2() then raise exception 'mfa_required'; end if;
  if not public.rate_limit_hit('delete-account:' || v_uid::text, 5, 3600) then
    raise exception 'rate_limited: too many attempts, try again later';
  end if;
  perform public.prepare_account_deletion(v_uid); -- raises deletion_blocked
  delete from auth.users where id = v_uid;
end;
$$;

create or replace function public.refresh_expired_offers()
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform public._require_active_user();
  if not public.rate_limit_hit('expire-offers:' || auth.uid()::text, 20, 60) then return 0; end if;
  return public.expire_stale_offers();
end;
$$;

-- Support requests: anonymous, or a person who may be locked out. A password-
-- only (aal1) session is treated as anonymous (must give an address) so it
-- cannot be used to read the profile's email.
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

-- ---------------------------------------------------------------------------
-- 4. Staff: unsuspend reported "not found" never fired (PERFORM resets FOUND).
-- ---------------------------------------------------------------------------
create or replace function public.admin_unsuspend_user(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._staff_actor();
  v_rows integer;
begin
  perform set_config('app.staff_bypass', '1', true);
  update public.profiles set suspended_at = null, suspension_reason = null where id = p_profile_id;
  get diagnostics v_rows = row_count;
  perform set_config('app.staff_bypass', '0', true);
  if v_rows = 0 then raise exception 'not_found'; end if;
  perform public._audit('user.unsuspend', 'profile', p_profile_id::text, '{}');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Mass-assignment guards. The permissive policies let an owner UPDATE a row
--    but not which columns; these triggers fix that for tables where the
--    other party's data or a trust signal lives in the same row.
-- ---------------------------------------------------------------------------

-- Client-writable trust signals: promoters.shows_posted was never maintained
-- and could simply be typed in. Verification was already guarded.
create or replace function public.prevent_client_trust_field_tamper() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'authenticated' or current_setting('app.staff_bypass', true) = '1' then
    return new;
  end if;

  if tg_table_name in ('artists', 'promoters') then
    if tg_op = 'INSERT' then
      if new.verification is distinct from 'unverified' then
        raise exception 'Verification can only be set by the platform.';
      end if;
    else
      if new.verification is distinct from old.verification then
        raise exception 'Verification can only be changed by the platform.';
      end if;
    end if;
  end if;
  if tg_table_name = 'promoters' then
    if tg_op = 'INSERT' then new.shows_posted := 0;
    else new.shows_posted := old.shows_posted; end if;
  elsif tg_table_name = 'applications' and tg_op = 'UPDATE' then
    if new.artist_id is distinct from old.artist_id or new.slot_id is distinct from old.slot_id then
      raise exception 'artist_id and slot_id cannot be changed after submission.';
    end if;
  end if;
  return new;
end;
$$;

-- Notifications: the owner may mark them read, nothing else.
create or replace function public.notifications_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' and (
       new.id is distinct from old.id or new.profile_id is distinct from old.profile_id
    or new.type is distinct from old.type or new.text is distinct from old.text
    or new.href is distinct from old.href or new.created_at is distinct from old.created_at
    or new.dedupe_key is distinct from old.dedupe_key) then
    raise exception 'notification_invalid: only the read state can be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_guard_bu on public.notifications;
create trigger notifications_guard_bu before update on public.notifications
  for each row execute function public.notifications_guard();

-- Threads: a participant can never re-point a conversation at someone else.
create or replace function public.message_threads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' and (
       new.id is distinct from old.id or new.artist_id is distinct from old.artist_id
    or new.promoter_id is distinct from old.promoter_id or new.context is distinct from old.context
    or new.application_id is distinct from old.application_id or new.created_at is distinct from old.created_at) then
    raise exception 'thread_invalid: a conversation''s participants and context cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger if exists message_threads_guard_bu on public.message_threads;
create trigger message_threads_guard_bu before update on public.message_threads
  for each row execute function public.message_threads_guard();

-- Gig invitations: the artist answers, the promoter withdraws; nobody edits
-- the other's side, the slot, or the people involved.
create unique index if not exists gig_invitations_one_live_per_artist_slot
  on public.gig_invitations (slot_id, artist_id) where status in ('pending', 'accepted');

create or replace function public.gig_invitations_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_slot public.slots;
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    select * into v_slot from public.slots where id = new.slot_id;
    if not found or v_slot.promoter_id <> new.promoter_id then raise exception 'not_authorized'; end if;
    if v_slot.status <> 'open' or v_slot.date < public.london_today() then raise exception 'listing_not_open'; end if;
    if new.status <> 'pending' or new.linked_application_id is not null or new.responded_at is not null then
      raise exception 'invitation_invalid: a new invitation must be pending';
    end if;
    if exists (select 1 from public.promoter_blocks b where b.artist_id = new.artist_id and b.promoter_id = new.promoter_id) then
      raise exception 'blocked: you can''t invite this artist';
    end if;
    if exists (select 1 from public.profiles where id = new.artist_id and suspended_at is not null) then
      raise exception 'invitation_invalid: that artist can''t be invited right now';
    end if;
    if new.message is not null and length(new.message) > 1000 then raise exception 'invitation_invalid: message is too long (max 1000 characters)'; end if;
    if (select count(*) from public.gig_invitations where promoter_id = new.promoter_id and created_at > now() - interval '1 hour') >= 30 then
      raise exception 'rate_limited: too many invitations in the last hour';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.slot_id is distinct from old.slot_id
     or new.promoter_id is distinct from old.promoter_id or new.artist_id is distinct from old.artist_id
     or new.message is distinct from old.message or new.created_at is distinct from old.created_at then
    raise exception 'invitation_invalid: only the response can change';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'invalid_transition: this invitation was already answered'; end if;
    if v_uid = old.artist_id and new.status in ('accepted', 'declined') then null;
    elsif v_uid = old.promoter_id and new.status = 'withdrawn' then null;
    else raise exception 'invalid_transition: you can''t set an invitation to %', new.status; end if;
  end if;
  if new.linked_application_id is distinct from old.linked_application_id then
    if v_uid <> old.artist_id or not exists (
         select 1 from public.applications a where a.id = new.linked_application_id and a.artist_id = old.artist_id and a.slot_id = old.slot_id) then
      raise exception 'invitation_invalid: that application doesn''t belong to this invitation';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists gig_invitations_guard_biu on public.gig_invitations;
create trigger gig_invitations_guard_biu before insert or update on public.gig_invitations
  for each row execute function public.gig_invitations_guard();

-- Availability replies: only the artist answers; only the promoter links.
create or replace function public.availability_recipients_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    if new.response <> 'pending' or new.responded_at is not null or new.thread_id is not null
       or new.linked_application_id is not null or new.question_asked then
      raise exception 'availability_invalid: a new recipient must be pending';
    end if;
    if exists (select 1 from public.profiles where id = new.artist_id and suspended_at is not null) then
      raise exception 'availability_invalid: that artist can''t be asked right now';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.request_id is distinct from old.request_id or new.artist_id is distinct from old.artist_id then
    raise exception 'availability_invalid: recipients can''t be changed';
  end if;
  if v_uid = old.artist_id then
    if new.linked_application_id is distinct from old.linked_application_id or new.notified_at is distinct from old.notified_at then
      raise exception 'availability_invalid: you can only change your own reply';
    end if;
    if new.thread_id is distinct from old.thread_id and not exists (
         select 1 from public.message_threads t where t.id = new.thread_id and t.artist_id = old.artist_id) then
      raise exception 'availability_invalid: that conversation isn''t yours';
    end if;
  else
    -- The promoter side may not answer for the artist.
    if new.response is distinct from old.response or new.responded_at is distinct from old.responded_at
       or new.question_asked is distinct from old.question_asked or new.thread_id is distinct from old.thread_id then
      raise exception 'availability_invalid: only the artist can reply';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists availability_recipients_guard_biu on public.availability_request_recipients;
create trigger availability_recipients_guard_biu before insert or update on public.availability_request_recipients
  for each row execute function public.availability_recipients_guard();

-- Availability requests: ownership is fixed; a linked listing must be the owner's.
create or replace function public.availability_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.promoter_id is distinct from old.promoter_id then
      raise exception 'availability_invalid: ownership cannot change';
    end if;
    if new.status is distinct from old.status and not (old.status = 'sent' and new.status in ('withdrawn', 'filled')) then
      raise exception 'invalid_transition: a % request can''t become %', old.status, new.status;
    end if;
  end if;
  if new.linked_slot_id is not null and not exists (
       select 1 from public.slots s where s.id = new.linked_slot_id and s.promoter_id = new.promoter_id) then
    raise exception 'availability_invalid: that listing isn''t yours';
  end if;
  return new;
end;
$$;
drop trigger if exists availability_requests_guard_biu on public.availability_requests;
create trigger availability_requests_guard_biu before insert or update on public.availability_requests
  for each row execute function public.availability_requests_guard();

-- The applicant counter is maintained by a trigger on applications; it runs
-- inside the caller's session, so it must pass the slot field guard below.
create or replace function public.bump_applicant_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.slot_bypass', '1', true);
  if tg_op = 'INSERT' then
    update public.slots set applicant_count = applicant_count + 1 where id = new.slot_id;
  elsif tg_op = 'DELETE' then
    update public.slots set applicant_count = applicant_count - 1 where id = old.slot_id;
  end if;
  perform set_config('app.slot_bypass', '0', true);
  return null;
end;
$$;

-- Listings: counters and timestamps are the platform's, not the client's.
create or replace function public.slots_server_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'authenticated' or current_setting('app.slot_bypass', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then
    new.applicant_count := 0; new.posted_at := now();
    new.closed_at := null; new.closed_reason := null; new.rescheduled_at := null;
  else
    new.applicant_count := old.applicant_count; new.posted_at := old.posted_at;
    new.rescheduled_at := old.rescheduled_at;
    if new.status is not distinct from old.status then
      new.closed_at := old.closed_at; new.closed_reason := old.closed_reason;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists slots_aa_server_fields_biu on public.slots;
create trigger slots_aa_server_fields_biu before insert or update on public.slots
  for each row execute function public.slots_server_fields();

-- ---------------------------------------------------------------------------
-- 6. Notifications of invitations used a type the table did not allow, so
--    inviting an artist failed. Allow a proper 'invitation' type and use it.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'viewed','shortlisted','urgent','booked','message','availability_request','availability_response',
  'offer','offer_accepted','offer_declined','application_declined','application_withdrawn',
  'booking_cancelled','listing_changed','report_update','system','invitation']));

create or replace function public.notify_on_gig_invitation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_headliner text;
  v_promoter_company text;
  v_artist_name text;
begin
  if tg_op = 'INSERT' then
    select headliner into v_headliner from public.slots where id = new.slot_id;
    select company into v_promoter_company from public.promoters where id = new.promoter_id;
    insert into public.notifications (profile_id, type, text, href, dedupe_key)
    values (new.artist_id, 'invitation',
      coalesce(v_promoter_company, 'A promoter') || ' invited you to apply for ' || coalesce(v_headliner, 'a gig'),
      '/applications', 'invite:' || new.id::text)
    on conflict do nothing;
  elsif new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    select name into v_artist_name from public.artists where id = new.artist_id;
    insert into public.notifications (profile_id, type, text, href, dedupe_key)
    values (new.promoter_id, 'invitation',
      coalesce(v_artist_name, 'An artist') || ' ' || new.status || ' your invitation',
      '/dashboard/promoter', 'invite-' || new.status || ':' || new.id::text)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Blocking, enforced in SQL. An artist can block a promoter; from then on
--    the promoter cannot message them (messages_guard), open a thread
--    (open_application_thread), add them to an availability request (policy),
--    invite them (gig_invitations_guard) or make them an offer (make_offer).
--    Existing offers and confirmed bookings are NOT cancelled by a block: they
--    are commitments with their own cancel flow.
-- ---------------------------------------------------------------------------
create or replace function public._promoter_blocked_by(p_artist_id uuid, p_promoter_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.promoter_blocks b where b.artist_id = p_artist_id and b.promoter_id = p_promoter_id)
$$;
revoke all on function public._promoter_blocked_by(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Every SECURITY DEFINER function gets a pinned search_path (several trigger
--    functions in 0001 had none, so a schema earlier on the path could shadow
--    the tables they touch).
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Grants. Supabase grants everything to anon and authenticated by default;
--    row-level security is then the only barrier. Narrow the visitor (anon)
--    role to exactly what is public, and stop clients from holding write
--    privileges on tables that only SQL functions may change.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.slots, public.artists, public.artist_tracks, public.artist_shows,
                public.promoters, public.venues to anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges revoke execute on functions from public;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.london_today() to anon;
grant execute on function public.submit_support_request(text, text, text) to anon;
-- search_slots is (re)granted to anon by the migration that defines it.
grant execute on function public.search_slots(text, text, text, date, date, integer, text, text, text, integer, boolean, text, integer, integer) to anon;

-- Tables only SQL functions write: no direct write privileges for clients.
revoke insert, update, delete, truncate on public.bookings from authenticated;
revoke insert, update, delete, truncate on public.admin_audit_log from authenticated;
revoke all on public.rate_limits from authenticated;
revoke insert, update, delete, truncate on public.reports from authenticated;
revoke insert, update, delete, truncate on public.support_requests from authenticated;
revoke insert, update, delete, truncate on public.city_distances from authenticated;
revoke update, delete, truncate on public.applications from authenticated; -- insert stays (policies decide who)
