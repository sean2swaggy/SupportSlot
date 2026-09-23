-- Support Slot — allow the booked artist to reschedule a slot too, not
-- just the promoter who posted it. BookingActionsLinks.tsx shows
-- "Reschedule" to both sides of a confirmed booking, but the original
-- policy only let the promoter write to `slots`, so an artist-initiated
-- reschedule was silently blocked by RLS (0 rows affected, no error) even
-- though the UI showed success. Only rescheduleSlot() ever touches this
-- row, and it only ever sets date/doors_time/set_time/rescheduled_at.
--
-- Fixed version: the bare `id` in the EXISTS subquery resolved to
-- applications.id (that table also has an `id` column, which shadows the
-- outer slots.id in Postgres's scoping) instead of the intended outer
-- slots.id — qualifying it as `slots.id` fixes the comparison.

drop policy if exists "slots: update own" on public.slots;
drop policy if exists "slots: update own or booked artist" on public.slots;

create policy "slots: update own or booked artist" on public.slots
  for update using (
    promoter_id = auth.uid()
    or exists (
      select 1 from public.applications a
      where a.slot_id = slots.id and a.artist_id = auth.uid() and a.status = 'booked'
    )
  );
