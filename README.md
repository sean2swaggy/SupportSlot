# Support Slot

**Find your next stage.** A UK marketplace where independent artists find and
apply for support (opening-act) slots, and promoters post listings and choose
an act.

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Auth + Postgres + row-level security).

**Support Slot handles no money.** An offer records the fee and travel the
promoter and artist agreed; once the artist accepts, the promoter pays them
directly. There is no payment provider, booking fee, payout or subscription.
Artists never pay to apply or perform.

See `CLAUDE.md` for the architecture rules.

---

## 1. Run it locally

```bash
npm install
cp .env.example .env.local   # fill in the Supabase values below
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests and the in-process Postgres tests. No network. |
| `npx tsc --noEmit` | Type check. |
| `npm run lint` | ESLint. |
| `npm run build` | Production build (must be clean). |
| `node scripts/seed-dev-fixtures.mjs` | Fictional demo accounts and data for a **test** project (see §3). |
| `node scripts/live-journey.mjs` | Live end-to-end + concurrency check against the project in `.env.local` (synthetic users, cleaned up). |
| `node scripts/security-regression.mjs` | Live negative tests against the same project. |

### Environment variables (names only — never commit values)

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Public anon key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Account deletion, support inbox, rate limiter, cron, fixtures |
| `NEXT_PUBLIC_SITE_URL` | server | Canonical origin used in emails |
| `CRON_SECRET` | **server only** | Bearer token the scheduler sends to `/api/cron/*` |
| `RESEND_API_KEY`, `EMAIL_FROM` | **server only** | Optional. Without them the email outbox stays `pending` and nothing claims to have been sent. |

## 2. Database

The whole schema is **one file**: `supabase/migrations/0001_initial_schema.sql`.

1. Create a new (free) Supabase project — use a separate one for testing.
2. Dashboard → SQL Editor → paste the file → Run. It is meant for an empty
   project and is applied as one transaction: if anything fails, nothing is
   applied (fix the error and run it again).
3. Copy the project URL and the anon and service-role keys into `.env.local`.

The tests apply this same file to an in-process Postgres (PGlite), so what you
paste is exactly what is tested.

Create the first staff member by hand (there is deliberately no in-app way):

```sql
update public.profiles set admin_role = 'admin' where email = 'you@example.com';
```

`moderator` can handle reports, support requests, listings and users; only
`admin` sees the bookings list and can set verification.

Future changes go in new numbered files (`0002_…sql`), never by editing the
first one once it has been applied to a real project.

## 3. Demo data (test projects only)

```bash
SEED_CONFIRM_PROJECT_REF=<your project ref> node scripts/seed-dev-fixtures.mjs
```

Creates clearly fictional accounts (two artists, two promoters, an admin, plus
extra artists), nine listings (open, tonight, closed, cancelled, filled),
applications at every stage, pending offers, a confirmed booking,
conversations, saved gigs and a report — all through the real SQL functions.
Re-running adds nothing twice; `--reset` removes the fixture rows. Logins and
authenticator secrets are written to `.dev-fixtures/` (gitignored); get a 2FA
code with `node scripts/totp.mjs artist`.

## 4. Scheduled jobs

Call these with `Authorization: Bearer $CRON_SECRET`:

* `GET /api/cron/expire-offers` — expires offers past their deadline (every
  15–60 min).
* `GET /api/cron/send-emails` — sends the pending notification-email outbox
  via the configured provider (every 5–10 min). Without a provider it marks
  nothing as sent.

(Vercel Hobby only allows daily crons; use Vercel Pro, GitHub Actions or
another scheduler for these intervals.)

## 5. How the states work

`submitted → viewed → shortlisted → offered → confirmed` (or `declined`,
`offer_declined`, `withdrawn`, `cancelled`). A promoter's offer stores the
agreed fee and travel in integer pence; only the artist accepting makes it a
booking (one confirmed booking per slot is enforced by a unique index). Offers
expire (at most 7 days) and go back to the shortlist.

## 6. Promoter tools

Every promoter has: a private artist roster (notes and tags), availability
requests and request templates, a show-schedule builder, gig invitations, and a
CSV export of their bookings. They are private to the owning promoter and
never visible to — or affecting — artists.

## 7. Project layout

```
src/app/              pages and API routes
src/components/       UI (bookings/, listings/, discovery/, layout/, …)
src/lib/              store, queries, actions, fit, dates, routes, server/, supabase/
supabase/migrations/  the schema (one file)
tests/db/             real-schema Postgres tests (PGlite)
scripts/              live checks and demo-data scripts
ios/, capacitor.config.ts   Capacitor iOS shell around the deployed site
```
