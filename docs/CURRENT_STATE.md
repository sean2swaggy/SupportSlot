# Support Slot — Current State (7 Nov 2026, branch `app/native-ios`)

## Live project
Connected to Supabase project `bctbiiukydckunfsqjxv` (migrations 0001–0005 applied by hand in the SQL editor on 7 Nov 2026). `SupportSlot/Config/Secrets.xcconfig` and `.env.local` point at it. The service-role key in `.env.local` is still the old project's, so the live scripts cannot run until it is replaced. `.env.local` also holds stale Stripe keys (unused; delete them). The test account created during setup was deleted again.

## Done this session
- Migrations (run 0001→0005 in order, once each):
  - 0003 session security: aal2 + not-suspended restrictive RLS on every table, `my_account_status()`, definer-function hardening (search_path pinned, grants locked: visitor role only reads public tables), guard triggers (invitations, availability, notifications, threads, slot/promoter counters), blocks enforced in SQL, invitation-notification bug fixed.
  - 0004 UK-wide locations: six-city CHECKs and `city_distances` removed; country/region/coords; private rounded `artist_locations`; `set_my_location`, `create_venue`, `search_slots` (radius), `search_artists`, `terms_preview`; travel rule = more than 30 straight-line miles OR unknown location ⇒ travel at least £10 (a distance rule, not a journey time — **business rule for you to confirm**); safe upgrade of existing six-city data.
  - 0005: explicit-column `export_my_data`, message `client_id` retry safety.
- Swift: MapKit place picker (search / current location only on tap / type-in), venue picker + add venue, radius filters, DB-computed travel terms, MFA-first phase order, PKCE email links (implicit tokens refused), aal2 claim check after verify, message retry ids, onboarding drafts, unsaved-listing confirm, Dynamic Type, Reduce Motion, honest deletion wording.
- Scripts rewritten for the new schema (`live-journey`, `security-regression`, `seed-dev-fixtures`, `lib/live.mjs`): **NOT RUN** (need the new service-role key).

## Verified (actual results, 7 Nov 2026)
- `npm test`: 149 database tests passing (real migrations in PGlite).
- Swift unit tests passing; app builds and launches in the iPhone 17 simulator against the live project.
- Live project, anon key only: `london_today()` and `search_slots` answer (200, empty list); reading `profiles` anonymously is refused (401), as migration 0003 intends.
- Web companion (`web/`): 20 tests, type-check and production build pass; `npm run app` runs a shared-data server (sign-up, booking, alerts, messages, restart persistence checked by hand).
- Not verified: sign-up, email confirmation, TOTP and signed-in iOS screens on the live project; the live scripts; concurrency; VoiceOver. A one-off fix (stale onboarding error banner, photo preview clipping) was checked by eye only.

## Still to do
- Docs not yet written: `docs/PERMISSIONS.md` matrix (the tests in `tests/db/session-security.test.ts` encode it), `docs/SETUP.md`, manual checklist.
- Supabase dashboard (not checked): TOTP MFA on, redirect URL `supportslot://auth-callback`, PKCE emails.
- Unresolved retention decisions (deletion): shared conversations are deleted for both sides; booking snapshots keep names; support requests keep email/message; audit rows kept with actor cleared.
- Legal text unreviewed; no signing/TestFlight; accessibility audit pending; server cannot prove coordinates are inside UK borders.

## Welcome flow and email codes (added 7 Nov 2026)
- Signed-out users now land on a welcome screen (create account / log in / browse) instead of the visitor home.
- Sign-up is confirmed with a 6-digit code typed into the app (`AuthService.verifyEmailCode`), with the link kept as a fallback; logging in with an unconfirmed email goes to the code screen and sends a fresh code. Needs the email template in `docs/EMAIL_TEMPLATES.md` to be set up in Supabase. Unit-tested; not yet tested end to end against the live project.

## Web companion
`web/` (Vite + React + a small Node server) is a separate, sample-data-backed web app for the same product. It does not talk to Supabase or the iOS app. See `web/README.md`.
