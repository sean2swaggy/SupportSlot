-- Support Slot — let a promoter turn an "available" availability-response
-- into a real application row (which BookModal then pays through the
-- normal Stripe flow). Hit live as a 403: the only existing INSERT policy
-- on applications is "artist_id = auth.uid()" (an artist applying for
-- themselves) — there was no path for a promoter to create one, even
-- though 0011_availability_requests.sql's whole design assumes exactly
-- that (see bookFromAvailabilityResponse in src/lib/queries.ts).
--
-- Scoped narrowly on purpose: a promoter can only create an application
-- for an artist who has genuinely responded "available" to one of THAT
-- SAME promoter's own requests, and only for the specific slot that
-- request has been linked to (linked_slot_id, set right before this
-- insert in the app — see linkSlotAndBook in
-- src/app/dashboard/promoter/requests/page.tsx). A promoter can't use
-- this to fabricate an application from an artist who never responded.

create policy "applications: insert by promoter from available response" on public.applications
  for insert with check (
    exists (
      select 1 from public.slots s
      where s.id = slot_id and s.promoter_id = auth.uid()
    )
    and exists (
      select 1 from public.availability_request_recipients r
      join public.availability_requests req on req.id = r.request_id
      where r.artist_id = applications.artist_id
        and r.response = 'available'
        and req.promoter_id = auth.uid()
        and req.linked_slot_id = applications.slot_id
    )
  );
