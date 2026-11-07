-- Support Slot — 0005: data export, and safe message retries.
--
-- Run after 0004.

-- ---------------------------------------------------------------------------
-- 1. Download my data.
--
-- Before: SECURITY INVOKER with `select to_jsonb(row)` over whole tables, so it
-- included staff-only columns (support_requests.staff_note / handled_by,
-- reports.resolution_note / reviewed_by, profiles.admin_role) and relied on
-- row-level security alone for scoping.
-- Now: SECURITY DEFINER, explicit owner filters and explicit column lists, so
-- the contents are what this function says and nothing else. It works for a
-- suspended account (an access right, not a feature) but needs an aal2 session.
--
-- Included: the person's own profile, artist/promoter record (with their own
-- private location), tracks and shows, their applications and the offers and
-- bookings they are a party to, conversations they are in (both sides'
-- messages, because the person took part in them), notifications, saved gigs,
-- reports and support requests THEY made (without staff notes), blocks they
-- set, and the promoter tools they own.
-- NOT included: staff notes, audit rows, other people's profiles or private
-- data, applications to other promoters' listings.
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.session_is_aal2() then raise exception 'mfa_required'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', p.id, 'role', p.role, 'email', p.email, 'username', p.username,
                  'created_at', p.created_at, 'has_onboarded', p.has_onboarded,
                  'notify_availability_requests', p.notify_availability_requests,
                  'suspended', p.suspended_at is not null)
                from public.profiles p where p.id = v_uid),
    'artist', (select to_jsonb(a) from public.artists a where a.id = v_uid),
    'artist_private_location', (select jsonb_build_object('lat', l.lat, 'lon', l.lon, 'precision', 'rounded to about 1 km', 'updated_at', l.updated_at)
                                from public.artist_locations l where l.artist_id = v_uid),
    'promoter', (select to_jsonb(p) from public.promoters p where p.id = v_uid),
    'tracks', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from public.artist_tracks t where t.artist_id = v_uid), '[]'),
    'shows', coalesce((select jsonb_agg(to_jsonb(s)) from public.artist_shows s where s.artist_id = v_uid), '[]'),
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'slot_id', x.slot_id, 'artist_id', x.artist_id, 'status', x.status,
               'message', x.message, 'submitted_at', x.submitted_at, 'viewed_at', x.viewed_at, 'status_changed_at', x.status_changed_at,
               'closed_reason', x.closed_reason))
      from public.applications x
      where x.artist_id = v_uid or exists (select 1 from public.slots s where s.id = x.slot_id and s.promoter_id = v_uid)), '[]'),
    'listings', coalesce((select jsonb_agg(to_jsonb(s)) from public.slots s where s.promoter_id = v_uid), '[]'),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b)) from public.bookings b where b.artist_id = v_uid or b.promoter_id = v_uid), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from public.notifications n where n.profile_id = v_uid), '[]'),
    'saved_slots', coalesce((select jsonb_agg(to_jsonb(s)) from public.saved_slots s where s.profile_id = v_uid), '[]'),
    'conversations', coalesce((select jsonb_agg(to_jsonb(t)) from public.message_threads t where t.artist_id = v_uid or t.promoter_id = v_uid), '[]'),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'thread_id', m.thread_id, 'sender_id', m.sender_id, 'text', m.text, 'created_at', m.created_at) order by m.created_at)
      from public.messages m join public.message_threads t on t.id = m.thread_id
      where t.artist_id = v_uid or t.promoter_id = v_uid), '[]'),
    'reports_made', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'context_type', r.context_type, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at))
      from public.reports r where r.reporter_id = v_uid), '[]'),
    'support_requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'topic', r.topic, 'message', r.message, 'status', r.status, 'created_at', r.created_at))
      from public.support_requests r where r.profile_id = v_uid), '[]'),
    'blocks', coalesce((select jsonb_agg(to_jsonb(b)) from public.promoter_blocks b where b.artist_id = v_uid or b.promoter_id = v_uid), '[]'),
    'gig_invitations', coalesce((select jsonb_agg(to_jsonb(i)) from public.gig_invitations i where i.artist_id = v_uid or i.promoter_id = v_uid), '[]'),
    'availability_requests', coalesce((select jsonb_agg(to_jsonb(r)) from public.availability_requests r where r.promoter_id = v_uid), '[]'),
    'availability_replies', coalesce((select jsonb_agg(to_jsonb(r)) from public.availability_request_recipients r where r.artist_id = v_uid), '[]'),
    'roster', coalesce((select jsonb_agg(to_jsonb(r)) from public.artist_roster r where r.promoter_id = v_uid), '[]'),
    'request_templates', coalesce((select jsonb_agg(to_jsonb(t)) from public.event_templates t where t.promoter_id = v_uid), '[]'),
    'show_schedules', coalesce((
      select jsonb_agg(jsonb_build_object('schedule', to_jsonb(s),
        'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.start_at) from public.schedule_entries e where e.schedule_id = s.id), '[]')))
      from public.show_schedules s where s.promoter_id = v_uid), '[]'),
    'schedule_templates', coalesce((
      select jsonb_agg(jsonb_build_object('template', to_jsonb(t),
        'entries', coalesce((select jsonb_agg(to_jsonb(e)) from public.schedule_template_entries e where e.template_id = t.id), '[]')))
      from public.schedule_templates t where t.promoter_id = v_uid), '[]'),
    'venues_added', coalesce((select jsonb_agg(to_jsonb(v)) from public.venues v where v.created_by = v_uid), '[]')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Messages: a retry of the same send must not create a second message.
--    The app generates `client_id` once per message and reuses it on retry.
-- ---------------------------------------------------------------------------
alter table public.messages add column client_id uuid;
alter table public.messages add constraint messages_sender_client_unique unique (sender_id, client_id);

-- Close the new objects to visitors, as in 0003/0004.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.london_today() to anon;
grant execute on function public.submit_support_request(text, text, text) to anon;
grant execute on function public.haversine_miles(double precision, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.search_slots(text, text, text, date, date, integer, text, text, double precision, double precision, integer, boolean, text, integer, integer) to anon, authenticated;
grant execute on function public.long_journey_miles() to anon, authenticated;
grant execute on function public.minimum_long_journey_travel_pence() to anon, authenticated;
