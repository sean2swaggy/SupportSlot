-- Support Slot — 0004: UK-wide locations.
--
-- Run after 0003. Replaces the six-city list (a CHECK constraint on four
-- tables plus a hand-typed distance table) with real places anywhere in
-- England, Scotland, Wales and Northern Ireland.
--
-- What a "place" is here (nothing in this file invents a place list; the app
-- gets places from Apple's MapKit search, or the person types one in):
--   label    the text people see, e.g. "Newport, Shropshire, England"
--   country  England | Scotland | Wales | Northern Ireland
--   region   county / council area / region; optional (not every place has one)
--   lat/lon  a town-or-city-centre point from the search, when there is one
--   source   'search' (from MapKit), 'manual' (typed in, no coordinates) or
--            'legacy' (the original six cities, migrated)
--
-- Privacy: artists' coordinates live in a PRIVATE table (artist_locations),
-- rounded to two decimal places (about 1 km) on write. The public profile has
-- only the label, country and region. Promoters find artists "near" a point
-- through search_artists(), which reports distance rounded up to 5 miles.
--
-- Distance is straight-line (great-circle) miles. It is NOT a journey time and
-- is never presented as one. The long-journey travel minimum is defined on it
-- (section 8) because the app has no routing service and will not invent one.
--
-- The server can check that coordinates fall inside a UK bounding box and that
-- the country is one of the four nations. It cannot prove that a point is
-- inside UK borders (the box also contains part of the Republic of Ireland);
-- the app only offers results from a UK-restricted MapKit search.

-- ---------------------------------------------------------------------------
-- 1. Place columns.
-- ---------------------------------------------------------------------------
alter table public.venues
  add column country text, add column region text,
  add column lat double precision, add column lon double precision,
  add column location_source text not null default 'search',
  add column created_by uuid references public.profiles(id) on delete set null;
alter table public.venues alter column verification set default 'unverified';

alter table public.slots
  add column country text, add column region text,
  add column lat double precision, add column lon double precision;

alter table public.artists
  add column location_country text, add column location_region text,
  add column location_source text not null default 'search';

alter table public.promoters
  add column location_country text, add column location_region text,
  add column location_source text not null default 'search';

-- ---------------------------------------------------------------------------
-- 2. Safe migration of the existing six cities: same labels, now with country,
--    region and a city-centre point. Idempotent.
-- ---------------------------------------------------------------------------
create temporary table _legacy_places (label text primary key, region text, lat double precision, lon double precision)
  on commit preserve rows;
insert into _legacy_places values
  ('London',     'Greater London',     51.5074, -0.1278),
  ('Manchester', 'Greater Manchester', 53.4808, -2.2426),
  ('Birmingham', 'West Midlands',      52.4862, -1.8904),
  ('Bristol',    'Bristol',            51.4545, -2.5879),
  ('Leeds',      'West Yorkshire',     53.8008, -1.5491),
  ('Brighton',   'East Sussex',        50.8225, -0.1372);

update public.venues v set country = 'England', region = l.region, lat = l.lat, lon = l.lon, location_source = 'legacy'
  from _legacy_places l where v.city = l.label and v.country is null;
update public.slots s set country = 'England', region = l.region, lat = l.lat, lon = l.lon
  from _legacy_places l where s.city = l.label and s.country is null;
update public.artists a set location_country = 'England', location_region = l.region, location_source = 'legacy'
  from _legacy_places l where a.location = l.label and a.location_country is null;
update public.promoters p set location_country = 'England', location_region = l.region, location_source = 'legacy'
  from _legacy_places l where p.location = l.label and p.location_country is null;

-- ---------------------------------------------------------------------------
-- 3. Private artist coordinates.
-- ---------------------------------------------------------------------------
create table public.artist_locations (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  lat double precision not null,
  lon double precision not null,
  updated_at timestamptz not null default now(),
  constraint artist_locations_uk_box check (lat between 49.8 and 61.0 and lon between -8.7 and 1.9)
);
alter table public.artist_locations enable row level security;
create policy "artist_locations: owner select" on public.artist_locations for select using (artist_id = auth.uid());
create policy "artist_locations: owner delete" on public.artist_locations for delete using (artist_id = auth.uid());
create policy "aal2_active_session_required" on public.artist_locations as restrictive for all to authenticated
  using ((select public.session_is_active())) with check ((select public.session_is_active()));
-- Writes go through set_my_location() only.
revoke all on public.artist_locations from anon;
revoke insert, update on public.artist_locations from authenticated;

insert into public.artist_locations (artist_id, lat, lon)
  select a.id, l.lat, l.lon from public.artists a join _legacy_places l on l.label = a.location
  on conflict do nothing;
drop table _legacy_places;

-- ---------------------------------------------------------------------------
-- 4. Constraints. The six-city CHECKs are gone; places are validated by shape.
--    Every migrated row has a country now, so it can be required.
-- ---------------------------------------------------------------------------
alter table public.slots drop constraint slots_city_check;
alter table public.artists drop constraint artists_location_check;
alter table public.promoters drop constraint promoters_location_check;
alter table public.venues drop constraint venues_city_check;

alter table public.venues alter column country set not null;
alter table public.slots alter column country set not null;
alter table public.artists alter column location_country set not null;

alter table public.venues
  add constraint venues_place_shape check (
    length(btrim(city)) between 2 and 120 and country in ('England', 'Scotland', 'Wales', 'Northern Ireland')
    and (region is null or length(btrim(region)) between 2 and 80)
    and ((lat is null) = (lon is null))
    and (lat is null or (lat between 49.8 and 61.0 and lon between -8.7 and 1.9))
    and location_source in ('search', 'manual', 'legacy')
    and (location_source <> 'manual' or lat is null));
alter table public.slots
  add constraint slots_place_shape check (
    length(btrim(city)) between 2 and 120 and country in ('England', 'Scotland', 'Wales', 'Northern Ireland')
    and (region is null or length(btrim(region)) between 2 and 80)
    and ((lat is null) = (lon is null))
    and (lat is null or (lat between 49.8 and 61.0 and lon between -8.7 and 1.9)));
alter table public.artists
  add constraint artists_place_shape check (
    length(btrim(location)) between 2 and 120 and location_country in ('England', 'Scotland', 'Wales', 'Northern Ireland')
    and (location_region is null or length(btrim(location_region)) between 2 and 80)
    and location_source in ('search', 'manual', 'legacy'));
alter table public.promoters
  add constraint promoters_place_shape check (
    location is null or (
      length(btrim(location)) between 2 and 120 and coalesce(location_country in ('England', 'Scotland', 'Wales', 'Northern Ireland'), false)
      and (location_region is null or length(btrim(location_region)) between 2 and 80)
      and location_source in ('search', 'manual', 'legacy')));

-- ---------------------------------------------------------------------------
-- 5. Distance. Great-circle miles on a sphere of mean radius 3958.7613 miles.
--    (The Swift app uses the same formula and constant; a test compares them.)
-- ---------------------------------------------------------------------------
create or replace function public.haversine_miles(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable parallel safe as $$
  select case when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
    else 2 * 3958.7613 * asin(least(1.0, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))) end
$$;

-- ---------------------------------------------------------------------------
-- 6. Writing places.
-- ---------------------------------------------------------------------------
create or replace function public._check_place(p_label text, p_country text, p_region text, p_lat double precision, p_lon double precision, p_source text)
returns void language plpgsql immutable as $$
begin
  if p_label is null or length(btrim(p_label)) < 2 or length(p_label) > 120 or p_label ~ '[[:cntrl:]]'
     or length(btrim(split_part(p_label, ',', 1))) < 2 then
    raise exception 'location_invalid: enter the name of a place (2–120 characters)';
  end if;
  if p_country is null or p_country not in ('England', 'Scotland', 'Wales', 'Northern Ireland') then
    raise exception 'location_invalid: choose England, Scotland, Wales or Northern Ireland';
  end if;
  if p_region is not null and (length(btrim(p_region)) < 2 or length(p_region) > 80 or p_region ~ '[[:cntrl:]]') then
    raise exception 'location_invalid: the county or area must be 2–80 characters (or left out)';
  end if;
  if (p_lat is null) <> (p_lon is null) then
    raise exception 'location_invalid: coordinates need both a latitude and a longitude';
  end if;
  if p_lat is not null and (p_lat not between 49.8 and 61.0 or p_lon not between -8.7 and 1.9) then
    raise exception 'location_invalid: those coordinates aren''t in the United Kingdom';
  end if;
  if p_source is null or p_source not in ('search', 'manual') then raise exception 'location_invalid: unknown source'; end if;
  if p_source = 'manual' and p_lat is not null then
    raise exception 'location_invalid: a typed-in place has no coordinates';
  end if;
end;
$$;

-- Change my own location: label/country/region on the public profile,
-- coordinates (rounded to ~1 km) in the private table, atomically.
create or replace function public.set_my_location(
  p_label text, p_country text, p_region text, p_lat double precision, p_lon double precision, p_source text default 'search')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_label text := btrim(p_label);
  v_region text := nullif(btrim(coalesce(p_region, '')), '');
begin
  perform public._check_place(v_label, p_country, v_region, p_lat, p_lon, p_source);
  perform set_config('app.location_rpc', '1', true);
  if exists (select 1 from public.artists where id = v_uid) then
    update public.artists set location = v_label, location_country = p_country, location_region = v_region, location_source = p_source
      where id = v_uid;
    if p_lat is null then
      delete from public.artist_locations where artist_id = v_uid;
    else
      insert into public.artist_locations (artist_id, lat, lon, updated_at)
        values (v_uid, round(p_lat::numeric, 2), round(p_lon::numeric, 2), now())
        on conflict (artist_id) do update set lat = excluded.lat, lon = excluded.lon, updated_at = now();
    end if;
  elsif exists (select 1 from public.promoters where id = v_uid) then
    update public.promoters set location = v_label, location_country = p_country, location_region = v_region, location_source = p_source
      where id = v_uid;
  else
    perform set_config('app.location_rpc', '0', true);
    raise exception 'profile_required: finish setting up your profile first';
  end if;
  perform set_config('app.location_rpc', '0', true);
end;
$$;

-- After creation the location can only change through set_my_location (so the
-- private coordinates can never disagree with the public label).
create or replace function public.location_fields_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'authenticated' or current_setting('app.location_rpc', true) = '1' then return new; end if;
  if tg_table_name = 'artists' then
    if tg_op = 'INSERT' then
      perform public._check_place(new.location, new.location_country, new.location_region, null, null, new.location_source);
    elsif new.location is distinct from old.location or new.location_country is distinct from old.location_country
       or new.location_region is distinct from old.location_region or new.location_source is distinct from old.location_source then
      raise exception 'location_invalid: change your location with the location picker';
    end if;
  elsif tg_table_name = 'promoters' then
    if tg_op = 'INSERT' then
      if new.location is not null then
        perform public._check_place(new.location, new.location_country, new.location_region, null, null, new.location_source);
      end if;
    elsif new.location is distinct from old.location or new.location_country is distinct from old.location_country
       or new.location_region is distinct from old.location_region or new.location_source is distinct from old.location_source then
      raise exception 'location_invalid: change your location with the location picker';
    end if;
  end if;
  return new;
end;
$$;
create trigger artists_location_guard_biu before insert or update on public.artists
  for each row execute function public.location_fields_guard();
create trigger promoters_location_guard_biu before insert or update on public.promoters
  for each row execute function public.location_fields_guard();

-- Venues: promoters add their own (unverified) venue; venue rows are public.
create or replace function public.create_venue(
  p_name text, p_address text, p_capacity integer,
  p_label text, p_country text, p_region text, p_lat double precision, p_lon double precision, p_source text default 'search')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_label text := btrim(coalesce(p_label, ''));
  v_region text := nullif(btrim(coalesce(p_region, '')), '');
  v_id text;
begin
  if not public.caller_is_promoter() then raise exception 'promoter_required'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'venue_invalid: the venue name must be 2–120 characters'; end if;
  if length(btrim(coalesce(p_address, ''))) < 3 or length(p_address) > 300 then raise exception 'venue_invalid: enter the venue''s address'; end if;
  if p_capacity is null or p_capacity < 1 or p_capacity > 100000 then raise exception 'venue_invalid: capacity must be at least 1'; end if;
  perform public._check_place(v_label, p_country, v_region, p_lat, p_lon, p_source);
  -- The same venue entered twice by the same promoter is one venue.
  select id into v_id from public.venues
    where created_by = v_uid and lower(name) = lower(v_name) and lower(city) = lower(v_label);
  if v_id is not null then return v_id; end if;
  if not public.rate_limit_hit('create-venue:' || v_uid::text, 10, 86400) then
    raise exception 'rate_limited: too many venues added today';
  end if;
  v_id := 'v-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.venues (id, name, city, capacity, address, verification, country, region, lat, lon, location_source, created_by)
    values (v_id, v_name, v_label, p_capacity, btrim(p_address), 'unverified', p_country, v_region, p_lat, p_lon, p_source, v_uid);
  return v_id;
end;
$$;

-- A listing's place is its venue's place — copied here, never taken from the client.
create or replace function public.slots_apply_venue_place() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_venue public.venues;
begin
  select * into v_venue from public.venues where id = new.venue_id;
  if not found then raise exception 'slot_invalid: choose a venue'; end if;
  new.city := v_venue.city; new.country := v_venue.country; new.region := v_venue.region;
  new.lat := v_venue.lat; new.lon := v_venue.lon;
  return new;
end;
$$;
create trigger slots_aa_venue_place_biu before insert or update on public.slots
  for each row execute function public.slots_apply_venue_place();

-- ---------------------------------------------------------------------------
-- 7. Search. Place-name search matches the label, region and country text;
--    radius search needs coordinates on both sides, and listings without
--    coordinates are left out of a radius search rather than guessed at.
-- ---------------------------------------------------------------------------
drop function public.search_slots(text, text, text, date, date, integer, text, text, text, integer, boolean, text, integer, integer);
create function public.search_slots(
  p_q text default null, p_country text default null, p_genre text default null,
  p_from date default null, p_to date default null, p_min_fee integer default null,
  p_venue_size text default null, p_artist_size text default null,
  p_near_lat double precision default null, p_near_lon double precision default null, p_max_miles integer default null,
  p_urgent_only boolean default false, p_sort text default 'date', p_limit integer default 12, p_offset integer default 0)
returns table(id uuid, total_count bigint, distance_miles double precision)
language sql stable set search_path = public as $$
  with hits as (
    select s.id, s.date, s.support_fee, s.posted_at,
           round((public.haversine_miles(p_near_lat, p_near_lon, s.lat, s.lon))::numeric, 1)::double precision as dist
    from public.slots s
    join public.venues v on v.id = s.venue_id
    where s.status = 'open'
      and s.application_deadline >= public.london_today()
      and s.date >= public.london_today()
      and (nullif(btrim(p_q), '') is null
           or strpos(lower(s.headliner), lower(btrim(p_q))) > 0
           or strpos(lower(s.description), lower(btrim(p_q))) > 0
           or strpos(lower(v.name), lower(btrim(p_q))) > 0
           or strpos(lower(s.city), lower(btrim(p_q))) > 0
           or strpos(lower(coalesce(s.region, '')), lower(btrim(p_q))) > 0)
      and (p_country is null or s.country = p_country)
      and (p_genre is null or p_genre = any (s.genres))
      and (p_from is null or s.date >= p_from)
      and (p_to is null or s.date <= p_to)
      and (p_min_fee is null or s.support_fee >= p_min_fee)
      and (p_venue_size is null
           or (p_venue_size = 'intimate' and v.capacity < 250)
           or (p_venue_size = 'mid' and v.capacity between 250 and 400)
           or (p_venue_size = 'large' and v.capacity > 400))
      and (p_artist_size is null or p_artist_size = any (s.artist_size_fit))
      and (p_max_miles is null or p_near_lat is null or p_near_lon is null
           or public.haversine_miles(p_near_lat, p_near_lon, s.lat, s.lon) <= p_max_miles)
      and (not p_urgent_only or s.is_urgent))
  select h.id, count(*) over () as total_count, h.dist
  from hits h
  order by
    case when p_sort = 'fee' then h.support_fee end desc nulls last,
    case when p_sort = 'newest' then h.posted_at end desc nulls last,
    case when p_sort = 'distance' then h.dist end asc nulls last,
    h.date asc, h.id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0)
$$;

-- Artists near a point, for promoters. Distances use the coarse private
-- coordinates and are rounded UP to the next 5 miles so they can't be used to
-- triangulate an address. Artists with no coordinates are excluded from a
-- radius search (and are still found by name/place text).
create or replace function public.search_artists(
  p_q text default null, p_genre text default null, p_country text default null,
  p_near_lat double precision default null, p_near_lon double precision default null, p_max_miles integer default null,
  p_sort text default 'newest', p_limit integer default 24, p_offset integer default 0)
returns table(id uuid, total_count bigint, distance_miles integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_active_user();
  return query
  with hits as (
    select a.id, a.member_since,
           case when p_near_lat is null or l.lat is null then null
                else (ceil(public.haversine_miles(p_near_lat, p_near_lon, l.lat, l.lon) / 5.0) * 5)::integer end as dist
    from public.artists a
    left join public.artist_locations l on l.artist_id = a.id
    where not exists (select 1 from public.profiles p where p.id = a.id and p.suspended_at is not null)
      and (nullif(btrim(p_q), '') is null
           or strpos(lower(a.name), lower(btrim(p_q))) > 0
           or strpos(lower(a.location), lower(btrim(p_q))) > 0
           or strpos(lower(coalesce(a.location_region, '')), lower(btrim(p_q))) > 0)
      and (p_genre is null or p_genre = any (a.genres))
      and (p_country is null or a.location_country = p_country)
      and (p_max_miles is null or p_near_lat is null or p_near_lon is null
           or (l.lat is not null and public.haversine_miles(p_near_lat, p_near_lon, l.lat, l.lon) <= p_max_miles)))
  select h.id, count(*) over () as total_count, h.dist
  from hits h
  order by case when p_sort = 'distance' then h.dist end asc nulls last, h.member_since desc, h.id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Travel terms. One rule, in one place, used by make_offer and by the
--    previews the app shows.
--
--    The original brief was "£10 minimum travel contribution on journeys over
--    an hour". The app has no routing service, so a journey time cannot be
--    known, and the old six-city table (road-mile estimates at 40 mph) cannot
--    cover the UK. The rule is therefore defined on straight-line distance:
--
--      LONG JOURNEY  =  the venue is more than 30 miles from the artist's
--                       location in a straight line (30 straight-line miles is
--                       roughly the old "40 road miles / one hour" threshold),
--                       OR either location has no coordinates (we can't show
--                       the journey is short, so the artist-protective side
--                       applies).
--      On a long journey the travel contribution is at least £10 (1000 pence).
--
--    It is a rule, not a measurement: the UI says "over 30 miles away (straight
--    line)" and never "one hour". Change the threshold here and in the tests.
-- ---------------------------------------------------------------------------
create function public.long_journey_miles() returns integer language sql immutable as $$ select 30 $$;
create function public.minimum_long_journey_travel_pence() returns integer language sql immutable as $$ select 1000 $$;

create or replace function public._travel_terms(p_base_pence integer, p_artist_id uuid, p_venue_lat double precision, p_venue_lon double precision)
returns table(travel_pence integer, long_journey boolean, distance_miles double precision, basis text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_lat double precision; v_lon double precision;
  v_miles double precision;
  v_long boolean;
  v_basis text;
begin
  select l.lat, l.lon into v_lat, v_lon from public.artist_locations l where l.artist_id = p_artist_id;
  if v_lat is null or p_venue_lat is null then
    v_long := true; v_basis := 'unknown_location'; v_miles := null;
  else
    v_miles := public.haversine_miles(v_lat, v_lon, p_venue_lat, p_venue_lon);
    v_long := v_miles > public.long_journey_miles(); v_basis := 'straight_line';
  end if;
  return query select case when v_long then greatest(p_base_pence, public.minimum_long_journey_travel_pence()) else p_base_pence end,
                      v_long, v_miles, v_basis;
end;
$$;

-- What an offer for this listing to this artist would contain. The artist sees
-- their own; the promoter who owns the listing sees it for an artist who has
-- applied to it (distance rounded up to 5 miles for them).
create or replace function public.terms_preview(p_slot_id uuid, p_artist_id uuid default null)
returns table(fee_pence integer, travel_pence integer, long_journey boolean, distance_miles integer, basis text, minimum_applies boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_slot public.slots;
  v_artist uuid := coalesce(p_artist_id, v_uid);
  v_t record;
  v_promoter_view boolean;
begin
  select * into v_slot from public.slots where id = p_slot_id;
  if not found then raise exception 'listing_not_found'; end if;
  v_promoter_view := v_slot.promoter_id = v_uid and v_artist <> v_uid;
  if v_artist = v_uid then
    if not exists (select 1 from public.artists where id = v_uid) then raise exception 'not_authorized'; end if;
  elsif v_slot.promoter_id = v_uid then
    if not exists (select 1 from public.applications a where a.slot_id = p_slot_id and a.artist_id = v_artist) then
      raise exception 'not_authorized';
    end if;
  else
    raise exception 'not_authorized';
  end if;
  select * into v_t from public._travel_terms(v_slot.travel_contribution * 100, v_artist, v_slot.lat, v_slot.lon);
  return query select v_slot.support_fee * 100, v_t.travel_pence, v_t.long_journey,
    case when v_t.distance_miles is null then null
         when v_promoter_view then (ceil(v_t.distance_miles / 5.0) * 5)::integer
         else round(v_t.distance_miles)::integer end,
    v_t.basis,
    (v_t.travel_pence > v_slot.travel_contribution * 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. make_offer: same flow as before (same locks, same snapshot), now using the
--    rule above, and refusing an artist who has blocked this promoter.
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

-- The same block check for opening a thread from an application.
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
  if v_uid = v_slot.promoter_id and public._promoter_blocked_by(v_app.artist_id, v_slot.promoter_id) then
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

-- ---------------------------------------------------------------------------
-- 10. Last-minute alerts: tell artists who asked for them, whose private
--     coordinates put the venue inside their own travel radius. An artist
--     with no coordinates gets no alert (we can't tell whether it's near) —
--     it is an in-app notification, not a push message.
-- ---------------------------------------------------------------------------
create or replace function public.notify_urgent_slot() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_artist record;
begin
  if not new.is_urgent or new.status <> 'open' or new.lat is null then return new; end if;
  for v_artist in
    select a.id from public.artists a
    join public.artist_locations l on l.artist_id = a.id
    where a.last_minute_alerts
      and public.haversine_miles(l.lat, l.lon, new.lat, new.lon) <= a.travel_radius_miles
      and not public._promoter_blocked_by(a.id, new.promoter_id)
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

-- ---------------------------------------------------------------------------
-- 11. The six-city machinery is no longer used.
-- ---------------------------------------------------------------------------
drop function public.effective_travel_pence(integer, text, text);
drop function public.city_distance_miles(text, text);
drop table public.city_distances;

-- Everything new is closed to visitors unless granted here.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.london_today() to anon;
grant execute on function public.submit_support_request(text, text, text) to anon;
grant execute on function public.haversine_miles(double precision, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.search_slots(text, text, text, date, date, integer, text, text, double precision, double precision, integer, boolean, text, integer, integer) to anon, authenticated;
grant execute on function public.long_journey_miles() to anon, authenticated;
grant execute on function public.minimum_long_journey_travel_pence() to anon, authenticated;
revoke all on function public._travel_terms(integer, uuid, double precision, double precision) from public, anon, authenticated;
