-- Support Slot — the promoter needs to be able to set
-- availability_request_recipients.linked_application_id once they turn an
-- "available" response into a real application (see
-- bookFromAvailabilityResponse in src/lib/queries.ts). The only existing
-- UPDATE policy on this table is "respond as recipient" (the artist
-- answering their own row) — there was no path for the owning promoter to
-- write to it at all, so the update silently affected 0 rows and
-- linked_application_id stayed null forever, even though the real booking
-- itself succeeded.
--
-- Reuses owns_availability_request() from 0012 (security definer, so this
-- doesn't reopen the recursion that migration fixed).

create policy "availability_request_recipients: update by owning promoter" on public.availability_request_recipients
  for update using (
    public.owns_availability_request(request_id)
  );
