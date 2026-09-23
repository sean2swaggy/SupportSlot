-- Support Slot — manual RLS verification for the Artist Roster and
-- Availability Requests features (0010/0011_*.sql).
--
-- Why this is a .sql script and not a Vitest test: the actual guarantee
-- being tested ("a promoter can't insert into their roster without an
-- active subscription", "an artist can never see another artist's
-- response") is enforced entirely in Postgres RLS policies, which only run
-- against a real Postgres instance — there's no way to exercise them from
-- a Node unit test without standing up a full local Supabase stack, which
-- is out of proportion to this change. This is the same kind of gap the
-- project already accepted for webhook testing (see README/CLAUDE.md).
--
-- HOW TO RUN: paste into the Supabase SQL editor and run block by block,
-- reading the "-- EXPECT" comment before each query and confirming the
-- actual result matches. The SQL editor runs as the `postgres` superuser,
-- which bypasses RLS entirely — `set role authenticated` + a fake JWT
-- `sub` claim is what actually makes `auth.uid()` resolve to a specific
-- user and RLS apply, exactly as it would for a real logged-in request.
-- This is Supabase's own documented pattern for testing policies by hand.
--
-- SETUP: replace these three with real ids from your dev project (e.g.
-- the test-artist-payouts@example.com / test-promoter-payouts@example.com
-- accounts already used elsewhere this session, plus one more promoter).
-- \set promoter_a '00000000-0000-0000-0000-000000000001'
-- \set promoter_b '00000000-0000-0000-0000-000000000002'
-- \set artist_a    '00000000-0000-0000-0000-000000000003'

-- ===========================================================================
-- 1. Server-side subscription enforcement — a client can't grant itself
--    Support+ directly (the exact gap 0010_promoter_support_plus.sql closes).
-- ===========================================================================
set role authenticated;
set request.jwt.claim.sub = :'promoter_a';

update public.profiles set is_support_plus = true where id = :'promoter_a';
-- EXPECT: an error — "Support+ status can only be changed by the billing
-- system." Confirm afterwards that it's still false:
select is_support_plus from public.profiles where id = :'promoter_a';
-- EXPECT: false (unless promoter_a is a real subscriber in your test data)

reset role;

-- ===========================================================================
-- 2. Roster: insert requires an active subscription.
-- ===========================================================================
-- First confirm promoter_a's actual subscription state — adjust the two
-- checks below to match whichever is currently true for your test account.
select is_support_plus from public.profiles where id = :'promoter_a';

set role authenticated;
set request.jwt.claim.sub = :'promoter_a';

insert into public.artist_roster (promoter_id, artist_id) values (:'promoter_a', :'artist_a');
-- EXPECT: succeeds if promoter_a.is_support_plus = true, otherwise a row-
-- level security policy violation on artist_roster.

reset role;

-- ===========================================================================
-- 3. Roster privacy — promoter_b can never see promoter_a's roster rows,
--    even though both are ordinary authenticated users.
-- ===========================================================================
set role authenticated;
set request.jwt.claim.sub = :'promoter_b';

select * from public.artist_roster where promoter_id = :'promoter_a';
-- EXPECT: zero rows — RLS filters them out entirely, not just the UI.

insert into public.artist_roster (promoter_id, artist_id)
values (:'promoter_a', :'artist_a');
-- EXPECT: rejected — "promoter_id = auth.uid()" fails since promoter_b is
-- signed in, not promoter_a. Confirms one promoter can't plant entries in
-- another promoter's private roster.

reset role;

-- ===========================================================================
-- 4. Roster survives a lapsed subscription (read-only, not deleted).
-- ===========================================================================
-- As superuser, simulate promoter_a's subscription lapsing:
update public.profiles set is_support_plus = false where id = :'promoter_a';
-- (this direct update is fine here — we're intentionally using the
-- superuser/service-role path that the real webhook also uses)

set role authenticated;
set request.jwt.claim.sub = :'promoter_a';

select * from public.artist_roster where promoter_id = :'promoter_a';
-- EXPECT: the roster entry from step 2 is still there and still readable.

update public.artist_roster set notes = 'trying to edit after lapse'
where promoter_id = :'promoter_a' and artist_id = :'artist_a';
-- EXPECT: 0 rows updated — editing requires an active subscription again.

delete from public.artist_roster where promoter_id = :'promoter_a' and artist_id = :'artist_a';
-- EXPECT: succeeds — removing an entry isn't a "new premium action", so it
-- stays available even while lapsed. Re-run step 2 afterwards if you want
-- the row back for later steps (you'll need is_support_plus = true again).

reset role;

-- ===========================================================================
-- 5. Availability requests: duplicate-send protection at the DB layer —
--    the same artist can't be added twice to the same request.
-- ===========================================================================
update public.profiles set is_support_plus = true where id = :'promoter_a';

set role authenticated;
set request.jwt.claim.sub = :'promoter_a';

insert into public.availability_requests
  (promoter_id, event_name, event_date, event_time, venue_name, venue_location, proposed_fee, set_length_mins, response_deadline)
values
  (:'promoter_a', 'RLS Test Show', current_date + 7, '20:00', 'Test Venue', 'Test City', 100, 30, now() + interval '3 days')
returning id \gset req_

insert into public.availability_request_recipients (request_id, artist_id) values (:'req_id', :'artist_a');
-- EXPECT: succeeds (first send).

insert into public.availability_request_recipients (request_id, artist_id) values (:'req_id', :'artist_a');
-- EXPECT: fails — unique(request_id, artist_id) violation. This is the
-- literal duplicate-send guard; the composer UI's submit-once guard (see
-- RequestComposerModal's useRef) handles the more common double-click case
-- before it ever reaches this constraint.

reset role;

-- ===========================================================================
-- 6. Free artist access — an artist can see and answer a request even
--    though the sending promoter's subscription has since lapsed.
-- ===========================================================================
update public.profiles set is_support_plus = false where id = :'promoter_a';

set role authenticated;
set request.jwt.claim.sub = :'artist_a';

select event_name, status from public.availability_requests where id = :'req_id';
-- EXPECT: one row — readable regardless of the promoter's current
-- subscription state.

update public.availability_request_recipients
set response = 'available', responded_at = now()
where request_id = :'req_id' and artist_id = :'artist_a';
-- EXPECT: succeeds — responding is a recipient-identity check + an
-- unexpired/non-withdrawn request, never a promoter-subscription check.

reset role;

-- ===========================================================================
-- 7. Recipients never see each other. Add a second artist, then confirm
--    artist_a's session can't read artist_b's response.
-- ===========================================================================
-- \set artist_b '00000000-0000-0000-0000-000000000004'

update public.profiles set is_support_plus = true where id = :'promoter_a';
set role authenticated;
set request.jwt.claim.sub = :'promoter_a';
insert into public.availability_request_recipients (request_id, artist_id) values (:'req_id', :'artist_b');
reset role;

set role authenticated;
set request.jwt.claim.sub = :'artist_a';

select artist_id from public.availability_request_recipients where request_id = :'req_id';
-- EXPECT: exactly one row — artist_a's own, never artist_b's.

reset role;

-- ===========================================================================
-- Cleanup — remove everything this script created.
-- ===========================================================================
delete from public.availability_requests where id = :'req_id';
delete from public.artist_roster where promoter_id = :'promoter_a' and artist_id = :'artist_a';
