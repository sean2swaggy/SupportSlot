-- Support Slot — Show Schedule: a private, promoter-only planning tool for
-- organising the run of a specific show (arrival/load-in, soundcheck, doors,
-- performances, changeovers, breaks), scoped to one posted slot at a time.
--
-- Support+-gated on every operation, not just writes. This is deliberately
-- stricter than artist_roster/event_templates (0010_promoter_support_plus.sql),
-- which stay readable after a lapsed subscription — Show Schedule must
-- *block viewing* once Support+ lapses while leaving the rows intact, so
-- every policy below (including select) requires promoter_is_subscribed().
-- Reactivating the subscription makes the exact same rows visible again with
-- no extra "reactivation" step needed.
--
-- Never artist-facing: no policy here ever checks artist_id = auth.uid().
-- Being assigned to an entry does not grant an artist any access to it.

create table public.show_schedules (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.slots(id) on delete cascade,
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'final')),
  -- Optimistic-concurrency counter — see claim_schedule_version() below.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index show_schedules_promoter_id_idx on public.show_schedules(promoter_id);

-- start_at/end_at are naive timestamps (no tz), matching how slots.date /
-- doors_time / set_time already store plain UK wall-clock time everywhere
-- else in this schema — the app has exactly one implicit timezone (Europe/
-- London; slots.city is constrained to UK cities), so there's no real
-- multi-timezone case to model. Storing full date+time per entry (rather
-- than time-of-day + the slot's single date) is what makes an event that
-- runs past midnight "just work": an entry at 00:45 the next calendar day is
-- simply a later timestamp, no day-rollover special-casing needed anywhere.
create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.show_schedules(id) on delete cascade,
  kind text not null check (kind in
    ('arrival', 'load_in', 'soundcheck', 'doors', 'performance', 'changeover', 'break', 'other')),
  title text not null,
  stage text not null default 'Main Stage',
  start_at timestamp not null,
  end_at timestamp not null,
  -- Only ever set from this event's own confirmed (booked) applications —
  -- enforced in application code, not here (RLS has no reason to special-
  -- case it since only the owning, subscribed promoter can write at all).
  artist_id uuid references public.artists(id) on delete set null,
  notes text not null default '',
  -- Display order within a (schedule_id, stage) timeline. Drag-and-drop and
  -- the up/down button controls only ever change this column — reordering
  -- must never silently change an entry's start_at/end_at.
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index schedule_entries_schedule_id_idx on public.schedule_entries(schedule_id);
create index schedule_entries_artist_id_idx on public.schedule_entries(artist_id);

-- Reusable structure only — kind/title/stage/duration/order. Deliberately no
-- artist_id or notes column at all, so a template can never carry a
-- previous event's artists or private notes forward by construction.
create table public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index schedule_templates_promoter_id_idx on public.schedule_templates(promoter_id);

create table public.schedule_template_entries (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.schedule_templates(id) on delete cascade,
  kind text not null check (kind in
    ('arrival', 'load_in', 'soundcheck', 'doors', 'performance', 'changeover', 'break', 'other')),
  title text not null,
  stage text not null default 'Main Stage',
  -- Minutes from a nominal "event start" (0) — applied to a real event by
  -- adding this offset to the promoter-chosen anchor time, then adding
  -- duration_minutes for end_at.
  offset_minutes integer not null,
  duration_minutes integer not null check (duration_minutes > 0),
  sort_order integer not null default 0
);
create index schedule_template_entries_template_id_idx on public.schedule_template_entries(template_id);

alter table public.show_schedules enable row level security;
alter table public.schedule_entries enable row level security;
alter table public.schedule_templates enable row level security;
alter table public.schedule_template_entries enable row level security;

create or replace function public.owns_show_schedule(p_schedule_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.show_schedules
    where id = p_schedule_id and promoter_id = auth.uid()
  );
$$;

create or replace function public.owns_schedule_template(p_template_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.schedule_templates
    where id = p_template_id and promoter_id = auth.uid()
  );
$$;

-- show_schedules --------------------------------------------------------
create policy "show_schedules: select own when subscribed" on public.show_schedules
  for select using (promoter_id = auth.uid() and public.promoter_is_subscribed());
create policy "show_schedules: insert own when subscribed" on public.show_schedules
  for insert with check (
    promoter_id = auth.uid()
    and public.promoter_is_subscribed()
    and exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
  );
create policy "show_schedules: update own when subscribed" on public.show_schedules
  for update using (promoter_id = auth.uid() and public.promoter_is_subscribed());
create policy "show_schedules: delete own when subscribed" on public.show_schedules
  for delete using (promoter_id = auth.uid() and public.promoter_is_subscribed());

-- schedule_entries --------------------------------------------------------
create policy "schedule_entries: select via owning schedule when subscribed" on public.schedule_entries
  for select using (public.owns_show_schedule(schedule_id) and public.promoter_is_subscribed());
create policy "schedule_entries: insert via owning schedule when subscribed" on public.schedule_entries
  for insert with check (public.owns_show_schedule(schedule_id) and public.promoter_is_subscribed());
create policy "schedule_entries: update via owning schedule when subscribed" on public.schedule_entries
  for update using (public.owns_show_schedule(schedule_id) and public.promoter_is_subscribed());
create policy "schedule_entries: delete via owning schedule when subscribed" on public.schedule_entries
  for delete using (public.owns_show_schedule(schedule_id) and public.promoter_is_subscribed());

-- schedule_templates / schedule_template_entries ---------------------------
create policy "schedule_templates: select own when subscribed" on public.schedule_templates
  for select using (promoter_id = auth.uid() and public.promoter_is_subscribed());
create policy "schedule_templates: insert own when subscribed" on public.schedule_templates
  for insert with check (promoter_id = auth.uid() and public.promoter_is_subscribed());
create policy "schedule_templates: update own when subscribed" on public.schedule_templates
  for update using (promoter_id = auth.uid() and public.promoter_is_subscribed());
create policy "schedule_templates: delete own when subscribed" on public.schedule_templates
  for delete using (promoter_id = auth.uid() and public.promoter_is_subscribed());

create policy "schedule_template_entries: select via owning template when subscribed" on public.schedule_template_entries
  for select using (public.owns_schedule_template(template_id) and public.promoter_is_subscribed());
create policy "schedule_template_entries: insert via owning template when subscribed" on public.schedule_template_entries
  for insert with check (public.owns_schedule_template(template_id) and public.promoter_is_subscribed());
create policy "schedule_template_entries: update via owning template when subscribed" on public.schedule_template_entries
  for update using (public.owns_schedule_template(template_id) and public.promoter_is_subscribed());
create policy "schedule_template_entries: delete via owning template when subscribed" on public.schedule_template_entries
  for delete using (public.owns_schedule_template(template_id) and public.promoter_is_subscribed());

-- Optimistic concurrency: every save that touches entries first "claims"
-- the next version with this atomic compare-and-swap. If another tab/editor
-- already claimed a later version, this raises and the client shows a
-- conflict state (reload to see the latest) instead of silently overwriting
-- someone else's edit.
create or replace function public.claim_schedule_version(p_schedule_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_version integer;
begin
  if not public.promoter_is_subscribed() then
    raise exception 'support_plus_required';
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
