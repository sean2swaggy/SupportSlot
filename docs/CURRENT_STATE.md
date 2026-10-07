# Support Slot — Current State

_Updated 7 October 2026, branch `app/native-ios`._

Support Slot is a UK marketplace connecting independent artists with promoters who post support (opening-act) slots. It is now a **native iOS app (SwiftUI)** that talks directly to Supabase. The website and its tooling were removed. **No money passes through the platform:** an offer records the fee and travel the two sides agreed; once the artist accepts, the promoter pays them directly. Support+ tools are free for every promoter.

## What exists

| Area | Status |
|---|---|
| Accounts: sign up, log in, email confirmation deep link, password reset, mandatory TOTP 2FA (enrol + challenge) | built |
| Onboarding (artist / promoter), profile editor (basics, photos, links, tracks, listeners, last-minute alerts) | built |
| Public discovery (visitor home, filters, tonight), slot detail, honest fit summary (no match %), saved gigs | built |
| Applications → offer → accept → booking, with decline/withdraw/cancel reasons and expiry | built (state machine is SQL) |
| Promoter: create / preview / edit / close / reopen / reschedule listings, applicants, offers, artist search | built |
| Promoter tools: roster, templates, availability requests, invitations, show schedule, bookings CSV | built |
| Messaging (threads, retry, paging, report/block), in-app notifications | built |
| Settings: data export, account deletion, support request, legal pages | built |
| Staff tools: reports, support requests, users (suspend / verify), listings, bookings (admin), audit log | built |
| Email and push notifications | **not built** — no server; notifications are in-app only |

## Verification status

| Check | Result |
|---|---|
| Swift unit tests (XCTest, faked network) | 77 pass |
| Database tests (real migrations in PGlite) incl. Swift ↔ schema contract and travel parity | 70 pass |
| App builds and launches in the iOS simulator; login screen and visitor home render with empty-data states | verified |
| `0001` + `0002` applied to a real Supabase project | **not yet** — the new project hasn't been created; `.env.local` still points at the old one |
| Signed-in flows in the simulator (artist, promoter, staff) | **not yet** — need the project above |
| `scripts/live-journey.mjs`, `scripts/security-regression.mjs`, demo-data script | **not yet run** against the new schema |
| `delete_my_account` removing the `auth.users` row | tested in PGlite only; needs a live check |

## Known gaps and decisions

- MFA is enforced by the app (client-side gate); RLS does not require an aal2 session.
- Fonts approximate the web design (system fonts); the app icon is generated.
- Venue photos are placeholders; user images are stored as resized data URLs in text columns.
- No UI tests, no accessibility audit with VoiceOver yet.
- Terms, Privacy and Trust text has not been reviewed by a lawyer.
- No signing, TestFlight or App Store listing configured.
- Supabase dashboard settings the app depends on: redirect URL `supportslot://auth-callback`, email-confirmation behaviour.

## Checklist against the original "fully functional" brief

Decisions made later in the project override parts of that brief: no website, no Stripe or any money handling, Support+ tools free for all promoters, no server of our own.

| Brief section | State |
|---|---|
| 1. Accounts and permissions | Built: register, log in/out, email confirmation, reset, mandatory TOTP. Ownership and roles enforced by RLS and SQL functions (tested in `tests/db/security.test.ts`). Role/admin cannot be self-assigned. Live negative tests (`security-regression.mjs`) not yet run on the new project. |
| 2. Artist profiles | Built: editor, tracks, validated links, resized JPEG photos (no arbitrary file uploads), profile checklist, public profile with private fields excluded. Performance video is a validated link only. |
| 3. Gig discovery and management | Built: search, filters, paging, saved gigs, create/preview/edit/close/reopen/reschedule, cancelled/expired handling, fit explanation from real fields (no match %). |
| 4. Applications and bookings | Built in SQL: unique application per artist per slot, valid transitions, one confirmed booking per slot (unique index), terms snapshot. Concurrent behaviour is **not** proven locally — `live-journey.mjs` needs a live project. |
| 5. Messaging and notifications | Built: participant-only threads, unread state, in-app notifications with dedupe keys. **Email via a provider is not built** (no server); only Supabase Auth's own emails exist. |
| 6. Payments | **Removed by decision.** No provider, webhook, payout, refund or dispute states. Copy says the promoter pays the artist directly. |
| 7. Support+ | **Removed as a paid tier by decision.** The tools it advertised (roster, templates, availability requests, schedule, CSV) are built and free; no analytics, no calendar sync claims. |
| 8. Administration | Built: staff screens, role checks in SQL, audit rows. Staff are made by hand in SQL; no public admin sign-up. |
| 9. Advertising | Not implemented anywhere. **Future phase**, after core booking is verified live. |
