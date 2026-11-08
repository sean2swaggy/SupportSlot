-- Support Slot — 0014: promoter teams ("Build a team").
--
-- A promoter (the owner) can invite up to 5 other promoter accounts, by email, to help
-- book people. A person is on at most one team. Once they accept, a team member can do
-- the booking work for the owner's listings: post and edit listings, shortlist, decline,
-- make and withdraw offers, cancel bookings, and message artists. They see the owner's
-- listings, applicants, bookings and conversations.
--
-- Not shared with the team (owner only): the artist roster, availability requests,
-- templates, show schedules, gig invitations, account settings, and reviews.
--
-- One rule decides everything: public.acts_for_promoter(owner). It is true for the owner
-- themself and for an ACTIVE team member of that owner. Every place that used to ask
-- "is this person the promoter?" now asks it instead. Run after 0001–0013, once.

-- 1. The team table -----------------------------------------------------------
-- table: promoter_team_members
create table public.promoter_team_members (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,   -- the owner
  member_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (promoter_id, member_id),
  check (promoter_id <> member_id)
);
create index promoter_team_members_member_idx on public.promoter_team_members (member_id);
-- A person can be an active member of only one team.
create unique index promoter_team_one_active_team on public.promoter_team_members (member_id) where status = 'active';

alter table public.promoter_team_members enable row level security;
create policy "promoter_team: owner or member read" on public.promoter_team_members for select to authenticated
  using (promoter_id = (select auth.uid()) or member_id = (select auth.uid()));
create policy "active_session_required" on public.promoter_team_members as restrictive for all to authenticated
  using ((select public.session_is_active())) with check ((select public.session_is_active()));
revoke all on public.promoter_team_members from public, anon, authenticated;
grant select on public.promoter_team_members to authenticated;   -- writes only through the functions below

-- 2. The one rule -------------------------------------------------------------
create or replace function public.acts_for_promoter(p_promoter uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and p_promoter is not null and (
    p_promoter = auth.uid()
    or exists (select 1 from public.promoter_team_members t
               where t.promoter_id = p_promoter and t.member_id = auth.uid() and t.status = 'active'))
$$;
revoke all on function public.acts_for_promoter(uuid) from public, anon;
grant execute on function public.acts_for_promoter(uuid) to authenticated;

-- 3. Notification types -------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'viewed','shortlisted','urgent','booked','message','availability_request','availability_response',
  'offer','offer_accepted','offer_declined','application_declined','application_withdrawn',
  'booking_cancelled','listing_changed','report_update','system','invitation',
  'review_received','saved_search','team_invite','team_update']));

-- 4. Invite, accept, leave or remove, and a view of my team -------------------
create or replace function public.invite_team_member(p_email text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public._require_active_user();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_member uuid;
  v_company text;
  v_id uuid;
begin
  select company into v_company from public.promoters where id = v_uid;
  if v_company is null then raise exception 'forbidden: only promoters can build a team'; end if;
  if exists (select 1 from public.promoter_team_members where member_id = v_uid and status = 'active') then
    raise exception 'forbidden: you''re on someone else''s team, so you can''t build your own';
  end if;
  if not public.rate_limit_hit('team-invite:' || v_uid::text, 20, 3600) then
    raise exception 'rate_limited: too many invitations — please wait a while';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'invalid_email: enter a valid email address';
  end if;
  select p.id into v_member from public.profiles p
    where lower(p.email) = v_email and p.role = 'promoter' and p.suspended_at is null
      and exists (select 1 from public.promoters x where x.id = p.id);
  if v_member is null then
    raise exception 'not_found: there''s no promoter account with that email. Ask them to sign up as a promoter first.';
  end if;
  if v_member = v_uid then raise exception 'invalid: you can''t invite yourself'; end if;
  if (select count(*) from public.promoter_team_members where promoter_id = v_uid) >= 5 then
    raise exception 'limit_reached: a team holds up to 5 people';
  end if;
  if exists (select 1 from public.promoter_team_members where promoter_id = v_uid and member_id = v_member) then
    raise exception 'already_invited: that person is already invited or on your team';
  end if;
  if exists (select 1 from public.promoter_team_members where promoter_id = v_member and status = 'active') then
    raise exception 'invalid: that person already runs their own team';
  end if;
  insert into public.promoter_team_members (promoter_id, member_id) values (v_uid, v_member) returning id into v_id;
  perform public.notify(v_member, 'team_invite', v_company || ' invited you to join their team on Support Slot.', '/team', 'teaminvite:' || v_id::text, false);
  return v_id;
end;
$$;

create or replace function public.respond_team_invite(p_promoter_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public._require_active_user();
  v_row public.promoter_team_members;
  v_name text;
begin
  select * into v_row from public.promoter_team_members where promoter_id = p_promoter_id and member_id = v_uid for update;
  if not found or v_row.status <> 'pending' then raise exception 'not_found: that invitation is no longer open'; end if;
  select coalesce((select company from public.promoters where id = v_uid), 'Someone') into v_name;
  if p_accept then
    if exists (select 1 from public.promoter_team_members where member_id = v_uid and status = 'active') then
      raise exception 'invalid: you''re already on a team. Leave it first.';
    end if;
    if exists (select 1 from public.promoter_team_members where promoter_id = v_uid and status = 'active') then
      raise exception 'invalid: you run a team of your own, so you can''t join another';
    end if;
    update public.promoter_team_members set status = 'active', accepted_at = now() where id = v_row.id;
    perform public.notify(p_promoter_id, 'team_update', v_name || ' joined your team.', '/team', 'teamjoin:' || v_row.id::text, false);
  else
    delete from public.promoter_team_members where id = v_row.id;
    perform public.notify(p_promoter_id, 'team_update', v_name || ' declined your team invitation.', '/team', 'teamdecline:' || v_row.id::text, false);
  end if;
end;
$$;

create or replace function public.remove_team_member(p_promoter_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public._require_active_user();
  v_row public.promoter_team_members;
  v_name text;
begin
  if v_uid not in (p_promoter_id, p_member_id) then raise exception 'not_authorized'; end if;
  delete from public.promoter_team_members where promoter_id = p_promoter_id and member_id = p_member_id returning * into v_row;
  if not found then raise exception 'not_found: that person isn''t on the team'; end if;
  select coalesce((select company from public.promoters where id = v_uid), 'Someone') into v_name;
  if v_uid = p_promoter_id then
    perform public.notify(p_member_id, 'team_update', v_name || ' removed you from their team.', '/team', 'teamremoved:' || v_row.id::text, false);
  else
    perform public.notify(p_promoter_id, 'team_update', v_name || ' left your team.', '/team', 'teamleft:' || v_row.id::text, false);
  end if;
end;
$$;

-- The caller's team: the people they invited, and any team they've been invited to or joined.
create or replace function public.team_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public._require_active_user();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'promoter_id', t.promoter_id, 'member_id', t.member_id, 'status', t.status, 'invited_at', t.invited_at,
      'owner_name', coalesce(po.company, 'A promoter'),
      'member_name', coalesce(pm.company, pr.username, 'A promoter'),
      'member_email', case when t.promoter_id = v_uid then pr.email else null end)
      order by t.invited_at)
    from public.promoter_team_members t
    left join public.promoters po on po.id = t.promoter_id
    left join public.promoters pm on pm.id = t.member_id
    left join public.profiles pr on pr.id = t.member_id
    where t.promoter_id = v_uid or t.member_id = v_uid), '[]'::jsonb);
end;
$$;

revoke all on function public.invite_team_member(text) from public, anon;
revoke all on function public.respond_team_invite(uuid, boolean) from public, anon;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
revoke all on function public.team_overview() from public, anon;
grant execute on function public.invite_team_member(text) to authenticated;
grant execute on function public.respond_team_invite(uuid, boolean) to authenticated;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
grant execute on function public.team_overview() to authenticated;

-- 5. Let team members through every promoter-only check -----------------------
-- Each existing function is re-created with one or two exact lines swapped for the new rule.
-- If a line isn't found exactly as expected the whole migration stops, so nothing is half-changed.
do $$
declare
  patch record;
  v_oid oid;
  v_def text;
begin
  for patch in select * from (values
    ('close_slot', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                   'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('cancel_slot', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                    'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('reschedule_slot', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                        'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('decline_application', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                            'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('mark_application_viewed', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                                'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('shortlist_application', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                              'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('withdraw_offer', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                       'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('make_offer', 'if v_slot.promoter_id <> v_uid then raise exception ''not_authorized''; end if;',
                   'if not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('make_offer', 'if public._promoter_blocked_by(v_app.artist_id, v_uid) then',
                   'if public._promoter_blocked_by(v_app.artist_id, v_slot.promoter_id) then'),
    ('cancel_booking', 'if v_uid not in (v_booking.artist_id, v_booking.promoter_id) then raise exception ''not_authorized''; end if;',
                       'if v_uid not in (v_booking.artist_id, v_booking.promoter_id) and not public.acts_for_promoter(v_booking.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('mark_thread_read', 'if not found or v_uid not in (v_thread.artist_id, v_thread.promoter_id) then raise exception ''not_authorized''; end if;',
                         'if not found or (v_uid <> v_thread.artist_id and not public.acts_for_promoter(v_thread.promoter_id)) then raise exception ''not_authorized''; end if;'),
    ('open_application_thread', 'if v_uid not in (v_app.artist_id, v_slot.promoter_id) then raise exception ''not_authorized''; end if;',
                                'if v_uid <> v_app.artist_id and not public.acts_for_promoter(v_slot.promoter_id) then raise exception ''not_authorized''; end if;'),
    ('open_application_thread', 'if v_uid = v_slot.promoter_id and public._promoter_blocked_by(v_app.artist_id, v_slot.promoter_id) then',
                                'if v_uid <> v_app.artist_id and public._promoter_blocked_by(v_app.artist_id, v_slot.promoter_id) then'),
    ('terms_preview', 'v_promoter_view := v_slot.promoter_id = v_uid and v_artist <> v_uid;',
                      'v_promoter_view := public.acts_for_promoter(v_slot.promoter_id) and v_artist <> v_uid;'),
    ('terms_preview', 'elsif v_slot.promoter_id = v_uid then',
                      'elsif public.acts_for_promoter(v_slot.promoter_id) then'),
    ('messages_guard', 'if new.sender_id not in (v_thread.artist_id, v_thread.promoter_id) then raise exception ''not_authorized''; end if;',
                       'if new.sender_id not in (v_thread.artist_id, v_thread.promoter_id) and not exists (select 1 from public.promoter_team_members tm where tm.promoter_id = v_thread.promoter_id and tm.member_id = new.sender_id and tm.status = ''active'') then raise exception ''not_authorized''; end if;'),
    ('messages_guard', 'if new.sender_id = v_thread.promoter_id',
                       'if new.sender_id <> v_thread.artist_id'),
    ('export_my_data', '''gig_diary'', coalesce((select jsonb_agg(to_jsonb(d) order by d.show_date) from public.gig_diary_entries d where d.artist_id = v_uid), ''[]'')',
                       '''gig_diary'', coalesce((select jsonb_agg(to_jsonb(d) order by d.show_date) from public.gig_diary_entries d where d.artist_id = v_uid), ''[]''), ''team'', coalesce((select jsonb_agg(to_jsonb(t)) from public.promoter_team_members t where t.promoter_id = v_uid or t.member_id = v_uid), ''[]'')')
  ) as t(fn, old_text, new_text)
  loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = patch.fn) <> 1 then
      raise exception 'patch failed: expected exactly one function named %', patch.fn;
    end if;
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = patch.fn;
    v_def := pg_get_functiondef(v_oid);
    if position(patch.old_text in v_def) = 0 then
      raise exception 'patch failed: % does not contain the expected text: %', patch.fn, patch.old_text;
    end if;
    execute replace(v_def, patch.old_text, patch.new_text);
  end loop;
end $$;

-- 6. Row-level rules: team members see and write the owner's booking data ------
drop policy "applications: select participant" on public.applications;
create policy "applications: select participant" on public.applications for select using (
  artist_id = auth.uid()
  or exists (select 1 from public.slots s where s.id = applications.slot_id and public.acts_for_promoter(s.promoter_id)));

drop policy "bookings: select participant" on public.bookings;
create policy "bookings: select participant" on public.bookings for select using (
  artist_id = auth.uid() or public.acts_for_promoter(promoter_id));

drop policy "message_threads: select participant" on public.message_threads;
create policy "message_threads: select participant" on public.message_threads for select using (
  artist_id = auth.uid() or public.acts_for_promoter(promoter_id));

drop policy "message_threads: update participant" on public.message_threads;
create policy "message_threads: update participant" on public.message_threads for update using (
  artist_id = auth.uid() or public.acts_for_promoter(promoter_id));

drop policy "messages: select participant" on public.messages;
create policy "messages: select participant" on public.messages for select using (
  exists (select 1 from public.message_threads t where t.id = messages.thread_id
          and (t.artist_id = auth.uid() or public.acts_for_promoter(t.promoter_id))));

drop policy "messages: insert as self" on public.messages;
create policy "messages: insert as self" on public.messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from public.message_threads t where t.id = messages.thread_id
              and (t.artist_id = auth.uid() or public.acts_for_promoter(t.promoter_id))));

drop policy "slots: insert own" on public.slots;
create policy "slots: insert own" on public.slots for insert with check (
  (promoter_id = auth.uid() or public.acts_for_promoter(promoter_id))
  and exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'promoter'));

drop policy "slots: update own" on public.slots;
create policy "slots: update own" on public.slots for update
  using (public.acts_for_promoter(promoter_id)) with check (public.acts_for_promoter(promoter_id));
