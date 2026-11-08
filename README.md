# Support Slot

**Find your next stage.** A UK marketplace where independent artists find and
apply for support (opening-act) slots, and promoters post listings and choose
an act.

This repository is a **native iOS app** (SwiftUI, iOS 17+, no third-party
packages) that talks straight to **Supabase** (Auth with email confirmation by a typed code,
Postgres, row-level security, SQL functions). There is no server of our own; `web/` is a small
sample-data web companion (see `web/README.md`) with no backend yet.

**Support Slot handles no money.** An offer records the fee and travel the
promoter and artist agreed; once the artist accepts, the promoter pays them
directly. There is no booking fee or payout. Two optional extras are sold by Apple
in-app purchase: the artist Gig diary (once) and the promoter Team plan
(monthly/yearly); free promoters get one open listing. Notifications are in-app only (no
email or push).

See `CLAUDE.md` for the rules the codebase follows and `docs/CURRENT_STATE.md`
for what has and hasn't been verified.

## Layout

```
SupportSlot/                 Xcode project (SupportSlot.xcodeproj) and sources
  SupportSlot/Backend/       Supabase client: auth, REST/RPC, queries, actions
  SupportSlot/Models/        Decodable rows, catalog (cities, genres, sizes)
  SupportSlot/Logic/         Pure logic: dates, money, travel, fit, validation
  SupportSlot/Design/        Theme, components, images, logo
  SupportSlot/App/           AppStore (state), root view, tab shells
  SupportSlot/Features/      Screens by area (Auth, Discover, Promoter, Staff…)
  SupportSlotTests/          XCTest unit tests (stubbed network)
  Config/                    Base.xcconfig, Secrets.example.xcconfig, Info.plist
supabase/migrations/         0001–0009: schema, app functions, session security, UK locations, data export, function search paths, password-only sign-in (0008/0009: a phone option added then removed again)
supabase/sql-editor/         the same files, for pasting into the Supabase SQL editor
tests/db/                    Postgres tests: real migrations in-process (PGlite)
scripts/                     Live checks and demo-data scripts (Node)
docs/                        CURRENT_STATE.md and archived planning docs
```

## Set it up

1. **Create a Supabase project** (a separate one for testing is wise).
2. Dashboard → SQL Editor: run the nine files in `supabase/sql-editor/`
   (`0001` through `0009`), one at a time, in order, once each, on an empty
   project (see `supabase/sql-editor/README.txt`). They are exact copies of
   `supabase/migrations/`. Future changes go in new numbered files.
3. Dashboard → Authentication → URL Configuration: add the redirect URL
   `supportslot://auth-callback`. Decide whether new accounts must confirm
   their email (Authentication → Providers → Email); the app handles both.
4. Copy `.env.example` to `.env.local` and fill in the project URL, anon key
   and service-role key.
5. Generate the app's config (anon key only; the service-role key never goes
   near the app):

   ```bash
   npm install
   node scripts/make-app-config.mjs     # writes SupportSlot/Config/Secrets.xcconfig (gitignored)
   ```
6. Open `SupportSlot/SupportSlot.xcodeproj` in Xcode and run on a simulator —
   or from the command line:

   ```bash
   xcodebuild -project SupportSlot/SupportSlot.xcodeproj -scheme SupportSlot \
     -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
   ```

   Without a project configured the app shows a "set-up required" screen
   instead of a broken login.

The first staff member is made by hand (there is deliberately no way to
become staff from the app):

```sql
update public.profiles set admin_role = 'admin' where email = 'you@example.com';
```

`moderator` can handle reports, support requests, listings and users; only
`admin` sees the bookings list and can set verification.

## Test it

| Command | What it does |
|---|---|
| `npm test` | Database tests: the real migrations in an in-process Postgres, including the Swift ↔ schema contract and the UK-location and travel rules. No network. |
| `xcodebuild … test` (same command, `test` instead of `build`) | Swift unit tests with a faked network. |
| `node scripts/live-journey.mjs` | Live end-to-end and concurrency check against the project in `.env.local` (synthetic users, cleaned up). |
| `node scripts/security-regression.mjs` | Live negative tests against the same project. |

### Demo data (test projects only)

```bash
SEED_CONFIRM_PROJECT_REF=<your project ref> node scripts/seed-dev-fixtures.mjs
```

Creates clearly fictional accounts (artists, promoters, an admin), listings in
every state, applications at every stage, offers, a confirmed booking,
conversations, saved gigs and a report — through the real SQL functions.
Re-running adds nothing twice; `--reset` removes the fixture rows. Logins and
passwords go to `.dev-fixtures/` (gitignored).

## How the states work

`submitted → viewed → shortlisted → offered → confirmed` (or `declined`,
`offer_declined`, `withdrawn`, `cancelled`). An offer stores the agreed fee and
travel in integer pence; only the artist accepting makes it a booking (one
confirmed booking per slot is enforced by a unique index). Offers expire (at
most 7 days) and return to the shortlist — the app asks the database to expire
stale offers when it opens and refreshes, since there is no scheduler (you can
also schedule `expire_stale_offers()` with pg_cron).

## Promoter tools

Every promoter has a private artist roster (notes and tags), availability
requests and request templates, a show-schedule builder, gig invitations and a
CSV export of their bookings. They are private to the owning promoter and never
affect who artists see or who is booked.
