-- Support Slot — real payment wiring for bookings.
--
-- 1. Links an application to the PaymentIntent that paid for it.
-- 2. Closes a gap that existed even before real payments: the
--    "applications: update participant" policy let either party set ANY
--    status via a direct client write, including "booked" — meaning a
--    promoter could mark a show booked without ever paying. Now that
--    booking involves real money, the transition TO "booked" must go
--    through the server (src/app/api/stripe/payments/confirm/route.ts,
--    which verifies the PaymentIntent succeeded before writing, using the
--    service role — bypassing RLS entirely). Other transitions (shortlist,
--    not_selected, cancelled, viewed) are unaffected.

alter table public.applications
  add column stripe_payment_intent_id text unique;

drop policy "applications: update participant" on public.applications;

create policy "applications: update participant" on public.applications
  for update using (
    artist_id = auth.uid()
    or exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
  )
  with check (
    status <> 'booked'
  );
-- Note: this policy now blocks ALL client-side writes that set status to
-- 'booked', including the artist's own cancel-after-booked edge cases —
-- that's intentional; only the service-role-backed confirm route (or a
-- future cancellation route) should touch a booked application's status.
