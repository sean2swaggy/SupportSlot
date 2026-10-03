-- Support Slot — staff tools, abuse reporting, support requests, profile
-- hardening and account-deletion groundwork.
--
-- There is deliberately NO way to become staff from the app: admin_role can
-- only be set by whoever owns the database (SQL editor / service role). The
-- first admin is created by hand — see docs in the completion report.

-- ---------------------------------------------------------------------------
-- 1. Staff roles + protected profile fields
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column admin_role text check (admin_role in ('moderator', 'admin'));

create or replace function public.protect_profile_staff_fields()
returns trigger language plpgsql security definer as $$
begin
  if auth.role() = 'authenticated' and current_setting('app.staff_bypass', true) is distinct from '1' and (
       new.admin_role is distinct from old.admin_role
    or new.suspended_at is distinct from old.suspended_at
    or new.suspension_reason is distinct from old.suspension_reason
    or new.email is distinct from old.email
    or new.has_onboarded is distinct from old.has_onboarded and old.has_onboarded = true
  ) then
    raise exception 'That account field can only be changed by the platform.';
  end if;
  return new;
end;
$$;
create trigger profiles_protect_staff_fields
  before update on public.profiles
  for each row execute function public.protect_profile_staff_fields();

create or replace function public.current_admin_role()
returns text language sql stable security definer set search_path = public as $$
  select admin_role from public.profiles where id = auth.uid()
$$;

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
create policy "admin_audit_log: staff select" on public.admin_audit_log
  for select using (public.current_admin_role() is not null);

create or replace function public._staff_actor(p_min text default 'moderator')
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.current_admin_role();
begin
  if v_role is null or (p_min = 'admin' and v_role <> 'admin') then
    raise exception 'not_authorized';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public._staff_actor(text) from public, anon, authenticated;

create or replace function public._audit(p_action text, p_target_type text, p_target_id text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_log (actor_id, actor_role, action, target_type, target_id, details)
  values (auth.uid(), public.current_admin_role(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'))
$$;
revoke all on function public._audit(text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reports (abuse) — any signed-in user, any content type
-- ---------------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_context_type_check;
alter table public.reports
  add constraint reports_context_type_check check (context_type in (
    'availability_request', 'message', 'slot', 'profile', 'application', 'booking', 'other'
  )),
  alter column reporter_id drop not null,
  alter column reported_profile_id drop not null,
  add column status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  add column reviewed_by uuid references public.profiles(id) on delete set null,
  add column reviewed_at timestamptz,
  add column resolution_note text;
alter table public.reports drop constraint reports_reporter_id_fkey;
alter table public.reports drop constraint reports_reported_profile_id_fkey;
alter table public.reports
  add constraint reports_reporter_id_fkey foreign key (reporter_id) references public.profiles(id) on delete set null,
  add constraint reports_reported_profile_id_fkey foreign key (reported_profile_id) references public.profiles(id) on delete set null;
create index reports_status_idx on public.reports (status, created_at desc);

drop policy if exists "reports: insert as reporter" on public.reports;

create or replace function public.submit_report(
  p_context_type text, p_context_id uuid, p_reported_profile_id uuid, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._require_active_user();
  v_id uuid;
begin
  if p_reported_profile_id = v_uid then raise exception 'report_invalid: you can''t report yourself'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'report_invalid: please describe what happened (at least 10 characters)'; end if;
  if length(p_reason) > 2000 then raise exception 'report_invalid: description is too long (max 2000 characters)'; end if;
  if p_context_type not in ('availability_request', 'message', 'slot', 'profile', 'application', 'booking', 'other') then
    raise exception 'report_invalid: unknown report type';
  end if;
  -- The same report twice is one report.
  select id into v_id from public.reports
    where reporter_id = v_uid and context_type = p_context_type
      and context_id is not distinct from p_context_id
      and reported_profile_id is not distinct from p_reported_profile_id
      and created_at > now() - interval '24 hours';
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rate_limited: too many reports today — contact support if this is urgent';
  end if;
  insert into public.reports (reporter_id, reported_profile_id, context_type, context_id, reason)
    values (v_uid, p_reported_profile_id, p_context_type, p_context_id, btrim(p_reason))
    returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.submit_report(text, uuid, uuid, text) to authenticated;
revoke execute on function public.submit_report(text, uuid, uuid, text) from anon, public;

create or replace function public.admin_update_report(p_report_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._staff_actor();
  v_r public.reports;
begin
  if p_status not in ('open', 'reviewing', 'actioned', 'dismissed') then raise exception 'invalid_status'; end if;
  select * into v_r from public.reports where id = p_report_id for update;
  if not found then raise exception 'report_not_found'; end if;
  update public.reports
    set status = p_status, reviewed_by = v_uid, reviewed_at = now(),
        resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
    where id = p_report_id;
  perform public._audit('report.' || p_status, 'report', p_report_id::text, jsonb_build_object('note', p_note));
  if v_r.reporter_id is not null and p_status in ('actioned', 'dismissed') then
    perform public.notify(v_r.reporter_id, 'report_update',
      case p_status when 'actioned' then 'Thanks — we''ve acted on your report.' else 'We reviewed your report and didn''t find a breach of our rules.' end,
      '/support', 'report:' || p_report_id::text || ':' || p_status, false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Support requests (account/payment/bug questions — not abuse reports)
-- ---------------------------------------------------------------------------
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null check (length(email) between 3 and 254),
  topic text not null check (topic in ('account', 'payment', 'booking', 'bug', 'other')),
  message text not null check (length(message) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  staff_note text,
  created_at timestamptz not null default now()
);
create index support_requests_status_idx on public.support_requests (status, created_at desc);
alter table public.support_requests enable row level security;
create policy "support_requests: select own" on public.support_requests
  for select using (profile_id = auth.uid());
-- Inserted only by the rate-limited /api/support route (service role).

create or replace function public.admin_update_support_request(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._staff_actor();
begin
  if p_status not in ('open', 'answered', 'closed') then raise exception 'invalid_status'; end if;
  update public.support_requests
    set status = p_status, handled_by = v_uid, handled_at = now(), staff_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
    where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public._audit('support.' || p_status, 'support_request', p_id::text, jsonb_build_object('note', p_note));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Staff reads — through narrow functions, never broad table access, so
-- moderators don't see payment or subscription data.
-- ---------------------------------------------------------------------------
create or replace function public.staff_open_reports(p_status text default 'open', p_limit integer default 50)
returns table (id uuid, context_type text, context_id uuid, reason text, status text, created_at timestamptz,
               reporter_id uuid, reporter_label text, reported_profile_id uuid, reported_label text,
               resolution_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._staff_actor();
  return query
    select r.id, r.context_type, r.context_id, r.reason, r.status, r.created_at,
           r.reporter_id, coalesce(rp.username, rp.email, '(deleted)'),
           r.reported_profile_id, coalesce(dp.username, dp.email, '(deleted)'),
           r.resolution_note
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles dp on dp.id = r.reported_profile_id
    where (p_status = 'all' or r.status = p_status)
    order by r.created_at desc
    limit least(greatest(p_limit, 1), 200);
end;
$$;

create or replace function public.staff_support_requests(p_status text default 'open', p_limit integer default 50)
returns setof public.support_requests
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._staff_actor();
  return query
    select * from public.support_requests where (p_status = 'all' or status = p_status)
    order by created_at desc limit least(greatest(p_limit, 1), 200);
end;
$$;

create or replace function public.staff_find_users(p_q text, p_limit integer default 25)
returns table (id uuid, role text, email text, username text, created_at timestamptz, has_onboarded boolean,
               suspended_at timestamptz, suspension_reason text, admin_role text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._staff_actor();
  return query
    select p.id, p.role, p.email, p.username, p.created_at, p.has_onboarded, p.suspended_at, p.suspension_reason, p.admin_role
    from public.profiles p
    where nullif(btrim(p_q), '') is null
       or strpos(lower(coalesce(p.email, '')), lower(btrim(p_q))) > 0
       or strpos(lower(coalesce(p.username, '')), lower(btrim(p_q))) > 0
       or p.id::text = btrim(p_q)
    order by p.created_at desc
    limit least(greatest(p_limit, 1), 100);
end;
$$;

create or replace function public.staff_recent_slots(p_q text default null, p_limit integer default 50)
returns table (id uuid, headliner text, city text, date date, status text, promoter_id uuid, promoter_company text, applicant_count integer)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._staff_actor();
  return query
    select s.id, s.headliner, s.city, s.date, s.status, s.promoter_id, pr.company, s.applicant_count
    from public.slots s left join public.promoters pr on pr.id = s.promoter_id
    where nullif(btrim(p_q), '') is null or strpos(lower(s.headliner), lower(btrim(p_q))) > 0 or s.id::text = btrim(p_q)
    order by s.posted_at desc
    limit least(greatest(p_limit, 1), 100);
end;
$$;

-- Payment visibility is admin-only.
create or replace function public.admin_recent_bookings(p_limit integer default 50)
returns table (id uuid, headliner text, artist_name text, promoter_company text, status text, payment_status text,
               total_pence integer, refunded_pence integer, dispute_status text, refund_review_required boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._staff_actor('admin');
  return query
    select b.id, b.headliner, b.artist_name, b.promoter_company, b.status, b.payment_status,
           b.total_pence, b.refunded_pence, b.dispute_status, b.refund_review_required, b.created_at
    from public.bookings b order by b.created_at desc limit least(greatest(p_limit, 1), 200);
end;
$$;

create or replace function public.staff_audit_log(p_limit integer default 100)
returns setof public.admin_audit_log
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._staff_actor();
  return query select * from public.admin_audit_log order by created_at desc limit least(greatest(p_limit, 1), 300);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Staff actions (all audited)
-- ---------------------------------------------------------------------------
create or replace function public.admin_suspend_user(p_profile_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._staff_actor();
  v_target public.profiles;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required'; end if;
  select * into v_target from public.profiles where id = p_profile_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_target.admin_role is not null then raise exception 'cannot_suspend_staff'; end if;
  perform set_config('app.staff_bypass', '1', true);
  update public.profiles set suspended_at = now(), suspension_reason = btrim(p_reason) where id = p_profile_id;
  perform set_config('app.staff_bypass', '0', true);
  perform public._audit('user.suspend', 'profile', p_profile_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.admin_unsuspend_user(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._staff_actor();
begin
  perform set_config('app.staff_bypass', '1', true);
  update public.profiles set suspended_at = null, suspension_reason = null where id = p_profile_id;
  perform set_config('app.staff_bypass', '0', true);
  if not found then raise exception 'not_found'; end if;
  perform public._audit('user.unsuspend', 'profile', p_profile_id::text, '{}');
end;
$$;

-- Takes a listing down on behalf of moderation: pending applicants are told
-- it's closed; a confirmed booking is cancelled (and flagged for a refund
-- decision if it was paid).
create or replace function public.admin_remove_listing(p_slot_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._staff_actor();
  v_slot public.slots;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required'; end if;
  select * into v_slot from public.slots where id = p_slot_id for update;
  if not found then raise exception 'listing_not_found'; end if;
  if v_slot.status = 'cancelled' then return; end if;
  perform public._wind_down_slot(v_slot, 'listing_removed', true);
  perform set_config('app.slot_bypass', '1', true);
  update public.slots set status = 'cancelled', closed_at = now(), closed_reason = 'removed_by_moderator: ' || left(btrim(p_reason), 400)
    where id = p_slot_id;
  perform set_config('app.slot_bypass', '0', true);
  perform public.notify(v_slot.promoter_id, 'system',
    'Your listing "' || v_slot.headliner || '" was removed by our moderation team. Reason: ' || btrim(p_reason),
    '/support', 'removed:' || p_slot_id::text, true);
  perform public._audit('listing.remove', 'slot', p_slot_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.admin_set_verification(p_profile_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._staff_actor('admin');
  v_val text := case when p_verified then 'verified' else 'unverified' end;
begin
  perform set_config('app.staff_bypass', '1', true);
  update public.artists set verification = v_val where id = p_profile_id;
  update public.promoters set verification = v_val where id = p_profile_id;
  perform set_config('app.staff_bypass', '0', true);
  perform public._audit('verification.' || v_val, 'profile', p_profile_id::text, '{}');
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'admin_update_report(uuid, text, text)', 'admin_update_support_request(uuid, text, text)',
    'staff_open_reports(text, integer)', 'staff_support_requests(text, integer)', 'staff_find_users(text, integer)',
    'staff_recent_slots(text, integer)', 'admin_recent_bookings(integer)', 'staff_audit_log(integer)',
    'admin_suspend_user(uuid, text)', 'admin_unsuspend_user(uuid)', 'admin_remove_listing(uuid, text)',
    'admin_set_verification(uuid, boolean)', 'current_admin_role()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Profile hardening: validation and safe media
-- ---------------------------------------------------------------------------
alter table public.artist_tracks
  add column url text check (url is null or (url ~ '^https?://' and length(url) <= 500)),
  add constraint artist_tracks_title_len check (length(btrim(title)) between 1 and 120);

create or replace function public.artists_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if length(btrim(new.name)) < 1 or length(new.name) > 80 then raise exception 'profile_invalid: name must be 1–80 characters'; end if;
  if length(new.bio) > 1000 then raise exception 'profile_invalid: bio is too long (max 1000 characters)'; end if;
  if coalesce(array_length(new.genres, 1), 0) > 5 then raise exception 'profile_invalid: choose at most 5 genres'; end if;
  if new.travel_radius_miles < 0 or new.travel_radius_miles > 500 then raise exception 'profile_invalid: travel radius must be 0–500 miles'; end if;
  if new.monthly_listeners is not null and new.monthly_listeners < 0 then raise exception 'profile_invalid: monthly listeners can''t be negative'; end if;
  if tg_op = 'UPDATE' and new.handle is distinct from old.handle then
    -- The handle is the public URL; bookings and payments never depend on it
    -- (they use the permanent id), but changing it would still break every
    -- shared link, so it's fixed once chosen.
    raise exception 'profile_invalid: your handle can''t be changed';
  end if;
  return new;
end;
$$;
create trigger artists_guard_biu before insert or update on public.artists
  for each row execute function public.artists_guard();

-- Images are stored as resized data: URLs (see AvatarUploadField) or https
-- URLs. NOT VALID: enforced for every new write, without failing on any old
-- row that predates the rule.
alter table public.artists
  add constraint artists_image_scheme check (image_url is null or image_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)') not valid,
  add constraint artists_banner_scheme check (banner_image_url is null or banner_image_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)') not valid,
  add constraint artists_thumb_scheme check (live_video_thumbnail_url is null or live_video_thumbnail_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)') not valid;
alter table public.promoters
  add constraint promoters_avatar_scheme check (avatar_url is null or avatar_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)') not valid;
alter table public.slots
  add constraint slots_headliner_image_scheme check (headliner_image_url is null or headliner_image_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)') not valid,
  add constraint slots_artist_photo_scheme check (artist_photo_url is null or artist_photo_url ~ '^(data:image/(jpeg|png|webp);base64,|https://)') not valid;

-- ---------------------------------------------------------------------------
-- 7. Account deletion groundwork. The route (service role) refuses to
-- proceed while any of these hold; financial records are kept (bookings
-- snapshot both parties' names and survive the account).
-- ---------------------------------------------------------------------------
create or replace function public.account_deletion_blockers(p_profile_id uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out text[] := '{}';
begin
  if exists (select 1 from public.bookings b
             where (b.artist_id = p_profile_id or b.promoter_id = p_profile_id)
               and b.status = 'confirmed' and b.event_date >= public.london_today()) then
    v_out := array_append(v_out, 'upcoming_confirmed_booking');
  end if;
  if exists (select 1 from public.bookings b
             where (b.artist_id = p_profile_id or b.promoter_id = p_profile_id)
               and (b.payment_status in ('processing', 'disputed') or b.refund_review_required)) then
    v_out := array_append(v_out, 'unresolved_payment');
  end if;
  return v_out;
end;
$$;
revoke all on function public.account_deletion_blockers(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;

-- Before the auth user is removed: end everything that's still in flight so
-- nobody is left waiting on an account that no longer exists.
create or replace function public.prepare_account_deletion(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_slot public.slots;
  v_app public.applications;
begin
  if array_length(public.account_deletion_blockers(p_profile_id), 1) is not null then
    raise exception 'deletion_blocked';
  end if;
  -- Only shows that haven't happened yet; past ones (and their payment
  -- history) are left as they are.
  for v_slot in
    select * from public.slots
    where promoter_id = p_profile_id and status in ('open', 'filled') and date >= public.london_today()
    for update
  loop
    perform public._wind_down_slot(v_slot, 'listing_cancelled', true);
  end loop;
  for v_app in select * from public.applications where artist_id = p_profile_id and status in ('submitted', 'viewed', 'shortlisted', 'offered') for update loop
    update public.bookings set status = 'withdrawn', responded_at = now(), decline_reason = 'account_deleted'
      where application_id = v_app.id and status = 'offered';
    update public.applications set status = 'withdrawn', status_changed_at = now(), closed_reason = 'artist_withdrew' where id = v_app.id;
  end loop;
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
