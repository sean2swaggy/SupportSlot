-- Support Slot — 0011: hardening found by the Supabase advisors and a review of 0010.
--
-- 1. Trigger-only functions can no longer be called as API functions
--    (/rest/v1/rpc/...) by visitors or signed-in users. Triggers still fire:
--    Postgres checks EXECUTE when a trigger is created, not when it runs.
--    Helper functions that row-level-security policies call are NOT touched.
-- 2. "Download my data" now includes reviews (written and received) and saved searches.
-- 3. Indexes on foreign keys that had none (faster joins and deletes as data grows).
--
-- No rows are changed. Run after 0001–0010, once.

-- 1. ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 2. ---------------------------------------------------------------------------
alter function public.export_my_data() rename to _export_my_data_base;
revoke all on function public._export_my_data_base() from public, anon, authenticated;

create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return public._export_my_data_base() || jsonb_build_object(
    'reviews_written', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reviews r where r.reviewer_id = v_uid), '[]'),
    'reviews_received', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reviews r where r.reviewee_id = v_uid), '[]'),
    'saved_searches', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.saved_searches s where s.artist_id = v_uid), '[]')
  );
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- 3. ---------------------------------------------------------------------------
create index if not exists reviews_reviewer_idx on public.reviews (reviewer_id);
create index if not exists reviews_booking_idx on public.reviews (booking_id);
create index if not exists slots_venue_id_idx on public.slots (venue_id);
create index if not exists saved_slots_slot_id_idx on public.saved_slots (slot_id);
create index if not exists message_threads_promoter_id_idx on public.message_threads (promoter_id);
create index if not exists promoter_blocks_promoter_id_idx on public.promoter_blocks (promoter_id);
create index if not exists applications_featured_track_id_idx on public.applications (featured_track_id);
create index if not exists venues_created_by_idx on public.venues (created_by);
create index if not exists reports_reporter_id_idx on public.reports (reporter_id);
create index if not exists support_requests_profile_id_idx on public.support_requests (profile_id);
create index if not exists gig_invitations_linked_application_idx on public.gig_invitations (linked_application_id);
create index if not exists availability_requests_linked_slot_idx on public.availability_requests (linked_slot_id);
create index if not exists availability_recipients_linked_application_idx on public.availability_request_recipients (linked_application_id);
create index if not exists availability_recipients_thread_idx on public.availability_request_recipients (thread_id);
