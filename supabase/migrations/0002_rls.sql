-- Support Slot — Row Level Security policies.
-- Run after 0001_schema.sql. This is the real security boundary — the app's
-- own UI logic is a convenience, not a guarantee, so every table gets RLS.

alter table public.profiles enable row level security;
alter table public.artists enable row level security;
alter table public.artist_tracks enable row level security;
alter table public.artist_shows enable row level security;
alter table public.promoters enable row level security;
alter table public.venues enable row level security;
alter table public.slots enable row level security;
alter table public.applications enable row level security;
alter table public.notifications enable row level security;
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
alter table public.wallet_transactions enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: read/update only your own row. No insert policy — rows are only
-- ever created by the handle_new_user() trigger (security definer, bypasses RLS).
-- ---------------------------------------------------------------------------
create policy "profiles: select own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles: update own" on public.profiles
  for update using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- artists: publicly browsable (Discover, public profile pages), writable
-- only by the owning account, and only while it's actually an artist account.
-- ---------------------------------------------------------------------------
create policy "artists: public select" on public.artists
  for select using (true);
create policy "artists: insert own" on public.artists
  for insert with check (
    id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'artist')
  );
create policy "artists: update own" on public.artists
  for update using (id = auth.uid());

create policy "artist_tracks: public select" on public.artist_tracks
  for select using (true);
create policy "artist_tracks: write own" on public.artist_tracks
  for all using (artist_id = auth.uid()) with check (artist_id = auth.uid());

create policy "artist_shows: public select" on public.artist_shows
  for select using (true);
create policy "artist_shows: write own" on public.artist_shows
  for all using (artist_id = auth.uid()) with check (artist_id = auth.uid());

-- ---------------------------------------------------------------------------
-- promoters: same shape as artists.
-- ---------------------------------------------------------------------------
create policy "promoters: public select" on public.promoters
  for select using (true);
create policy "promoters: insert own" on public.promoters
  for insert with check (
    id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'promoter')
  );
create policy "promoters: update own" on public.promoters
  for update using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- venues: publicly readable, no client write policy at all. Only the
-- service-role key (used once, for seeding in 0003) can write here — there
-- is no in-app "create a venue" flow.
-- ---------------------------------------------------------------------------
create policy "venues: public select" on public.venues
  for select using (true);

-- ---------------------------------------------------------------------------
-- slots: publicly browsable, writable only by the posting promoter.
-- ---------------------------------------------------------------------------
create policy "slots: public select" on public.slots
  for select using (true);
create policy "slots: insert own" on public.slots
  for insert with check (
    promoter_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'promoter')
  );
create policy "slots: update own" on public.slots
  for update using (promoter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- applications: visible to the applying artist and the slot's promoter.
-- Insert only by the applying artist, as themselves. Update allowed for
-- either party (which status transitions are legal per role is enforced in
-- application code, not RLS — RLS is the coarse "must be a participant" gate).
-- ---------------------------------------------------------------------------
create policy "applications: select participant" on public.applications
  for select using (
    artist_id = auth.uid()
    or exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
  );
create policy "applications: insert own" on public.applications
  for insert with check (artist_id = auth.uid());
create policy "applications: update participant" on public.applications
  for update using (
    artist_id = auth.uid()
    or exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- notifications: read/update only your own. No client insert policy —
-- written only by security definer trigger functions.
-- ---------------------------------------------------------------------------
create policy "notifications: select own" on public.notifications
  for select using (profile_id = auth.uid());
create policy "notifications: update own" on public.notifications
  for update using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- message_threads / messages: scoped to the two participants.
-- ---------------------------------------------------------------------------
create policy "message_threads: select participant" on public.message_threads
  for select using (artist_id = auth.uid() or promoter_id = auth.uid());
create policy "message_threads: insert participant" on public.message_threads
  for insert with check (artist_id = auth.uid() or promoter_id = auth.uid());
create policy "message_threads: update participant" on public.message_threads
  for update using (artist_id = auth.uid() or promoter_id = auth.uid());

create policy "messages: select participant" on public.messages
  for select using (
    exists (
      select 1 from public.message_threads t
      where t.id = thread_id and (t.artist_id = auth.uid() or t.promoter_id = auth.uid())
    )
  );
create policy "messages: insert as self" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.message_threads t
      where t.id = thread_id and (t.artist_id = auth.uid() or t.promoter_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- wallet_transactions: visible to sender and recipient; only the sending
-- promoter can create one, and only as themselves.
-- ---------------------------------------------------------------------------
create policy "wallet_transactions: select participant" on public.wallet_transactions
  for select using (to_artist_id = auth.uid() or from_promoter_id = auth.uid());
create policy "wallet_transactions: insert own" on public.wallet_transactions
  for insert with check (from_promoter_id = auth.uid());
