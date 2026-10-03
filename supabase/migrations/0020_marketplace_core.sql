-- Support Slot — marketplace core: the data model behind the real
-- apply → review → offer → accept → confirmed-booking journey, plus public
-- discovery, saved gigs, honest notifications and abuse limits.
--
-- Design rules this migration enforces in the database (not just the UI):
--   * Applications and bookings only change state through the SQL functions
--     in 0021 — clients get no direct UPDATE on either table.
--   * A booking's agreed terms are a snapshot taken at offer time, so a later
--     edit to a listing can never silently change what an artist agreed to.
--   * Money is integer pence everywhere.
--   * Only one booking per slot can be 'confirmed' (partial unique index).
--
-- Fixes a hole the earlier audit missed: "applications: insert own" only
-- checked artist_id, so an artist could INSERT an application that was
-- already status = 'booked', skipping payment entirely.

-- ---------------------------------------------------------------------------
-- 0. Small helpers
-- ---------------------------------------------------------------------------
create or replace function public.london_today()
returns date language sql stable as $$
  select (now() at time zone 'Europe/London')::date
$$;

-- UK city-centre road distances (miles). Same figures as src/lib/geo.ts —
-- needed in SQL so travel top-ups can be computed server-side where a client
-- can't influence them.
create table public.city_distances (
  city_a text not null,
  city_b text not null,
  miles integer not null check (miles >= 0),
  primary key (city_a, city_b)
);
insert into public.city_distances (city_a, city_b, miles) values
  ('London','Manchester',200), ('London','Birmingham',120), ('London','Bristol',120),
  ('London','Leeds',200), ('London','Brighton',55), ('Manchester','Birmingham',90),
  ('Manchester','Bristol',170), ('Manchester','Leeds',45), ('Manchester','Brighton',250),
  ('Birmingham','Bristol',90), ('Birmingham','Leeds',120), ('Birmingham','Brighton',170),
  ('Bristol','Leeds',210), ('Bristol','Brighton',130), ('Leeds','Brighton',240);
insert into public.city_distances (city_a, city_b, miles)
  select city_b, city_a, miles from public.city_distances;
alter table public.city_distances enable row level security;
create policy "city_distances: public select" on public.city_distances for select using (true);

create or replace function public.city_distance_miles(a text, b text)
returns integer language sql stable as $$
  select case when a = b then 0
    else coalesce((select miles from public.city_distances where city_a = a and city_b = b), 150) end
$$;

-- Over an hour at an assumed 40mph => a guaranteed £10 minimum travel
-- contribution (src/lib/travel.ts mirrors this; a test keeps them in step).
create or replace function public.effective_travel_pence(base_pence integer, artist_city text, venue_city text)
returns integer language sql stable as $$
  select case when public.city_distance_miles(artist_city, venue_city)::numeric / 40 > 1
              then greatest(base_pence, 1000) else base_pence end
$$;

-- Estimated Stripe UK card fee (1.5% + 20p), grossed up so that charging it
-- to the promoter as its own line item leaves the artist with their full
-- agreed fee: P = 0.015 * (T + P) + 20  =>  P = (0.015 * T + 20) / 0.985,
-- rounded UP to the penny so the platform never loses on the estimate.
create or replace function public.processing_fee_pence(base_pence bigint)
returns integer language sql immutable as $$
  select ((15 * base_pence + 20000 + 984) / 985)::integer
$$;

-- ---------------------------------------------------------------------------
-- 1. profiles: notification preferences
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column email_notifications boolean not null default true,
  -- Set only by moderators (see 0023); the guards below refuse new activity
  -- from a suspended account.
  add column suspended_at timestamptz,
  add column suspension_reason text;

-- ---------------------------------------------------------------------------
-- 2. slots: lifecycle + server-side validation
-- ---------------------------------------------------------------------------
alter table public.slots drop constraint slots_status_check;
alter table public.slots
  add constraint slots_status_check check (status in ('open', 'filled', 'closed', 'cancelled')),
  add column closed_at timestamptz,
  add column closed_reason text;

-- Only the owner can write a slot. (0005 had let the booked artist reschedule
-- it too; rescheduling is now a promoter-only function that notifies the
-- artist — an artist silently moving the date of someone else's event isn't a
-- feature.)
drop policy if exists "slots: update own or booked artist" on public.slots;
drop policy if exists "slots: update own" on public.slots;
create policy "slots: update own" on public.slots
  for update using (promoter_id = auth.uid()) with check (promoter_id = auth.uid());

create or replace function public.slots_guard()
returns trigger language plpgsql security definer set search_path = public as $$
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
      or new.booking_fee is distinct from old.booking_fee
      or new.performance_length_mins is distinct from old.performance_length_mins;
    if v_material then
      select exists (select 1 from public.bookings b where b.slot_id = old.id and b.status in ('offered', 'confirmed'))
        into v_locked;
      if v_locked then
        raise exception 'listing_locked: this listing has an offer or a confirmed booking, so its date, venue, times and money can''t be edited. Use Reschedule, or withdraw the offer first.';
      end if;
    end if;
  end if;

  -- Rules for both insert and (non-locked) update.
  if length(btrim(new.headliner)) < 1 or length(new.headliner) > 120 then raise exception 'slot_invalid: headliner must be 1–120 characters'; end if;
  if length(new.description) > 2000 then raise exception 'slot_invalid: description is too long (max 2000 characters)'; end if;
  if new.support_fee < 0 or new.support_fee > 100000 then raise exception 'slot_invalid: support fee must be between £0 and £100,000'; end if;
  if new.travel_contribution < 0 or new.travel_contribution > 5000 then raise exception 'slot_invalid: travel contribution must be between £0 and £5,000'; end if;
  if new.booking_fee < 10 or new.booking_fee > 1000 then raise exception 'slot_invalid: booking fee must be between £10 and £1,000'; end if;
  if new.performance_length_mins < 5 or new.performance_length_mins > 240 then raise exception 'slot_invalid: set length must be 5–240 minutes'; end if;
  if new.expected_attendance < 1 or new.expected_attendance > 100000 then raise exception 'slot_invalid: expected attendance must be at least 1'; end if;
  if coalesce(array_length(new.genres, 1), 0) < 1 then raise exception 'slot_invalid: choose at least one genre'; end if;
  if coalesce(array_length(new.requirements, 1), 0) > 10 then raise exception 'slot_invalid: at most 10 requirements'; end if;
  return new;
end;
$$;

create trigger slots_guard_biu
  before insert or update on public.slots
  for each row execute function public.slots_guard();

-- Tell applicants when a listing they applied to materially changes.
create or replace function public.slots_notify_changes()
returns trigger language plpgsql security definer set search_path = public as $$
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

create trigger slots_notify_changes_au
  after update on public.slots
  for each row execute function public.slots_notify_changes();

-- ---------------------------------------------------------------------------
-- 3. Notifications: dedupe, richer types, optional email outbox
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in (
    'viewed', 'shortlisted', 'match', 'urgent', 'booked', 'message',
    'availability_request', 'availability_response',
    'offer', 'offer_accepted', 'offer_declined', 'application_declined',
    'application_withdrawn', 'booking_cancelled', 'listing_changed',
    'payment_received', 'payment_failed', 'refund', 'dispute',
    'subscription', 'report_update', 'system'
  )),
  add column dedupe_key text;
create unique index notifications_dedupe_idx
  on public.notifications (profile_id, dedupe_key) where dedupe_key is not null;

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  href text,
  dedupe_key text,
  -- 'sent' is only ever set together with a provider message id — see
  -- src/lib/email.ts. 'pending' means "not sent yet", never "sent".
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check ((status = 'sent') = (provider_message_id is not null))
);
create unique index email_outbox_dedupe_idx on public.email_outbox (profile_id, dedupe_key) where dedupe_key is not null;
alter table public.email_outbox enable row level security;
-- No client policies at all: only the service role (the send route) touches it.

-- The single place a notification is created. Internal: clients never call it.
create or replace function public.notify(
  p_profile_id uuid, p_type text, p_text text, p_href text,
  p_dedupe_key text default null, p_email boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
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
revoke all on function public.notify(uuid, text, text, text, text, boolean) from public, anon, authenticated;

-- Replace the legacy status-change notifier (it knew 'booked' / 'not_selected').
drop trigger if exists applications_notify_status_change on public.applications;
drop function if exists public.notify_on_application_status_change();

-- ---------------------------------------------------------------------------
-- 4. applications: new state machine
-- ---------------------------------------------------------------------------
alter table public.applications drop constraint applications_status_check;
update public.applications set status = 'confirmed' where status = 'booked';
update public.applications set status = 'declined' where status = 'not_selected';
alter table public.applications
  add constraint applications_status_check check (status in (
    'submitted', 'viewed', 'shortlisted', 'offered', 'confirmed',
    'declined', 'offer_declined', 'withdrawn', 'cancelled'
  )),
  alter column match_percent drop not null,
  add column viewed_at timestamptz,
  add column status_changed_at timestamptz not null default now(),
  add column closed_reason text;

-- The fabricated 38–99% "match" score is gone; fit is explained from real
-- fields in the UI. Keep the column (nullable) only so old rows survive.
alter table public.applications drop column if exists stripe_payment_intent_id;

-- Clients may only INSERT 'submitted' applications for themselves (a promoter
-- converting an "available" response may insert 'submitted' or 'shortlisted').
-- All later changes go through the 0021 functions: no UPDATE policy remains.
drop policy if exists "applications: insert own" on public.applications;
drop policy if exists "applications: update participant" on public.applications;
drop policy if exists "applications: insert by promoter from available response" on public.applications;

create policy "applications: insert own" on public.applications
  for insert with check (artist_id = auth.uid() and status = 'submitted');

create policy "applications: insert by promoter from available response" on public.applications
  for insert with check (
    status in ('submitted', 'shortlisted')
    and exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
    and exists (
      select 1
      from public.availability_request_recipients r
      join public.availability_requests req on req.id = r.request_id
      where r.artist_id = applications.artist_id
        and r.response = 'available'
        and req.promoter_id = auth.uid()
        and req.linked_slot_id = applications.slot_id
    )
  );

create or replace function public.applications_guard()
returns trigger language plpgsql security definer set search_path = public as $$
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

create trigger applications_guard_bi
  before insert on public.applications
  for each row execute function public.applications_guard();

-- ---------------------------------------------------------------------------
-- 5. bookings: agreed terms + payment state
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  -- on delete SET NULL throughout: financial records outlive an account
  -- deletion (the names below are snapshots for exactly that reason).
  application_id uuid references public.applications(id) on delete set null,
  slot_id uuid references public.slots(id) on delete set null,
  artist_id uuid references public.artists(id) on delete set null,
  promoter_id uuid references public.promoters(id) on delete set null,
  status text not null default 'offered'
    check (status in ('offered', 'confirmed', 'declined', 'withdrawn', 'cancelled')),

  -- Terms snapshot: fixed at offer time.
  artist_name text not null,
  promoter_company text not null,
  headliner text not null,
  venue_id text,
  venue_name text not null,
  venue_address text not null,
  venue_city text not null,
  event_date date not null,
  doors_time time not null,
  set_time time not null,
  set_length_mins integer not null,
  requirements text[] not null default '{}',
  fee_pence integer not null check (fee_pence >= 0),
  travel_pence integer not null check (travel_pence >= 0),
  booking_fee_pence integer not null check (booking_fee_pence >= 0),
  processing_fee_pence integer not null check (processing_fee_pence >= 0),
  total_pence integer not null,
  currency text not null default 'GBP' check (currency = 'GBP'),
  check (total_pence = fee_pence + travel_pence + booking_fee_pence + processing_fee_pence),

  offer_message text,
  offered_at timestamptz not null default now(),
  offer_expires_at timestamptz not null,
  responded_at timestamptz,
  decline_reason text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  -- Set when a booking that has already been paid is cancelled: a human has
  -- to decide on and issue the refund (see the admin tools). Never automatic.
  refund_review_required boolean not null default false,

  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'processing', 'paid', 'failed', 'partially_refunded', 'refunded', 'disputed')),
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  receipt_url text,
  paid_at timestamptz,
  refunded_pence integer not null default 0 check (refunded_pence >= 0),
  last_payment_event_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_artist_id_idx on public.bookings (artist_id);
create index bookings_promoter_id_idx on public.bookings (promoter_id);
create index bookings_slot_id_idx on public.bookings (slot_id);
-- The overbooking guard: at most one confirmed booking per slot, enforced by
-- the database itself, whatever the application code does.
create unique index bookings_one_confirmed_per_slot on public.bookings (slot_id) where status = 'confirmed';
-- An application can have many historical bookings (e.g. an offer that was
-- withdrawn and later re-made), but only one live one.
create unique index bookings_one_active_per_application
  on public.bookings (application_id) where status in ('offered', 'confirmed');

alter table public.bookings enable row level security;
create policy "bookings: select participant" on public.bookings
  for select using (artist_id = auth.uid() or promoter_id = auth.uid());
-- Deliberately no insert/update/delete policies.

create or replace function public.bookings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger bookings_touch_bu before update on public.bookings
  for each row execute function public.bookings_touch();

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  stripe_event_id text unique,
  kind text not null check (kind in (
    'payment_started', 'payment_succeeded', 'payment_failed', 'refunded',
    'dispute_opened', 'dispute_won', 'dispute_lost', 'transfer_reversed', 'admin_note'
  )),
  amount_pence integer,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'
);
create index payment_events_booking_id_idx on public.payment_events (booking_id);
alter table public.payment_events enable row level security;
create policy "payment_events: select participant" on public.payment_events
  for select using (exists (
    select 1 from public.bookings b
    where b.id = booking_id and (b.artist_id = auth.uid() or b.promoter_id = auth.uid())
  ));

-- Every Stripe event is recorded before it's processed; a repeat delivery of
-- the same event id is a no-op (see 0022).
create table public.stripe_events (
  id text primary key,
  type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.stripe_events enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Saved gigs
-- ---------------------------------------------------------------------------
create table public.saved_slots (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  slot_id uuid not null references public.slots(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, slot_id)
);
alter table public.saved_slots enable row level security;
create policy "saved_slots: select own" on public.saved_slots for select using (profile_id = auth.uid());
create policy "saved_slots: insert own" on public.saved_slots for insert with check (profile_id = auth.uid());
create policy "saved_slots: delete own" on public.saved_slots for delete using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. Public discovery: one server-side query for search, filters, sorting and
-- pagination. "Active" means status open AND neither the application deadline
-- nor the show date has passed in UK time. SECURITY INVOKER: it only ever
-- returns what the caller's RLS already lets them read (slots are public).
-- ---------------------------------------------------------------------------
create or replace function public.search_slots(
  p_q text default null, p_city text default null, p_genre text default null,
  p_from date default null, p_to date default null, p_min_fee integer default null,
  p_venue_size text default null, p_artist_size text default null,
  p_from_city text default null, p_max_miles integer default null,
  p_urgent_only boolean default false,
  p_sort text default 'date', p_limit integer default 12, p_offset integer default 0
)
returns table (id uuid, total_count bigint)
language sql stable security invoker set search_path = public as $$
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
grant execute on function public.search_slots(text, text, text, date, date, integer, text, text, text, integer, boolean, text, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Messaging guards: threads can be tied to an application; messages are
-- length-checked, rate-limited and refused towards someone who has blocked
-- the sender; the recipient gets one unread notification per thread, not one
-- per message.
-- ---------------------------------------------------------------------------
alter table public.message_threads
  add column application_id uuid references public.applications(id) on delete cascade,
  add column last_message_at timestamptz;
create index message_threads_application_id_idx on public.message_threads (application_id);

alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages
  add constraint messages_sender_id_fkey foreign key (sender_id) references public.profiles(id) on delete cascade;

drop trigger if exists messages_notify on public.messages;
drop function if exists public.notify_on_message();

create or replace function public.messages_guard()
returns trigger language plpgsql security definer set search_path = public as $$
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
create trigger messages_guard_bi before insert on public.messages
  for each row execute function public.messages_guard();

create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
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
create trigger messages_after_insert_ai after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ---------------------------------------------------------------------------
-- 9. Abuse limiter for server routes (checkout, reports, account actions).
-- Postgres-backed so it holds across every serverless instance.
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
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
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
