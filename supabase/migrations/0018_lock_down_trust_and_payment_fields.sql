-- Support Slot — lock down trust-signal and payment-routing fields from
-- direct client writes, and stop status/ranking tampering on applications.
--
-- Confirmed live during a pre-launch security audit: a signed-in artist
-- could self-insert verification: 'verified' and a self-chosen
-- stripe_account_id / stripe_transfers_active: true on their own artists
-- row via a direct Supabase client call (the anon key + their own
-- session — exactly what a browser has). Nothing in the UI does this, but
-- "artists: insert own" / "artists: update own" never restricted which
-- COLUMNS a client could set, only which ROW. Combined with
-- stripe_account_id being publicly readable (artists: public select is
-- `using (true)`, no column restriction — confirmed a fully unauthenticated
-- client can read every artist's stripe_account_id), this is exactly the
-- "never trust client-provided ... Stripe account IDs" scenario. The same
-- gap existed for promoters.verification / promoters.stripe_customer_id,
-- and for applications.match_percent / artist_id / slot_id (ranking and
-- ownership tampering) — the existing "applications: update participant"
-- with_check only ever blocked status = 'booked', not a self-set
-- 'shortlisted', nor a rewritten match_percent.
--
-- Same "an authenticated client can never touch this, only service_role"
-- pattern already used for profiles.is_support_plus in
-- 0010_promoter_support_plus.sql — service_role (auth.role() = 'service_role')
-- always bypasses this, same as it bypasses RLS.

create or replace function public.prevent_client_trust_and_payment_field_tamper()
returns trigger
language plpgsql
security definer
as $$
begin
  if auth.role() <> 'authenticated' then
    return new;
  end if;

  if tg_table_name = 'artists' then
    if tg_op = 'INSERT' then
      if new.verification is distinct from 'unverified'
        or new.stripe_account_id is not null
        or new.stripe_transfers_active is distinct from false then
        raise exception 'Verification and payout linkage can only be set by the platform.';
      end if;
    else
      if new.verification is distinct from old.verification
        or new.stripe_account_id is distinct from old.stripe_account_id
        or new.stripe_transfers_active is distinct from old.stripe_transfers_active then
        raise exception 'Verification and payout linkage can only be changed by the platform.';
      end if;
    end if;
  elsif tg_table_name = 'promoters' then
    if tg_op = 'INSERT' then
      if new.verification is distinct from 'unverified' or new.stripe_customer_id is not null then
        raise exception 'Verification and billing linkage can only be set by the platform.';
      end if;
    else
      if new.verification is distinct from old.verification
        or new.stripe_customer_id is distinct from old.stripe_customer_id then
        raise exception 'Verification and billing linkage can only be changed by the platform.';
      end if;
    end if;
  elsif tg_table_name = 'applications' and tg_op = 'UPDATE' then
    if new.match_percent is distinct from old.match_percent
      or new.artist_id is distinct from old.artist_id
      or new.slot_id is distinct from old.slot_id then
      raise exception 'match_percent, artist_id and slot_id cannot be changed after submission.';
    end if;
  end if;

  return new;
end;
$$;

create trigger artists_trust_and_payment_immutable_by_client
  before insert or update on public.artists
  for each row execute function public.prevent_client_trust_and_payment_field_tamper();

create trigger promoters_trust_and_payment_immutable_by_client
  before insert or update on public.promoters
  for each row execute function public.prevent_client_trust_and_payment_field_tamper();

create trigger applications_ranking_and_ownership_immutable_by_client
  before update on public.applications
  for each row execute function public.prevent_client_trust_and_payment_field_tamper();

-- ---------------------------------------------------------------------------
-- applications: role-scoped status transitions. Previously either
-- participant could set ANY status besides 'booked', so an artist could
-- self-shortlist (or self-"not_select", or bounce their own status back to
-- "viewed") via a direct client write. Now: the artist may only withdraw
-- (-> 'cancelled'); the promoter may move it through the normal review
-- states, or cancel a confirmed booking (BookingActionsLinks lets either
-- side cancel a booked show — see 0005_slots_reschedule_rls.sql for the
-- matching "artist can also touch a booked slot" precedent). 'booked'
-- itself still requires the server-side payment-verified path
-- (payments/confirm or the webhook, both service-role) — unchanged.
-- ---------------------------------------------------------------------------
drop policy "applications: update participant" on public.applications;

create policy "applications: update participant" on public.applications
  for update using (
    artist_id = auth.uid()
    or exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
  )
  with check (
    status <> 'booked'
    and (
      (artist_id = auth.uid() and status = 'cancelled')
      or (
        status in ('viewed', 'shortlisted', 'not_selected', 'cancelled')
        and exists (select 1 from public.slots s where s.id = slot_id and s.promoter_id = auth.uid())
      )
    )
  );
