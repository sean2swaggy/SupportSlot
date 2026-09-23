-- Support Slot — the promoter-facing "Support Slot booking fee" used to be
-- a hardcoded £12 constant in BookModal.tsx, with no connection to the
-- promoter at all. Making it a real per-slot field the promoter sets when
-- posting, with a platform-enforced £10 floor (this is what becomes the
-- Stripe `application_fee_amount` once Connect is wired up).

alter table public.slots
  add column booking_fee integer not null default 12 check (booking_fee >= 10);
