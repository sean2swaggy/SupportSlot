-- Support Slot — replace the pre-Stripe fake wallet system with real Stripe
-- plumbing on both sides:
--
-- Artists already get paid for real the moment a booking's PaymentIntent
-- succeeds (destination charge, transfer_data.destination — see
-- 0008_real_payments.sql and src/app/api/stripe/payments/create-intent).
-- Stripe itself then pays that out to the artist's bank on its own schedule.
-- The old "$cashtag payout code, promoter manually sends an amount" wallet
-- (wallet_transactions, artists.payout_code) never moved real money and now
-- just duplicates/confuses what real bookings already do — dropped entirely.
--
-- Promoters get a real Stripe Customer so a saved card can be reused for
-- faster checkout on their next booking (no held balance — every booking is
-- still its own individual charge, so this doesn't touch e-money territory).

drop table if exists public.wallet_transactions;

alter table public.artists drop column if exists payout_code;

alter table public.promoters add column stripe_customer_id text unique;
