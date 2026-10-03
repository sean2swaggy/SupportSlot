# Support Slot

**Find your next stage.** A UK marketplace where independent artists find and
apply for support (opening-act) slots, and promoters post listings, choose an
act, and pay them through Stripe.

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Auth + Postgres + RLS) · Stripe (PaymentIntents, Connect, Billing).

See `CLAUDE.md` for the architecture rules and `docs/COMPLETION_REPORT.md` for
what is implemented, what has been verified, and what is still to do before
going live.

---

## 1. Run it locally

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests and the in-process Postgres tests. No network. |
| `npx tsc --noEmit` | Type check. |
| `npm run lint` | ESLint. |
| `npm run build` | Production build (must be clean). |
| `node scripts/security-regression.mjs` | Live negative tests against the Supabase project in `.env.local` (needs migrations applied; creates and deletes synthetic users; Stripe stays in test mode). |

### Environment variables (names only — never commit values)

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Public anon key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Webhooks, payments, cron, account deletion, support inbox |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | browser | Stripe.js |
| `STRIPE_SECRET_KEY` | **server only** | Stripe API (use a `sk_test_…` key until launch) |
| `STRIPE_WEBHOOK_SECRET` | **server only** | Verifies webhook signatures |
| `NEXT_PUBLIC_SITE_URL` | server | Canonical origin for Stripe return URLs and emails |
| `CRON_SECRET` | **server only** | Bearer token the scheduler sends to `/api/cron/*` |
| `RESEND_API_KEY`, `EMAIL_FROM` | **server only** | Optional. Without them the email outbox stays `pending`/`skipped` and nothing claims to have been sent. |

## 2. Database

Migrations live in `supabase/migrations/` and are applied **in order** in the
Supabase SQL editor (there is no CLI in this setup): `0001` … `0023`.
`0020`–`0023` are the marketplace core (offer/booking state machine, payments
and billing, staff tools, privacy). Each file is safe to run once; if one
fails nothing in that file is applied (fix and re-run it).

Create the first staff member by hand (there is deliberately no in-app way):

```sql
update public.profiles set admin_role = 'admin' where email = 'you@example.com';
```

`moderator` can handle reports/support/listings/users; only `admin` sees
payments and can set verification.

## 3. Stripe

* **Webhook endpoint:** `https://<site>/api/stripe/webhooks` with events
  `payment_intent.processing`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `charge.refunded`,
  `charge.dispute.created`, `charge.dispute.closed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`.
* **Connect:** artists onboard through Stripe-hosted onboarding (recipient
  accounts, GB). Bookings are destination charges: the artist receives fee +
  travel in full; the platform keeps the booking fee and the processing line.
* **Billing:** Support+ is a promoter subscription (Checkout + customer
  portal). Enable cancellation and payment-method updates in the portal
  settings, and turn on Smart Retries / failed-payment emails in Stripe.
* Refunds are issued from the Stripe Dashboard by an admin; the webhook records
  them. Cancelled-after-payment bookings are flagged for review in `/admin`.

## 4. Scheduled jobs

Call these with `Authorization: Bearer $CRON_SECRET`:

* `GET /api/cron/expire-offers` — expires offers past their deadline (every
  15–60 min).
* `GET /api/cron/send-emails` — sends the pending notification-email outbox
  via the configured provider (every 5–10 min). Without a provider it marks
  nothing as sent.

(Vercel Hobby only allows daily crons; use Vercel Pro, GitHub Actions or
another scheduler for these intervals.)

## 5. How the money and states work

`submitted → viewed → shortlisted → offered → confirmed` (or `declined`,
`offer_declined`, `withdrawn`, `cancelled`). A promoter's offer stores the
agreed terms in integer pence; only the artist accepting makes it a booking
(one confirmed booking per slot is enforced by a unique index); payment is a
separate state (`unpaid → processing → paid → partially_refunded/refunded`,
`failed`, `disputed`) changed only by verified Stripe events. Support Slot is
not an escrow.

## 6. Project layout

```
src/app/              pages and API routes
src/components/       UI (bookings/, listings/, discovery/, layout/, …)
src/lib/              store, queries, actions, fit, dates, routes, stripe/, server/
supabase/migrations/  the schema, in order
tests/db/             real-migration Postgres tests (PGlite)
scripts/              live security regression script
ios/, capacitor.config.ts   Capacitor iOS shell around the deployed site
```
