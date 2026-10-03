# Support Slot — project guide for Claude Code

Read this before making changes. `README.md` has setup, env vars, the
migration/deploy runbook and the test strategy.

## What this is

A UK marketplace connecting independent artists with promoters posting
"support slot" (opening act) listings. Next.js 16 App Router (middleware is
named `proxy` in v16 — see `node_modules/next/dist/docs`), React 19,
TypeScript, Tailwind v4, **Supabase** (Auth with mandatory TOTP 2FA, Postgres
+ RLS, SQL functions) and **Stripe** (PaymentIntents + Connect for artist
payouts, Billing for Support+).

```
npm install
npm run dev        # http://localhost:3000
npm test           # vitest: unit tests + in-process Postgres tests (no network)
npm run lint
npx tsc --noEmit
npm run build      # must be clean before calling anything done
```

## The rules of this codebase

1. **The database is the authority.** State changes (application → offer →
   booking → payment, listing close/cancel/reschedule, notifications) are SQL
   functions in `supabase/migrations/0021_booking_functions.sql` /
   `0022_payments_and_billing.sql`. They lock rows in a fixed order
   (slot → application → other applications), check who is asking and what
   state things are in, and are idempotent. Clients have **no** direct
   UPDATE on `applications`/`bookings`; the UI calls the wrappers in
   `src/lib/actions.ts`, which return a `Result` — callers must look at it.
   Never show success before the server said so.
2. **Money is integer pence**, computed in SQL (`make_offer`) and stored on
   the `bookings` row as a snapshot. `src/lib/stripe/fees.ts` only previews;
   `tests/db/fees-parity.test.ts` proves it matches SQL. The browser never
   sends an amount. A booking is "paid" only via the verified webhook
   (`src/lib/stripe/webhook-handler.ts` → SQL) or the provider-verified sync
   route — never because a page loaded.
3. **No invented numbers.** There is no match percentage. `src/lib/fit.ts`
   explains genre/location/size fit from real fields. Support+ never affects
   who is shown or booked.
4. **Access control is one pure function**, `decideAccess` in
   `src/lib/routes.ts`, used by the proxy (`src/proxy.ts` →
   `src/lib/supabase/middleware.ts`, the real enforcement) and mirrored by
   the client shell (`AppGate.tsx`). Add routes to the tables in `routes.ts`
   and its test. `next` redirects only go through `safeNextPath`
   (`src/lib/redirect.ts`).
5. **Schema/code drift fails a test.** `tests/db/query-contract.test.ts`
   checks every `.from().select/insert/update` column and every `.rpc()`
   name/argument in `src/` against the schema built from the migrations. If
   you add a column or function, add it to a migration, not just the code.
6. **Staff and payment tables are service-role only.** Stripe ids live in
   private tables; `admin_*`/`staff_*` functions check role in SQL and write
   an audit row. There is no way to become staff from the app (set
   `profiles.admin_role` by hand in SQL).

## Client state

`src/lib/store.tsx` is a React Context over Supabase (`useStore()`): current
user/role, artist/promoter profile, applications, bookings, message threads,
notifications, saved gigs. It reloads on tab focus and every 45 s. Mutators
return `Result` and refresh from the server rather than guessing. If the
initial load fails, `loadError` is set and `AppGate` shows a retry screen —
never an empty dashboard.

## Testing layers

- `src/lib/*.test.ts` — pure logic (fit, dates, fees, routes, redirect, listing
  validation, profile checklist, email sender, webhook idempotency…).
- `tests/db/*.test.ts` — **real migrations in PGlite** with stubbed Supabase
  auth/roles: RLS, triggers, the state machine, payments, subscriptions,
  rate limits, deletion, search. Single-connection: it cannot prove
  concurrent behaviour.
- `scripts/security-regression.mjs` — live negative tests against the
  configured Supabase project (creates and deletes synthetic users).
- Stripe in tests is faked at the `WebhookDeps` boundary; a real test-mode
  payment needs a connected test account and is a manual step.

## Gotchas

- `react-hooks/purity`: no `new Date()`/`Date.now()` during render — use a
  lazy `useState(() => ...)` initializer or an event handler.
- `react-hooks/set-state-in-effect`: derive state instead of `setState` in an
  effect; reset modal state with a `key` from the parent.
- No nested interactive elements inside `<Link>`; use a wrapper with a link
  plus a sibling actions block (`SlotCard` + `SaveGigButton`).
- Show dates are UK calendar dates (`YYYY-MM-DD`); use `src/lib/dates.ts`
  (`londonToday`, …), never `new Date(isoDate)` for day maths.
- `useSearchParams` needs a `<Suspense>` boundary or the build fails.
- Design tokens live in `src/app/globals.css` (`@theme inline`); fonts are
  self-hosted via `@fontsource/*`.
- On macOS `sed -i` needs `-i ''`.
- The offer expiry, cancellation reasons, 7-day offer window and fee rules are
  in SQL — change them there and in the matching test, not in the UI.
