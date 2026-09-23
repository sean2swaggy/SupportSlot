-- Support Slot — Stripe Connect account linkage for artists (recipient
-- accounts, per the Connect recommendation: dashboard=express,
-- fees_collector=application, losses_collector=application, destination
-- charges). Nothing here processes real payments yet — this just gives
-- each artist a place to store their connected-account id and whether
-- they're ready to receive real transfers.

alter table public.artists
  add column stripe_account_id text unique,
  add column stripe_transfers_active boolean not null default false;

-- Artists can read/update their own Stripe linkage fields — already covered
-- by the existing "artists: update own" policy (id = auth.uid()), no new
-- policy needed. Promoters/public still can't see stripe_account_id since
-- it's just another column on a publicly-selectable row (not sensitive on
-- its own — it's an opaque Stripe id, not a secret).
