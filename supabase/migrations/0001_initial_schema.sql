-- Support Slot — complete database schema.
--
-- ONE file, for a brand-new, empty Supabase project. Paste it into the Supabase
-- SQL editor and run it once (Dashboard → SQL Editor). It creates every table,
-- constraint, index, row-level-security policy, trigger and function the app
-- uses, plus the six curated venues and the city-distance table.
--
-- Support Slot handles no money: there are no payment, payout, billing or
-- subscription objects in here. An offer records the fee and travel the two
-- sides agreed; they settle up directly.
--
-- Rules that live in this file (the app never bypasses them):
--   * State changes (application -> offer -> booking, listing close/cancel/
--     reschedule, notifications) are SQL functions that lock rows in a fixed
--     order (slot -> application -> other applications), check who is asking
--     and what state things are in, and are idempotent. Clients have no
--     direct UPDATE on applications or bookings.
--   * At most one confirmed booking per slot (partial unique index).
--   * Staff tables are only reachable through admin_*/staff_* functions that
--     check the caller's role in SQL and write an audit row.
--   * profiles.role is immutable; staff fields are set by hand in SQL only.
--
-- If a statement fails, nothing is applied (the editor runs the file as one
-- transaction): fix the error and run it again.

SET check_function_bodies = false;
SET client_min_messages = warning;

SET check_function_bodies = false;

-- schema: public

-- function: _app_slot_id(uuid)
CREATE FUNCTION public._app_slot_id(p_application_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select slot_id from public.applications where id = p_application_id
$$;

-- function: _audit(text, text, text, jsonb)
CREATE FUNCTION public._audit(p_action text, p_target_type text, p_target_id text, p_details jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.admin_audit_log (actor_id, actor_role, action, target_type, target_id, details)
  values (auth.uid(), public.current_admin_role(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'))
$$;

-- function: _require_active_user()
CREATE FUNCTION public._require_active_user() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: _staff_actor(text)
CREATE FUNCTION public._staff_actor(p_min text DEFAULT 'moderator'::text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role text := public.current_admin_role();
begin
  if v_role is null or (p_min = 'admin' and v_role <> 'admin') then
    raise exception 'not_authorized';
  end if;
  return auth.uid();
end;
$$;

-- table: slots
CREATE TABLE public.slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promoter_id uuid NOT NULL,
    venue_id text NOT NULL,
    headliner text NOT NULL,
    headliner_image_url text,
    artist_photo_url text,
    city text NOT NULL,
    date date NOT NULL,
    doors_time time without time zone NOT NULL,
    set_time time without time zone NOT NULL,
    performance_length_mins integer NOT NULL,
    genres text[] DEFAULT '{}'::text[] NOT NULL,
    expected_attendance integer NOT NULL,
    support_fee integer NOT NULL,
    travel_contribution integer DEFAULT 0 NOT NULL,
    requirements text[] DEFAULT '{}'::text[] NOT NULL,
    application_deadline date NOT NULL,
    applicant_count integer DEFAULT 0 NOT NULL,
    is_urgent boolean DEFAULT false NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    artist_size_fit text[] DEFAULT '{}'::text[] NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    rescheduled_at timestamp with time zone,
    posted_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    closed_reason text,
    CONSTRAINT slots_artist_photo_url_size CHECK ((length(artist_photo_url) < 2000000)),
    CONSTRAINT slots_artist_size_fit_check CHECK ((artist_size_fit <@ ARRAY['emerging'::text, 'developing'::text, 'established'::text])),
    CONSTRAINT slots_city_check CHECK ((city = ANY (ARRAY['London'::text, 'Manchester'::text, 'Birmingham'::text, 'Bristol'::text, 'Leeds'::text, 'Brighton'::text]))),
    CONSTRAINT slots_genres_check CHECK ((genres <@ ARRAY['Alternative'::text, 'Electronic'::text, 'Indie'::text, 'Experimental'::text, 'Hip-Hop'::text, 'Punk'::text, 'Folk'::text, 'Pop'::text, 'R&B'::text, 'Techno'::text, 'Drum & Bass'::text, 'Rock'::text])),
    CONSTRAINT slots_headliner_image_url_size CHECK ((length(headliner_image_url) < 2000000)),
    CONSTRAINT slots_status_check CHECK ((status = ANY (ARRAY['open'::text, 'filled'::text, 'closed'::text, 'cancelled'::text])))
);

-- function: _wind_down_slot(public.slots, text, boolean)
CREATE FUNCTION public._wind_down_slot(p_slot public.slots, p_reason text, p_cancel_confirmed boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
            cancel_reason = 'Listing cancelled by the promoter'
        where id = v_b.id;
      update public.applications set status = 'cancelled', status_changed_at = now(), closed_reason = p_reason where id = v_a.id;
      perform public.notify(v_a.artist_id, 'booking_cancelled',
        p_slot.headliner || ' was cancelled by the promoter.',
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

-- function: account_deletion_blockers(uuid)
CREATE FUNCTION public.account_deletion_blockers(p_profile_id uuid) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_out text[] := '{}';
begin
  if exists (select 1 from public.bookings b
             where (b.artist_id = p_profile_id or b.promoter_id = p_profile_id)
               and b.status = 'confirmed' and b.event_date >= public.london_today()) then
    v_out := array_append(v_out, 'upcoming_confirmed_booking');
  end if;
  return v_out;
end;
$$;

-- function: admin_recent_bookings(integer)
CREATE FUNCTION public.admin_recent_bookings(p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, headliner text, artist_name text, promoter_company text, status text, event_date date, fee_pence integer, travel_pence integer, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public._staff_actor('admin');
  return query
    select b.id, b.headliner, b.artist_name, b.promoter_company, b.status,
           b.event_date, b.fee_pence, b.travel_pence, b.created_at
    from public.bookings b order by b.created_at desc limit least(greatest(p_limit, 1), 200);
end;
$$;

-- function: admin_remove_listing(uuid, text)
CREATE FUNCTION public.admin_remove_listing(p_slot_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._staff_actor();
  v_slot public.slots;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required'; end if;
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then raise exception 'listing_not_found'; end if;
  if v_slot.status = 'cancelled' then return; end if;
  perform public._wind_down_slot(v_slot, 'listing_removed', true);
  perform set_config('app.slot_bypass', '1', true);
  update public.slots set status = 'cancelled', closed_at = now(), closed_reason = 'removed_by_moderator: ' || left(btrim(p_reason), 400)
    where id = p_slot_id;
  perform set_config('app.slot_bypass', '0', true);
  perform public.notify(v_slot.promoter_id, 'system',
    'Your listing "' || v_slot.headliner || '" was removed by our moderation team. Reason: ' || btrim(p_reason),
    '/support', 'removed:' || p_slot_id::text, true);
  perform public._audit('listing.remove', 'slot', p_slot_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

-- function: admin_set_verification(uuid, boolean)
CREATE FUNCTION public.admin_set_verification(p_profile_id uuid, p_verified boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._staff_actor('admin');
  v_val text := case when p_verified then 'verified' else 'unverified' end;
begin
  perform set_config('app.staff_bypass', '1', true);
  update public.artists set verification = v_val where id = p_profile_id;
  update public.promoters set verification = v_val where id = p_profile_id;
  perform set_config('app.staff_bypass', '0', true);
  perform public._audit('verification.' || v_val, 'profile', p_profile_id::text, '{}');
end;
$$;

-- function: admin_suspend_user(uuid, text)
CREATE FUNCTION public.admin_suspend_user(p_profile_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._staff_actor();
  v_target public.profiles;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required'; end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_target.admin_role is not null then raise exception 'cannot_suspend_staff'; end if;
  perform set_config('app.staff_bypass', '1', true);
  update public.profiles set suspended_at = now(), suspension_reason = btrim(p_reason) where id = p_profile_id;
  perform set_config('app.staff_bypass', '0', true);
  perform public._audit('user.suspend', 'profile', p_profile_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

-- function: admin_unsuspend_user(uuid)
CREATE FUNCTION public.admin_unsuspend_user(p_profile_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._staff_actor();
begin
  perform set_config('app.staff_bypass', '1', true);
  update public.profiles set suspended_at = null, suspension_reason = null where id = p_profile_id;
  perform set_config('app.staff_bypass', '0', true);
  if not found then raise exception 'not_found'; end if;
  perform public._audit('user.unsuspend', 'profile', p_profile_id::text, '{}');
end;
$$;

-- function: admin_update_report(uuid, text, text)
CREATE FUNCTION public.admin_update_report(p_report_id uuid, p_status text, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._staff_actor();
  v_r public.reports;
begin
  if p_status not in ('open', 'reviewing', 'actioned', 'dismissed') then raise exception 'invalid_status'; end if;
  select * into v_r from public.reports where id = p_report_id for update;
  if not found then raise exception 'report_not_found'; end if;
  update public.reports
    set status = p_status, reviewed_by = v_uid, reviewed_at = now(),
        resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
    where id = p_report_id;
  perform public._audit('report.' || p_status, 'report', p_report_id::text, jsonb_build_object('note', p_note));
  if v_r.reporter_id is not null and p_status in ('actioned', 'dismissed') then
    perform public.notify(v_r.reporter_id, 'report_update',
      case p_status when 'actioned' then 'Thanks — we''ve acted on your report.' else 'We reviewed your report and didn''t find a breach of our rules.' end,
      '/support', 'report:' || p_report_id::text || ':' || p_status, false);
  end if;
end;
$$;

-- function: admin_update_support_request(uuid, text, text)
CREATE FUNCTION public.admin_update_support_request(p_id uuid, p_status text, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._staff_actor();
begin
  if p_status not in ('open', 'answered', 'closed') then raise exception 'invalid_status'; end if;
  update public.support_requests
    set status = p_status, handled_by = v_uid, handled_at = now(), staff_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
    where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public._audit('support.' || p_status, 'support_request', p_id::text, jsonb_build_object('note', p_note));
end;
$$;

-- function: applications_guard()
CREATE FUNCTION public.applications_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot public.slots;
begin
  if auth.role() = 'service_role' then return new; end if;

  select * into v_slot from public.slots where id = new.slot_id;
  if not found then raise exception 'listing_not_found'; end if;
  if v_slot.status <> 'open' then raise exception 'listing_not_open'; end if;
  if v_slot.application_deadline < public.london_today() or v_slot.date < public.london_today() then
    raise exception 'applications_closed';
  end if;
  if exists (select 1 from public.profiles where id = new.artist_id and suspended_at is not null) then
    raise exception 'account_suspended';
  end if;
  if new.artist_id = auth.uid() then
    -- 20 applications an hour is far beyond honest use.
    if (select count(*) from public.applications where artist_id = new.artist_id and submitted_at > now() - interval '1 hour') >= 20 then
      raise exception 'rate_limited: too many applications in the last hour';
    end if;
    if new.message is not null and length(new.message) > 500 then
      raise exception 'application_invalid: message is too long (max 500 characters)';
    end if;
    if new.featured_track_id is not null
       and not exists (select 1 from public.artist_tracks t where t.id = new.featured_track_id and t.artist_id = new.artist_id) then
      raise exception 'application_invalid: that track isn''t on your profile';
    end if;
  end if;
  new.match_percent := null;
  return new;
end;
$$;

-- function: artists_guard()
CREATE FUNCTION public.artists_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if length(btrim(new.name)) < 1 or length(new.name) > 80 then raise exception 'profile_invalid: name must be 1–80 characters'; end if;
  if length(new.bio) > 1000 then raise exception 'profile_invalid: bio is too long (max 1000 characters)'; end if;
  if coalesce(array_length(new.genres, 1), 0) > 5 then raise exception 'profile_invalid: choose at most 5 genres'; end if;
  if new.travel_radius_miles < 0 or new.travel_radius_miles > 500 then raise exception 'profile_invalid: travel radius must be 0–500 miles'; end if;
  if new.monthly_listeners is not null and new.monthly_listeners < 0 then raise exception 'profile_invalid: monthly listeners can''t be negative'; end if;
  if tg_op = 'UPDATE' and new.handle is distinct from old.handle then
    -- The handle is the public URL; bookings and payments never depend on it
    -- (they use the permanent id), but changing it would still break every
    -- shared link, so it's fixed once chosen.
    raise exception 'profile_invalid: your handle can''t be changed';
  end if;
  return new;
end;
$$;

-- function: bookings_touch()
CREATE FUNCTION public.bookings_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- function: bump_applicant_count()
CREATE FUNCTION public.bump_applicant_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if tg_op = 'INSERT' then
    update public.slots set applicant_count = applicant_count + 1 where id = new.slot_id;
  elsif tg_op = 'DELETE' then
    update public.slots set applicant_count = applicant_count - 1 where id = old.slot_id;
  end if;
  return null;
end;
$$;

-- function: caller_is_promoter()
CREATE FUNCTION public.caller_is_promoter() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'promoter');
$$;

-- function: cancel_booking(uuid, text)
CREATE FUNCTION public.cancel_booking(p_application_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_app public.applications;
  v_booking public.bookings;
  v_other uuid;
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

  update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(p_reason)
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
      || ' cancelled the booking for ' || v_booking.headliner || '. Reason: ' || btrim(p_reason),
    case when v_other = v_booking.artist_id then '/applications' else '/dashboard/promoter' end,
    'cancelled:' || v_booking.id::text, true);
end;
$$;

-- function: cancel_slot(uuid, text)
CREATE FUNCTION public.cancel_slot(p_slot_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: city_distance_miles(text, text)
CREATE FUNCTION public.city_distance_miles(a text, b text) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  select case when a = b then 0
    else coalesce((select miles from public.city_distances where city_a = a and city_b = b), 150) end
$$;

-- table: email_outbox
CREATE TABLE public.email_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    to_email text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    href text,
    dedupe_key text,
    status text DEFAULT 'pending'::text NOT NULL,
    provider_message_id text,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT email_outbox_check CHECK (((status = 'sent'::text) = (provider_message_id IS NOT NULL))),
    CONSTRAINT email_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);

-- function: claim_email_outbox(integer)
CREATE FUNCTION public.claim_email_outbox(p_limit integer DEFAULT 20) RETURNS SETOF public.email_outbox
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.email_outbox
    set attempts = attempts + 1, claimed_at = now()
  where id in (
    select id from public.email_outbox
    where status = 'pending' and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by created_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  returning *
$$;

-- function: claim_schedule_version(uuid, integer)
CREATE FUNCTION public.claim_schedule_version(p_schedule_id uuid, p_expected_version integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_new_version integer;
begin
  if not public.caller_is_promoter() then
    raise exception 'promoter_required';
  end if;
  update public.show_schedules
  set version = version + 1, updated_at = now()
  where id = p_schedule_id and promoter_id = auth.uid() and version = p_expected_version
  returning version into v_new_version;
  if v_new_version is null then
    raise exception 'stale_schedule_version';
  end if;
  return v_new_version;
end;
$$;

-- function: close_slot(uuid)
CREATE FUNCTION public.close_slot(p_slot_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: current_admin_role()
CREATE FUNCTION public.current_admin_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select admin_role from public.profiles where id = auth.uid()
$$;

-- function: decline_application(uuid, text)
CREATE FUNCTION public.decline_application(p_application_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: effective_travel_pence(integer, text, text)
CREATE FUNCTION public.effective_travel_pence(base_pence integer, artist_city text, venue_city text) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  select case when public.city_distance_miles(artist_city, venue_city)::numeric / 40 > 1
              then greatest(base_pence, 1000) else base_pence end
$$;

-- function: expire_stale_offers()
CREATE FUNCTION public.expire_stale_offers() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: handle_new_user()
CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.profiles (id, role, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'role', 'artist'), new.email);
  return new;
end;
$$;

-- function: is_open_availability_request(uuid)
CREATE FUNCTION public.is_open_availability_request(p_request_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.availability_requests
    where id = p_request_id and status = 'sent' and response_deadline > now()
  );
$$;

-- function: is_recipient_of_availability_request(uuid)
CREATE FUNCTION public.is_recipient_of_availability_request(p_request_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.availability_request_recipients
    where request_id = p_request_id and artist_id = auth.uid()
  );
$$;

-- function: is_username_available(text)
CREATE FUNCTION public.is_username_available(p_username text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(p_username)
  );
$$;

-- function: london_today()
CREATE FUNCTION public.london_today() RETURNS date
    LANGUAGE sql STABLE
    AS $$
  select (now() at time zone 'Europe/London')::date
$$;

-- function: make_offer(uuid, text)
CREATE FUNCTION public.make_offer(p_application_id uuid, p_message text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    v_slot.support_fee * 100, v_travel, nullif(btrim(p_message), ''), v_expires
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

-- function: mark_application_viewed(uuid)
CREATE FUNCTION public.mark_application_viewed(p_application_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: mark_thread_read(uuid)
CREATE FUNCTION public.mark_thread_read(p_thread_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: messages_after_insert()
CREATE FUNCTION public.messages_after_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread public.message_threads;
  v_recipient uuid;
  v_href text;
begin
  select * into v_thread from public.message_threads where id = new.thread_id;
  update public.message_threads set last_message_at = new.created_at where id = new.thread_id;
  v_recipient := case when new.sender_id = v_thread.artist_id then v_thread.promoter_id else v_thread.artist_id end;
  v_href := '/messages?thread=' || new.thread_id::text;
  if not exists (
    select 1 from public.notifications
    where profile_id = v_recipient and type = 'message' and read = false and href = v_href
  ) then
    perform public.notify(v_recipient, 'message', 'You have a new message', v_href, null, false);
  end if;
  return new;
end;
$$;

-- function: messages_guard()
CREATE FUNCTION public.messages_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_thread public.message_threads;
begin
  if auth.role() = 'service_role' then return new; end if;
  select * into v_thread from public.message_threads where id = new.thread_id;
  if not found then raise exception 'thread_not_found'; end if;
  if new.sender_id not in (v_thread.artist_id, v_thread.promoter_id) then raise exception 'not_authorized'; end if;
  new.text := btrim(new.text);
  if length(new.text) < 1 then raise exception 'message_invalid: message is empty'; end if;
  if length(new.text) > 2000 then raise exception 'message_invalid: message is too long (max 2000 characters)'; end if;
  if exists (select 1 from public.profiles where id = new.sender_id and suspended_at is not null) then
    raise exception 'account_suspended';
  end if;
  if new.sender_id = v_thread.promoter_id
     and exists (select 1 from public.promoter_blocks b where b.artist_id = v_thread.artist_id and b.promoter_id = v_thread.promoter_id) then
    raise exception 'blocked: you can''t message this artist';
  end if;
  if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'rate_limited: slow down — too many messages in the last minute';
  end if;
  return new;
end;
$$;

-- function: notify(uuid, text, text, text, text, boolean)
CREATE FUNCTION public.notify(p_profile_id uuid, p_type text, p_text text, p_href text, p_dedupe_key text DEFAULT NULL::text, p_email boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rows integer;
  v_email text;
  v_wants_email boolean;
begin
  if p_profile_id is null then return; end if;
  insert into public.notifications (profile_id, type, text, href, dedupe_key)
  values (p_profile_id, p_type, p_text, p_href, p_dedupe_key)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 or not p_email then return; end if;

  select email, email_notifications into v_email, v_wants_email from public.profiles where id = p_profile_id;
  if v_email is null or not coalesce(v_wants_email, true) then return; end if;
  insert into public.email_outbox (profile_id, to_email, subject, body, href, dedupe_key)
  values (p_profile_id, v_email, left(p_text, 120), p_text, p_href, p_dedupe_key)
  on conflict do nothing;
end;
$$;

-- function: notify_on_availability_request()
CREATE FUNCTION public.notify_on_availability_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_request public.availability_requests;
  v_promoter_company text;
  v_should_notify boolean;
begin
  select * into v_request from public.availability_requests where id = new.request_id;
  select coalesce(notify_availability_requests, true) into v_should_notify
    from public.profiles where id = new.artist_id;
  if not coalesce(v_should_notify, true) then
    return new;
  end if;
  select company into v_promoter_company from public.promoters where id = v_request.promoter_id;
  insert into public.notifications (profile_id, type, text, href)
  values (
    new.artist_id,
    'availability_request',
    coalesce(v_promoter_company, 'A promoter') || ' wants to know if you''re free for ' || v_request.event_name,
    '/requests'
  );
  return new;
end;
$$;

-- function: notify_on_availability_request_status_change()
CREATE FUNCTION public.notify_on_availability_request_status_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_recipient record;
  v_text text;
begin
  if new.status is distinct from old.status and new.status in ('withdrawn', 'filled') then
    v_text := case new.status
      when 'withdrawn' then 'A request for ' || new.event_name || ' was withdrawn'
      else new.event_name || ' has been filled'
    end;
    for v_recipient in
      select artist_id from public.availability_request_recipients where request_id = new.id
    loop
      insert into public.notifications (profile_id, type, text, href)
      values (v_recipient.artist_id, 'availability_request', v_text, '/requests');
    end loop;
  end if;
  return new;
end;
$$;

-- function: notify_on_availability_response()
CREATE FUNCTION public.notify_on_availability_response() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_promoter_id uuid;
  v_artist_name text;
  v_event_name text;
begin
  if new.response is distinct from old.response and new.response in ('available', 'unavailable') then
    select promoter_id, event_name into v_promoter_id, v_event_name
      from public.availability_requests where id = new.request_id;
    select name into v_artist_name from public.artists where id = new.artist_id;
    insert into public.notifications (profile_id, type, text, href)
    values (
      v_promoter_id,
      'availability_response',
      coalesce(v_artist_name, 'An artist') || ' responded ' || new.response || ' for ' || v_event_name,
      '/dashboard/promoter/requests'
    );
  end if;
  return new;
end;
$$;

-- function: notify_on_gig_invitation()
CREATE FUNCTION public.notify_on_gig_invitation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_headliner text;
  v_promoter_company text;
  v_artist_name text;
begin
  if tg_op = 'INSERT' then
    select headliner into v_headliner from public.slots where id = new.slot_id;
    select company into v_promoter_company from public.promoters where id = new.promoter_id;
    insert into public.notifications (profile_id, type, text, href)
    values (
      new.artist_id,
      'match',
      coalesce(v_promoter_company, 'A promoter') || ' invited you to apply for ' || coalesce(v_headliner, 'a gig'),
      '/applications'
    );
  elsif new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    select name into v_artist_name from public.artists where id = new.artist_id;
    insert into public.notifications (profile_id, type, text, href)
    values (
      new.promoter_id,
      'match',
      coalesce(v_artist_name, 'An artist') || ' ' || new.status || ' your invitation',
      '/dashboard/promoter'
    );
  end if;
  return new;
end;
$$;

-- function: notify_urgent_slot()
CREATE FUNCTION public.notify_urgent_slot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_artist record;
begin
  if not new.is_urgent or new.status <> 'open' then return new; end if;
  for v_artist in
    select a.id from public.artists a
    where a.last_minute_alerts
      and public.city_distance_miles(a.location, new.city) <= a.travel_radius_miles
      and not exists (select 1 from public.promoter_blocks b where b.artist_id = a.id and b.promoter_id = new.promoter_id)
      and not exists (select 1 from public.profiles p where p.id = a.id and p.suspended_at is not null)
    limit 500
  loop
    perform public.notify(v_artist.id, 'urgent',
      'Needed tonight: support for ' || new.headliner || ' in ' || new.city || '.',
      '/slot/' || new.id::text, 'urgent:' || new.id::text, false);
  end loop;
  return new;
end;
$$;

-- function: open_application_thread(uuid)
CREATE FUNCTION public.open_application_thread(p_application_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: owns_availability_request(uuid)
CREATE FUNCTION public.owns_availability_request(p_request_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.availability_requests
    where id = p_request_id and promoter_id = auth.uid()
  );
$$;

-- function: owns_schedule_template(uuid)
CREATE FUNCTION public.owns_schedule_template(p_template_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.schedule_templates
    where id = p_template_id and promoter_id = auth.uid()
  );
$$;

-- function: owns_show_schedule(uuid)
CREATE FUNCTION public.owns_show_schedule(p_schedule_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.show_schedules
    where id = p_schedule_id and promoter_id = auth.uid()
  );
$$;

-- function: prepare_account_deletion(uuid)
CREATE FUNCTION public.prepare_account_deletion(p_profile_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slot public.slots;
  v_app public.applications;
begin
  if array_length(public.account_deletion_blockers(p_profile_id), 1) is not null then
    raise exception 'deletion_blocked';
  end if;
  -- Only shows that haven't happened yet; past ones (and their payment
  -- history) are left as they are.
  for v_slot in
    select * from public.slots
    where promoter_id = p_profile_id and status in ('open', 'filled') and date >= public.london_today()
    for update
  loop
    perform public._wind_down_slot(v_slot, 'listing_cancelled', true);
  end loop;
  for v_app in select * from public.applications where artist_id = p_profile_id and status in ('submitted', 'viewed', 'shortlisted', 'offered') for update loop
    update public.bookings set status = 'withdrawn', responded_at = now(), decline_reason = 'account_deleted'
      where application_id = v_app.id and status = 'offered';
    update public.applications set status = 'withdrawn', status_changed_at = now(), closed_reason = 'artist_withdrew' where id = v_app.id;
  end loop;
end;
$$;

-- function: prevent_client_trust_field_tamper()
CREATE FUNCTION public.prevent_client_trust_field_tamper() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  -- 'app.staff_bypass' is set only inside the audited admin_* functions (an
  -- API client can't set a Postgres setting), which run with the caller's
  -- JWT and so would otherwise trip this guard themselves.
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
  elsif tg_table_name = 'applications' and tg_op = 'UPDATE' then
    if new.artist_id is distinct from old.artist_id or new.slot_id is distinct from old.slot_id then
      raise exception 'artist_id and slot_id cannot be changed after submission.';
    end if;
  end if;
  return new;
end;
$$;

-- function: prevent_role_change()
CREATE FUNCTION public.prevent_role_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.role <> old.role then
    raise exception 'role cannot be changed after signup';
  end if;
  return new;
end;
$$;

-- function: protect_profile_staff_fields()
CREATE FUNCTION public.protect_profile_staff_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if auth.role() = 'authenticated' and current_setting('app.staff_bypass', true) is distinct from '1' and (
       new.admin_role is distinct from old.admin_role
    or new.suspended_at is distinct from old.suspended_at
    or new.suspension_reason is distinct from old.suspension_reason
    or new.email is distinct from old.email
    or new.has_onboarded is distinct from old.has_onboarded and old.has_onboarded = true
  ) then
    raise exception 'That account field can only be changed by the platform.';
  end if;
  return new;
end;
$$;

-- function: rate_limit_hit(text, integer, integer)
CREATE FUNCTION public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_count <= p_limit;
end;
$$;

-- function: reschedule_slot(uuid, date, time without time zone, time without time zone)
CREATE FUNCTION public.reschedule_slot(p_slot_id uuid, p_date date, p_doors time without time zone, p_set time without time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: respond_to_offer(uuid, boolean, text)
CREATE FUNCTION public.respond_to_offer(p_application_id uuid, p_accept boolean, p_reason text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    v_booking.artist_name || ' accepted — your booking for ' || v_booking.headliner || ' is confirmed. Arrange payment with them directly.',
    '/dashboard/promoter', 'offer_accepted:' || v_booking.id::text, true);
  return 'confirmed';
end;
$$;

-- function: search_slots(text, text, text, date, date, integer, text, text, text, integer, boolean, text, integer, integer)
CREATE FUNCTION public.search_slots(p_q text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_genre text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_min_fee integer DEFAULT NULL::integer, p_venue_size text DEFAULT NULL::text, p_artist_size text DEFAULT NULL::text, p_from_city text DEFAULT NULL::text, p_max_miles integer DEFAULT NULL::integer, p_urgent_only boolean DEFAULT false, p_sort text DEFAULT 'date'::text, p_limit integer DEFAULT 12, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, total_count bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select s.id, count(*) over () as total_count
  from public.slots s
  join public.venues v on v.id = s.venue_id
  where s.status = 'open'
    and s.application_deadline >= public.london_today()
    and s.date >= public.london_today()
    and (nullif(btrim(p_q), '') is null
         or strpos(lower(s.headliner), lower(btrim(p_q))) > 0
         or strpos(lower(s.description), lower(btrim(p_q))) > 0
         or strpos(lower(v.name), lower(btrim(p_q))) > 0
         or strpos(lower(s.city), lower(btrim(p_q))) > 0)
    and (p_city is null or s.city = p_city)
    and (p_genre is null or p_genre = any (s.genres))
    and (p_from is null or s.date >= p_from)
    and (p_to is null or s.date <= p_to)
    and (p_min_fee is null or s.support_fee >= p_min_fee)
    and (p_venue_size is null
         or (p_venue_size = 'intimate' and v.capacity < 250)
         or (p_venue_size = 'mid' and v.capacity between 250 and 400)
         or (p_venue_size = 'large' and v.capacity > 400))
    and (p_artist_size is null or p_artist_size = any (s.artist_size_fit))
    and (p_max_miles is null or p_from_city is null
         or public.city_distance_miles(p_from_city, s.city) <= p_max_miles)
    and (not p_urgent_only or s.is_urgent)
  order by
    case when p_sort = 'fee' then s.support_fee end desc nulls last,
    case when p_sort = 'newest' then s.posted_at end desc nulls last,
    s.date asc, s.id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0)
$$;

-- function: shortlist_application(uuid)
CREATE FUNCTION public.shortlist_application(p_application_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: slots_guard()
CREATE FUNCTION public.slots_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_today date := public.london_today();
  v_locked boolean;
  v_material boolean;
begin
  -- Server-side jobs and the SQL functions below (which set this flag) skip
  -- the client-facing rules.
  if auth.role() = 'service_role' or current_setting('app.slot_bypass', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.profiles where id = new.promoter_id and suspended_at is not null) then
      raise exception 'account_suspended';
    end if;
    if new.status <> 'open' then raise exception 'slot_invalid: a new listing must start open'; end if;
    if new.date < v_today then raise exception 'slot_invalid: the show date is in the past'; end if;
    if new.application_deadline < v_today then raise exception 'slot_invalid: the application deadline is in the past'; end if;
    if new.application_deadline > new.date then raise exception 'slot_invalid: the application deadline must be on or before the show date'; end if;
    if (select count(*) from public.slots where promoter_id = new.promoter_id and posted_at > now() - interval '1 hour') >= 10 then
      raise exception 'rate_limited: too many listings posted in the last hour';
    end if;
  else
    if new.promoter_id is distinct from old.promoter_id or new.id is distinct from old.id then
      raise exception 'slot_invalid: ownership cannot change';
    end if;
    if new.status is distinct from old.status then
      -- Clients may only open/close; filled/cancelled come from the booking functions.
      if not ((old.status = 'open' and new.status = 'closed') or (old.status = 'closed' and new.status = 'open')) then
        raise exception 'slot_invalid: status can only be changed through the booking functions';
      end if;
      if new.status = 'open' and (new.date < v_today or new.application_deadline < v_today) then
        raise exception 'slot_invalid: this listing can''t be reopened — its date or deadline has passed';
      end if;
    end if;
    v_material :=
      new.date is distinct from old.date or new.doors_time is distinct from old.doors_time
      or new.set_time is distinct from old.set_time or new.city is distinct from old.city
      or new.venue_id is distinct from old.venue_id or new.support_fee is distinct from old.support_fee
      or new.travel_contribution is distinct from old.travel_contribution
      or new.performance_length_mins is distinct from old.performance_length_mins;
    if v_material then
      select exists (select 1 from public.bookings b where b.slot_id = old.id and b.status in ('offered', 'confirmed'))
        into v_locked;
      if v_locked then
        raise exception 'listing_locked: this listing has an offer or a confirmed booking, so its date, venue, times and fee can''t be edited. Use Reschedule, or withdraw the offer first.';
      end if;
    end if;
  end if;

  -- Rules for both insert and (non-locked) update.
  if length(btrim(new.headliner)) < 1 or length(new.headliner) > 120 then raise exception 'slot_invalid: headliner must be 1–120 characters'; end if;
  if length(new.description) > 2000 then raise exception 'slot_invalid: description is too long (max 2000 characters)'; end if;
  if new.support_fee < 0 or new.support_fee > 100000 then raise exception 'slot_invalid: support fee must be between £0 and £100,000'; end if;
  if new.travel_contribution < 0 or new.travel_contribution > 5000 then raise exception 'slot_invalid: travel contribution must be between £0 and £5,000'; end if;
  if new.performance_length_mins < 5 or new.performance_length_mins > 240 then raise exception 'slot_invalid: set length must be 5–240 minutes'; end if;
  if new.expected_attendance < 1 or new.expected_attendance > 100000 then raise exception 'slot_invalid: expected attendance must be at least 1'; end if;
  if coalesce(array_length(new.genres, 1), 0) < 1 then raise exception 'slot_invalid: choose at least one genre'; end if;
  if coalesce(array_length(new.requirements, 1), 0) > 10 then raise exception 'slot_invalid: at most 10 requirements'; end if;
  return new;
end;
$$;

-- function: slots_notify_changes()
CREATE FUNCTION public.slots_notify_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_changes text[] := '{}';
  v_app record;
begin
  if new.date is distinct from old.date then v_changes := array_append(v_changes, 'date'); end if;
  if new.doors_time is distinct from old.doors_time or new.set_time is distinct from old.set_time then v_changes := array_append(v_changes, 'times'); end if;
  if new.venue_id is distinct from old.venue_id or new.city is distinct from old.city then v_changes := array_append(v_changes, 'venue'); end if;
  if new.support_fee is distinct from old.support_fee or new.travel_contribution is distinct from old.travel_contribution then v_changes := array_append(v_changes, 'fee'); end if;
  if array_length(v_changes, 1) is null then return new; end if;

  for v_app in
    select id, artist_id from public.applications
    where slot_id = new.id and status in ('submitted', 'viewed', 'shortlisted')
  loop
    perform public.notify(
      v_app.artist_id, 'listing_changed',
      new.headliner || ': the ' || array_to_string(v_changes, ' and ') || ' changed after you applied — check it still works for you.',
      '/slot/' || new.id::text,
      'slotchg:' || new.id::text || ':' || v_app.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text,
      false
    );
  end loop;
  return new;
end;
$$;

-- table: admin_audit_log
CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_role text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- function: staff_audit_log(integer)
CREATE FUNCTION public.staff_audit_log(p_limit integer DEFAULT 100) RETURNS SETOF public.admin_audit_log
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public._staff_actor();
  return query select * from public.admin_audit_log order by created_at desc limit least(greatest(p_limit, 1), 300);
end;
$$;

-- function: staff_find_users(text, integer)
CREATE FUNCTION public.staff_find_users(p_q text, p_limit integer DEFAULT 25) RETURNS TABLE(id uuid, role text, email text, username text, created_at timestamp with time zone, has_onboarded boolean, suspended_at timestamp with time zone, suspension_reason text, admin_role text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public._staff_actor();
  return query
    select p.id, p.role, p.email, p.username, p.created_at, p.has_onboarded, p.suspended_at, p.suspension_reason, p.admin_role
    from public.profiles p
    where nullif(btrim(p_q), '') is null
       or strpos(lower(coalesce(p.email, '')), lower(btrim(p_q))) > 0
       or strpos(lower(coalesce(p.username, '')), lower(btrim(p_q))) > 0
       or p.id::text = btrim(p_q)
    order by p.created_at desc
    limit least(greatest(p_limit, 1), 100);
end;
$$;

-- function: staff_open_reports(text, integer)
CREATE FUNCTION public.staff_open_reports(p_status text DEFAULT 'open'::text, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, context_type text, context_id uuid, reason text, status text, created_at timestamp with time zone, reporter_id uuid, reporter_label text, reported_profile_id uuid, reported_label text, resolution_note text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public._staff_actor();
  return query
    select r.id, r.context_type, r.context_id, r.reason, r.status, r.created_at,
           r.reporter_id, coalesce(rp.username, rp.email, '(deleted)'),
           r.reported_profile_id, coalesce(dp.username, dp.email, '(deleted)'),
           r.resolution_note
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles dp on dp.id = r.reported_profile_id
    where (p_status = 'all' or r.status = p_status)
    order by r.created_at desc
    limit least(greatest(p_limit, 1), 200);
end;
$$;

-- function: staff_recent_slots(text, integer)
CREATE FUNCTION public.staff_recent_slots(p_q text DEFAULT NULL::text, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, headliner text, city text, date date, status text, promoter_id uuid, promoter_company text, applicant_count integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public._staff_actor();
  return query
    select s.id, s.headliner, s.city, s.date, s.status, s.promoter_id, pr.company, s.applicant_count
    from public.slots s left join public.promoters pr on pr.id = s.promoter_id
    where nullif(btrim(p_q), '') is null or strpos(lower(s.headliner), lower(btrim(p_q))) > 0 or s.id::text = btrim(p_q)
    order by s.posted_at desc
    limit least(greatest(p_limit, 1), 100);
end;
$$;

-- table: support_requests
CREATE TABLE public.support_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid,
    email text NOT NULL,
    topic text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    handled_by uuid,
    handled_at timestamp with time zone,
    staff_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_requests_email_check CHECK (((length(email) >= 3) AND (length(email) <= 254))),
    CONSTRAINT support_requests_message_check CHECK (((length(message) >= 10) AND (length(message) <= 4000))),
    CONSTRAINT support_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'answered'::text, 'closed'::text]))),
    CONSTRAINT support_requests_topic_check CHECK ((topic = ANY (ARRAY['account'::text, 'booking'::text, 'bug'::text, 'other'::text])))
);

-- function: staff_support_requests(text, integer)
CREATE FUNCTION public.staff_support_requests(p_status text DEFAULT 'open'::text, p_limit integer DEFAULT 50) RETURNS SETOF public.support_requests
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public._staff_actor();
  return query
    select * from public.support_requests where (p_status = 'all' or status = p_status)
    order by created_at desc limit least(greatest(p_limit, 1), 200);
end;
$$;

-- function: submit_report(text, uuid, uuid, text)
CREATE FUNCTION public.submit_report(p_context_type text, p_context_id uuid, p_reported_profile_id uuid, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := public._require_active_user();
  v_id uuid;
begin
  if p_reported_profile_id = v_uid then raise exception 'report_invalid: you can''t report yourself'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'report_invalid: please describe what happened (at least 10 characters)'; end if;
  if length(p_reason) > 2000 then raise exception 'report_invalid: description is too long (max 2000 characters)'; end if;
  if p_context_type not in ('availability_request', 'message', 'slot', 'profile', 'application', 'booking', 'other') then
    raise exception 'report_invalid: unknown report type';
  end if;
  -- The same report twice is one report.
  select id into v_id from public.reports
    where reporter_id = v_uid and context_type = p_context_type
      and context_id is not distinct from p_context_id
      and reported_profile_id is not distinct from p_reported_profile_id
      and created_at > now() - interval '24 hours';
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rate_limited: too many reports today — contact support if this is urgent';
  end if;
  insert into public.reports (reporter_id, reported_profile_id, context_type, context_id, reason)
    values (v_uid, p_reported_profile_id, p_context_type, p_context_id, btrim(p_reason))
    returning id into v_id;
  return v_id;
end;
$$;

-- function: withdraw_application(uuid)
CREATE FUNCTION public.withdraw_application(p_application_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- function: withdraw_offer(uuid)
CREATE FUNCTION public.withdraw_offer(p_application_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- table: applications
CREATE TABLE public.applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_id uuid NOT NULL,
    artist_id uuid NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    featured_track_id uuid,
    message text,
    match_percent integer,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    viewed_at timestamp with time zone,
    status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_reason text,
    CONSTRAINT applications_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'viewed'::text, 'shortlisted'::text, 'offered'::text, 'confirmed'::text, 'declined'::text, 'offer_declined'::text, 'withdrawn'::text, 'cancelled'::text])))
);

-- table: artist_roster
CREATE TABLE public.artist_roster (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promoter_id uuid NOT NULL,
    artist_id uuid NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);

-- table: artist_shows
CREATE TABLE public.artist_shows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artist_id uuid NOT NULL,
    kind text NOT NULL,
    headliner text NOT NULL,
    venue text NOT NULL,
    city text NOT NULL,
    date date NOT NULL,
    CONSTRAINT artist_shows_kind_check CHECK ((kind = ANY (ARRAY['past'::text, 'upcoming'::text])))
);

-- table: artist_tracks
CREATE TABLE public.artist_tracks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artist_id uuid NOT NULL,
    title text NOT NULL,
    duration text NOT NULL,
    cover_image_url text,
    sort_order integer DEFAULT 0 NOT NULL,
    url text,
    CONSTRAINT artist_tracks_cover_image_url_size CHECK ((length(cover_image_url) < 2000000)),
    CONSTRAINT artist_tracks_title_len CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 120))),
    CONSTRAINT artist_tracks_url_check CHECK (((url IS NULL) OR ((url ~ '^https?://'::text) AND (length(url) <= 500))))
);

-- table: artists
CREATE TABLE public.artists (
    id uuid NOT NULL,
    handle text NOT NULL,
    name text NOT NULL,
    image_url text,
    banner_image_url text,
    location text NOT NULL,
    genres text[] DEFAULT '{}'::text[] NOT NULL,
    spotify_url text DEFAULT ''::text NOT NULL,
    instagram_url text DEFAULT ''::text NOT NULL,
    tiktok_url text DEFAULT ''::text NOT NULL,
    soundcloud_url text,
    bandcamp_url text,
    youtube_url text,
    website_url text,
    monthly_listeners integer,
    bio text DEFAULT ''::text NOT NULL,
    live_video_thumbnail_url text,
    live_video_url text,
    availability text DEFAULT 'available'::text NOT NULL,
    travel_radius_miles integer DEFAULT 50 NOT NULL,
    verification text DEFAULT 'unverified'::text NOT NULL,
    artist_size text DEFAULT 'emerging'::text NOT NULL,
    last_minute_alerts boolean DEFAULT false NOT NULL,
    member_since timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artists_artist_size_check CHECK ((artist_size = ANY (ARRAY['emerging'::text, 'developing'::text, 'established'::text]))),
    CONSTRAINT artists_availability_check CHECK ((availability = ANY (ARRAY['available'::text, 'limited'::text, 'unavailable'::text]))),
    CONSTRAINT artists_bandcamp_url_scheme CHECK (((bandcamp_url IS NULL) OR (bandcamp_url ~ '^https?://'::text))),
    CONSTRAINT artists_banner_image_url_size CHECK ((length(banner_image_url) < 2000000)),
    CONSTRAINT artists_genres_check CHECK ((genres <@ ARRAY['Alternative'::text, 'Electronic'::text, 'Indie'::text, 'Experimental'::text, 'Hip-Hop'::text, 'Punk'::text, 'Folk'::text, 'Pop'::text, 'R&B'::text, 'Techno'::text, 'Drum & Bass'::text, 'Rock'::text])),
    CONSTRAINT artists_image_url_size CHECK ((length(image_url) < 2000000)),
    CONSTRAINT artists_instagram_url_scheme CHECK (((instagram_url = ''::text) OR (instagram_url ~ '^https?://'::text))),
    CONSTRAINT artists_live_video_thumbnail_url_size CHECK ((length(live_video_thumbnail_url) < 2000000)),
    CONSTRAINT artists_live_video_url_scheme CHECK (((live_video_url IS NULL) OR (live_video_url ~ '^https?://'::text))),
    CONSTRAINT artists_location_check CHECK ((location = ANY (ARRAY['London'::text, 'Manchester'::text, 'Birmingham'::text, 'Bristol'::text, 'Leeds'::text, 'Brighton'::text]))),
    CONSTRAINT artists_soundcloud_url_scheme CHECK (((soundcloud_url IS NULL) OR (soundcloud_url ~ '^https?://'::text))),
    CONSTRAINT artists_spotify_url_scheme CHECK (((spotify_url = ''::text) OR (spotify_url ~ '^https?://'::text))),
    CONSTRAINT artists_tiktok_url_scheme CHECK (((tiktok_url = ''::text) OR (tiktok_url ~ '^https?://'::text))),
    CONSTRAINT artists_verification_check CHECK ((verification = ANY (ARRAY['verified'::text, 'unverified'::text]))),
    CONSTRAINT artists_website_url_scheme CHECK (((website_url IS NULL) OR (website_url ~ '^https?://'::text))),
    CONSTRAINT artists_youtube_url_scheme CHECK (((youtube_url IS NULL) OR (youtube_url ~ '^https?://'::text)))
);

-- table: availability_request_recipients
CREATE TABLE public.availability_request_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    artist_id uuid NOT NULL,
    response text DEFAULT 'pending'::text NOT NULL,
    responded_at timestamp with time zone,
    question_asked boolean DEFAULT false NOT NULL,
    thread_id uuid,
    linked_application_id uuid,
    notified_at timestamp with time zone,
    CONSTRAINT availability_request_recipients_response_check CHECK ((response = ANY (ARRAY['pending'::text, 'available'::text, 'unavailable'::text])))
);

-- table: availability_requests
CREATE TABLE public.availability_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promoter_id uuid NOT NULL,
    event_name text NOT NULL,
    event_date date NOT NULL,
    event_time time without time zone NOT NULL,
    timezone text DEFAULT 'Europe/London'::text NOT NULL,
    venue_name text NOT NULL,
    venue_location text NOT NULL,
    proposed_fee integer NOT NULL,
    currency text DEFAULT 'GBP'::text NOT NULL,
    set_length_mins integer NOT NULL,
    response_deadline timestamp with time zone NOT NULL,
    message text,
    status text DEFAULT 'sent'::text NOT NULL,
    linked_slot_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT availability_requests_currency_check CHECK ((currency = ANY (ARRAY['GBP'::text, 'EUR'::text, 'USD'::text]))),
    CONSTRAINT availability_requests_proposed_fee_check CHECK ((proposed_fee >= 0)),
    CONSTRAINT availability_requests_set_length_mins_check CHECK ((set_length_mins > 0)),
    CONSTRAINT availability_requests_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'withdrawn'::text, 'filled'::text])))
);

-- table: bookings
CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    slot_id uuid,
    artist_id uuid,
    promoter_id uuid,
    status text DEFAULT 'offered'::text NOT NULL,
    artist_name text NOT NULL,
    promoter_company text NOT NULL,
    headliner text NOT NULL,
    venue_id text,
    venue_name text NOT NULL,
    venue_address text NOT NULL,
    venue_city text NOT NULL,
    event_date date NOT NULL,
    doors_time time without time zone NOT NULL,
    set_time time without time zone NOT NULL,
    set_length_mins integer NOT NULL,
    requirements text[] DEFAULT '{}'::text[] NOT NULL,
    fee_pence integer NOT NULL,
    travel_pence integer NOT NULL,
    currency text DEFAULT 'GBP'::text NOT NULL,
    offer_message text,
    offered_at timestamp with time zone DEFAULT now() NOT NULL,
    offer_expires_at timestamp with time zone NOT NULL,
    responded_at timestamp with time zone,
    decline_reason text,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bookings_currency_check CHECK ((currency = 'GBP'::text)),
    CONSTRAINT bookings_fee_pence_check CHECK ((fee_pence >= 0)),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['offered'::text, 'confirmed'::text, 'declined'::text, 'withdrawn'::text, 'cancelled'::text]))),
    CONSTRAINT bookings_travel_pence_check CHECK ((travel_pence >= 0))
);

-- table: city_distances
CREATE TABLE public.city_distances (
    city_a text NOT NULL,
    city_b text NOT NULL,
    miles integer NOT NULL,
    CONSTRAINT city_distances_miles_check CHECK ((miles >= 0))
);

-- table: event_templates
CREATE TABLE public.event_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promoter_id uuid NOT NULL,
    name text NOT NULL,
    event_name text DEFAULT ''::text NOT NULL,
    venue_name text DEFAULT ''::text NOT NULL,
    venue_location text DEFAULT ''::text NOT NULL,
    proposed_fee integer,
    currency text DEFAULT 'GBP'::text NOT NULL,
    set_length_mins integer,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_templates_currency_check CHECK ((currency = ANY (ARRAY['GBP'::text, 'EUR'::text, 'USD'::text])))
);

-- table: gig_invitations
CREATE TABLE public.gig_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_id uuid NOT NULL,
    promoter_id uuid NOT NULL,
    artist_id uuid NOT NULL,
    message text,
    status text DEFAULT 'pending'::text NOT NULL,
    linked_application_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    CONSTRAINT gig_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text])))
);

-- table: message_threads
CREATE TABLE public.message_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artist_id uuid NOT NULL,
    promoter_id uuid NOT NULL,
    context text,
    artist_last_read_at timestamp with time zone,
    promoter_last_read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    application_id uuid,
    last_message_at timestamp with time zone
);

-- table: messages
CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- table: notifications
CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    type text NOT NULL,
    text text NOT NULL,
    href text,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    dedupe_key text,
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['viewed'::text, 'shortlisted'::text, 'urgent'::text, 'booked'::text, 'message'::text, 'availability_request'::text, 'availability_response'::text, 'offer'::text, 'offer_accepted'::text, 'offer_declined'::text, 'application_declined'::text, 'application_withdrawn'::text, 'booking_cancelled'::text, 'listing_changed'::text, 'report_update'::text, 'system'::text])))
);

-- table: profiles
CREATE TABLE public.profiles (
    id uuid NOT NULL,
    role text NOT NULL,
    email text NOT NULL,
    has_onboarded boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notify_availability_requests boolean DEFAULT true NOT NULL,
    username text,
    email_notifications boolean DEFAULT true NOT NULL,
    suspended_at timestamp with time zone,
    suspension_reason text,
    admin_role text,
    CONSTRAINT profiles_admin_role_check CHECK ((admin_role = ANY (ARRAY['moderator'::text, 'admin'::text]))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['artist'::text, 'promoter'::text]))),
    CONSTRAINT profiles_username_format CHECK (((username IS NULL) OR (username ~ '^[a-zA-Z0-9_]{3,20}$'::text)))
);

-- table: promoter_blocks
CREATE TABLE public.promoter_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artist_id uuid NOT NULL,
    promoter_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- table: promoters
CREATE TABLE public.promoters (
    id uuid NOT NULL,
    name text NOT NULL,
    company text NOT NULL,
    avatar_url text,
    location text,
    verification text DEFAULT 'unverified'::text NOT NULL,
    shows_posted integer DEFAULT 0 NOT NULL,
    CONSTRAINT promoters_avatar_url_size CHECK ((length(avatar_url) < 2000000)),
    CONSTRAINT promoters_location_check CHECK ((location = ANY (ARRAY['London'::text, 'Manchester'::text, 'Birmingham'::text, 'Bristol'::text, 'Leeds'::text, 'Brighton'::text]))),
    CONSTRAINT promoters_verification_check CHECK ((verification = ANY (ARRAY['verified'::text, 'unverified'::text])))
);

-- table: rate_limits
CREATE TABLE public.rate_limits (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL
);

-- table: reports
CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid,
    reported_profile_id uuid,
    context_type text NOT NULL,
    context_id uuid,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    resolution_note text,
    CONSTRAINT reports_context_type_check CHECK ((context_type = ANY (ARRAY['availability_request'::text, 'message'::text, 'slot'::text, 'profile'::text, 'application'::text, 'booking'::text, 'other'::text]))),
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewing'::text, 'actioned'::text, 'dismissed'::text])))
);

-- table: saved_slots
CREATE TABLE public.saved_slots (
    profile_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- table: schedule_entries
CREATE TABLE public.schedule_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    stage text DEFAULT 'Main Stage'::text NOT NULL,
    start_at timestamp without time zone NOT NULL,
    end_at timestamp without time zone NOT NULL,
    artist_id uuid,
    notes text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schedule_entries_check CHECK ((end_at > start_at)),
    CONSTRAINT schedule_entries_kind_check CHECK ((kind = ANY (ARRAY['arrival'::text, 'load_in'::text, 'soundcheck'::text, 'doors'::text, 'performance'::text, 'changeover'::text, 'break'::text, 'other'::text])))
);

-- table: schedule_template_entries
CREATE TABLE public.schedule_template_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    stage text DEFAULT 'Main Stage'::text NOT NULL,
    offset_minutes integer NOT NULL,
    duration_minutes integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT schedule_template_entries_duration_minutes_check CHECK ((duration_minutes > 0)),
    CONSTRAINT schedule_template_entries_kind_check CHECK ((kind = ANY (ARRAY['arrival'::text, 'load_in'::text, 'soundcheck'::text, 'doors'::text, 'performance'::text, 'changeover'::text, 'break'::text, 'other'::text])))
);

-- table: schedule_templates
CREATE TABLE public.schedule_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promoter_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- table: show_schedules
CREATE TABLE public.show_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_id uuid NOT NULL,
    promoter_id uuid NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT show_schedules_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'final'::text])))
);

-- table: venues
CREATE TABLE public.venues (
    id text NOT NULL,
    name text NOT NULL,
    city text NOT NULL,
    capacity integer NOT NULL,
    address text NOT NULL,
    image_url text,
    verification text DEFAULT 'verified'::text NOT NULL,
    CONSTRAINT venues_city_check CHECK ((city = ANY (ARRAY['London'::text, 'Manchester'::text, 'Birmingham'::text, 'Bristol'::text, 'Leeds'::text, 'Brighton'::text]))),
    CONSTRAINT venues_verification_check CHECK ((verification = ANY (ARRAY['verified'::text, 'unverified'::text])))
);

-- data: admin_audit_log

-- data: applications

-- data: artist_roster

-- data: artist_shows

-- data: artist_tracks

-- data: artists

-- data: availability_request_recipients

-- data: availability_requests

-- data: bookings

-- data: city_distances
INSERT INTO public.city_distances VALUES ('London', 'Manchester', 200);
INSERT INTO public.city_distances VALUES ('London', 'Birmingham', 120);
INSERT INTO public.city_distances VALUES ('London', 'Bristol', 120);
INSERT INTO public.city_distances VALUES ('London', 'Leeds', 200);
INSERT INTO public.city_distances VALUES ('London', 'Brighton', 55);
INSERT INTO public.city_distances VALUES ('Manchester', 'Birmingham', 90);
INSERT INTO public.city_distances VALUES ('Manchester', 'Bristol', 170);
INSERT INTO public.city_distances VALUES ('Manchester', 'Leeds', 45);
INSERT INTO public.city_distances VALUES ('Manchester', 'Brighton', 250);
INSERT INTO public.city_distances VALUES ('Birmingham', 'Bristol', 90);
INSERT INTO public.city_distances VALUES ('Birmingham', 'Leeds', 120);
INSERT INTO public.city_distances VALUES ('Birmingham', 'Brighton', 170);
INSERT INTO public.city_distances VALUES ('Bristol', 'Leeds', 210);
INSERT INTO public.city_distances VALUES ('Bristol', 'Brighton', 130);
INSERT INTO public.city_distances VALUES ('Leeds', 'Brighton', 240);
INSERT INTO public.city_distances VALUES ('Manchester', 'London', 200);
INSERT INTO public.city_distances VALUES ('Birmingham', 'London', 120);
INSERT INTO public.city_distances VALUES ('Bristol', 'London', 120);
INSERT INTO public.city_distances VALUES ('Leeds', 'London', 200);
INSERT INTO public.city_distances VALUES ('Brighton', 'London', 55);
INSERT INTO public.city_distances VALUES ('Birmingham', 'Manchester', 90);
INSERT INTO public.city_distances VALUES ('Bristol', 'Manchester', 170);
INSERT INTO public.city_distances VALUES ('Leeds', 'Manchester', 45);
INSERT INTO public.city_distances VALUES ('Brighton', 'Manchester', 250);
INSERT INTO public.city_distances VALUES ('Bristol', 'Birmingham', 90);
INSERT INTO public.city_distances VALUES ('Leeds', 'Birmingham', 120);
INSERT INTO public.city_distances VALUES ('Brighton', 'Birmingham', 170);
INSERT INTO public.city_distances VALUES ('Leeds', 'Bristol', 210);
INSERT INTO public.city_distances VALUES ('Brighton', 'Bristol', 130);
INSERT INTO public.city_distances VALUES ('Brighton', 'Leeds', 240);

-- data: email_outbox

-- data: event_templates

-- data: gig_invitations

-- data: message_threads

-- data: messages

-- data: notifications

-- data: profiles

-- data: promoter_blocks

-- data: promoters

-- data: rate_limits

-- data: reports

-- data: saved_slots

-- data: schedule_entries

-- data: schedule_template_entries

-- data: schedule_templates

-- data: show_schedules

-- data: slots

-- data: support_requests

-- data: venues
INSERT INTO public.venues VALUES ('venue-1', 'Village Underground', 'London', 780, '54 Holywell Ln, London EC2A 3PQ', 'https://picsum.photos/seed/ss-venue-london-1/1200/800', 'verified');
INSERT INTO public.venues VALUES ('venue-2', 'YES Basement', 'Manchester', 350, '38 Charles St, Manchester M1 6EU', 'https://picsum.photos/seed/ss-venue-manchester-1/1200/800', 'verified');
INSERT INTO public.venues VALUES ('venue-3', 'Strange Brew', 'Bristol', 250, '23-25 St Nicholas St, Bristol BS1 1TP', 'https://picsum.photos/seed/ss-venue-bristol-1/1200/800', 'verified');
INSERT INTO public.venues VALUES ('venue-4', 'The Snug', 'Birmingham', 180, 'Kings Heath High St, Birmingham B14', 'https://picsum.photos/seed/ss-venue-birmingham-1/1200/800', 'unverified');
INSERT INTO public.venues VALUES ('venue-5', 'The Warehouse Exchange', 'Leeds', 420, 'Mabgate Mills, Leeds LS9', 'https://picsum.photos/seed/ss-venue-leeds-1/1200/800', 'verified');
INSERT INTO public.venues VALUES ('venue-6', 'The Arch Room', 'Brighton', 300, 'Kings Rd Arches, Brighton BN1', 'https://picsum.photos/seed/ss-venue-brighton-1/1200/800', 'verified');

-- constraint: admin_audit_log admin_audit_log_pkey
ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);

-- constraint: applications applications_pkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);

-- constraint: applications applications_slot_id_artist_id_key
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_slot_id_artist_id_key UNIQUE (slot_id, artist_id);

-- constraint: artist_roster artist_roster_pkey
ALTER TABLE ONLY public.artist_roster
    ADD CONSTRAINT artist_roster_pkey PRIMARY KEY (id);

-- constraint: artist_roster artist_roster_promoter_id_artist_id_key
ALTER TABLE ONLY public.artist_roster
    ADD CONSTRAINT artist_roster_promoter_id_artist_id_key UNIQUE (promoter_id, artist_id);

-- constraint: artist_shows artist_shows_pkey
ALTER TABLE ONLY public.artist_shows
    ADD CONSTRAINT artist_shows_pkey PRIMARY KEY (id);

-- constraint: artist_tracks artist_tracks_pkey
ALTER TABLE ONLY public.artist_tracks
    ADD CONSTRAINT artist_tracks_pkey PRIMARY KEY (id);

-- check constraint: artists artists_banner_scheme
ALTER TABLE public.artists
    ADD CONSTRAINT artists_banner_scheme CHECK (((banner_image_url IS NULL) OR (banner_image_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)'::text))) NOT VALID;

-- constraint: artists artists_handle_key
ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_handle_key UNIQUE (handle);

-- check constraint: artists artists_image_scheme
ALTER TABLE public.artists
    ADD CONSTRAINT artists_image_scheme CHECK (((image_url IS NULL) OR (image_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)'::text))) NOT VALID;

-- constraint: artists artists_pkey
ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_pkey PRIMARY KEY (id);

-- check constraint: artists artists_thumb_scheme
ALTER TABLE public.artists
    ADD CONSTRAINT artists_thumb_scheme CHECK (((live_video_thumbnail_url IS NULL) OR (live_video_thumbnail_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)'::text))) NOT VALID;

-- constraint: availability_request_recipients availability_request_recipients_pkey
ALTER TABLE ONLY public.availability_request_recipients
    ADD CONSTRAINT availability_request_recipients_pkey PRIMARY KEY (id);

-- constraint: availability_request_recipients availability_request_recipients_request_id_artist_id_key
ALTER TABLE ONLY public.availability_request_recipients
    ADD CONSTRAINT availability_request_recipients_request_id_artist_id_key UNIQUE (request_id, artist_id);

-- constraint: availability_requests availability_requests_pkey
ALTER TABLE ONLY public.availability_requests
    ADD CONSTRAINT availability_requests_pkey PRIMARY KEY (id);

-- constraint: bookings bookings_pkey
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);

-- constraint: city_distances city_distances_pkey
ALTER TABLE ONLY public.city_distances
    ADD CONSTRAINT city_distances_pkey PRIMARY KEY (city_a, city_b);

-- constraint: email_outbox email_outbox_pkey
ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_pkey PRIMARY KEY (id);

-- constraint: event_templates event_templates_pkey
ALTER TABLE ONLY public.event_templates
    ADD CONSTRAINT event_templates_pkey PRIMARY KEY (id);

-- constraint: gig_invitations gig_invitations_pkey
ALTER TABLE ONLY public.gig_invitations
    ADD CONSTRAINT gig_invitations_pkey PRIMARY KEY (id);

-- constraint: gig_invitations gig_invitations_slot_id_artist_id_key
ALTER TABLE ONLY public.gig_invitations
    ADD CONSTRAINT gig_invitations_slot_id_artist_id_key UNIQUE (slot_id, artist_id);

-- constraint: message_threads message_threads_artist_id_promoter_id_context_key
ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_artist_id_promoter_id_context_key UNIQUE (artist_id, promoter_id, context);

-- constraint: message_threads message_threads_pkey
ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_pkey PRIMARY KEY (id);

-- constraint: messages messages_pkey
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

-- constraint: notifications notifications_pkey
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

-- constraint: profiles profiles_pkey
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

-- constraint: promoter_blocks promoter_blocks_artist_id_promoter_id_key
ALTER TABLE ONLY public.promoter_blocks
    ADD CONSTRAINT promoter_blocks_artist_id_promoter_id_key UNIQUE (artist_id, promoter_id);

-- constraint: promoter_blocks promoter_blocks_pkey
ALTER TABLE ONLY public.promoter_blocks
    ADD CONSTRAINT promoter_blocks_pkey PRIMARY KEY (id);

-- check constraint: promoters promoters_avatar_scheme
ALTER TABLE public.promoters
    ADD CONSTRAINT promoters_avatar_scheme CHECK (((avatar_url IS NULL) OR (avatar_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)'::text))) NOT VALID;

-- constraint: promoters promoters_pkey
ALTER TABLE ONLY public.promoters
    ADD CONSTRAINT promoters_pkey PRIMARY KEY (id);

-- constraint: rate_limits rate_limits_pkey
ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key, window_start);

-- constraint: reports reports_pkey
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

-- constraint: saved_slots saved_slots_pkey
ALTER TABLE ONLY public.saved_slots
    ADD CONSTRAINT saved_slots_pkey PRIMARY KEY (profile_id, slot_id);

-- constraint: schedule_entries schedule_entries_pkey
ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_pkey PRIMARY KEY (id);

-- constraint: schedule_template_entries schedule_template_entries_pkey
ALTER TABLE ONLY public.schedule_template_entries
    ADD CONSTRAINT schedule_template_entries_pkey PRIMARY KEY (id);

-- constraint: schedule_templates schedule_templates_pkey
ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_pkey PRIMARY KEY (id);

-- constraint: show_schedules show_schedules_pkey
ALTER TABLE ONLY public.show_schedules
    ADD CONSTRAINT show_schedules_pkey PRIMARY KEY (id);

-- constraint: show_schedules show_schedules_slot_id_key
ALTER TABLE ONLY public.show_schedules
    ADD CONSTRAINT show_schedules_slot_id_key UNIQUE (slot_id);

-- check constraint: slots slots_artist_photo_scheme
ALTER TABLE public.slots
    ADD CONSTRAINT slots_artist_photo_scheme CHECK (((artist_photo_url IS NULL) OR (artist_photo_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)'::text))) NOT VALID;

-- check constraint: slots slots_headliner_image_scheme
ALTER TABLE public.slots
    ADD CONSTRAINT slots_headliner_image_scheme CHECK (((headliner_image_url IS NULL) OR (headliner_image_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)'::text))) NOT VALID;

-- constraint: slots slots_pkey
ALTER TABLE ONLY public.slots
    ADD CONSTRAINT slots_pkey PRIMARY KEY (id);

-- constraint: support_requests support_requests_pkey
ALTER TABLE ONLY public.support_requests
    ADD CONSTRAINT support_requests_pkey PRIMARY KEY (id);

-- constraint: venues venues_pkey
ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);

-- index: admin_audit_log_created_idx
CREATE INDEX admin_audit_log_created_idx ON public.admin_audit_log USING btree (created_at DESC);

-- index: applications_artist_id_idx
CREATE INDEX applications_artist_id_idx ON public.applications USING btree (artist_id);

-- index: applications_slot_id_idx
CREATE INDEX applications_slot_id_idx ON public.applications USING btree (slot_id);

-- index: artist_roster_artist_id_idx
CREATE INDEX artist_roster_artist_id_idx ON public.artist_roster USING btree (artist_id);

-- index: artist_roster_promoter_id_idx
CREATE INDEX artist_roster_promoter_id_idx ON public.artist_roster USING btree (promoter_id);

-- index: artist_shows_artist_id_idx
CREATE INDEX artist_shows_artist_id_idx ON public.artist_shows USING btree (artist_id);

-- index: artist_tracks_artist_id_idx
CREATE INDEX artist_tracks_artist_id_idx ON public.artist_tracks USING btree (artist_id);

-- index: availability_request_recipients_artist_id_idx
CREATE INDEX availability_request_recipients_artist_id_idx ON public.availability_request_recipients USING btree (artist_id);

-- index: availability_request_recipients_request_id_idx
CREATE INDEX availability_request_recipients_request_id_idx ON public.availability_request_recipients USING btree (request_id);

-- index: availability_requests_promoter_id_idx
CREATE INDEX availability_requests_promoter_id_idx ON public.availability_requests USING btree (promoter_id);

-- index: bookings_artist_id_idx
CREATE INDEX bookings_artist_id_idx ON public.bookings USING btree (artist_id);

-- index: bookings_one_active_per_application
CREATE UNIQUE INDEX bookings_one_active_per_application ON public.bookings USING btree (application_id) WHERE (status = ANY (ARRAY['offered'::text, 'confirmed'::text]));

-- index: bookings_one_confirmed_per_slot
CREATE UNIQUE INDEX bookings_one_confirmed_per_slot ON public.bookings USING btree (slot_id) WHERE (status = 'confirmed'::text);

-- index: bookings_promoter_id_idx
CREATE INDEX bookings_promoter_id_idx ON public.bookings USING btree (promoter_id);

-- index: bookings_slot_id_idx
CREATE INDEX bookings_slot_id_idx ON public.bookings USING btree (slot_id);

-- index: email_outbox_dedupe_idx
CREATE UNIQUE INDEX email_outbox_dedupe_idx ON public.email_outbox USING btree (profile_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);

-- index: event_templates_promoter_id_idx
CREATE INDEX event_templates_promoter_id_idx ON public.event_templates USING btree (promoter_id);

-- index: gig_invitations_artist_id_idx
CREATE INDEX gig_invitations_artist_id_idx ON public.gig_invitations USING btree (artist_id);

-- index: gig_invitations_promoter_id_idx
CREATE INDEX gig_invitations_promoter_id_idx ON public.gig_invitations USING btree (promoter_id);

-- index: message_threads_application_id_idx
CREATE INDEX message_threads_application_id_idx ON public.message_threads USING btree (application_id);

-- index: messages_thread_id_idx
CREATE INDEX messages_thread_id_idx ON public.messages USING btree (thread_id);

-- index: notifications_dedupe_idx
CREATE UNIQUE INDEX notifications_dedupe_idx ON public.notifications USING btree (profile_id, dedupe_key) WHERE (dedupe_key IS NOT NULL);

-- index: notifications_profile_id_idx
CREATE INDEX notifications_profile_id_idx ON public.notifications USING btree (profile_id);

-- index: profiles_username_unique_idx
CREATE UNIQUE INDEX profiles_username_unique_idx ON public.profiles USING btree (lower(username));

-- index: promoter_blocks_artist_id_idx
CREATE INDEX promoter_blocks_artist_id_idx ON public.promoter_blocks USING btree (artist_id);

-- index: reports_reported_profile_id_idx
CREATE INDEX reports_reported_profile_id_idx ON public.reports USING btree (reported_profile_id);

-- index: reports_status_idx
CREATE INDEX reports_status_idx ON public.reports USING btree (status, created_at DESC);

-- index: schedule_entries_artist_id_idx
CREATE INDEX schedule_entries_artist_id_idx ON public.schedule_entries USING btree (artist_id);

-- index: schedule_entries_schedule_id_idx
CREATE INDEX schedule_entries_schedule_id_idx ON public.schedule_entries USING btree (schedule_id);

-- index: schedule_template_entries_template_id_idx
CREATE INDEX schedule_template_entries_template_id_idx ON public.schedule_template_entries USING btree (template_id);

-- index: schedule_templates_promoter_id_idx
CREATE INDEX schedule_templates_promoter_id_idx ON public.schedule_templates USING btree (promoter_id);

-- index: show_schedules_promoter_id_idx
CREATE INDEX show_schedules_promoter_id_idx ON public.show_schedules USING btree (promoter_id);

-- index: slots_is_urgent_idx
CREATE INDEX slots_is_urgent_idx ON public.slots USING btree (is_urgent);

-- index: slots_promoter_id_idx
CREATE INDEX slots_promoter_id_idx ON public.slots USING btree (promoter_id);

-- index: slots_status_idx
CREATE INDEX slots_status_idx ON public.slots USING btree (status);

-- index: support_requests_status_idx
CREATE INDEX support_requests_status_idx ON public.support_requests USING btree (status, created_at DESC);

-- trigger: applications applications_bump_count
CREATE TRIGGER applications_bump_count AFTER INSERT OR DELETE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.bump_applicant_count();

-- trigger: applications applications_guard_bi
CREATE TRIGGER applications_guard_bi BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.applications_guard();

-- trigger: applications applications_ranking_and_ownership_immutable_by_client
CREATE TRIGGER applications_ranking_and_ownership_immutable_by_client BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.prevent_client_trust_field_tamper();

-- trigger: artists artists_guard_biu
CREATE TRIGGER artists_guard_biu BEFORE INSERT OR UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.artists_guard();

-- trigger: artists artists_trust_fields_immutable_by_client
CREATE TRIGGER artists_trust_fields_immutable_by_client BEFORE INSERT OR UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.prevent_client_trust_field_tamper();

-- trigger: availability_request_recipients availability_request_recipients_notify_new
CREATE TRIGGER availability_request_recipients_notify_new AFTER INSERT ON public.availability_request_recipients FOR EACH ROW EXECUTE FUNCTION public.notify_on_availability_request();

-- trigger: availability_request_recipients availability_request_recipients_notify_response
CREATE TRIGGER availability_request_recipients_notify_response AFTER UPDATE ON public.availability_request_recipients FOR EACH ROW EXECUTE FUNCTION public.notify_on_availability_response();

-- trigger: availability_requests availability_requests_notify_status_change
CREATE TRIGGER availability_requests_notify_status_change AFTER UPDATE ON public.availability_requests FOR EACH ROW EXECUTE FUNCTION public.notify_on_availability_request_status_change();

-- trigger: bookings bookings_touch_bu
CREATE TRIGGER bookings_touch_bu BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_touch();

-- trigger: gig_invitations gig_invitations_notify_insert
CREATE TRIGGER gig_invitations_notify_insert AFTER INSERT ON public.gig_invitations FOR EACH ROW EXECUTE FUNCTION public.notify_on_gig_invitation();

-- trigger: gig_invitations gig_invitations_notify_response
CREATE TRIGGER gig_invitations_notify_response AFTER UPDATE ON public.gig_invitations FOR EACH ROW EXECUTE FUNCTION public.notify_on_gig_invitation();

-- trigger: messages messages_after_insert_ai
CREATE TRIGGER messages_after_insert_ai AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_after_insert();

-- trigger: messages messages_guard_bi
CREATE TRIGGER messages_guard_bi BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_guard();

-- trigger: profiles profiles_protect_staff_fields
CREATE TRIGGER profiles_protect_staff_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_staff_fields();

-- trigger: profiles profiles_role_immutable
CREATE TRIGGER profiles_role_immutable BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change();

-- trigger: promoters promoters_trust_fields_immutable_by_client
CREATE TRIGGER promoters_trust_fields_immutable_by_client BEFORE INSERT OR UPDATE ON public.promoters FOR EACH ROW EXECUTE FUNCTION public.prevent_client_trust_field_tamper();

-- trigger: slots slots_guard_biu
CREATE TRIGGER slots_guard_biu BEFORE INSERT OR UPDATE ON public.slots FOR EACH ROW EXECUTE FUNCTION public.slots_guard();

-- trigger: slots slots_notify_changes_au
CREATE TRIGGER slots_notify_changes_au AFTER UPDATE ON public.slots FOR EACH ROW EXECUTE FUNCTION public.slots_notify_changes();

-- trigger: slots slots_notify_urgent_ai
CREATE TRIGGER slots_notify_urgent_ai AFTER INSERT ON public.slots FOR EACH ROW EXECUTE FUNCTION public.notify_urgent_slot();

-- fk constraint: admin_audit_log admin_audit_log_actor_id_fkey
ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- fk constraint: applications applications_artist_id_fkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: applications applications_featured_track_id_fkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_featured_track_id_fkey FOREIGN KEY (featured_track_id) REFERENCES public.artist_tracks(id);

-- fk constraint: applications applications_slot_id_fkey
ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE CASCADE;

-- fk constraint: artist_roster artist_roster_artist_id_fkey
ALTER TABLE ONLY public.artist_roster
    ADD CONSTRAINT artist_roster_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: artist_roster artist_roster_promoter_id_fkey
ALTER TABLE ONLY public.artist_roster
    ADD CONSTRAINT artist_roster_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: artist_shows artist_shows_artist_id_fkey
ALTER TABLE ONLY public.artist_shows
    ADD CONSTRAINT artist_shows_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: artist_tracks artist_tracks_artist_id_fkey
ALTER TABLE ONLY public.artist_tracks
    ADD CONSTRAINT artist_tracks_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: artists artists_id_fkey
ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_id_fkey FOREIGN KEY (id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- fk constraint: availability_request_recipients availability_request_recipients_artist_id_fkey
ALTER TABLE ONLY public.availability_request_recipients
    ADD CONSTRAINT availability_request_recipients_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: availability_request_recipients availability_request_recipients_linked_application_id_fkey
ALTER TABLE ONLY public.availability_request_recipients
    ADD CONSTRAINT availability_request_recipients_linked_application_id_fkey FOREIGN KEY (linked_application_id) REFERENCES public.applications(id) ON DELETE SET NULL;

-- fk constraint: availability_request_recipients availability_request_recipients_request_id_fkey
ALTER TABLE ONLY public.availability_request_recipients
    ADD CONSTRAINT availability_request_recipients_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.availability_requests(id) ON DELETE CASCADE;

-- fk constraint: availability_request_recipients availability_request_recipients_thread_id_fkey
ALTER TABLE ONLY public.availability_request_recipients
    ADD CONSTRAINT availability_request_recipients_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.message_threads(id) ON DELETE SET NULL;

-- fk constraint: availability_requests availability_requests_linked_slot_id_fkey
ALTER TABLE ONLY public.availability_requests
    ADD CONSTRAINT availability_requests_linked_slot_id_fkey FOREIGN KEY (linked_slot_id) REFERENCES public.slots(id) ON DELETE SET NULL;

-- fk constraint: availability_requests availability_requests_promoter_id_fkey
ALTER TABLE ONLY public.availability_requests
    ADD CONSTRAINT availability_requests_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: bookings bookings_application_id_fkey
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;

-- fk constraint: bookings bookings_artist_id_fkey
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE SET NULL;

-- fk constraint: bookings bookings_promoter_id_fkey
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE SET NULL;

-- fk constraint: bookings bookings_slot_id_fkey
ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE SET NULL;

-- fk constraint: email_outbox email_outbox_profile_id_fkey
ALTER TABLE ONLY public.email_outbox
    ADD CONSTRAINT email_outbox_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- fk constraint: event_templates event_templates_promoter_id_fkey
ALTER TABLE ONLY public.event_templates
    ADD CONSTRAINT event_templates_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: gig_invitations gig_invitations_artist_id_fkey
ALTER TABLE ONLY public.gig_invitations
    ADD CONSTRAINT gig_invitations_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: gig_invitations gig_invitations_linked_application_id_fkey
ALTER TABLE ONLY public.gig_invitations
    ADD CONSTRAINT gig_invitations_linked_application_id_fkey FOREIGN KEY (linked_application_id) REFERENCES public.applications(id) ON DELETE SET NULL;

-- fk constraint: gig_invitations gig_invitations_promoter_id_fkey
ALTER TABLE ONLY public.gig_invitations
    ADD CONSTRAINT gig_invitations_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: gig_invitations gig_invitations_slot_id_fkey
ALTER TABLE ONLY public.gig_invitations
    ADD CONSTRAINT gig_invitations_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE CASCADE;

-- fk constraint: message_threads message_threads_application_id_fkey
ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;

-- fk constraint: message_threads message_threads_artist_id_fkey
ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: message_threads message_threads_promoter_id_fkey
ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: messages messages_sender_id_fkey
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- fk constraint: messages messages_thread_id_fkey
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.message_threads(id) ON DELETE CASCADE;

-- fk constraint: notifications notifications_profile_id_fkey
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- fk constraint: profiles profiles_id_fkey
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- fk constraint: promoter_blocks promoter_blocks_artist_id_fkey
ALTER TABLE ONLY public.promoter_blocks
    ADD CONSTRAINT promoter_blocks_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;

-- fk constraint: promoter_blocks promoter_blocks_promoter_id_fkey
ALTER TABLE ONLY public.promoter_blocks
    ADD CONSTRAINT promoter_blocks_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: promoters promoters_id_fkey
ALTER TABLE ONLY public.promoters
    ADD CONSTRAINT promoters_id_fkey FOREIGN KEY (id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- fk constraint: reports reports_reported_profile_id_fkey
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reported_profile_id_fkey FOREIGN KEY (reported_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- fk constraint: reports reports_reporter_id_fkey
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- fk constraint: reports reports_reviewed_by_fkey
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- fk constraint: saved_slots saved_slots_profile_id_fkey
ALTER TABLE ONLY public.saved_slots
    ADD CONSTRAINT saved_slots_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- fk constraint: saved_slots saved_slots_slot_id_fkey
ALTER TABLE ONLY public.saved_slots
    ADD CONSTRAINT saved_slots_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE CASCADE;

-- fk constraint: schedule_entries schedule_entries_artist_id_fkey
ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE SET NULL;

-- fk constraint: schedule_entries schedule_entries_schedule_id_fkey
ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.show_schedules(id) ON DELETE CASCADE;

-- fk constraint: schedule_template_entries schedule_template_entries_template_id_fkey
ALTER TABLE ONLY public.schedule_template_entries
    ADD CONSTRAINT schedule_template_entries_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.schedule_templates(id) ON DELETE CASCADE;

-- fk constraint: schedule_templates schedule_templates_promoter_id_fkey
ALTER TABLE ONLY public.schedule_templates
    ADD CONSTRAINT schedule_templates_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: show_schedules show_schedules_promoter_id_fkey
ALTER TABLE ONLY public.show_schedules
    ADD CONSTRAINT show_schedules_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: show_schedules show_schedules_slot_id_fkey
ALTER TABLE ONLY public.show_schedules
    ADD CONSTRAINT show_schedules_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE CASCADE;

-- fk constraint: slots slots_promoter_id_fkey
ALTER TABLE ONLY public.slots
    ADD CONSTRAINT slots_promoter_id_fkey FOREIGN KEY (promoter_id) REFERENCES public.promoters(id) ON DELETE CASCADE;

-- fk constraint: slots slots_venue_id_fkey
ALTER TABLE ONLY public.slots
    ADD CONSTRAINT slots_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id);

-- fk constraint: support_requests support_requests_handled_by_fkey
ALTER TABLE ONLY public.support_requests
    ADD CONSTRAINT support_requests_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- fk constraint: support_requests support_requests_profile_id_fkey
ALTER TABLE ONLY public.support_requests
    ADD CONSTRAINT support_requests_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- row security: admin_audit_log
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- policy: admin_audit_log admin_audit_log: staff select
CREATE POLICY "admin_audit_log: staff select" ON public.admin_audit_log FOR SELECT USING ((public.current_admin_role() IS NOT NULL));

-- row security: applications
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- policy: applications applications: insert by promoter from available response
CREATE POLICY "applications: insert by promoter from available response" ON public.applications FOR INSERT WITH CHECK (((status = ANY (ARRAY['submitted'::text, 'shortlisted'::text])) AND (EXISTS ( SELECT 1
   FROM public.slots s
  WHERE ((s.id = applications.slot_id) AND (s.promoter_id = auth.uid())))) AND (EXISTS ( SELECT 1
   FROM (public.availability_request_recipients r
     JOIN public.availability_requests req ON ((req.id = r.request_id)))
  WHERE ((r.artist_id = applications.artist_id) AND (r.response = 'available'::text) AND (req.promoter_id = auth.uid()) AND (req.linked_slot_id = applications.slot_id))))));

-- policy: applications applications: insert own
CREATE POLICY "applications: insert own" ON public.applications FOR INSERT WITH CHECK (((artist_id = auth.uid()) AND (status = 'submitted'::text)));

-- policy: applications applications: select participant
CREATE POLICY "applications: select participant" ON public.applications FOR SELECT USING (((artist_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.slots s
  WHERE ((s.id = applications.slot_id) AND (s.promoter_id = auth.uid()))))));

-- row security: artist_roster
ALTER TABLE public.artist_roster ENABLE ROW LEVEL SECURITY;

-- policy: artist_roster artist_roster: delete own
CREATE POLICY "artist_roster: delete own" ON public.artist_roster FOR DELETE USING ((promoter_id = auth.uid()));

-- policy: artist_roster artist_roster: insert own
CREATE POLICY "artist_roster: insert own" ON public.artist_roster FOR INSERT WITH CHECK (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: artist_roster artist_roster: select own
CREATE POLICY "artist_roster: select own" ON public.artist_roster FOR SELECT USING ((promoter_id = auth.uid()));

-- policy: artist_roster artist_roster: update own
CREATE POLICY "artist_roster: update own" ON public.artist_roster FOR UPDATE USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- row security: artist_shows
ALTER TABLE public.artist_shows ENABLE ROW LEVEL SECURITY;

-- policy: artist_shows artist_shows: public select
CREATE POLICY "artist_shows: public select" ON public.artist_shows FOR SELECT USING (true);

-- policy: artist_shows artist_shows: write own
CREATE POLICY "artist_shows: write own" ON public.artist_shows USING ((artist_id = auth.uid())) WITH CHECK ((artist_id = auth.uid()));

-- row security: artist_tracks
ALTER TABLE public.artist_tracks ENABLE ROW LEVEL SECURITY;

-- policy: artist_tracks artist_tracks: public select
CREATE POLICY "artist_tracks: public select" ON public.artist_tracks FOR SELECT USING (true);

-- policy: artist_tracks artist_tracks: write own
CREATE POLICY "artist_tracks: write own" ON public.artist_tracks USING ((artist_id = auth.uid())) WITH CHECK ((artist_id = auth.uid()));

-- row security: artists
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

-- policy: artists artists: insert own
CREATE POLICY "artists: insert own" ON public.artists FOR INSERT WITH CHECK (((id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'artist'::text))))));

-- policy: artists artists: public select
CREATE POLICY "artists: public select" ON public.artists FOR SELECT USING (true);

-- policy: artists artists: update own
CREATE POLICY "artists: update own" ON public.artists FOR UPDATE USING ((id = auth.uid()));

-- row security: availability_request_recipients
ALTER TABLE public.availability_request_recipients ENABLE ROW LEVEL SECURITY;

-- policy: availability_request_recipients availability_request_recipients: insert by owning promoter when
CREATE POLICY "availability_request_recipients: insert by owning promoter when" ON public.availability_request_recipients FOR INSERT WITH CHECK ((public.owns_availability_request(request_id) AND public.caller_is_promoter() AND (NOT (EXISTS ( SELECT 1
   FROM public.promoter_blocks b
  WHERE ((b.artist_id = availability_request_recipients.artist_id) AND (b.promoter_id = auth.uid())))))));

-- policy: availability_request_recipients availability_request_recipients: respond as recipient
CREATE POLICY "availability_request_recipients: respond as recipient" ON public.availability_request_recipients FOR UPDATE USING (((artist_id = auth.uid()) AND public.is_open_availability_request(request_id)));

-- policy: availability_request_recipients availability_request_recipients: select own or owning promoter
CREATE POLICY "availability_request_recipients: select own or owning promoter" ON public.availability_request_recipients FOR SELECT USING (((artist_id = auth.uid()) OR public.owns_availability_request(request_id)));

-- policy: availability_request_recipients availability_request_recipients: update by owning promoter
CREATE POLICY "availability_request_recipients: update by owning promoter" ON public.availability_request_recipients FOR UPDATE USING (public.owns_availability_request(request_id));

-- row security: availability_requests
ALTER TABLE public.availability_requests ENABLE ROW LEVEL SECURITY;

-- policy: availability_requests availability_requests: insert own when subscribed
CREATE POLICY "availability_requests: insert own when subscribed" ON public.availability_requests FOR INSERT WITH CHECK (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: availability_requests availability_requests: select owner or recipient
CREATE POLICY "availability_requests: select owner or recipient" ON public.availability_requests FOR SELECT USING (((promoter_id = auth.uid()) OR public.is_recipient_of_availability_request(id)));

-- policy: availability_requests availability_requests: update own
CREATE POLICY "availability_requests: update own" ON public.availability_requests FOR UPDATE USING ((promoter_id = auth.uid()));

-- row security: bookings
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- policy: bookings bookings: select participant
CREATE POLICY "bookings: select participant" ON public.bookings FOR SELECT USING (((artist_id = auth.uid()) OR (promoter_id = auth.uid())));

-- row security: city_distances
ALTER TABLE public.city_distances ENABLE ROW LEVEL SECURITY;

-- policy: city_distances city_distances: public select
CREATE POLICY "city_distances: public select" ON public.city_distances FOR SELECT USING (true);

-- row security: email_outbox
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- row security: event_templates
ALTER TABLE public.event_templates ENABLE ROW LEVEL SECURITY;

-- policy: event_templates event_templates: delete own
CREATE POLICY "event_templates: delete own" ON public.event_templates FOR DELETE USING ((promoter_id = auth.uid()));

-- policy: event_templates event_templates: insert own
CREATE POLICY "event_templates: insert own" ON public.event_templates FOR INSERT WITH CHECK (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: event_templates event_templates: select own
CREATE POLICY "event_templates: select own" ON public.event_templates FOR SELECT USING ((promoter_id = auth.uid()));

-- policy: event_templates event_templates: update own
CREATE POLICY "event_templates: update own" ON public.event_templates FOR UPDATE USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- row security: gig_invitations
ALTER TABLE public.gig_invitations ENABLE ROW LEVEL SECURITY;

-- policy: gig_invitations gig_invitations: insert by slot owner
CREATE POLICY "gig_invitations: insert by slot owner" ON public.gig_invitations FOR INSERT WITH CHECK (((promoter_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.slots s
  WHERE ((s.id = gig_invitations.slot_id) AND (s.promoter_id = auth.uid()))))));

-- policy: gig_invitations gig_invitations: select participant
CREATE POLICY "gig_invitations: select participant" ON public.gig_invitations FOR SELECT USING (((promoter_id = auth.uid()) OR (artist_id = auth.uid())));

-- policy: gig_invitations gig_invitations: update participant
CREATE POLICY "gig_invitations: update participant" ON public.gig_invitations FOR UPDATE USING (((promoter_id = auth.uid()) OR (artist_id = auth.uid())));

-- row security: message_threads
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;

-- policy: message_threads message_threads: insert participant
CREATE POLICY "message_threads: insert participant" ON public.message_threads FOR INSERT WITH CHECK ((((artist_id = auth.uid()) OR (promoter_id = auth.uid())) AND (EXISTS ( SELECT 1
   FROM (public.availability_request_recipients r
     JOIN public.availability_requests req ON ((req.id = r.request_id)))
  WHERE ((r.artist_id = message_threads.artist_id) AND (req.promoter_id = message_threads.promoter_id)))) AND (NOT (EXISTS ( SELECT 1
   FROM public.promoter_blocks b
  WHERE ((b.artist_id = message_threads.artist_id) AND (b.promoter_id = message_threads.promoter_id)))))));

-- policy: message_threads message_threads: select participant
CREATE POLICY "message_threads: select participant" ON public.message_threads FOR SELECT USING (((artist_id = auth.uid()) OR (promoter_id = auth.uid())));

-- policy: message_threads message_threads: update participant
CREATE POLICY "message_threads: update participant" ON public.message_threads FOR UPDATE USING (((artist_id = auth.uid()) OR (promoter_id = auth.uid())));

-- row security: messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- policy: messages messages: insert as self
CREATE POLICY "messages: insert as self" ON public.messages FOR INSERT WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.message_threads t
  WHERE ((t.id = messages.thread_id) AND ((t.artist_id = auth.uid()) OR (t.promoter_id = auth.uid())))))));

-- policy: messages messages: select participant
CREATE POLICY "messages: select participant" ON public.messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.message_threads t
  WHERE ((t.id = messages.thread_id) AND ((t.artist_id = auth.uid()) OR (t.promoter_id = auth.uid()))))));

-- row security: notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- policy: notifications notifications: select own
CREATE POLICY "notifications: select own" ON public.notifications FOR SELECT USING ((profile_id = auth.uid()));

-- policy: notifications notifications: update own
CREATE POLICY "notifications: update own" ON public.notifications FOR UPDATE USING ((profile_id = auth.uid()));

-- row security: profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- policy: profiles profiles: select own
CREATE POLICY "profiles: select own" ON public.profiles FOR SELECT USING ((id = auth.uid()));

-- policy: profiles profiles: update own
CREATE POLICY "profiles: update own" ON public.profiles FOR UPDATE USING ((id = auth.uid()));

-- row security: promoter_blocks
ALTER TABLE public.promoter_blocks ENABLE ROW LEVEL SECURITY;

-- policy: promoter_blocks promoter_blocks: delete as artist
CREATE POLICY "promoter_blocks: delete as artist" ON public.promoter_blocks FOR DELETE USING ((artist_id = auth.uid()));

-- policy: promoter_blocks promoter_blocks: insert as artist
CREATE POLICY "promoter_blocks: insert as artist" ON public.promoter_blocks FOR INSERT WITH CHECK ((artist_id = auth.uid()));

-- policy: promoter_blocks promoter_blocks: select own
CREATE POLICY "promoter_blocks: select own" ON public.promoter_blocks FOR SELECT USING (((artist_id = auth.uid()) OR (promoter_id = auth.uid())));

-- row security: promoters
ALTER TABLE public.promoters ENABLE ROW LEVEL SECURITY;

-- policy: promoters promoters: insert own
CREATE POLICY "promoters: insert own" ON public.promoters FOR INSERT WITH CHECK (((id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'promoter'::text))))));

-- policy: promoters promoters: public select
CREATE POLICY "promoters: public select" ON public.promoters FOR SELECT USING (true);

-- policy: promoters promoters: update own
CREATE POLICY "promoters: update own" ON public.promoters FOR UPDATE USING ((id = auth.uid()));

-- row security: rate_limits
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- row security: reports
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- policy: reports reports: select own
CREATE POLICY "reports: select own" ON public.reports FOR SELECT USING ((reporter_id = auth.uid()));

-- row security: saved_slots
ALTER TABLE public.saved_slots ENABLE ROW LEVEL SECURITY;

-- policy: saved_slots saved_slots: delete own
CREATE POLICY "saved_slots: delete own" ON public.saved_slots FOR DELETE USING ((profile_id = auth.uid()));

-- policy: saved_slots saved_slots: insert own
CREATE POLICY "saved_slots: insert own" ON public.saved_slots FOR INSERT WITH CHECK ((profile_id = auth.uid()));

-- policy: saved_slots saved_slots: select own
CREATE POLICY "saved_slots: select own" ON public.saved_slots FOR SELECT USING ((profile_id = auth.uid()));

-- row security: schedule_entries
ALTER TABLE public.schedule_entries ENABLE ROW LEVEL SECURITY;

-- policy: schedule_entries schedule_entries: delete via owning schedule when subscribed
CREATE POLICY "schedule_entries: delete via owning schedule when subscribed" ON public.schedule_entries FOR DELETE USING ((public.owns_show_schedule(schedule_id) AND public.caller_is_promoter()));

-- policy: schedule_entries schedule_entries: insert via owning schedule when subscribed
CREATE POLICY "schedule_entries: insert via owning schedule when subscribed" ON public.schedule_entries FOR INSERT WITH CHECK ((public.owns_show_schedule(schedule_id) AND public.caller_is_promoter()));

-- policy: schedule_entries schedule_entries: select via owning schedule when subscribed
CREATE POLICY "schedule_entries: select via owning schedule when subscribed" ON public.schedule_entries FOR SELECT USING ((public.owns_show_schedule(schedule_id) AND public.caller_is_promoter()));

-- policy: schedule_entries schedule_entries: update via owning schedule when subscribed
CREATE POLICY "schedule_entries: update via owning schedule when subscribed" ON public.schedule_entries FOR UPDATE USING ((public.owns_show_schedule(schedule_id) AND public.caller_is_promoter()));

-- row security: schedule_template_entries
ALTER TABLE public.schedule_template_entries ENABLE ROW LEVEL SECURITY;

-- policy: schedule_template_entries schedule_template_entries: delete via owning template when subs
CREATE POLICY "schedule_template_entries: delete via owning template when subs" ON public.schedule_template_entries FOR DELETE USING ((public.owns_schedule_template(template_id) AND public.caller_is_promoter()));

-- policy: schedule_template_entries schedule_template_entries: insert via owning template when subs
CREATE POLICY "schedule_template_entries: insert via owning template when subs" ON public.schedule_template_entries FOR INSERT WITH CHECK ((public.owns_schedule_template(template_id) AND public.caller_is_promoter()));

-- policy: schedule_template_entries schedule_template_entries: select via owning template when subs
CREATE POLICY "schedule_template_entries: select via owning template when subs" ON public.schedule_template_entries FOR SELECT USING ((public.owns_schedule_template(template_id) AND public.caller_is_promoter()));

-- policy: schedule_template_entries schedule_template_entries: update via owning template when subs
CREATE POLICY "schedule_template_entries: update via owning template when subs" ON public.schedule_template_entries FOR UPDATE USING ((public.owns_schedule_template(template_id) AND public.caller_is_promoter()));

-- row security: schedule_templates
ALTER TABLE public.schedule_templates ENABLE ROW LEVEL SECURITY;

-- policy: schedule_templates schedule_templates: delete own when subscribed
CREATE POLICY "schedule_templates: delete own when subscribed" ON public.schedule_templates FOR DELETE USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: schedule_templates schedule_templates: insert own when subscribed
CREATE POLICY "schedule_templates: insert own when subscribed" ON public.schedule_templates FOR INSERT WITH CHECK (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: schedule_templates schedule_templates: select own when subscribed
CREATE POLICY "schedule_templates: select own when subscribed" ON public.schedule_templates FOR SELECT USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: schedule_templates schedule_templates: update own when subscribed
CREATE POLICY "schedule_templates: update own when subscribed" ON public.schedule_templates FOR UPDATE USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- row security: show_schedules
ALTER TABLE public.show_schedules ENABLE ROW LEVEL SECURITY;

-- policy: show_schedules show_schedules: delete own when subscribed
CREATE POLICY "show_schedules: delete own when subscribed" ON public.show_schedules FOR DELETE USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: show_schedules show_schedules: insert own when subscribed
CREATE POLICY "show_schedules: insert own when subscribed" ON public.show_schedules FOR INSERT WITH CHECK (((promoter_id = auth.uid()) AND public.caller_is_promoter() AND (EXISTS ( SELECT 1
   FROM public.slots s
  WHERE ((s.id = show_schedules.slot_id) AND (s.promoter_id = auth.uid()))))));

-- policy: show_schedules show_schedules: select own when subscribed
CREATE POLICY "show_schedules: select own when subscribed" ON public.show_schedules FOR SELECT USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- policy: show_schedules show_schedules: update own when subscribed
CREATE POLICY "show_schedules: update own when subscribed" ON public.show_schedules FOR UPDATE USING (((promoter_id = auth.uid()) AND public.caller_is_promoter()));

-- row security: slots
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;

-- policy: slots slots: insert own
CREATE POLICY "slots: insert own" ON public.slots FOR INSERT WITH CHECK (((promoter_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'promoter'::text))))));

-- policy: slots slots: public select
CREATE POLICY "slots: public select" ON public.slots FOR SELECT USING (true);

-- policy: slots slots: update own
CREATE POLICY "slots: update own" ON public.slots FOR UPDATE USING ((promoter_id = auth.uid())) WITH CHECK ((promoter_id = auth.uid()));

-- row security: support_requests
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

-- policy: support_requests support_requests: select own
CREATE POLICY "support_requests: select own" ON public.support_requests FOR SELECT USING ((profile_id = auth.uid()));

-- row security: venues
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

-- policy: venues venues: public select
CREATE POLICY "venues: public select" ON public.venues FOR SELECT USING (true);


-- ---------------------------------------------------------------------------
-- Auth hook: every new auth user gets a profile (role comes from signup metadata).
-- ---------------------------------------------------------------------------
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Function privileges. Supabase grants new functions to everyone by default;
-- these are the ones that are NOT for anonymous visitors (and, for the
-- server-only ones, not for signed-in users either — only the service role).
-- ---------------------------------------------------------------------------
revoke all on function public._app_slot_id(uuid) from public, anon, authenticated;
revoke all on function public._audit(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public._require_active_user() from public, anon, authenticated;
revoke all on function public._staff_actor(text) from public, anon, authenticated;
revoke all on function public._wind_down_slot(slots,text,boolean) from public, anon, authenticated;
revoke all on function public.account_deletion_blockers(uuid) from public, anon, authenticated;
revoke all on function public.admin_recent_bookings(integer) from public, anon;
revoke all on function public.admin_remove_listing(uuid,text) from public, anon;
revoke all on function public.admin_set_verification(uuid,boolean) from public, anon;
revoke all on function public.admin_suspend_user(uuid,text) from public, anon;
revoke all on function public.admin_unsuspend_user(uuid) from public, anon;
revoke all on function public.admin_update_report(uuid,text,text) from public, anon;
revoke all on function public.admin_update_support_request(uuid,text,text) from public, anon;
revoke all on function public.cancel_booking(uuid,text) from public, anon;
revoke all on function public.cancel_slot(uuid,text) from public, anon;
revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
revoke all on function public.close_slot(uuid) from public, anon;
revoke all on function public.current_admin_role() from public, anon;
revoke all on function public.decline_application(uuid,text) from public, anon;
revoke all on function public.expire_stale_offers() from public, anon, authenticated;
revoke all on function public.make_offer(uuid,text) from public, anon;
revoke all on function public.mark_application_viewed(uuid) from public, anon;
revoke all on function public.mark_thread_read(uuid) from public, anon;
revoke all on function public.notify(uuid,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.open_application_thread(uuid) from public, anon;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.rate_limit_hit(text,integer,integer) from public, anon, authenticated;
revoke all on function public.reschedule_slot(uuid,date,time without time zone,time without time zone) from public, anon;
revoke all on function public.respond_to_offer(uuid,boolean,text) from public, anon;
revoke all on function public.shortlist_application(uuid) from public, anon;
revoke all on function public.staff_audit_log(integer) from public, anon;
revoke all on function public.staff_find_users(text,integer) from public, anon;
revoke all on function public.staff_open_reports(text,integer) from public, anon;
revoke all on function public.staff_recent_slots(text,integer) from public, anon;
revoke all on function public.staff_support_requests(text,integer) from public, anon;
revoke all on function public.submit_report(text,uuid,uuid,text) from public, anon;
revoke all on function public.withdraw_application(uuid) from public, anon;
revoke all on function public.withdraw_offer(uuid) from public, anon;
