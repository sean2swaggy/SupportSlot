# Support Slot — Current State

_Updated 7 October 2026, branch `rebuild/no-payments`. Supersedes the 5 October version, which described the Stripe-based build._

Support Slot is a UK marketplace connecting independent artists with promoters who post support (opening-act) slots. **It handles no money.** An offer records the fee and travel the two sides agreed; once the artist accepts, the promoter pays them directly. There is no payment provider, booking fee, payout, refund, dispute or subscription anywhere in the code or schema.

## What changed in this rebuild

| Removed | Replaced by |
|---|---|
| Stripe (PaymentIntents, Connect payouts, Billing, webhooks), the pay/payout/receipt UI, `/api/stripe/*`, `/api/bookings/*` | Nothing — payment is between promoter and artist. Copy on Terms, Privacy, Trust, the home page and booking screens says so. |
| Support+ subscription, `/support-plus`, pricing, entitlement checks | The roster, request templates, availability requests, show schedule and bookings CSV are open to **every promoter**, still private to the owner. |
| Booking fee, card-processing line, totals, payment status, refund/dispute flags | A booking stores only `fee_pence` and `travel_pence` (the agreed terms, as a snapshot). |
| 24 incremental migrations | **One file**, `supabase/migrations/0001_initial_schema.sql`, generated from the final schema and checked to be identical to the old chain. Unused storage buckets were not carried over (the app never used them). |
| `/admin` "Payments" tab | "Bookings" tab (admin only): the agreed terms of recent bookings. |

Everything else is kept: accounts with mandatory TOTP 2FA, onboarding, artist profiles, public discovery with filters, saved gigs, honest fit explanation (no match percentages), listing create/preview/edit/close/cancel/reschedule, applications and the offer → accept → booking state machine, messaging, notifications, report/block, admin and support tools, account export/deletion, the iOS shell, and the design system.

## Verification status

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (87 pre-existing warnings) |
| `npm test` | 165 tests pass (the real schema in an in-process Postgres) |
| `npm run build` | clean |
| Signed-out pages in a real browser (home, trust, terms, login) | rendered; removed routes redirect/404 |
| Applied to a real Supabase project | **not yet** — needs a new project (see below) |
| Signed-in flows in a browser; concurrency script; demo-data script | **not yet run** — they need the schema applied to a project |

## To go from here to a working app

1. Create a new (free) Supabase project.
2. Paste `supabase/migrations/0001_initial_schema.sql` into its SQL editor and run it.
3. Put its URL, anon key and service-role key into `.env.local`.
4. `node scripts/live-journey.mjs` and `node scripts/security-regression.mjs` (synthetic users), then
   `SEED_CONFIRM_PROJECT_REF=<ref> node scripts/seed-dev-fixtures.mjs` for demo data, and `npm run dev`.

## Known gaps and decisions still open

- Email sending needs a provider (`RESEND_API_KEY`, `EMAIL_FROM`); without one nothing is sent or reported sent. Supabase Auth email (confirmation / reset) depends on that project's own SMTP settings.
- Nothing schedules `/api/cron/expire-offers` and `/api/cron/send-emails`.
- Venue photos are `picsum.photos` placeholders (allowed in the CSP for images only); user uploads are stored as resized data URLs.
- Past shows exist in the schema with no editor; there is no press kit; the live video is a link only.
- No browser end-to-end tests and no accessibility audit yet.
- Terms, Privacy and Trust text has not been reviewed by a lawyer.
- The iOS shell points at `localhost` by default; no production URL, signing or store listing.
- A platform fee or paid tier would be a new product decision; none exists.
