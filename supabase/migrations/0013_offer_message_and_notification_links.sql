-- Support Slot — 0013: offer messages appear in Messages; notifications link to the exact item.
--
-- 1. When a promoter sends an offer with an optional message, that message is now
--    also posted into the conversation for that application, so both people see it
--    in the Messages tab (and the artist gets the usual "new message" notification).
--    The message is still stored on the booking and shown with the offer terms.
-- 2. notify() works out a precise link for application/booking notifications:
--      artist   '/application/<application id>'
--      promoter '/listing/<listing id>'
--    so tapping a notification opens the right screen instead of just a tab.
--    Notifications that carry no booking/application id keep their old links.
--
-- No rows are changed. Run after 0001–0012, once.

-- 1. -------------------------------------------------------------------------
create or replace function public.make_offer(p_application_id uuid, p_message text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
  v_artist public.artists;
  v_promoter public.promoters;
  v_venue public.venues;
  v_travel integer;
  v_expires timestamptz;
  v_booking_id uuid;
  v_note text := nullif(btrim(coalesce(p_message, '')), '');
  v_thread uuid;
begin
  if p_message is not null and length(p_message) > 1000 then
    raise exception 'offer_invalid: message is too long (max 1000 characters)';
  end if;
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  if v_slot.status <> 'open' then raise exception 'listing_not_open'; end if;
  if v_slot.date < public.london_today() then raise exception 'listing_past'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.status not in ('submitted', 'viewed', 'shortlisted') then
    raise exception 'invalid_transition: a % application can''t receive an offer', v_app.status;
  end if;
  if exists (select 1 from public.bookings where slot_id = v_slot.id and status = 'confirmed') then
    raise exception 'slot_filled';
  end if;
  if public._promoter_blocked_by(v_app.artist_id, v_uid) then
    raise exception 'blocked: you can''t make this artist an offer';
  end if;
  if exists (select 1 from public.profiles where id = v_app.artist_id and suspended_at is not null) then
    raise exception 'offer_invalid: that artist''s account is unavailable';
  end if;

  select * into v_artist from public.artists where id = v_app.artist_id;
  select * into v_promoter from public.promoters where id = v_slot.promoter_id;
  select * into v_venue from public.venues where id = v_slot.venue_id;
  if v_artist.id is null or v_promoter.id is null or v_venue.id is null then
    raise exception 'offer_invalid: missing profile or venue data';
  end if;

  select t.travel_pence into v_travel
    from public._travel_terms(v_slot.travel_contribution * 100, v_artist.id, v_slot.lat, v_slot.lon) t;
  -- An offer lasts 7 days, but never ends before the show or sooner than 2 hours from now.
  v_expires := greatest(
    now() + interval '2 hours',
    least(now() + interval '7 days', (v_slot.date::timestamp at time zone 'Europe/London'))
  );

  insert into public.bookings (
    application_id, slot_id, artist_id, promoter_id, status,
    artist_name, promoter_company, headliner, venue_id, venue_name, venue_address, venue_city,
    event_date, doors_time, set_time, set_length_mins, requirements,
    fee_pence, travel_pence, offer_message, offer_expires_at
  ) values (
    p_application_id, v_slot.id, v_artist.id, v_promoter.id, 'offered',
    v_artist.name, v_promoter.company, v_slot.headliner, v_venue.id, v_venue.name, v_venue.address, v_venue.city,
    v_slot.date, v_slot.doors_time, v_slot.set_time, v_slot.performance_length_mins, v_slot.requirements,
    v_slot.support_fee * 100, v_travel, v_note, v_expires
  ) returning id into v_booking_id;

  update public.applications
    set status = 'offered', status_changed_at = now(), viewed_at = coalesce(viewed_at, now())
    where id = p_application_id;

  -- The optional message also goes into the conversation, so it's in Messages for both people.
  if v_note is not null then
    v_thread := public.open_application_thread(p_application_id);
    insert into public.messages (thread_id, sender_id, text) values (v_thread, v_uid, v_note);
  end if;

  perform public.notify(v_app.artist_id, 'offer',
    v_promoter.company || ' offered you the support slot at ' || v_venue.name || ' (' || v_slot.headliner || ') — review the terms and accept or decline.',
    '/applications', 'offer:' || v_booking_id::text, true);
  return v_booking_id;
end;
$$;

-- 2. -------------------------------------------------------------------------
create or replace function public.notify(
  p_profile_id uuid, p_type text, p_text text, p_href text,
  p_dedupe_key text default null, p_email boolean default false
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_href text := p_href;
  v_key_kind text;
  v_id uuid;
  v_app uuid;
  v_slot uuid;
begin
  if p_profile_id is null then return; end if;

  -- Work out an exact link from the id inside the dedupe key (e.g. 'offer:<booking id>').
  if p_href in ('/applications', '/dashboard/promoter') and p_dedupe_key is not null then
    v_key_kind := split_part(p_dedupe_key, ':', 1);
    if v_key_kind = 'invite' and p_href = '/applications' then
      v_href := '/requests';
    elsif p_dedupe_key ~ ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
      v_id := substring(p_dedupe_key from ':([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')::uuid;
      select b.application_id into v_app from public.bookings b where b.id = v_id;
      if v_app is null then select a.id into v_app from public.applications a where a.id = v_id; end if;
      if v_app is not null then
        if p_href = '/applications' then
          v_href := '/application/' || v_app::text;
        else
          select a.slot_id into v_slot from public.applications a where a.id = v_app;
          if v_slot is not null then v_href := '/listing/' || v_slot::text; end if;
        end if;
      end if;
    end if;
  end if;

  insert into public.notifications (profile_id, type, text, href, dedupe_key)
  values (p_profile_id, p_type, p_text, v_href, p_dedupe_key)
  on conflict do nothing;
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text, boolean) from public, anon, authenticated;
