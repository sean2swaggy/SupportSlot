# Support Slot — Current State (7 Oct 2026, branch `app/native-ios`, uncommitted)

## Blocker
No live Supabase project is configured. `.env.local` and `SupportSlot/Config/Secrets.xcconfig` still point at the RETIRED project (`hbjwrjvdipwknaikvyev`); scripts now refuse it. `.env.local` also holds stale Stripe keys (delete them). Needed: the NEW project URL + anon key (and a service-role key in `.env.local` for the scripts only).

## Done this session
- Migrations (run 0001→0005 in order, once each):
  - 0003 session security: aal2 + not-suspended restrictive RLS on every table, `my_account_status()`, definer-function hardening (search_path pinned, grants locked: visitor role only reads public tables), guard triggers (invitations, availability, notifications, threads, slot/promoter counters), blocks enforced in SQL, invitation-notification bug fixed.
  - 0004 UK-wide locations: six-city CHECKs and `city_distances` removed; country/region/coords; private rounded `artist_locations`; `set_my_location`, `create_venue`, `search_slots` (radius), `search_artists`, `terms_preview`; travel rule = more than 30 straight-line miles OR unknown location ⇒ travel at least £10 (a distance rule, not a journey time — **business rule for you to confirm**); safe upgrade of existing six-city data.
  - 0005: explicit-column `export_my_data`, message `client_id` retry safety.
- Swift: MapKit place picker (search / current location only on tap / type-in), venue picker + add venue, radius filters, DB-computed travel terms, MFA-first phase order, PKCE email links (implicit tokens refused), aal2 claim check after verify, message retry ids, onboarding drafts, unsaved-listing confirm, Dynamic Type, Reduce Motion, honest deletion wording.
- Scripts rewritten for the new schema (`live-journey`, `security-regression`, `seed-dev-fixtures`, `lib/live.mjs`): **NOT RUN** (no project).

## Verified (actual results)
- Local DB tests (real migrations in PGlite): 148 passing (`npm test`); mutation checks showed the aal2/suspension tests fail if those rules are removed.
- Swift unit tests (stubbed network): 94 passing; app builds for simulator (iPhone 17 — "iPhone 17 Pro" is not installed here).
- NOT verified: anything live (Supabase Auth, real PKCE links, TOTP, concurrency, deletion removing `auth.users`), signed-in simulator journeys, MapKit results, VoiceOver.

## Still to do
- Docs not yet written: `docs/PERMISSIONS.md` matrix (the tests in `tests/db/session-security.test.ts` encode it), `docs/SETUP.md`, manual checklist; README/CLAUDE.md still mention six cities and `Travel.swift` parity.
- Supabase dashboard: enable TOTP MFA, redirect URL `supportslot://auth-callback`, confirm PKCE emails.
- Unresolved retention decisions (deletion): shared conversations are deleted for both sides; booking snapshots keep names; support requests keep email/message; audit rows kept with actor cleared.
- Legal text unreviewed; no signing/TestFlight; accessibility audit pending; server cannot prove coordinates are inside UK borders.
