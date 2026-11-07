-- Support Slot — 0006: pin the search path on the plain helper functions.
--
-- Supabase's security advisor flags functions whose search_path is not fixed
-- ("function_search_path_mutable"). These seven are plain SQL/plpgsql helpers
-- (distance maths, the London date, two triggers, the place checker); none is
-- SECURITY DEFINER, so this was low risk, but pinning it removes the warning
-- and the possibility. No behaviour changes and no rows are touched.
--
-- Run after 0001–0005, once.

alter function public._check_place(text, text, text, double precision, double precision, text) set search_path = public, pg_temp;
alter function public.bookings_touch() set search_path = public, pg_temp;
alter function public.haversine_miles(double precision, double precision, double precision, double precision) set search_path = public, pg_temp;
alter function public.london_today() set search_path = public, pg_temp;
alter function public.long_journey_miles() set search_path = public, pg_temp;
alter function public.minimum_long_journey_travel_pence() set search_path = public, pg_temp;
alter function public.prevent_role_change() set search_path = public, pg_temp;
