# Support Slot — Current State (7 Nov 2026, branch `app/native-ios`)

## Live project
Connected to Supabase project `bctbiiukydckunfsqjxv` (migrations 0001–0005 applied by hand in the SQL editor; 0006–0009 applied through the Supabase connection, on 7 Nov 2026). `SupportSlot/Config/Secrets.xcconfig` and `.env.local` point at it. The service-role key in `.env.local` is still the old project's, so the live scripts cannot run until it is replaced. `.env.local` also holds stale Stripe keys (unused; delete them). The test account created during setup was deleted again.

## Done this session
- Migrations (run 0001→0005 in order, once each):
  - 0003 session security: aal2 + not-suspended restrictive RLS on every table, `my_account_status()`, definer-function hardening (search_path pinned, grants locked: visitor role only reads public tables), guard triggers (invitations, availability, notifications, threads, slot/promoter counters), blocks enforced in SQL, invitation-notification bug fixed.
  - 0004 UK-wide locations: six-city CHECKs and `city_distances` removed; country/region/coords; private rounded `artist_locations`; `set_my_location`, `create_venue`, `search_slots` (radius), `search_artists`, `terms_preview`; travel rule = more than 30 straight-line miles OR unknown location ⇒ travel at least £10 (a distance rule, not a journey time — **business rule for you to confirm**); safe upgrade of existing six-city data.
  - 0005: explicit-column `export_my_data`, message `client_id` retry safety.
- Swift: MapKit place picker (search / current location only on tap / type-in), venue picker + add venue, radius filters, DB-computed travel terms, MFA-first phase order, PKCE email links (implicit tokens refused), aal2 claim check after verify, message retry ids, onboarding drafts, unsaved-listing confirm, Dynamic Type, Reduce Motion, honest deletion wording.
- Scripts rewritten for the new schema (`live-journey`, `security-regression`, `seed-dev-fixtures`, `lib/live.mjs`): **NOT RUN** (need the new service-role key).

## Verified (actual results, 7 Nov 2026)
- `npm test`: 153 database tests passing (real migrations in PGlite).
- Swift unit tests passing; app builds and launches in the iPhone 17 simulator against the live project.
- Live project, anon key only: `london_today()` and `search_slots` answer (200, empty list); reading `profiles` anonymously is refused (401), as migration 0003 intends.
- Web companion (`web/`): 20 tests, type-check and production build pass; `npm run app` runs a shared-data server (sign-up, booking, alerts, messages, restart persistence checked by hand).
- Not verified: sign-up, email confirmation, and signed-in iOS screens on the live project; the live scripts; concurrency; VoiceOver. A one-off fix (stale onboarding error banner, photo preview clipping) was checked by eye only.

## Still to do
- Docs not yet written: `docs/PERMISSIONS.md` matrix (the tests in `tests/db/session-security.test.ts` encode it), `docs/SETUP.md`, manual checklist.
- Supabase dashboard (not checked): redirect URL `supportslot://auth-callback`, PKCE emails.
- Unresolved retention decisions (deletion): shared conversations are deleted for both sides; booking snapshots keep names; support requests keep email/message; audit rows kept with actor cleared.
- Legal text unreviewed; no signing/TestFlight; accessibility audit pending; server cannot prove coordinates are inside UK borders.

## Welcome flow and email codes (added 7 Nov 2026)
- Signed-out users now land on a welcome screen (create account / log in / browse) instead of the visitor home.
- Sign-up is confirmed with an 8-digit code typed into the app (length must match Supabase's Email OTP length) (`AuthService.verifyEmailCode`), with the link kept as a fallback; logging in with an unconfirmed email goes to the code screen and sends a fresh code. Needs the email template in `docs/EMAIL_TEMPLATES.md` to be set up in Supabase. Unit-tested; not yet tested end to end against the live project.

## Web companion
`web/` (Vite + React + a small Node server) is a separate, sample-data-backed web app for the same product. It does not talk to Supabase or the iOS app. See `web/README.md`.

## Supabase advisor (7 Nov 2026, after 0006)
No search-path warnings. Remaining warnings are expected: the app's own SECURITY DEFINER functions are callable by signed-in users by design (and `submit_support_request` by visitors), and leaked-password protection is a dashboard toggle that is off.

## Two-factor removed (7 Nov 2026)
By the owner's decision there is no authenticator-app step. Migration `0007` removed the aal2 requirement from the policies and functions (it also renamed the policy to `active_session_required`); the iOS app no longer has the set-up/enter-code screens; the live-check scripts, demo-account script and the TOTP helper scripts were updated or removed. Accounts are protected by a password only. Two leftover SQL functions (`export_my_data`, `delete_my_account`) still raise the old `mfa_required` text if called by someone with no profile; harmless. If two-factor is ever wanted again, make it optional rather than mandatory.

## Phone sign-up: tried and removed (7 Nov 2026)
A mobile-number option (texted code) was built and then removed by the owner's decision; sign-up is by email only. Migration `0008` added it to the database and `0009` undoes it (both were applied, so both stay in the history; run both, or neither, on a new project). Passwords are reset by email: "Forgot password?" on the log-in screen sends a reset link that opens the app (`supportslot://auth-callback`, PKCE), then the person chooses a new password. The reset email's template can be restyled in Supabase (Authentication → Emails → Templates → Reset password); it must keep `{{ .ConfirmationURL }}`.

## Paid extras (Apple in-app purchase)

- Products: `com.supportslot.app.gigdiary` (£5.99, non-consumable), `com.supportslot.app.team.monthly` (£19.99) and `com.supportslot.app.team.yearly` (£49.99), one subscription group. A local test configuration is `SupportSlot/Config/SupportSlot.storekit`.
- **Not live yet:** the products must be created in App Store Connect with the same ids and prices, which needs the Apple Developer account. Until then the paywall shows "Purchases aren't available right now".
- Enforcement is **on the device** (StoreKit verifies Apple's signed transactions; each purchase is tied to the account via `appAccountToken`). The database does **not** enforce plans: the 1-open-listing limit and locked tools can be bypassed by calling the API directly. Server-side verification (App Store Server Notifications + an edge function writing an entitlements table) is the next hardening step and needs sandbox testing with the Apple account.
- The Gig diary table (migration 0012) is private to its owner by row-level security whether or not they bought it.
- "Shared team logins" are **not built**: Team currently means unlimited listings and the promoter tools for one login.

## Promoter teams (migration 0014)

- A promoter invites up to 5 other promoter accounts by email; a person is on at most one team. Everything is decided by `acts_for_promoter(owner)` (owner or an active member). Members can post/edit listings, shortlist/decline, make/withdraw offers, cancel bookings and message artists for the owner. Owner-only: roster, availability requests, templates, schedules, gig invitations, reviews, settings.
- Inviting needs the Team plan, checked on the device only (the database does not know about purchases). Members post for the owner without their own plan.
- Notifications still go to the owner only; helpers aren't notified when an artist replies.
- Not yet verified on a phone with two real accounts.
