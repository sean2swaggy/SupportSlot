-- Support Slot — core schema
-- Run in the Supabase SQL editor, in order (0001 -> 0002 -> 0003 -> 0004).

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users. Created automatically by a trigger the
-- instant a user signs up, so it exists before onboarding ever queries it.
-- role is chosen once at signup and is immutable afterwards (see trigger
-- below) — this app has no "switch role" feature for real accounts.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('artist', 'promoter')),
  email text not null,
  has_onboarded boolean not null default false,
  is_support_plus boolean not null default false,
  support_plus_billing_period text check (support_plus_billing_period in ('monthly', 'annual')),
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'role', 'artist'), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.prevent_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role <> old.role then
    raise exception 'role cannot be changed after signup';
  end if;
  return new;
end;
$$;

create trigger profiles_role_immutable
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ---------------------------------------------------------------------------
-- artists
-- ---------------------------------------------------------------------------
create table public.artists (
  id uuid primary key references public.profiles(id) on delete cascade,
  handle text not null unique,
  payout_code text not null unique,
  name text not null,
  image_url text,
  banner_image_url text,
  location text not null
    check (location in ('London', 'Manchester', 'Birmingham', 'Bristol', 'Leeds', 'Brighton')),
  genres text[] not null default '{}'
    check (genres <@ array[
      'Alternative','Electronic','Indie','Experimental','Hip-Hop','Punk',
      'Folk','Pop','R&B','Techno','Drum & Bass','Rock'
    ]::text[]),
  spotify_url text not null default '',
  instagram_url text not null default '',
  tiktok_url text not null default '',
  soundcloud_url text,
  bandcamp_url text,
  youtube_url text,
  website_url text,
  monthly_listeners integer,
  bio text not null default '',
  live_video_thumbnail_url text,
  live_video_url text,
  availability text not null default 'available'
    check (availability in ('available', 'limited', 'unavailable')),
  travel_radius_miles integer not null default 50,
  verification text not null default 'unverified' check (verification in ('verified', 'unverified')),
  artist_size text not null default 'emerging'
    check (artist_size in ('emerging', 'developing', 'established')),
  last_minute_alerts boolean not null default false,
  member_since timestamptz not null default now()
);

create table public.artist_tracks (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  title text not null,
  duration text not null,
  cover_image_url text,
  sort_order int not null default 0
);
create index artist_tracks_artist_id_idx on public.artist_tracks(artist_id);

create table public.artist_shows (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  kind text not null check (kind in ('past', 'upcoming')),
  headliner text not null,
  venue text not null,
  city text not null,
  date date not null
);
create index artist_shows_artist_id_idx on public.artist_shows(artist_id);

-- ---------------------------------------------------------------------------
-- promoters
-- ---------------------------------------------------------------------------
create table public.promoters (
  id uuid primary key references public.profiles(id) on delete cascade,
  name text not null,
  company text not null,
  avatar_url text,
  location text check (location in ('London', 'Manchester', 'Birmingham', 'Bristol', 'Leeds', 'Brighton')),
  verification text not null default 'unverified' check (verification in ('verified', 'unverified')),
  shows_posted integer not null default 0
);

-- ---------------------------------------------------------------------------
-- venues — curated reference data, seeded once in 0003, no client writes.
-- ---------------------------------------------------------------------------
create table public.venues (
  id text primary key,
  name text not null,
  city text not null check (city in ('London', 'Manchester', 'Birmingham', 'Bristol', 'Leeds', 'Brighton')),
  capacity integer not null,
  address text not null,
  image_url text,
  verification text not null default 'verified' check (verification in ('verified', 'unverified'))
);

-- ---------------------------------------------------------------------------
-- slots
-- ---------------------------------------------------------------------------
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  venue_id text not null references public.venues(id),
  headliner text not null,
  headliner_image_url text,
  artist_photo_url text,
  city text not null check (city in ('London', 'Manchester', 'Birmingham', 'Bristol', 'Leeds', 'Brighton')),
  date date not null,
  doors_time time not null,
  set_time time not null,
  performance_length_mins integer not null,
  genres text[] not null default '{}'
    check (genres <@ array[
      'Alternative','Electronic','Indie','Experimental','Hip-Hop','Punk',
      'Folk','Pop','R&B','Techno','Drum & Bass','Rock'
    ]::text[]),
  expected_attendance integer not null,
  support_fee integer not null,
  travel_contribution integer not null default 0,
  requirements text[] not null default '{}',
  application_deadline date not null,
  applicant_count integer not null default 0,
  is_urgent boolean not null default false,
  status text not null default 'open' check (status in ('open', 'filled', 'closed')),
  artist_size_fit text[] not null default '{}'
    check (artist_size_fit <@ array['emerging','developing','established']::text[]),
  description text not null default '',
  rescheduled_at timestamptz,
  posted_at timestamptz not null default now()
);
create index slots_promoter_id_idx on public.slots(promoter_id);
create index slots_status_idx on public.slots(status);
create index slots_is_urgent_idx on public.slots(is_urgent);

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('submitted', 'viewed', 'shortlisted', 'booked', 'not_selected', 'cancelled')),
  featured_track_id uuid references public.artist_tracks(id),
  message text,
  match_percent integer not null,
  submitted_at timestamptz not null default now(),
  unique (slot_id, artist_id)
);
create index applications_slot_id_idx on public.applications(slot_id);
create index applications_artist_id_idx on public.applications(artist_id);

create function public.bump_applicant_count()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op = 'INSERT' then
    update public.slots set applicant_count = applicant_count + 1 where id = new.slot_id;
  elsif tg_op = 'DELETE' then
    update public.slots set applicant_count = applicant_count - 1 where id = old.slot_id;
  end if;
  return null;
end;
$$;

create trigger applications_bump_count
  after insert or delete on public.applications
  for each row execute function public.bump_applicant_count();

-- ---------------------------------------------------------------------------
-- notifications — written only by trigger functions (security definer),
-- never inserted directly by a client. See 0002 for the RLS policy that
-- enforces this.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('viewed', 'shortlisted', 'match', 'urgent', 'booked', 'message')),
  text text not null,
  href text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_profile_id_idx on public.notifications(profile_id);

-- Fire a notification when an application's status changes.
create function public.notify_on_application_status_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_slot_headliner text;
begin
  if new.status is distinct from old.status and new.status in ('shortlisted', 'booked', 'not_selected') then
    select headliner into v_slot_headliner from public.slots where id = new.slot_id;
    insert into public.notifications (profile_id, type, text, href)
    values (
      new.artist_id,
      case new.status
        when 'shortlisted' then 'shortlisted'
        when 'booked' then 'booked'
        else 'viewed'
      end,
      case new.status
        when 'shortlisted' then 'You were shortlisted for ' || coalesce(v_slot_headliner, 'a slot')
        when 'booked' then 'You''re booked for ' || coalesce(v_slot_headliner, 'a slot')
        else 'Update on your application to ' || coalesce(v_slot_headliner, 'a slot')
      end,
      '/slot/' || new.slot_id::text
    );
  end if;
  return new;
end;
$$;

create trigger applications_notify_status_change
  after update on public.applications
  for each row execute function public.notify_on_application_status_change();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  context text,
  artist_last_read_at timestamptz,
  promoter_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (artist_id, promoter_id, context)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  text text not null,
  created_at timestamptz not null default now()
);
create index messages_thread_id_idx on public.messages(thread_id);

-- Notify the other participant when a message is sent.
create function public.notify_on_message()
returns trigger
language plpgsql
security definer
as $$
declare
  v_thread public.message_threads;
  v_recipient uuid;
begin
  select * into v_thread from public.message_threads where id = new.thread_id;
  v_recipient := case when new.sender_id = v_thread.artist_id then v_thread.promoter_id else v_thread.artist_id end;
  insert into public.notifications (profile_id, type, text, href)
  values (v_recipient, 'message', 'You have a new message', '/messages');
  return new;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_on_message();

-- ---------------------------------------------------------------------------
-- wallet_transactions — payout ledger. No Stripe wiring in this phase; this
-- just replaces the localStorage-backed mock ledger with a real table.
-- toPayoutCode / fromPromoterName are joined live at read time, not stored,
-- so they can never go stale.
-- ---------------------------------------------------------------------------
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  to_artist_id uuid not null references public.artists(id) on delete cascade,
  from_promoter_id uuid not null references public.promoters(id) on delete cascade,
  slot_id uuid references public.slots(id) on delete set null,
  amount integer not null check (amount > 0),
  note text,
  sent_at timestamptz not null default now()
);
create index wallet_transactions_to_artist_id_idx on public.wallet_transactions(to_artist_id);
create index wallet_transactions_from_promoter_id_idx on public.wallet_transactions(from_promoter_id);
