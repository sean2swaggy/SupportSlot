# Support Slot — project guide for Claude Code

Read this before making changes. `README.md` has setup and the test commands;
`docs/CURRENT_STATE.md` says what is and isn't verified.

## What this is

A UK marketplace connecting independent artists with promoters posting
"support slot" (opening act) listings. A **native iOS app** (SwiftUI, iOS 17+,
`@Observable`, no third-party packages) that talks directly to **Supabase**
(Auth with email confirmation by 6-digit code and password-only sign-in, Postgres + RLS, SQL functions). There is no
server of our own; `web/` is a sample-data web companion (Vite + React, see
`web/README.md`) not yet wired to Supabase. **No money passes through the platform** —
the promoter pays the artist directly; there is no payment provider, fee or
subscription, and every promoter has the promoter tools.

```
npm test                                   # DB tests: real migrations in PGlite
xcodebuild -project SupportSlot/SupportSlot.xcodeproj -scheme SupportSlot \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test   # Swift tests
node scripts/make-app-config.mjs           # Secrets.xcconfig from .env.local
```

Both test suites and a clean `build` must pass before calling anything done.

## The rules of this codebase

1. **The database is the authority.** State changes (application → offer →
   booking, listing close/cancel/reschedule, notifications) are SQL functions in
   `supabase/migrations/0001_initial_schema.sql` and `0002_app_functions.sql`.
   They lock rows in a fixed order (slot → application → other applications),
   check who is asking and what state things are in, and are idempotent.
   Clients have **no** direct UPDATE on `applications`/`bookings`. The app calls
   them through `Backend/Actions.swift`; `AppStore.perform {}` always re-reads
   server state after a write. Never show success before the server said so.
2. **Money is integer pence**, computed in SQL (`make_offer`) and stored on the
   `bookings` row as a snapshot (`fee_pence` + `travel_pence` only).
   The app shows the DB-computed terms (`terms_preview`) and never sends an
   amount for an offer. The old Swift-vs-SQL travel parity test was removed
   because the travel rule now lives only in SQL (`tests/db/uk-locations.test.ts`).
3. **No invented numbers.** There is no match percentage. `Logic/Fit.swift`
   explains genre/location/size fit from real fields.
4. **Access is decided in one place per layer.** The database enforces RLS (a
   signed-in, non-suspended account on every table, migration 0007); the app's
   `AppStore` phase order (needsConfig → signedOut → onboarding → suspended →
   ready) gates what is shown. Sign-in is **password-only**: there is no
   two-factor step (removed on request in 0007). Email is confirmed with a
   6-digit code typed into the app. Anyone with the password has the account.
5. **Schema/code drift fails a test.** `tests/db/swift-contract.test.ts` reads
   the Swift sources and checks every column list (`static let …Columns` under a
   `// table: x` tag, `Query("table", …)`), filter, embed relationship, write
   payload key and `rpc("name", [args])` against the schema built from the
   migrations. When you add a column or function, put it in a migration (a new
   numbered file once a project has the old ones) and tag new row structs with
   `// table: x`. Payloads built away from the call go in `REGIONS` in that test.
6. **Staff tables are role-checked in SQL.** `admin_*`/`staff_*` functions check
   the role and write an audit row. There is no way to become staff from the
   app (set `profiles.admin_role` by hand in SQL).
7. **Secrets.** Only the project host and public anon key go in the app
   (`Secrets.xcconfig`, gitignored). The service-role key lives in `.env.local`
   for scripts and must never reach the app or the repo.

## App structure

`App/AppStore.swift` is the single observable store (current user/role,
profiles, applications, bookings, threads, notifications, saved gigs). It
reloads on foreground and every 45 s; if the initial load fails it shows a
retry screen — never an empty dashboard. `Backend/` is our own small Supabase
client (`Transport`, `AuthService`, `Database`/`Query`); `Database` retries once
after a token refresh on 401. Images are resized JPEG data URLs under 2,000,000
characters, stored in text columns.

## Testing layers

- `SupportSlotTests/` — XCTest with `StubURLProtocol` (no network): query
  encoding, JSON, error mapping, JWT, auth (single-flight refresh, email code), logic.
- `tests/db/*.test.ts` — real migrations in PGlite with stubbed Supabase
  auth/roles: RLS, triggers, the state machine, rate limits, deletion, search,
  app functions, the Swift contract and the UK-location/travel rules. Single connection — it
  cannot prove concurrent behaviour.
- `scripts/live-journey.mjs`, `scripts/security-regression.mjs` — live checks
  against the configured Supabase project (synthetic users, cleaned up).

## Gotchas

- Show dates are UK calendar dates (`YYYY-MM-DD`); use `Logic/UKDates.swift`
  (`londonToday`, …), never a `Date` from an ISO date for day maths.
- Schedule entry times are naive local strings (`start_at`/`end_at`), not
  timestamps.
- xcconfig treats `//` as a comment, so `SUPABASE_HOST` has no `https://`.
- No nested interactive controls inside a `NavigationLink` row; use a sibling
  actions block.
- On macOS `sed -i` needs `-i ''`; quote `--include='*.swift'` in zsh.
- Offer expiry, cancellation reasons, the 7-day offer window and the £10
  long-journey minimum are in SQL — change them there and in the matching
  test, not in the UI.
