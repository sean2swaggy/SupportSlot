-- Support Slot — the application/booking state machine, as SQL functions.
--
-- Every transition runs in one transaction, checks who the caller is, checks
-- the current state, and locks rows in a fixed order (SLOT first, then the
-- application, then other applications by id) so two simultaneous requests
-- can't both succeed or deadlock: the second one waits, then sees the new
-- state and is refused with a clear error.
--
-- Valid transitions:
--   submitted  -> viewed | shortlisted | offered | declined | withdrawn
--   viewed     -> shortlisted | offered | declined | withdrawn
--   shortlisted-> offered | declined | withdrawn
--   offered    -> confirmed (artist accepts) | offer_declined (artist declines)
--                 | shortlisted (promoter withdraws offer / offer expires)
--                 | withdrawn | declined (slot filled / listing closed)
--   confirmed  -> cancelled (either party)
-- confirmed, declined, offer_declined, withdrawn, cancelled are otherwise terminal.
--
-- All functions raise exceptions whose message starts with a stable code
-- (e.g. "slot_filled", "invalid_transition") that src/lib/errors.ts maps to
-- plain-language text.

create or replace function public._app_slot_id(p_application_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select slot_id from public.applications where id = p_application_id
$$;
revoke all on function public._app_slot_id(uuid) from public, anon, authenticated;

create or replace function public._require_active_user()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_uid and suspended_at is not null) then
    raise exception 'account_suspended';
  end if;
  return v_uid;
end;
$$;
revoke all on function public._require_active_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Promoter: first genuine view of an application. Idempotent; only moves
-- submitted -> viewed, and only for the promoter who owns the slot — so a
-- "Viewed" badge on the artist's side can't be produced by anyone else.
-- ---------------------------------------------------------------------------
create or replace function public.mark_application_viewed(p_application_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
begin
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.status <> 'submitted' then return; end if;
  update public.applications
    set status = 'viewed', viewed_at = now(), status_changed_at = now()
    where id = p_application_id;
  perform public.notify(v_app.artist_id, 'viewed',
    v_slot.headliner || ': a promoter has looked at your application.',
    '/applications', 'viewed:' || p_application_id::text, false);
end;
$$;

create or replace function public.shortlist_application(p_application_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
begin
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.status not in ('submitted', 'viewed') then
    raise exception 'invalid_transition: a % application can''t be shortlisted', v_app.status;
  end if;
  update public.applications
    set status = 'shortlisted', status_changed_at = now(), viewed_at = coalesce(viewed_at, now())
    where id = p_application_id;
  perform public.notify(v_app.artist_id, 'shortlisted',
    'You were shortlisted for ' || v_slot.headliner,
    '/applications', 'shortlisted:' || p_application_id::text, false);
end;
$$;

create or replace function public.decline_application(p_application_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
begin
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.status not in ('submitted', 'viewed', 'shortlisted') then
    raise exception 'invalid_transition: a % application can''t be declined (withdraw the offer first if there is one)', v_app.status;
  end if;
  update public.applications
    set status = 'declined', closed_reason = 'promoter_declined', status_changed_at = now()
    where id = p_application_id;
  perform public.notify(v_app.artist_id, 'application_declined',
    'Update on your application to ' || v_slot.headliner || ': it wasn''t successful this time.',
    '/applications', 'declined:' || p_application_id::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Promoter: make an offer. Terms are computed HERE from the slot and artist
-- rows — a client can't pass its own amounts. Money in integer pence.
-- ---------------------------------------------------------------------------
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
  v_base integer;
  v_proc integer;
  v_expires timestamptz;
  v_booking_id uuid;
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

  select * into v_artist from public.artists where id = v_app.artist_id;
  select * into v_promoter from public.promoters where id = v_slot.promoter_id;
  select * into v_venue from public.venues where id = v_slot.venue_id;
  if v_artist.id is null or v_promoter.id is null or v_venue.id is null then
    raise exception 'offer_invalid: missing profile or venue data';
  end if;

  v_travel := public.effective_travel_pence(v_slot.travel_contribution * 100, v_artist.location, v_slot.city);
  v_base := v_slot.support_fee * 100 + v_travel + v_slot.booking_fee * 100;
  v_proc := public.processing_fee_pence(v_base);
  v_expires := greatest(
    now() + interval '2 hours',
    least(now() + interval '7 days', (v_slot.date::timestamp at time zone 'Europe/London'))
  );

  insert into public.bookings (
    application_id, slot_id, artist_id, promoter_id, status,
    artist_name, promoter_company, headliner, venue_id, venue_name, venue_address, venue_city,
    event_date, doors_time, set_time, set_length_mins, requirements,
    fee_pence, travel_pence, booking_fee_pence, processing_fee_pence, total_pence,
    offer_message, offer_expires_at
  ) values (
    p_application_id, v_slot.id, v_artist.id, v_promoter.id, 'offered',
    v_artist.name, v_promoter.company, v_slot.headliner, v_venue.id, v_venue.name, v_venue.address, v_venue.city,
    v_slot.date, v_slot.doors_time, v_slot.set_time, v_slot.performance_length_mins, v_slot.requirements,
    v_slot.support_fee * 100, v_travel, v_slot.booking_fee * 100, v_proc, v_base + v_proc,
    nullif(btrim(p_message), ''), v_expires
  ) returning id into v_booking_id;

  update public.applications
    set status = 'offered', status_changed_at = now(), viewed_at = coalesce(viewed_at, now())
    where id = p_application_id;

  perform public.notify(v_app.artist_id, 'offer',
    v_promoter.company || ' offered you the support slot at ' || v_venue.name || ' (' || v_slot.headliner || ') — review the terms and accept or decline.',
    '/applications', 'offer:' || v_booking_id::text, true);
  return v_booking_id;
end;
$$;

create or replace function public.withdraw_offer(p_application_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
  v_booking public.bookings;
begin
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  select * into v_booking from public.bookings where application_id = p_application_id and status = 'offered' for update;
  if v_app.status <> 'offered' or v_booking.id is null then
    raise exception 'invalid_transition: there is no outstanding offer to withdraw';
  end if;
  update public.bookings set status = 'withdrawn', responded_at = now(), decline_reason = 'offer_withdrawn' where id = v_booking.id;
  update public.applications set status = 'shortlisted', status_changed_at = now() where id = p_application_id;
  perform public.notify(v_app.artist_id, 'offer_declined',
    v_booking.promoter_company || ' withdrew their offer for ' || v_booking.headliner || '.',
    '/applications', 'offer_withdrawn:' || v_booking.id::text, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Artist: accept or decline. Accepting is the ONLY way a booking becomes
-- 'confirmed'. The slot row is locked first, so if two artists accept at the
-- same moment the second waits and then fails with slot_filled.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_offer(p_application_id uuid, p_accept boolean, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
  v_booking public.bookings;
  v_other record;
begin
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.artist_id <> v_uid then raise exception 'not_authorized'; end if;
  select * into v_booking from public.bookings where application_id = p_application_id and status = 'offered' for update;
  if v_app.status <> 'offered' or v_booking.id is null then
    raise exception 'invalid_transition: there is no outstanding offer on this application';
  end if;
  if v_booking.offer_expires_at < now() then raise exception 'offer_expired'; end if;

  if not p_accept then
    update public.bookings
      set status = 'declined', responded_at = now(), decline_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
      where id = v_booking.id;
    update public.applications set status = 'offer_declined', status_changed_at = now() where id = p_application_id;
    perform public.notify(v_booking.promoter_id, 'offer_declined',
      v_booking.artist_name || ' declined your offer for ' || v_booking.headliner || '.',
      '/dashboard/promoter', 'offer_declined:' || v_booking.id::text, true);
    return 'declined';
  end if;

  if v_slot.status <> 'open' or exists (select 1 from public.bookings where slot_id = v_slot.id and status = 'confirmed') then
    raise exception 'slot_filled';
  end if;
  if v_slot.date < public.london_today() then raise exception 'listing_past'; end if;

  update public.bookings
    set status = 'confirmed', confirmed_at = now(), responded_at = now()
    where id = v_booking.id;
  update public.applications set status = 'confirmed', status_changed_at = now() where id = p_application_id;
  perform set_config('app.slot_bypass', '1', true);
  update public.slots set status = 'filled' where id = v_slot.id;
  perform set_config('app.slot_bypass', '0', true);

  -- Everyone else still in play for this slot is told it's gone.
  for v_other in
    select a.id, a.artist_id from public.applications a
    where a.slot_id = v_slot.id and a.id <> p_application_id
      and a.status in ('submitted', 'viewed', 'shortlisted', 'offered')
    order by a.id for update
  loop
    update public.bookings
      set status = 'withdrawn', responded_at = now(), decline_reason = 'slot_filled'
      where application_id = v_other.id and status = 'offered';
    update public.applications
      set status = 'declined', closed_reason = 'slot_filled', status_changed_at = now()
      where id = v_other.id;
    perform public.notify(v_other.artist_id, 'application_declined',
      v_slot.headliner || ' has now been filled by another artist.',
      '/applications', 'filled:' || v_other.id::text, false);
  end loop;

  perform public.notify(v_booking.promoter_id, 'offer_accepted',
    v_booking.artist_name || ' accepted — your booking for ' || v_booking.headliner || ' is confirmed. You can now pay.',
    '/dashboard/promoter', 'offer_accepted:' || v_booking.id::text, true);
  return 'confirmed';
end;
$$;

create or replace function public.withdraw_application(p_application_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
  v_booking public.bookings;
begin
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if v_app.artist_id <> v_uid then raise exception 'not_authorized'; end if;
  if v_app.status not in ('submitted', 'viewed', 'shortlisted', 'offered') then
    raise exception 'invalid_transition: a % application can''t be withdrawn (a confirmed booking has to be cancelled instead)', v_app.status;
  end if;
  update public.bookings
    set status = 'withdrawn', responded_at = now(), decline_reason = 'application_withdrawn'
    where application_id = p_application_id and status = 'offered';
  update public.applications set status = 'withdrawn', status_changed_at = now(), closed_reason = 'artist_withdrew'
    where id = p_application_id;
  perform public.notify(v_slot.promoter_id, 'application_withdrawn',
    coalesce((select name from public.artists where id = v_app.artist_id), 'An artist') || ' withdrew their application to ' || v_slot.headliner || '.',
    '/dashboard/promoter', 'withdrawn:' || p_application_id::text, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Either party can cancel a CONFIRMED booking, with a reason. If money has
-- already been paid, the booking is flagged for a human refund decision —
-- nothing is refunded automatically and nothing is promised in the UI.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(p_application_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
  v_booking public.bookings;
  v_other uuid;
  v_paid boolean;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'cancel_invalid: please give a reason'; end if;
  if length(p_reason) > 500 then raise exception 'cancel_invalid: reason is too long (max 500 characters)'; end if;
  select * into v_slot from public.slots where id = public._app_slot_id(p_application_id) for update;
  if not found then raise exception 'application_not_found'; end if;
  select * into v_app from public.applications where id = p_application_id for update;
  select * into v_booking from public.bookings where application_id = p_application_id and status = 'confirmed' for update;
  if v_booking.id is null or v_app.status <> 'confirmed' then
    raise exception 'invalid_transition: only a confirmed booking can be cancelled';
  end if;
  if v_uid not in (v_booking.artist_id, v_booking.promoter_id) then raise exception 'not_authorized'; end if;

  v_paid := v_booking.payment_status in ('processing', 'paid', 'partially_refunded', 'disputed');
  update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(p_reason),
        refund_review_required = v_paid
    where id = v_booking.id;
  update public.applications set status = 'cancelled', status_changed_at = now(), closed_reason = 'booking_cancelled'
    where id = p_application_id;
  -- The show is still on: put the slot back on the market (the owner can close it).
  if v_slot.status = 'filled' and v_slot.date >= public.london_today() then
    perform set_config('app.slot_bypass', '1', true);
    update public.slots set status = 'open' where id = v_slot.id;
    perform set_config('app.slot_bypass', '0', true);
  end if;

  v_other := case when v_uid = v_booking.artist_id then v_booking.promoter_id else v_booking.artist_id end;
  perform public.notify(v_other, 'booking_cancelled',
    case when v_uid = v_booking.artist_id then v_booking.artist_name else v_booking.promoter_company end
      || ' cancelled the booking for ' || v_booking.headliner || '. Reason: ' || btrim(p_reason)
      || case when v_paid then ' A payment had been made — our team will review it.' else '' end,
    case when v_other = v_booking.artist_id then '/applications' else '/dashboard/promoter' end,
    'cancelled:' || v_booking.id::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Listing lifecycle
-- ---------------------------------------------------------------------------
create or replace function public._wind_down_slot(p_slot public.slots, p_reason text, p_cancel_confirmed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_a record;
  v_b public.bookings;
begin
  for v_a in
    select a.id, a.artist_id, a.status from public.applications a
    where a.slot_id = p_slot.id and a.status in ('submitted', 'viewed', 'shortlisted', 'offered', 'confirmed')
    order by a.id for update
  loop
    if v_a.status = 'confirmed' then
      if not p_cancel_confirmed then continue; end if;
      select * into v_b from public.bookings where application_id = v_a.id and status = 'confirmed' for update;
      update public.bookings
        set status = 'cancelled', cancelled_at = now(), cancelled_by = p_slot.promoter_id,
            cancel_reason = 'Listing cancelled by the promoter',
            refund_review_required = payment_status in ('processing', 'paid', 'partially_refunded', 'disputed')
        where id = v_b.id;
      update public.applications set status = 'cancelled', status_changed_at = now(), closed_reason = p_reason where id = v_a.id;
      perform public.notify(v_a.artist_id, 'booking_cancelled',
        p_slot.headliner || ' was cancelled by the promoter.'
          || case when v_b.payment_status in ('processing', 'paid', 'partially_refunded', 'disputed') then ' A payment had been made — our team will review it.' else '' end,
        '/applications', 'slotcancel:' || v_a.id::text, true);
    else
      update public.bookings set status = 'withdrawn', responded_at = now(), decline_reason = p_reason
        where application_id = v_a.id and status = 'offered';
      update public.applications set status = 'declined', status_changed_at = now(), closed_reason = p_reason where id = v_a.id;
      perform public.notify(v_a.artist_id, 'application_declined',
        p_slot.headliner || ' is no longer taking applications.',
        '/applications', 'slotclosed:' || v_a.id::text, false);
    end if;
  end loop;
end;
$$;
revoke all on function public._wind_down_slot(public.slots, text, boolean) from public, anon, authenticated;

create or replace function public.close_slot(p_slot_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
begin
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then raise exception 'listing_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  if exists (select 1 from public.bookings where slot_id = p_slot_id and status = 'confirmed') then
    raise exception 'has_confirmed_booking';
  end if;
  if v_slot.status <> 'open' then raise exception 'invalid_transition: only an open listing can be closed'; end if;
  perform public._wind_down_slot(v_slot, 'listing_closed', false);
  perform set_config('app.slot_bypass', '1', true);
  update public.slots set status = 'closed', closed_at = now(), closed_reason = 'closed_by_promoter' where id = p_slot_id;
  perform set_config('app.slot_bypass', '0', true);
end;
$$;

create or replace function public.cancel_slot(p_slot_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
begin
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then raise exception 'listing_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  if v_slot.status in ('cancelled', 'closed') then raise exception 'invalid_transition: this listing is already %', v_slot.status; end if;
  perform public._wind_down_slot(v_slot, 'listing_cancelled', true);
  perform set_config('app.slot_bypass', '1', true);
  update public.slots
    set status = 'cancelled', closed_at = now(), closed_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
    where id = p_slot_id;
  perform set_config('app.slot_bypass', '0', true);
end;
$$;

-- Changing the date/times of a listing that has a CONFIRMED booking: allowed
-- for the promoter only, updates the agreed terms, and tells the artist
-- (who can still cancel). Refused while an offer is outstanding — withdraw
-- it first so nobody accepts terms that just changed.
create or replace function public.reschedule_slot(p_slot_id uuid, p_date date, p_doors time, p_set time)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_b public.bookings;
begin
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then raise exception 'listing_not_found'; end if;
  if v_slot.promoter_id <> v_uid then raise exception 'not_authorized'; end if;
  if v_slot.status not in ('open', 'filled') then raise exception 'invalid_transition: this listing is %', v_slot.status; end if;
  if p_date < public.london_today() then raise exception 'slot_invalid: the new date is in the past'; end if;
  if p_set < p_doors then raise exception 'slot_invalid: the set can''t start before doors'; end if;
  if exists (select 1 from public.bookings where slot_id = p_slot_id and status = 'offered') then
    raise exception 'offers_outstanding';
  end if;

  perform set_config('app.slot_bypass', '1', true);
  update public.slots
    set date = p_date, doors_time = p_doors, set_time = p_set, rescheduled_at = now(),
        application_deadline = least(application_deadline, p_date)
    where id = p_slot_id;
  perform set_config('app.slot_bypass', '0', true);

  select * into v_b from public.bookings where slot_id = p_slot_id and status = 'confirmed' for update;
  if v_b.id is not null then
    update public.bookings set event_date = p_date, doors_time = p_doors, set_time = p_set where id = v_b.id;
    perform public.notify(v_b.artist_id, 'listing_changed',
      v_b.promoter_company || ' rescheduled ' || v_b.headliner || ' to ' || to_char(p_date, 'Dy DD Mon YYYY')
        || ' (doors ' || to_char(p_doors, 'HH24:MI') || ', you''re on at ' || to_char(p_set, 'HH24:MI') || '). If that doesn''t work for you, you can cancel the booking.',
      '/applications', 'resched:' || v_b.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text, true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Messaging: open (or find) the conversation for an application. Either
-- participant can start it. A promoter can't start one with an artist who
-- has blocked them.
-- ---------------------------------------------------------------------------
create or replace function public.open_application_thread(p_application_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_app public.applications;
  v_slot public.slots;
  v_thread uuid;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found then raise exception 'application_not_found'; end if;
  select * into v_slot from public.slots where id = v_app.slot_id;
  if v_uid not in (v_app.artist_id, v_slot.promoter_id) then raise exception 'not_authorized'; end if;
  if v_uid = v_slot.promoter_id
     and exists (select 1 from public.promoter_blocks b where b.artist_id = v_app.artist_id and b.promoter_id = v_slot.promoter_id) then
    raise exception 'blocked: you can''t message this artist';
  end if;

  select id into v_thread from public.message_threads
    where artist_id = v_app.artist_id and promoter_id = v_slot.promoter_id and context = 'application:' || p_application_id::text;
  if v_thread is null then
    insert into public.message_threads (artist_id, promoter_id, context, application_id)
    values (v_app.artist_id, v_slot.promoter_id, 'application:' || p_application_id::text, p_application_id)
    on conflict (artist_id, promoter_id, context) do update set artist_id = excluded.artist_id
    returning id into v_thread;
  end if;
  return v_thread;
end;
$$;

create or replace function public.mark_thread_read(p_thread_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_thread public.message_threads;
begin
  select * into v_thread from public.message_threads where id = p_thread_id;
  if not found or v_uid not in (v_thread.artist_id, v_thread.promoter_id) then raise exception 'not_authorized'; end if;
  if v_uid = v_thread.artist_id then
    update public.message_threads set artist_last_read_at = now() where id = p_thread_id;
  else
    update public.message_threads set promoter_last_read_at = now() where id = p_thread_id;
  end if;
  update public.notifications set read = true
    where profile_id = v_uid and type = 'message' and read = false and href = '/messages?thread=' || p_thread_id::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping (called by a scheduled server route, service role only):
-- an offer nobody answered by its deadline goes back to the shortlist.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_offers()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_b record;
  v_n integer := 0;
begin
  for v_b in
    select b.id, b.application_id, b.artist_id, b.promoter_id, b.headliner, b.artist_name
    from public.bookings b
    where b.status = 'offered' and b.offer_expires_at < now()
    order by b.id for update skip locked
  loop
    update public.bookings set status = 'withdrawn', responded_at = now(), decline_reason = 'offer_expired' where id = v_b.id;
    update public.applications set status = 'shortlisted', status_changed_at = now()
      where id = v_b.application_id and status = 'offered';
    perform public.notify(v_b.artist_id, 'offer_declined', 'Your offer for ' || v_b.headliner || ' expired.',
      '/applications', 'offer_expired:' || v_b.id::text, false);
    perform public.notify(v_b.promoter_id, 'offer_declined', v_b.artist_name || ' didn''t respond to your offer for ' || v_b.headliner || ' in time — it has expired.',
      '/dashboard/promoter', 'offer_expired_p:' || v_b.id::text, false);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.expire_stale_offers() from public, anon, authenticated;
grant execute on function public.expire_stale_offers() to service_role;

-- Client-callable functions: signed-in users only.
do $$
declare
  f text;
begin
  foreach f in array array[
    'mark_application_viewed(uuid)', 'shortlist_application(uuid)', 'decline_application(uuid, text)',
    'make_offer(uuid, text)', 'withdraw_offer(uuid)', 'respond_to_offer(uuid, boolean, text)',
    'withdraw_application(uuid)', 'cancel_booking(uuid, text)', 'close_slot(uuid)',
    'cancel_slot(uuid, text)', 'reschedule_slot(uuid, date, time, time)',
    'open_application_thread(uuid)', 'mark_thread_read(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
