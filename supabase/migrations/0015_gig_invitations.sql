-- Support Slot — promoter-initiated gig invitations, for the new
-- "Discover Artists" browsing page. Deliberately separate from and free of
-- the Support+ gated availability_requests system (0011): any promoter,
-- subscribed or not, can invite any artist to a specific one of their own
-- open gigs directly from a discovery card — no roster membership required
-- first. This is the direct promoter-side equivalent of an artist applying.
--
-- Accepting an invitation does NOT auto-book. It creates a real
-- `applications` row — the artist accepts as themselves (artist_id =
-- auth.uid()), so this reuses the existing "applications: insert own" RLS
-- policy with no changes needed there. From that point on it's a normal
-- application: the promoter shortlists/books/pays through the existing,
-- unchanged flow.

create table public.gig_invitations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  linked_application_id uuid references public.applications(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (slot_id, artist_id)
);
create index gig_invitations_promoter_id_idx on public.gig_invitations(promoter_id);
create index gig_invitations_artist_id_idx on public.gig_invitations(artist_id);

alter table public.gig_invitations enable row level security;

create policy "gig_invitations: select participant" on public.gig_invitations
  for select using (promoter_id = auth.uid() or artist_id = auth.uid());

-- Ownership check: a promoter can only invite artists to a slot they
-- actually posted.
create policy "gig_invitations: insert by slot owner" on public.gig_invitations
  for insert with check (
    promoter_id = auth.uid()
    and exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
  );

-- Promoter can withdraw; artist can accept/decline their own. Both are
-- "respond to something already sent" housekeeping, not a new send.
create policy "gig_invitations: update participant" on public.gig_invitations
  for update using (promoter_id = auth.uid() or artist_id = auth.uid());

-- Reuses the existing notifications convention (security-definer trigger,
-- see 0001_schema.sql).
create function public.notify_on_gig_invitation()
returns trigger
language plpgsql
security definer
as $$
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

create trigger gig_invitations_notify_insert
  after insert on public.gig_invitations
  for each row execute function public.notify_on_gig_invitation();

create trigger gig_invitations_notify_response
  after update on public.gig_invitations
  for each row execute function public.notify_on_gig_invitation();
