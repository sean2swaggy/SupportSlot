-- Support Slot — Support+ becomes a promoter-only subscription.
--
-- Closes a real security gap first: today "profiles: update own" has no
-- column restriction, so any signed-in user can grant themselves Support+
-- by calling the Supabase client directly (`supabase.from('profiles').update
-- ({is_support_plus: true})`), bypassing checkout entirely. From here on,
-- is_support_plus / support_plus_billing_period / stripe_subscription_id are
-- only ever written by the service-role key, driven by a real Stripe
-- Checkout Session + webhook (see src/app/api/stripe/subscriptions/*) — the
-- exact "server-side, verified subscription state, not a client-side flag"
-- requirement. This mirrors how applications.status='booked' was locked
-- down the same way in 0008_real_payments.sql.

alter table public.profiles
  add column stripe_subscription_id text unique,
  add column notify_availability_requests boolean not null default true;

create function public.prevent_client_support_plus_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if (
    new.is_support_plus is distinct from old.is_support_plus
    or new.support_plus_billing_period is distinct from old.support_plus_billing_period
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  ) and auth.role() = 'authenticated' then
    raise exception 'Support+ status can only be changed by the billing system.';
  end if;
  return new;
end;
$$;

create trigger profiles_support_plus_immutable_by_client
  before update on public.profiles
  for each row execute function public.prevent_client_support_plus_change();

-- ---------------------------------------------------------------------------
-- Artist Roster — a promoter's private, saved list of artists. Free
-- promoters can still browse/apply/book normally; only Support+ subscribers
-- can save someone to their roster or edit notes on an existing entry.
-- Removing an entry, or just reading an existing one, stays available after
-- a subscription lapses (see RLS below) — nothing about an artist's own
-- account, applications or booking history is touched by any of this.
-- ---------------------------------------------------------------------------
create table public.artist_roster (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  notes text not null default '',
  tags text[] not null default '{}',
  added_at timestamptz not null default now(),
  unique (promoter_id, artist_id)
);
create index artist_roster_promoter_id_idx on public.artist_roster(promoter_id);
create index artist_roster_artist_id_idx on public.artist_roster(artist_id);

alter table public.artist_roster enable row level security;

-- Read and delete stay available even with a lapsed subscription — only
-- *adding to* or *editing* the roster requires an active subscription.
create policy "artist_roster: select own" on public.artist_roster
  for select using (promoter_id = auth.uid());
create policy "artist_roster: insert own when subscribed" on public.artist_roster
  for insert with check (
    promoter_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and is_support_plus = true)
  );
create policy "artist_roster: update own when subscribed" on public.artist_roster
  for update using (
    promoter_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and is_support_plus = true)
  );
create policy "artist_roster: delete own" on public.artist_roster
  for delete using (promoter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reusable event templates — prefills the availability-request composer.
-- Same subscribed-to-write, free-to-read/delete shape as the roster.
-- ---------------------------------------------------------------------------
create table public.event_templates (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  name text not null,
  event_name text not null default '',
  venue_name text not null default '',
  venue_location text not null default '',
  proposed_fee integer,
  currency text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD')),
  set_length_mins integer,
  message text,
  created_at timestamptz not null default now()
);
create index event_templates_promoter_id_idx on public.event_templates(promoter_id);

alter table public.event_templates enable row level security;

create policy "event_templates: select own" on public.event_templates
  for select using (promoter_id = auth.uid());
create policy "event_templates: insert own when subscribed" on public.event_templates
  for insert with check (
    promoter_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and is_support_plus = true)
  );
create policy "event_templates: update own when subscribed" on public.event_templates
  for update using (
    promoter_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and is_support_plus = true)
  );
create policy "event_templates: delete own" on public.event_templates
  for delete using (promoter_id = auth.uid());
