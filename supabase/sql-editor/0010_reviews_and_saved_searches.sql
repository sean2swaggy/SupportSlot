-- Support Slot — 0010: post-show reviews and saved searches.
--
-- Reviews: after a confirmed show has happened, each side (artist and promoter)
-- may leave ONE 1–5 star rating and a short note about the other. Written only
-- through submit_review (no direct insert/update/delete); readable by any
-- signed-in account. Nothing about money.
--
-- Saved searches: an artist keeps up to 10 searches (genres and/or a distance
-- from their private location). When a new open listing matches, they get an
-- in-app notification. Not a push message.
--
-- Run after 0001–0009, once.

-- ---------------------------------------------------------------------------
-- 1. Notification types for the two new alerts.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'viewed','shortlisted','urgent','booked','message','availability_request','availability_response',
  'offer','offer_accepted','offer_declined','application_declined','application_withdrawn',
  'booking_cancelled','listing_changed','report_update','system','invitation',
  'review_received','saved_search']));

-- ---------------------------------------------------------------------------
-- 2. Reviews.
-- ---------------------------------------------------------------------------
-- table: reviews
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_name text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (booking_id, reviewer_id),
  check (reviewer_id <> reviewee_id)
);
create index reviews_reviewee_idx on public.reviews (reviewee_id, created_at desc);

alter table public.reviews enable row level security;
create policy "reviews: signed-in read" on public.reviews for select to authenticated using (true);
create policy "active_session_required" on public.reviews as restrictive for all to authenticated
  using ((select public.session_is_active())) with check ((select public.session_is_active()));
revoke all on public.reviews from public, anon, authenticated;
grant select on public.reviews to authenticated;

create or replace function public.submit_review(p_booking_id uuid, p_rating integer, p_comment text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public._require_active_user();
  v_b public.bookings;
  v_reviewee uuid;
  v_name text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_id uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating: choose 1 to 5 stars'; end if;
  if v_comment is not null and char_length(v_comment) > 500 then raise exception 'invalid_comment: keep it under 500 characters'; end if;
  if not public.rate_limit_hit('review:' || v_uid::text, 20, 86400) then
    raise exception 'rate_limited: too many reviews today';
  end if;
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or (v_uid is distinct from v_b.artist_id and v_uid is distinct from v_b.promoter_id) then
    raise exception 'not_found: that booking isn''t yours to review';
  end if;
  if v_b.status <> 'confirmed' then raise exception 'not_confirmed: only confirmed shows can be reviewed'; end if;
  if v_b.event_date >= public.london_today() then raise exception 'too_early: you can review once the show has happened'; end if;
  v_reviewee := case when v_uid = v_b.artist_id then v_b.promoter_id else v_b.artist_id end;
  if v_reviewee is null then raise exception 'not_found: the other account no longer exists'; end if;
  v_name := case when v_uid = v_b.artist_id then v_b.artist_name else v_b.promoter_company end;
  begin
    insert into public.reviews (booking_id, reviewer_id, reviewee_id, reviewer_name, rating, comment)
    values (p_booking_id, v_uid, v_reviewee, v_name, p_rating, v_comment) returning id into v_id;
  exception when unique_violation then
    raise exception 'already_reviewed: you''ve already reviewed this show';
  end;
  perform public.notify(v_reviewee, 'review_received', v_name || ' left you a review.', '/booking/' || p_booking_id::text,
                        'review:' || v_id::text, false);
  return v_id;
end;
$$;
revoke all on function public.submit_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Saved searches (artists only) and the alert when a matching listing opens.
-- ---------------------------------------------------------------------------
-- table: saved_searches
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  genres text[] not null default '{}',
  max_miles integer check (max_miles is null or max_miles between 1 and 500),
  created_at timestamptz not null default now(),
  check (cardinality(genres) > 0 or max_miles is not null)
);
create index saved_searches_artist_idx on public.saved_searches (artist_id);

alter table public.saved_searches enable row level security;
create policy "saved_searches: own read" on public.saved_searches for select to authenticated using (artist_id = (select auth.uid()));
create policy "saved_searches: own delete" on public.saved_searches for delete to authenticated using (artist_id = (select auth.uid()));
create policy "active_session_required" on public.saved_searches as restrictive for all to authenticated
  using ((select public.session_is_active())) with check ((select public.session_is_active()));
revoke all on public.saved_searches from public, anon, authenticated;
grant select, delete on public.saved_searches to authenticated;

create or replace function public.save_search(p_label text, p_genres text[], p_max_miles integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public._require_active_user();
  v_label text := btrim(coalesce(p_label, ''));
  v_genres text[] := coalesce(p_genres, '{}');
  v_id uuid;
begin
  if not exists (select 1 from public.artists where id = v_uid) then raise exception 'forbidden: only artists can save searches'; end if;
  if char_length(v_label) not between 1 and 60 then raise exception 'invalid_label: give the search a short name'; end if;
  if cardinality(v_genres) = 0 and p_max_miles is null then raise exception 'invalid_search: choose a genre or a distance'; end if;
  if cardinality(v_genres) > 5 then raise exception 'invalid_search: up to 5 genres'; end if;
  if (select count(*) from public.saved_searches where artist_id = v_uid) >= 10 then
    raise exception 'limit_reached: you can keep 10 saved searches';
  end if;
  insert into public.saved_searches (artist_id, label, genres, max_miles) values (v_uid, v_label, v_genres, p_max_miles) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_search(text, text[], integer) from public, anon;
grant execute on function public.save_search(text, text[], integer) to authenticated;

create or replace function public.notify_saved_search_match() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hit record;
begin
  if new.status <> 'open' then return new; end if;
  for v_hit in
    select distinct on (s.artist_id) s.artist_id, s.label
    from public.saved_searches s
    left join public.artist_locations l on l.artist_id = s.artist_id
    where (cardinality(s.genres) = 0 or s.genres && new.genres)
      and (s.max_miles is null or (new.lat is not null and l.lat is not null
           and public.haversine_miles(l.lat, l.lon, new.lat, new.lon) <= s.max_miles))
      and not public._promoter_blocked_by(s.artist_id, new.promoter_id)
      and not exists (select 1 from public.profiles p where p.id = s.artist_id and p.suspended_at is not null)
    order by s.artist_id, s.created_at
    limit 500
  loop
    perform public.notify(v_hit.artist_id, 'saved_search',
      'New slot matching “' || v_hit.label || '”: ' || new.headliner || ' in ' || new.city || '.',
      '/slot/' || new.id::text, 'search:' || new.id::text, false);
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_saved_search_match() from public, anon, authenticated;
create trigger slots_notify_saved_search_ai after insert on public.slots
  for each row execute function public.notify_saved_search_match();
