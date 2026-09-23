-- Support Slot — Availability requests: a subscribed promoter asks roster
-- artists whether they're free for a show, *before* any real booking or
-- payment. Deliberately separate from applications/slots/BookModal — an
-- "Available" response here is guidance, never a reservation. An actual
-- booking still goes through the existing apply → book → pay flow (see
-- linked_slot_id / linked_application_id below, set once a promoter turns a
-- response into a real booking).

create table public.availability_requests (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  event_name text not null,
  event_date date not null,
  event_time time not null,
  timezone text not null default 'Europe/London',
  venue_name text not null,
  venue_location text not null,
  proposed_fee integer not null check (proposed_fee >= 0),
  currency text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD')),
  set_length_mins integer not null check (set_length_mins > 0),
  response_deadline timestamptz not null,
  message text,
  -- 'sent' is the only status a request is created with — there's no draft
  -- state (the composer's preview step handles "not sent yet" client-side).
  status text not null default 'sent' check (status in ('sent', 'withdrawn', 'filled')),
  -- Set once the promoter actually books someone who responded — links this
  -- enquiry to the real slot used for the real booking (see BookModal).
  linked_slot_id uuid references public.slots(id) on delete set null,
  created_at timestamptz not null default now()
);
create index availability_requests_promoter_id_idx on public.availability_requests(promoter_id);

create table public.availability_request_recipients (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.availability_requests(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  -- Lifecycle (request.status) and response are deliberately separate
  -- columns/concepts — a withdrawn/expired request doesn't retroactively
  -- change what an artist actually answered.
  response text not null default 'pending' check (response in ('pending', 'available', 'unavailable')),
  responded_at timestamptz,
  -- Asking a question never changes `response` — see notify_on_message()
  -- in 0001_schema.sql, reused for the actual question/answer exchange.
  question_asked boolean not null default false,
  thread_id uuid references public.message_threads(id) on delete set null,
  linked_application_id uuid references public.applications(id) on delete set null,
  notified_at timestamptz,
  unique (request_id, artist_id)
);
create index availability_request_recipients_request_id_idx on public.availability_request_recipients(request_id);
create index availability_request_recipients_artist_id_idx on public.availability_request_recipients(artist_id);

-- ---------------------------------------------------------------------------
-- Block / report — artist-initiated, scoped to availability requests only.
-- A block silently stops a promoter from ever adding that artist as a
-- recipient again (enforced in the recipients insert policy below), rather
-- than notifying the promoter they've been blocked.
-- ---------------------------------------------------------------------------
create table public.promoter_blocks (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (artist_id, promoter_id)
);
create index promoter_blocks_artist_id_idx on public.promoter_blocks(artist_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_profile_id uuid not null references public.profiles(id) on delete cascade,
  context_type text not null check (context_type in ('availability_request', 'message', 'other')),
  context_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);
create index reports_reported_profile_id_idx on public.reports(reported_profile_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.availability_requests enable row level security;
alter table public.availability_request_recipients enable row level security;
alter table public.promoter_blocks enable row level security;
alter table public.reports enable row level security;

-- Requests: the owning promoter sees everything they've sent (regardless of
-- current subscription status — reading and managing existing requests
-- isn't a "new premium action"); a recipient artist can see the request's
-- own event details (not other recipients — that's a separate table).
create policy "availability_requests: select owner or recipient" on public.availability_requests
  for select using (
    promoter_id = auth.uid()
    or exists (
      select 1 from public.availability_request_recipients r
      where r.request_id = id and r.artist_id = auth.uid()
    )
  );
-- Sending a request is the core premium action.
create policy "availability_requests: insert own when subscribed" on public.availability_requests
  for insert with check (
    promoter_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and is_support_plus = true)
  );
-- Withdrawing / marking filled / linking a slot is housekeeping on a
-- request that already exists — allowed regardless of current subscription
-- status, same principle as roster deletes.
create policy "availability_requests: update own" on public.availability_requests
  for update using (promoter_id = auth.uid());

-- Recipients: an artist only ever sees their own row — never who else was
-- sent the same request, and never another artist's response.
create policy "availability_request_recipients: select own or owning promoter" on public.availability_request_recipients
  for select using (
    artist_id = auth.uid()
    or exists (
      select 1 from public.availability_requests req
      where req.id = request_id and req.promoter_id = auth.uid()
    )
  );
-- Recipients are added at request-creation time by the (subscribed)
-- promoter — and never for an artist who has blocked them.
create policy "availability_request_recipients: insert by owning promoter when subscribed" on public.availability_request_recipients
  for insert with check (
    exists (
      select 1 from public.availability_requests req
      where req.id = request_id
        and req.promoter_id = auth.uid()
        and exists (select 1 from public.profiles where id = auth.uid() and is_support_plus = true)
    )
    and not exists (
      select 1 from public.promoter_blocks b
      where b.artist_id = availability_request_recipients.artist_id and b.promoter_id = auth.uid()
    )
  );
-- An artist can answer their own, not-yet-expired, not-withdrawn/filled
-- request at any time — deliberately independent of the promoter's current
-- subscription state, per "allow artists to answer previously sent,
-- unexpired requests" even if Support+ later lapses.
create policy "availability_request_recipients: respond as recipient" on public.availability_request_recipients
  for update using (
    artist_id = auth.uid()
    and exists (
      select 1 from public.availability_requests req
      where req.id = request_id
        and req.status = 'sent'
        and req.response_deadline > now()
    )
  );

create policy "promoter_blocks: select own" on public.promoter_blocks
  for select using (artist_id = auth.uid() or promoter_id = auth.uid());
create policy "promoter_blocks: insert as artist" on public.promoter_blocks
  for insert with check (artist_id = auth.uid());
create policy "promoter_blocks: delete as artist" on public.promoter_blocks
  for delete using (artist_id = auth.uid());

create policy "reports: insert as reporter" on public.reports
  for insert with check (reporter_id = auth.uid());
create policy "reports: select own" on public.reports
  for select using (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Notifications — same "written only by security-definer triggers" pattern
-- as applications/messages in 0001_schema.sql.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('viewed', 'shortlisted', 'match', 'urgent', 'booked', 'message', 'availability_request', 'availability_response'));

create function public.notify_on_availability_request()
returns trigger
language plpgsql
security definer
as $$
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

create trigger availability_request_recipients_notify_new
  after insert on public.availability_request_recipients
  for each row execute function public.notify_on_availability_request();

create function public.notify_on_availability_response()
returns trigger
language plpgsql
security definer
as $$
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

create trigger availability_request_recipients_notify_response
  after update on public.availability_request_recipients
  for each row execute function public.notify_on_availability_response();

create function public.notify_on_availability_request_status_change()
returns trigger
language plpgsql
security definer
as $$
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

create trigger availability_requests_notify_status_change
  after update on public.availability_requests
  for each row execute function public.notify_on_availability_request_status_change();
