-- Support Slot — payments and Support+ billing state.
--
-- 1. Stripe account/customer ids move out of the publicly-readable artists /
--    promoters rows into private tables (an unauthenticated client could read
--    every artist's stripe_account_id before this). Only the public boolean
--    artists.stripe_transfers_active stays visible ("payouts ready").
-- 2. Payment lifecycle handlers as idempotent SQL functions, called only by
--    the verified-webhook route (service role). They record every event once,
--    refuse to move a payment "backwards" when events arrive out of order,
--    and never mark a booking paid unless the amount and PaymentIntent match
--    the agreed booking terms.
-- 3. Support+ entitlement state, with the same out-of-order protection.

-- ---------------------------------------------------------------------------
-- 1. Private payment-identity tables
-- ---------------------------------------------------------------------------
create table public.artist_payment_accounts (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  stripe_account_id text not null unique,
  transfers_active boolean not null default false,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.artist_payment_accounts enable row level security;
create policy "artist_payment_accounts: select own" on public.artist_payment_accounts
  for select using (artist_id = auth.uid());

create table public.promoter_billing (
  promoter_id uuid primary key references public.promoters(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);
alter table public.promoter_billing enable row level security;
create policy "promoter_billing: select own" on public.promoter_billing
  for select using (promoter_id = auth.uid());

insert into public.artist_payment_accounts (artist_id, stripe_account_id, transfers_active)
  select id, stripe_account_id, stripe_transfers_active from public.artists where stripe_account_id is not null;
insert into public.promoter_billing (promoter_id, stripe_customer_id)
  select id, stripe_customer_id from public.promoters where stripe_customer_id is not null;

-- The tamper guard from 0018 still names the columns being dropped; replace
-- it first. The public payout-ready flag and the verification badge stay
-- service-role-only.
create or replace function public.prevent_client_trust_and_payment_field_tamper()
returns trigger language plpgsql security definer as $$
begin
  -- 'app.staff_bypass' is set only inside the audited admin_* functions (an
  -- API client can't set a Postgres setting), which run with the caller's
  -- JWT and so would otherwise trip this guard themselves.
  if auth.role() <> 'authenticated' or current_setting('app.staff_bypass', true) = '1' then
    return new;
  end if;

  if tg_table_name = 'artists' then
    if tg_op = 'INSERT' then
      if new.verification is distinct from 'unverified' or new.stripe_transfers_active is distinct from false then
        raise exception 'Verification and payout status can only be set by the platform.';
      end if;
    else
      if new.verification is distinct from old.verification
         or new.stripe_transfers_active is distinct from old.stripe_transfers_active then
        raise exception 'Verification and payout status can only be changed by the platform.';
      end if;
    end if;
  elsif tg_table_name = 'promoters' then
    if tg_op = 'INSERT' then
      if new.verification is distinct from 'unverified' then
        raise exception 'Verification can only be set by the platform.';
      end if;
    else
      if new.verification is distinct from old.verification then
        raise exception 'Verification can only be changed by the platform.';
      end if;
    end if;
  elsif tg_table_name = 'applications' and tg_op = 'UPDATE' then
    if new.artist_id is distinct from old.artist_id or new.slot_id is distinct from old.slot_id then
      raise exception 'artist_id and slot_id cannot be changed after submission.';
    end if;
  end if;
  return new;
end;
$$;

alter table public.artists drop column stripe_account_id;
alter table public.promoters drop column stripe_customer_id;

-- ---------------------------------------------------------------------------
-- 2. Payment lifecycle
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column dispute_status text check (dispute_status in ('open', 'won', 'lost'));

-- Records an incoming Stripe event once. 'new'/'retry' => go ahead and
-- process; 'duplicate' => already done, acknowledge and stop; 'in_progress'
-- => another delivery is mid-flight, ask Stripe to retry later.
create or replace function public.begin_stripe_event(p_id text, p_type text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_rows integer;
  v_status text;
  v_received timestamptz;
begin
  insert into public.stripe_events (id, type) values (p_id, p_type) on conflict (id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then return 'new'; end if;
  select status, received_at into v_status, v_received from public.stripe_events where id = p_id for update;
  if v_status = 'processed' then return 'duplicate'; end if;
  if v_status = 'failed' or v_received < now() - interval '5 minutes' then
    update public.stripe_events set status = 'processing', error = null, received_at = now() where id = p_id;
    return 'retry';
  end if;
  return 'in_progress';
end;
$$;

create or replace function public.finish_stripe_event(p_id text, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.stripe_events
    set status = case when p_error is null then 'processed' else 'failed' end,
        processed_at = now(), error = p_error
    where id = p_id
$$;

create or replace function public.booking_for_payment(p_payment_intent_id text, p_charge_id text default null)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.bookings
  where stripe_payment_intent_id = p_payment_intent_id
     or (p_charge_id is not null and stripe_charge_id = p_charge_id)
  -- The PaymentIntent match is the stronger one; prefer it if both exist.
  order by (stripe_payment_intent_id = p_payment_intent_id) desc nulls last
  limit 1
$$;

-- Called when the server has created the PaymentIntent for a confirmed booking.
create or replace function public.attach_payment_intent(p_booking_id uuid, p_payment_intent_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found'; end if;
  if v_b.status <> 'confirmed' then raise exception 'booking_not_confirmed'; end if;
  if v_b.payment_status in ('paid', 'partially_refunded', 'refunded', 'disputed') then
    raise exception 'already_paid';
  end if;
  update public.bookings set stripe_payment_intent_id = p_payment_intent_id where id = p_booking_id;
  insert into public.payment_events (booking_id, kind, amount_pence, details)
    values (p_booking_id, 'payment_started', v_b.total_pence, jsonb_build_object('payment_intent', p_payment_intent_id));
end;
$$;

create or replace function public.apply_payment_succeeded(
  p_event_id text, p_occurred timestamptz, p_payment_intent_id text,
  p_booking_id uuid, p_amount_pence integer, p_charge_id text, p_receipt_url text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings;
  v_rows integer;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'payment_unmatched: no booking %', p_booking_id; end if;
  if v_b.stripe_payment_intent_id is distinct from p_payment_intent_id then
    raise exception 'payment_unmatched: PaymentIntent does not belong to this booking';
  end if;
  if p_amount_pence <> v_b.total_pence then
    raise exception 'amount_mismatch: paid % but the agreed total is %', p_amount_pence, v_b.total_pence;
  end if;
  if v_b.status not in ('confirmed', 'cancelled') then
    raise exception 'payment_unmatched: booking is %', v_b.status;
  end if;

  -- The same payment can reach us twice under different ids (the webhook,
  -- and a provider-verified sync when the customer returns to the site):
  -- record it once.
  if exists (select 1 from public.payment_events
             where booking_id = p_booking_id and kind = 'payment_succeeded'
               and details ->> 'payment_intent' = p_payment_intent_id) then
    return;
  end if;
  insert into public.payment_events (booking_id, stripe_event_id, kind, amount_pence, occurred_at, details)
    values (p_booking_id, p_event_id, 'payment_succeeded', p_amount_pence, p_occurred,
            jsonb_build_object('payment_intent', p_payment_intent_id, 'charge', p_charge_id))
    on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if; -- duplicate delivery

  -- Never move a refunded or disputed payment back to "paid".
  if v_b.payment_status in ('unpaid', 'processing', 'failed') then
    update public.bookings
      set payment_status = 'paid', paid_at = coalesce(paid_at, p_occurred),
          stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
          receipt_url = coalesce(p_receipt_url, receipt_url),
          last_payment_event_at = p_occurred,
          -- A payment that lands after a cancellation needs a human decision.
          refund_review_required = refund_review_required or status = 'cancelled'
      where id = p_booking_id;
  else
    update public.bookings
      set stripe_charge_id = coalesce(stripe_charge_id, p_charge_id),
          receipt_url = coalesce(receipt_url, p_receipt_url)
      where id = p_booking_id;
  end if;

  perform public.notify(v_b.promoter_id, 'payment_received',
    'Payment received for ' || v_b.headliner || ': £' || to_char(v_b.total_pence / 100.0, 'FM999,990.00') || '.',
    '/dashboard/promoter', 'paid:' || p_booking_id::text, true);
  perform public.notify(v_b.artist_id, 'payment_received',
    v_b.promoter_company || ' has paid for ' || v_b.headliner || '. £' || to_char((v_b.fee_pence + v_b.travel_pence) / 100.0, 'FM999,990.00')
      || ' is being transferred to your Stripe balance; Stripe then pays it out to your bank on your payout schedule.',
    '/applications', 'paid_a:' || p_booking_id::text, true);
end;
$$;

create or replace function public.apply_payment_processing(
  p_event_id text, p_occurred timestamptz, p_payment_intent_id text, p_booking_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or v_b.stripe_payment_intent_id is distinct from p_payment_intent_id then
    raise exception 'payment_unmatched: PaymentIntent does not belong to this booking';
  end if;
  if v_b.payment_status in ('unpaid', 'failed') then
    update public.bookings set payment_status = 'processing', last_payment_event_at = p_occurred where id = p_booking_id;
  end if;
end;
$$;

create or replace function public.apply_payment_failed(
  p_event_id text, p_occurred timestamptz, p_payment_intent_id text, p_booking_id uuid, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings;
  v_rows integer;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or v_b.stripe_payment_intent_id is distinct from p_payment_intent_id then
    raise exception 'payment_unmatched: PaymentIntent does not belong to this booking';
  end if;
  insert into public.payment_events (booking_id, stripe_event_id, kind, amount_pence, occurred_at, details)
    values (p_booking_id, p_event_id, 'payment_failed', v_b.total_pence, p_occurred,
            jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)))
    on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;
  -- A failed attempt can follow a successful one (retry after success is
  -- impossible, but a late event is not): never downgrade a paid booking.
  if v_b.payment_status in ('unpaid', 'processing', 'failed') then
    update public.bookings set payment_status = 'failed', last_payment_event_at = p_occurred where id = p_booking_id;
    perform public.notify(v_b.promoter_id, 'payment_failed',
      'Your payment for ' || v_b.headliner || ' didn''t go through. You can try again with another card.',
      '/dashboard/promoter', 'payfail:' || p_event_id, true);
  end if;
end;
$$;

-- p_refunded_total is the charge's CUMULATIVE refunded amount, so a late or
-- repeated event can only ever move the figure up.
create or replace function public.apply_refund(
  p_event_id text, p_occurred timestamptz, p_payment_intent_id text, p_charge_id text, p_refunded_total integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.booking_for_payment(p_payment_intent_id, p_charge_id);
  v_b public.bookings;
  v_new integer;
  v_rows integer;
begin
  if v_id is null then raise exception 'payment_unmatched: no booking for this charge'; end if;
  select * into v_b from public.bookings where id = v_id for update;
  v_new := greatest(v_b.refunded_pence, least(p_refunded_total, v_b.total_pence));
  insert into public.payment_events (booking_id, stripe_event_id, kind, amount_pence, occurred_at, details)
    values (v_id, p_event_id, 'refunded', v_new - v_b.refunded_pence, p_occurred,
            jsonb_build_object('refunded_total', v_new))
    on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;
  update public.bookings
    set refunded_pence = v_new,
        payment_status = case when v_new >= total_pence then 'refunded'
                              when v_new > 0 then 'partially_refunded' else payment_status end,
        last_payment_event_at = p_occurred
    where id = v_id;
  if v_new > v_b.refunded_pence then
    perform public.notify(v_b.promoter_id, 'refund',
      '£' || to_char((v_new - v_b.refunded_pence) / 100.0, 'FM999,990.00') || ' was refunded for ' || v_b.headliner || '.',
      '/dashboard/promoter', 'refund_p:' || p_event_id, true);
    perform public.notify(v_b.artist_id, 'refund',
      'A refund was issued for ' || v_b.headliner || ' (' || v_b.promoter_company || ').',
      '/applications', 'refund_a:' || p_event_id, true);
  end if;
end;
$$;

-- phase: 'opened' | 'won' | 'lost'. Only ever moves forward (open -> won/lost).
create or replace function public.apply_dispute(
  p_event_id text, p_occurred timestamptz, p_payment_intent_id text, p_charge_id text,
  p_phase text, p_amount_pence integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.booking_for_payment(p_payment_intent_id, p_charge_id);
  v_b public.bookings;
  v_rows integer;
begin
  if v_id is null then raise exception 'payment_unmatched: no booking for this charge'; end if;
  if p_phase not in ('opened', 'won', 'lost') then raise exception 'bad_phase'; end if;
  select * into v_b from public.bookings where id = v_id for update;
  insert into public.payment_events (booking_id, stripe_event_id, kind, amount_pence, occurred_at, details)
    values (v_id, p_event_id,
            case p_phase when 'opened' then 'dispute_opened' when 'won' then 'dispute_won' else 'dispute_lost' end,
            p_amount_pence, p_occurred, '{}')
    on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;

  if p_phase = 'opened' then
    if v_b.dispute_status is null then
      update public.bookings set dispute_status = 'open',
        payment_status = case when payment_status = 'refunded' then payment_status else 'disputed' end,
        last_payment_event_at = p_occurred where id = v_id;
      perform public.notify(v_b.promoter_id, 'dispute', 'A payment for ' || v_b.headliner || ' has been disputed with the card issuer.', '/dashboard/promoter', 'dispute_p:' || v_id::text, true);
      perform public.notify(v_b.artist_id, 'dispute', 'The payment for ' || v_b.headliner || ' has been disputed with the card issuer. We''ll let you know the outcome.', '/applications', 'dispute_a:' || v_id::text, true);
    end if;
  elsif v_b.dispute_status is distinct from 'won' and v_b.dispute_status is distinct from 'lost' then
    update public.bookings
      set dispute_status = p_phase,
          payment_status = case
            when p_phase = 'won' and refunded_pence >= total_pence then 'refunded'
            when p_phase = 'won' and refunded_pence > 0 then 'partially_refunded'
            when p_phase = 'won' then 'paid'
            else 'disputed' end,
          last_payment_event_at = p_occurred
      where id = v_id;
  end if;
end;
$$;

create or replace function public.record_transfer_reversal(p_key text, p_booking_id uuid, p_amount_pence integer, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.payment_events (booking_id, stripe_event_id, kind, amount_pence, details)
    values (p_booking_id, p_key, 'transfer_reversed', p_amount_pence, jsonb_build_object('note', left(coalesce(p_note, ''), 300)))
    on conflict (stripe_event_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Support+ entitlement
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column support_plus_status text,
  add column support_plus_current_period_end timestamptz,
  add column support_plus_cancel_at_period_end boolean not null default false,
  add column support_plus_event_at timestamptz;

create or replace function public.prevent_client_support_plus_change()
returns trigger language plpgsql security definer as $$
begin
  if (
    new.is_support_plus is distinct from old.is_support_plus
    or new.support_plus_billing_period is distinct from old.support_plus_billing_period
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.support_plus_status is distinct from old.support_plus_status
    or new.support_plus_current_period_end is distinct from old.support_plus_current_period_end
    or new.support_plus_cancel_at_period_end is distinct from old.support_plus_cancel_at_period_end
    or new.support_plus_event_at is distinct from old.support_plus_event_at
  ) and auth.role() = 'authenticated' then
    raise exception 'Support+ status can only be changed by the billing system.';
  end if;
  return new;
end;
$$;

-- Entitlement policy (a product decision, written down here on purpose):
--   active, trialing -> Support+ on.
--   past_due         -> stays ON while Stripe retries the failed payment
--                       (the promoter is told and shown a banner); it ends
--                       when Stripe gives up and moves the subscription to
--                       unpaid or canceled. Set Stripe's retry rules to a
--                       window you're comfortable giving free access for.
--   canceled, unpaid, incomplete, incomplete_expired, paused -> OFF.
--   Cancelling in the billing portal keeps access until the paid period ends
--   (status stays active with cancel_at_period_end = true).
-- Core marketplace features never depend on this flag.
create or replace function public.support_plus_entitled(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('active', 'trialing', 'past_due')
$$;

create or replace function public.apply_subscription_state(
  p_event_id text, p_occurred timestamptz, p_promoter_id uuid, p_subscription_id text,
  p_status text, p_period_end timestamptz, p_cancel_at_period_end boolean, p_billing_period text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_p public.profiles;
  v_entitled boolean := public.support_plus_entitled(p_status);
  v_is_current boolean;
begin
  select * into v_p from public.profiles where id = p_promoter_id for update;
  if not found or v_p.role <> 'promoter' then raise exception 'subscription_unmatched: not a promoter account'; end if;
  -- Stale (out-of-order) event: a newer one has already been applied.
  if v_p.support_plus_event_at is not null and p_occurred < v_p.support_plus_event_at then return; end if;
  v_is_current := v_p.stripe_subscription_id is null or v_p.stripe_subscription_id = p_subscription_id;

  -- The end of an OLD subscription must not revoke a newer one.
  if not v_is_current and not v_entitled then return; end if;

  update public.profiles
    set is_support_plus = v_entitled,
        support_plus_status = p_status,
        support_plus_billing_period = case when v_entitled then coalesce(p_billing_period, support_plus_billing_period) else support_plus_billing_period end,
        support_plus_current_period_end = p_period_end,
        support_plus_cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
        stripe_subscription_id = case when v_entitled then p_subscription_id else null end,
        support_plus_event_at = p_occurred
    where id = p_promoter_id;

  if p_status = 'past_due' and v_p.support_plus_status is distinct from 'past_due' then
    perform public.notify(p_promoter_id, 'subscription',
      'Your Support+ payment failed. Update your payment method in billing to keep Support+ — we''ll keep it on while the payment is retried.',
      '/support-plus', 'sub_pastdue:' || p_subscription_id || ':' || coalesce(extract(epoch from p_period_end)::bigint::text, ''), true);
  elsif not v_entitled and v_p.is_support_plus then
    perform public.notify(p_promoter_id, 'subscription',
      'Your Support+ subscription has ended. Your roster and templates are kept; adding to them needs Support+ again.',
      '/support-plus', 'sub_end:' || p_subscription_id, true);
  elsif v_entitled and not v_p.is_support_plus then
    perform public.notify(p_promoter_id, 'subscription', 'Support+ is active.', '/support-plus',
      'sub_on:' || p_subscription_id || ':' || p_event_id, false);
  end if;
end;
$$;

-- Server-only functions.
do $$
declare
  f text;
begin
  foreach f in array array[
    'begin_stripe_event(text, text)', 'finish_stripe_event(text, text)',
    'booking_for_payment(text, text)', 'attach_payment_intent(uuid, text)',
    'apply_payment_succeeded(text, timestamptz, text, uuid, integer, text, text)',
    'apply_payment_processing(text, timestamptz, text, uuid)',
    'apply_payment_failed(text, timestamptz, text, uuid, text)',
    'apply_refund(text, timestamptz, text, text, integer)',
    'apply_dispute(text, timestamptz, text, text, text, integer)',
    'record_transfer_reversal(text, uuid, integer, text)',
    'apply_subscription_state(text, timestamptz, uuid, text, text, timestamptz, boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- Email outbox worker support: claims a batch so two overlapping runs can't
-- send the same email twice. A claim older than 5 minutes (a crashed run) is
-- reclaimable; after 5 attempts a row stops being retried.
create or replace function public.claim_email_outbox(p_limit integer default 20)
returns setof public.email_outbox language sql security definer set search_path = public as $$
  update public.email_outbox
    set attempts = attempts + 1, claimed_at = now()
  where id in (
    select id from public.email_outbox
    where status = 'pending' and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by created_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  returning *
$$;
revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;
