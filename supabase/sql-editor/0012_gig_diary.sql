-- Support Slot — 0012: the artist's Gig diary (a paid private extra, sold in the app).
--
-- A private log of an artist's own shows: date, venue, who booked them, what they
-- were paid and spent, set list, notes. Only the artist can see or change their rows.
-- Nothing here touches booking, ranking or visibility, and the diary never affects
-- how an artist appears to promoters.
--
-- Whether an artist has bought the diary is decided on their device by Apple's
-- purchase system (StoreKit); the database keeps the diary private to its owner, so
-- the row-level rules below are the privacy boundary, not a paywall.
--
-- Run after 0001–0011, once.

-- table: gig_diary_entries
create table public.gig_diary_entries (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  show_date date not null,
  venue text not null check (char_length(btrim(venue)) between 1 and 120),
  city text check (city is null or char_length(city) <= 80),
  promoter text check (promoter is null or char_length(promoter) <= 120),
  fee_pence integer not null default 0 check (fee_pence between 0 and 10000000),
  expenses_pence integer not null default 0 check (expenses_pence between 0 and 10000000),
  set_list text check (set_list is null or char_length(set_list) <= 2000),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (artist_id, booking_id)
);
create index gig_diary_artist_date_idx on public.gig_diary_entries (artist_id, show_date desc);
create index gig_diary_booking_idx on public.gig_diary_entries (booking_id);

alter table public.gig_diary_entries enable row level security;
create policy "gig_diary: own read" on public.gig_diary_entries for select to authenticated
  using (artist_id = (select auth.uid()));
create policy "gig_diary: own insert" on public.gig_diary_entries for insert to authenticated
  with check (artist_id = (select auth.uid())
    and (booking_id is null or exists (select 1 from public.bookings b where b.id = booking_id and b.artist_id = (select auth.uid()))));
create policy "gig_diary: own update" on public.gig_diary_entries for update to authenticated
  using (artist_id = (select auth.uid()))
  with check (artist_id = (select auth.uid())
    and (booking_id is null or exists (select 1 from public.bookings b where b.id = booking_id and b.artist_id = (select auth.uid()))));
create policy "gig_diary: own remove" on public.gig_diary_entries for delete to authenticated
  using (artist_id = (select auth.uid()));
create policy "active_session_required" on public.gig_diary_entries as restrictive for all to authenticated
  using ((select public.session_is_active())) with check ((select public.session_is_active()));
revoke all on public.gig_diary_entries from public, anon, authenticated;
grant select, insert, update, delete on public.gig_diary_entries to authenticated;

-- At most 2,000 entries per artist (protects storage; far more than anyone will log).
create or replace function public.gig_diary_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.gig_diary_entries where artist_id = new.artist_id) >= 2000 then
    raise exception 'limit_reached: a diary holds up to 2,000 shows';
  end if;
  return new;
end;
$$;
revoke all on function public.gig_diary_limit() from public, anon, authenticated;
create trigger gig_diary_limit_bi before insert on public.gig_diary_entries
  for each row execute function public.gig_diary_limit();

-- "Download my data" includes the diary.
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return public._export_my_data_base() || jsonb_build_object(
    'reviews_written', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reviews r where r.reviewer_id = v_uid), '[]'),
    'reviews_received', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reviews r where r.reviewee_id = v_uid), '[]'),
    'saved_searches', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.saved_searches s where s.artist_id = v_uid), '[]'),
    'gig_diary', coalesce((select jsonb_agg(to_jsonb(d) order by d.show_date) from public.gig_diary_entries d where d.artist_id = v_uid), '[]')
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
