-- Support Slot — fix "infinite recursion detected in policy for relation
-- availability_requests", hit live when sending the first real request.
--
-- Cause: availability_requests' SELECT policy queries
-- availability_request_recipients, and availability_request_recipients'
-- SELECT/INSERT/UPDATE policies query availability_requests right back.
-- Any RLS-enabled table referenced inside another table's policy has its
-- own policies re-applied — so checking visibility on one table re-triggers
-- the other's policy, which re-triggers the first, and Postgres's recursion
-- guard trips.
--
-- Fix: move every cross-table check into a `security definer` helper
-- function. Functions created here are owned by the migration role
-- (same as the tables), and an owner's own direct table reads bypass RLS
-- (FORCE ROW LEVEL SECURITY was never set on these tables) — so the
-- function reads the other table's data directly instead of re-entering
-- its policies, breaking the cycle. Same mechanism the existing
-- notify_on_application_status_change()/bump_applicant_count() trigger
-- functions already rely on to write into notifications past its RLS.

create or replace function public.owns_availability_request(p_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.availability_requests
    where id = p_request_id and promoter_id = auth.uid()
  );
$$;

create or replace function public.is_recipient_of_availability_request(p_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.availability_request_recipients
    where request_id = p_request_id and artist_id = auth.uid()
  );
$$;

create or replace function public.is_open_availability_request(p_request_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.availability_requests
    where id = p_request_id and status = 'sent' and response_deadline > now()
  );
$$;

create or replace function public.promoter_is_subscribed()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_support_plus = true
  );
$$;

-- availability_requests -----------------------------------------------------
drop policy if exists "availability_requests: select owner or recipient" on public.availability_requests;
create policy "availability_requests: select owner or recipient" on public.availability_requests
  for select using (
    promoter_id = auth.uid()
    or public.is_recipient_of_availability_request(id)
  );

drop policy if exists "availability_requests: insert own when subscribed" on public.availability_requests;
create policy "availability_requests: insert own when subscribed" on public.availability_requests
  for insert with check (
    promoter_id = auth.uid() and public.promoter_is_subscribed()
  );

-- availability_request_recipients -------------------------------------------
drop policy if exists "availability_request_recipients: select own or owning promoter" on public.availability_request_recipients;
create policy "availability_request_recipients: select own or owning promoter" on public.availability_request_recipients
  for select using (
    artist_id = auth.uid()
    or public.owns_availability_request(request_id)
  );

drop policy if exists "availability_request_recipients: insert by owning promoter when subscribed" on public.availability_request_recipients;
create policy "availability_request_recipients: insert by owning promoter when subscribed" on public.availability_request_recipients
  for insert with check (
    public.owns_availability_request(request_id)
    and public.promoter_is_subscribed()
    and not exists (
      select 1 from public.promoter_blocks b
      where b.artist_id = availability_request_recipients.artist_id and b.promoter_id = auth.uid()
    )
  );

drop policy if exists "availability_request_recipients: respond as recipient" on public.availability_request_recipients;
create policy "availability_request_recipients: respond as recipient" on public.availability_request_recipients
  for update using (
    artist_id = auth.uid() and public.is_open_availability_request(request_id)
  );
