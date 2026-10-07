# SupportSlot — Current State

_Audit date: 5 October 2026. Branch inspected: `feature/complete-app` (clean working tree, 17 commits; `main` holds only the original prototype commit). This is an inventory of what exists in the repository. Nothing here was changed, installed, migrated or deployed to produce it. The only command run was the existing test suite (read-only, no network)._

**How to read the status column** (the five classes requested):

| Code | Meaning |
|---|---|
| **A** | Implemented in code. Runtime verification **not** performed against live services. |
| **B** | Partially implemented |
| **C** | UI / mock-up only |
| **D** | Documented or proposed, not implemented |
| **E** | Missing, contradictory or unclear |

A passing test file does not upgrade a feature beyond **A**. Where a feature has automated coverage this is listed separately as "Tests".

---

## 1. Product overview

SupportSlot is a UK marketplace connecting **independent artists** with **promoters** who post **support (opening-act) slots** at live shows. Artists browse and apply for free. Promoters post listings, shortlist applicants, make an offer, and — once the artist accepts — pay through Stripe. Artists never pay to apply or perform (the "No pay-to-play" rule is stated in `src/app/terms/page.tsx` and `src/app/trust/page.tsx`).

- **Audience:** emerging/developing/established UK artists and bands; independent promoters and venues in six cities (London, Manchester, Birmingham, Bristol, Leeds, Brighton).
- **Roles:** artist, promoter (chosen once at signup, immutable — `profiles.role`, trigger `prevent_role_change` in `0001_schema.sql`), and staff (`profiles.admin_role` = `admin` | `moderator`, set by hand in SQL — `0023_admin_support_privacy.sql`).
- **Revenue model as coded:** the promoter pays the artist's agreed fee + travel + a "Support Slot booking fee" + an estimated card-processing line, all itemised. The artist receives fee + travel in full. Promoters can also buy **Support+** (subscription). See §9 and the contradictions in §8.
- **Platforms:** responsive web app (Next.js) plus a Capacitor iOS shell that loads the web app by URL (`capacitor.config.ts`, `ios/`).

## 2. Evidence base

Read: `CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example`, `package.json`, `next.config.ts`, `capacitor.config.ts`, `src/lib/csp.ts`, every file under `src/app` (pages + API routes), the key components and `src/lib` modules (`routes`, `store`, `queries`, `actions`, `fit`, `pricing`, `stripe/*`, `email`, `server/*`, `supabase/*`, `types`), all 23 migrations in `supabase/migrations/` (3,828 lines), `supabase/tests/`, `tests/db/*`, `src/lib/*.test.ts`, `scripts/*`.

Inspected and **not found**: screenshots, design files (Figma etc.), a logo file, brand guidelines, deployment configuration (no `vercel.json`, no CI config), a `docs/` folder (the README links to `docs/COMPLETION_REPORT.md`, which does not exist — see §8).

Test results recorded today (`npx vitest run`): **21 files, 197 tests passed**. `tsc`, ESLint and `next build` were last clean at the end of the previous working session and were **not** re-run for this audit.

## 3. Feature / status table

| # | Feature | Status | Evidence (paths) | Notes |
|---|---|---|---|---|
| **Accounts** | | | | |
| 1 | Sign up / log in (email + password) | A | `src/app/login/page.tsx`, `src/lib/supabase/*` | Real Supabase Auth. Role passed in signup metadata; DB trigger `handle_new_user` makes the profile. "Continue with Spotify" removed (was a disabled stub). |
| 2 | Mandatory TOTP two-factor | A | `src/app/mfa-setup`, `mfa-challenge`, `src/lib/supabase/middleware.ts` | Enforced in the proxy before any other page. |
| 3 | Password strength + unique usernames | A | `src/lib/password.ts`, `src/lib/username.ts`, `0017_username.sql` | Tests: `password.test.ts`, `username.test.ts`. |
| 4 | Onboarding wizard (age ≥ 16, profile, links, bio, email verify) | A | `src/app/onboarding/page.tsx` | DOB is an age gate only, never stored. Date-field overflow on iOS fixed in `globals.css` (not verified on a device). |
| 5 | Password reset | A | `src/app/forgot-password`, `reset-password`, `src/app/auth/callback/route.ts` | Uses Supabase email links; SMTP/template configuration is outside the repo (unknown). |
| 6 | Return-to-page after login (`next`) | A | `src/lib/redirect.ts`, `src/lib/routes.ts` | Tests: `redirect.test.ts`, `routes.test.ts`. |
| 7 | Settings: password, email-notification switch, blocked list, data export, account deletion | A | `src/app/settings/page.tsx`, `api/account/export`, `api/account/delete`, `0023` (`account_deletion_blockers`, `prepare_account_deletion`) | Deletion refuses while a confirmed booking/unresolved payment exists. Financial rows are kept. |
| 8 | Suspended-account screen | A | `src/app/suspended/page.tsx`, `routes.ts` | A suspended user can reach only legal/support pages. |
| **Artists** | | | | |
| 9 | Artist profile editor (name, bio, genres ≤5, location, radius, availability, size, tracks, links, live-video link) | A | `src/app/dashboard/artist/profile/page.tsx`, `src/lib/profile.ts`, `artists_guard` in `0023` | Test: `profile.test.ts`. |
| 10 | Public artist page | A | `src/app/artist/[handle]/page.tsx` | |
| 11 | Music links (Spotify, Instagram, TikTok, SoundCloud, Bandcamp, YouTube, website) | A | `ArtistLinksEditor.tsx`, `artist-links.ts`, `store.tsx` | URLs validated with a safe-URL check. No embedded players. |
| 12 | Tracks (title, length, optional link) | A | profile editor; `artist_tracks` | Artist features one track per application. |
| 13 | Live performance **video** | B | profile editor `live_video_url`, `live_video_thumbnail_url` | A link only: "We don't host the video." No thumbnail upload UI found. |
| 14 | **Press kit / EPK** | D→E | none in code | Not implemented and not documented anywhere in the repo. |
| 15 | Monthly listeners | A | `ArtistMonthlyListenersEditor.tsx` | Self-reported and labelled so (tooltip, privacy page). Not pulled from Spotify. |
| 16 | Past / upcoming shows on profile | B | `artist_shows` table, read in `queries.ts:90` | No screen to add past shows (read-only). Upcoming list is empty copy "Nothing confirmed yet". |
| 17 | Artist verification badge | A | `admin_set_verification` (`0023`), `VerifiedBadge.tsx` | Staff-set only. |
| **Gig discovery** | | | | |
| 18 | Public gig search, filters, sort, pagination | A | `src/components/discovery/SlotBrowser.tsx`, `searchSlots` in `queries.ts`, SQL `search_slots` (`0020`) | Filters: text, city, genre, date window, pay, venue size, artist size, distance (artists only), sort (soonest/highest fee/newest). URL-synced. Tests: `platform.test.ts`. |
| 19 | Slot detail page | A | `src/app/slot/[id]/page.tsx`, `SlotDetailClient.tsx` | Visitors get sign-up/login prompts with `next`. |
| 20 | Saved gigs | A | `src/app/saved/page.tsx`, `SaveGigButton.tsx`, `saved_slots` | |
| 21 | "Needed tonight" / last-minute listings and alerts | A | `src/app/last-minute/page.tsx`, trigger `notify_urgent_slot` (`0020`) | In-app notification only (no email/push). |
| 22 | Fit explanation (genre / location / size) | A | `src/lib/fit.ts`, `FitSummary.tsx` | **No percentage.** Test: `fit.test.ts`. |
| 23 | Promoter "Discover artists" + invite to gig | A | `PromoterDiscoverArtists.tsx`, `InviteToGigModal.tsx`, `0015_gig_invitations.sql` | |
| **Promoter listings** | | | | |
| 24 | Create / validate / preview / publish listing | A | `ListingForm.tsx`, `src/lib/listing.ts`, `slots_guard` (`0020`) | Two-step with a preview. Test: `listing.test.ts`. |
| 25 | Edit (locked once an offer/booking exists), close, reopen, cancel, reschedule | A | `promoter/slot/[id]/edit`, `ListingActions.tsx`, `RescheduleListing.tsx`, SQL fns in `0021` | Owner-only (RLS + function checks). |
| 26 | Promoter dashboard ("My Gigs", needs-attention) | A | `src/app/dashboard/promoter/page.tsx` | |
| **Applications & bookings** | | | | |
| 27 | Apply (featured track + optional message) | A | `ApplyModal.tsx`, `applications_guard` | One application per artist per slot (unique index). |
| 28 | Applicant management: viewed, shortlist, decline, offer, withdraw offer | A | `ApplicantManagementClient.tsx`, `0021` | "Viewed" is set by the DB when the promoter opens the applicants page. |
| 29 | Offer → accept/decline → confirmed booking | A | `BookingControls.tsx`, `respond_to_offer` (`0021`) | Terms snapshotted in pence. Overbooking blocked by a partial unique index. Offers expire (≤7 days) via cron. |
| 30 | Cancel booking (either side) | A | `cancel_booking` | Paid bookings are flagged `refund_review_required`; no automatic refund. |
| 31 | Artist applications page / status pills | A | `src/app/applications/page.tsx`, `StatusPill.tsx` | |
| 32 | Availability requests (promoter → roster artists) | A | `dashboard/promoter/requests`, `artist /requests`, `0011` | Support+ gated. |
| 33 | Show schedule builder | A | `promoter/slot/[id]/schedule`, `ShowScheduleClient.tsx`, `0016` | Support+ gated in the DB on every operation. **Not listed on the Support+ pricing page** (§8). |
| **Messaging & notifications** | | | | |
| 34 | In-app messaging (threads per application, unread, pagination, retry, block, report) | A | `src/app/messages/page.tsx`, `open_application_thread`, `messages_guard` | 20 msgs/min cap; blocked promoters can't message. |
| 35 | In-app notifications | A | `NotificationsPanel.tsx`, `notify()` (`0020`) | De-duplicated. A legacy type `match` still exists in `types.ts`. |
| 36 | Notification email | B | `src/lib/email.ts`, `email_outbox`, `api/cron/send-emails` | Provider is Resend. Without `RESEND_API_KEY`/`EMAIL_FROM` nothing is sent and nothing is reported as sent. Provider **not configured** here. |
| **Payments** | | | | |
| 37 | Artist payout onboarding (Stripe Connect recipient accounts, GB) | A | `api/stripe/connect/*`, `PayoutPanel.tsx`, `artist_payment_accounts` | Needs a real/test Connect account to exercise. |
| 38 | Promoter pays a confirmed booking (destination charge) | A | `api/bookings/[id]/pay`, `PayBookingModal.tsx` | Browser sends only the booking id; amount comes from the stored terms. |
| 39 | Verified webhooks, idempotent state changes | A | `api/stripe/webhooks`, `webhook-handler.ts`, `0022` | Events: `payment_intent.processing/succeeded/payment_failed`, `charge.refunded`, `charge.dispute.created/closed`, `customer.subscription.created/updated/deleted`. Tests: `webhook.test.ts`, `payments.test.ts`. Real Stripe delivery not tested. |
| 40 | Provider-verified return sync | A | `api/bookings/[id]/sync` | Asks Stripe, not the browser. |
| 41 | Payment states / refunds / disputes | B | `0020`/`0022` (`apply_refund`, `apply_dispute`) | States recorded from webhooks. Refunds are issued by an admin in the Stripe Dashboard; no in-app refund button. |
| 42 | Receipts | B | `receipt_url` on bookings, link in `PayoutPanel.tsx` | Stripe-hosted URL only; no SupportSlot-generated receipt/invoice. |
| 43 | Bookings CSV export (promoter) | A | `api/reports/bookings` | Support+ gated; formula-injection safe. |
| 44 | Legacy wallet / payout codes | E | `wallet_transactions` table (`0001`), `0009_real_payouts.sql` | Table remains in the schema but nothing in `src/` uses it. `payout_code` column was dropped in 0009. |
| **Support+** | | | | |
| 45 | Checkout, status, billing portal, cancel, failed-payment handling | A | `src/app/support-plus/page.tsx`, `api/stripe/subscriptions/*`, `apply_subscription_state` (`0022`) | Promoter-only. `past_due` keeps access while Stripe retries. |
| 46 | Server-enforced benefits | A | RLS in `0010`, `0016`; route check in `api/reports/bookings` | Roster, request templates, availability requests, show schedule, CSV export. |
| 47 | Support+ affects ranking or selection | — | `fit.ts` header; `support-plus/page.tsx` | **No.** Stated in the UI and absent from the code. |
| **Advertising** | | | | |
| 48 | Artist advertising / sponsored music / campaign reports | D | none (`grep` for advert/sponsor/campaign: only two "we don't use advertising" lines in `src/app/privacy/page.tsx`) | Does not exist. |
| **Trust & admin** | | | | |
| 49 | Report a user/listing/message; block a promoter | A | `ReportModal.tsx`, `submit_report`, `promoter_blocks` | Report rate-limited. |
| 50 | Admin console (reports, support inbox, users, listings, payments, audit) | A | `src/app/admin/page.tsx`, `0023` | `moderator` sees all but payments and verification. Every action writes `admin_audit_log` in SQL. No public admin signup. |
| 51 | Contact support (signed-in or out) | A | `src/app/support/page.tsx`, `api/support` | Stored for staff; no email to staff is sent. |
| **Platform** | | | | |
| 52 | Access control (one pure function) | A | `src/lib/routes.ts`, `src/proxy.ts`, `AppGate.tsx` | Test: `routes.test.ts`. |
| 53 | Rate limiting | A | `rate_limit_hit` (`0020`), `src/lib/server/request.ts` | Postgres-backed. |
| 54 | Security headers / CSP | A | `next.config.ts`, `src/lib/csp.ts` | See the image-source concern in §8. |
| 55 | Background jobs | A | `api/cron/expire-offers`, `api/cron/send-emails`, `src/lib/server/cron.ts` | Bearer `CRON_SECRET`. **Nothing schedules them** in this repo. |
| 56 | iOS app shell | B | `capacitor.config.ts`, `ios/`, `cap-www/` | Remote-loads the site (defaults to `http://localhost:3000`). No production URL, store listing or signing configured. |
| 57 | Image uploads | B | `AvatarUploadField.tsx`, `ImageUploadField.tsx` | Resized in the browser and stored as `data:` URLs in rows. Storage buckets from `0004_storage.sql` are unused (`grep` finds no `.storage` call). |
| 58 | Legal pages | B | `terms`, `privacy`, `trust` | Written, dated 3 Oct 2026, not lawyer-reviewed (unknown). |

## 4. Current architecture

- **Framework:** Next.js 16.3.5 App Router, React 19.2, TypeScript, Tailwind CSS v4. In Next 16 middleware is named `proxy` (`src/proxy.ts`). `AGENTS.md` instructs agents to read `node_modules/next/dist/docs/` first — APIs differ from older versions.
- **Backend:** Supabase (Auth, Postgres with row-level security, SQL functions called via RPC). Stripe: PaymentIntents + Connect v2 recipient accounts + destination charges; Billing via Checkout + customer portal.
- **Client state:** `src/lib/store.tsx` is a React Context (`useStore()`) over Supabase; reloads on focus and every 45 s; mutators return a `Result`. If the first load fails a retry screen is shown rather than an empty dashboard.
- **Server data:** `src/lib/queries.ts` (reads), `src/lib/actions.ts` (writes/RPC wrappers returning `Result`).
- **Rule: the database is the authority.** State changes are SQL functions (`0021`, `0022`) that lock rows in a fixed order (slot → application → other applications), check the caller and state, and are idempotent. Clients have no direct UPDATE on `applications` or `bookings`.
- **Money:** integer pence, computed in SQL (`make_offer`, `processing_fee_pence`, `effective_travel_pence`) and stored as a snapshot on `bookings`; `src/lib/stripe/fees.ts` only previews (`tests/db/fees-parity.test.ts` proves the two agree).
- **Staff/payment tables** are service-role only; Stripe ids live in private tables.
- **Service-role usage:** webhooks, payments, cron, account deletion, the support inbox.
- **Deployment:** none configured. No hosting target, no CI. Production URL: unknown.

## 5. Data model (23 migrations; applied **in order** by hand in the Supabase SQL editor)

Tables: `profiles`, `artists`, `artist_tracks`, `artist_shows`, `promoters`, `venues` (6 seeded rows), `city_distances`, `slots`, `applications`, `bookings`, `notifications`, `message_threads`, `messages`, `saved_slots`, `artist_roster`, `event_templates`, `availability_requests` (+ `_recipients`), `gig_invitations`, `promoter_blocks`, `reports`, `support_requests`, `show_schedules`, `schedule_entries`, `schedule_templates` (+ `_entries`), `artist_payment_accounts`, `promoter_billing`, `payment_events`, `stripe_events`, `email_outbox`, `rate_limits`, `admin_audit_log`, `wallet_transactions` (legacy, unused).

Key constraints: one application per (slot, artist); at most one `confirmed` booking per slot; at most one live booking per application; `total = fee + travel + booking fee + processing fee` (check constraint); currency GBP only; role immutable; username global and unique; slot rules (date/deadline not in the past, fee ≤ £100,000, booking fee £10–£1,000, 1–10 requirements, ≥1 genre) enforced in `slots_guard`. The migrations contain 34 `enable row level security` statements.

States:

- **Application:** `submitted → viewed → shortlisted → offered → confirmed`; ends `declined`, `offer_declined`, `withdrawn`, `cancelled`.
- **Booking:** `offered`, `confirmed`, `declined`, `withdrawn`, `cancelled`.
- **Payment:** `unpaid → processing → paid → partially_refunded | refunded`, plus `failed` and `disputed`.
- **Listing:** `open`, `filled`, `closed`, `cancelled`.
- **Support+ (Stripe status):** entitled for `active`, `trialing`, `past_due`; not entitled for `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`.

## 6. Design summary

- **Look:** dark editorial/gig-poster. Square corners everywhere (no radius), hairline borders, uppercase display headings, uppercase monospace buttons and eyebrow labels, a subtle grain overlay (`.grain`), marquee animation.
- **Colour tokens** (`src/app/globals.css`): ink `#0a0a0b`, ink-raised `#121214`, ink-card `#17171a`, ink-border `#29292e`, paper `#f4f2ec`, paper-dim `#a9a7a0`, **acid `#d6ff3f`** (primary accent), acid-ink `#10140a`, signal `#ff5a36` (errors/danger), ok `#38e08f`. `color-scheme: dark` only; there is no light theme.
- **Type** (self-hosted via `@fontsource/*`): Space Grotesk 500/600/700 (display), Inter 400/500/600 (body), JetBrains Mono 400/500/700 (labels, buttons).
- **Logo:** a text wordmark `SUPPORT/SLOT` with the slash in acid (`src/components/layout/Logo.tsx`). No logo file exists. `src/app/favicon.ico` and iOS AppIcon/Splash PNGs exist.
- **Components:** `Button` (primary/secondary/ghost/outline/danger; sm/md/lg), `Modal`, `Select`, `Tag`, `SectionHeading`, `StatCard`, `VerifiedBadge`, `SupportPlusBadge`, `UrgentPulse`, cards for slots/artists.
- **Responsive:** top navbar on desktop; fixed bottom `MobileNav` on phones (visitor: Discover/Tonight/Log in; artist: Discover/Applications/Profile + Messages; promoter: Discover/Applicants/My Gigs + "post a slot"). Inputs forced to 16 px on touch devices to stop iOS zoom. `prefers-reduced-motion` is honoured.
- **Images:** photography is placeholder (`picsum.photos` URLs in `0003_seed_venues.sql`); user uploads are data URLs. No brand photography is supplied.

## 7. Key user journeys (as coded)

**Artist:** visit `/` → sign up (`/login?mode=signup`) → mandatory 2FA setup → onboarding → dashboard/profile → Discover (filter, save) → slot page → Apply (track + message) → watch status on `/applications` → receive offer (notification + email outbox) → accept or decline → booking confirmed → set up payouts in Stripe → promoter pays → see payment status/receipt → message promoter.

**Promoter:** sign up → 2FA → onboarding (company, city) → Post a slot (form → preview → publish) → open applicants (marks "viewed") → shortlist/decline → make offer (terms snapshotted) → artist accepts → pay via Stripe → manage/reschedule/cancel → optional Support+ (roster, availability requests, templates, schedule builder, CSV).

**Staff:** set `admin_role` in SQL → `/admin` → reports, support inbox, user suspend/verify, remove listing, payments overview (admin only), audit log.

## 8. Gaps, contradictions and external dependencies

### Contradictions (and which source was used)

| # | Conflict | Source used | Why |
|---|---|---|---|
| 1 | **Pricing.** `src/lib/pricing.ts` has Support+ at **£7.99/month and £89.99/year** (unchanged since the initial commit). £9.99/month and £99/year appear nowhere in the repo. | Code (£7.99 / £89.99) | The brief says £9.99/£99 were proposals, not approvals. Existing priced behaviour is preserved. |
| 2 | **Support+ features page vs the database.** The pricing page lists roster, availability requests, templates and CSV export; the DB also gates the **Show schedule** (`0016`), which the page does not mention. | Database | It enforces access. The page copy needs a product decision (advertise it, or ungate it). |
| 3 | **Booking fee is chosen by the promoter.** The listing form lets the promoter set "Support Slot booking fee" (£10 minimum, £1,000 max in SQL, default £12). Copy calls it "Support Slot's own cut". A platform fee set by the paying party is unusual. | Code | Unresolved business decision (§ Decisions in the master prompt). |
| 4 | **Landing "How it works" step 3** says apply by choosing "a track **and a live clip**". The apply modal only picks a track; the clip is a profile link the promoter opens. | Apply modal | It is the behaviour the user sees. |
| 5 | **Application message length:** UI counter says 280 (`ApplyModal.tsx`); the DB allows 500. | UI limit is stricter | No harm, but inconsistent. |
| 6 | **Image sources vs CSP.** `img-src` allows only `'self'`, `data:`, `blob:` and the Supabase origin (`src/lib/csp.ts`). The seeded venue photos are `https://picsum.photos/...` and the DB accepts any `https://` image URL. These would likely be **blocked by the browser**. | Not verified | Needs a runtime check. |
| 7 | **README** links `docs/COMPLETION_REPORT.md`, which does not exist. | — | Treat the README link as broken. |
| 8 | **Stale comments** describe removed behaviour: `ImageUploadField.tsx` ("localStorage"), `csp.ts` (mentions the deleted `BookModal.tsx`), `EmailVerifyBanner.tsx`, `artist-links.ts`, `queries.ts` ("mock"), `components/trust/ReportBlockDemo.tsx` (name only). | Code behaviour | Cosmetic. |
| 9 | **Privacy page** says "we don't use third-party advertising or … advertising cookies". Any future advertising product will contradict this copy. | — | Must be revisited if advertising is built. |
| 10 | **Notification type `match`** remains in `types.ts` although matching percentages were removed. | — | Legacy. |

### External dependencies and unknowns

- **Live Supabase project:** migrations `0020`–`0023` are **not applied** to the project configured in `.env.local` (confirmed: `bookings` is absent and `search_slots` is missing). Until they are applied, Discover shows its honest error state and no signed-in marketplace flow can run live. Applying them to existing live data also converts old `booked` applications to `confirmed` without a `bookings` row (disclosed risk).
- Whether that project is a throwaway test project or production: **unknown** (it holds 5 accounts and no listings; Stripe keys are test-mode).
- **Stripe:** test-mode keys are set; webhook endpoint registration, Connect settings, billing-portal settings and Smart Retries: **unknown / not verified**. A real test payment needs a connected test account.
- **Email:** Resend not configured. Supabase Auth email delivery (SMTP, templates, rate limits): unknown.
- **Scheduler:** nothing calls the two cron routes (Vercel Hobby allows only daily crons).
- **Hosting/deploy:** no target. **iOS:** App Store route, signing, and policy fit for selling a subscription inside a wrapped app: unknown.
- **Legal:** terms/privacy/trust text not reviewed by a lawyer (unknown). Next.js `next/og` security advisory noted earlier; upgrade to a patched 16.3.x release recommended.
- **Earlier audit gap:** the original schema let a client insert an application in any status. Migration `0020` restricts client inserts to `submitted` (or `shortlisted` for a promoter converting an "available" response) and removes client UPDATE on applications — but that protection exists only in the **unapplied** migration, so the live project does not have it yet.

## 9. Pricing and entitlements (facts only)

- **Support+ (promoters only):** £7.99/month or £89.99/year (`src/lib/pricing.ts`); inline Stripe `price_data`; cancel anytime via Stripe portal; access ends at period end after cancel; `past_due` keeps access while Stripe retries.
- **Free for everyone:** browsing, applying (no application fees), messaging, receiving bookings; promoters post unlimited listings, review every applicant, message artists, complete paid bookings (`FREE_INCLUDES` in `support-plus/page.tsx`).
- **Booking money:** promoter pays fee + travel (min £10 raised for >1 h travel) + booking fee (£10–£1,000) + processing (1.5% + 20p grossed up). Artist receives fee + travel in full. SupportSlot is not an escrow.
- **Not approved:** £9.99/£99. No artist subscription, no advertising pricing exists.

## 10. What is unknown or has not been tested

- Anything against the live Supabase project beyond the public pages (migrations missing).
- A real Stripe test-mode payment, Connect onboarding, webhook delivery, portal, refunds and disputes.
- Real concurrent behaviour (`scripts/live-journey.mjs` exists to prove it once migrations are applied; the in-process Postgres tests are single-connection).
- Email sending; scheduled jobs.
- Signed-in screens in a real browser or the iOS simulator (only visitor screens were viewed); the iOS date-field fix on a device.
- Accessibility audit (keyboard, screen reader, contrast) — no evidence of one.
- Performance, load, backups, monitoring/error tracking (none found).
- Image loading under the CSP (§8 #6).

## 11. Tests present

- `src/lib/*.test.ts` (14 files): pure logic — fit, dates, fees, routes, redirect, listing validation, profile checklist, schedule, availability, email sender, errors, password, username, artist-links.
- `tests/db/*.test.ts` (7 files): the **real migrations in an in-process Postgres (PGlite)** with stubbed Supabase auth/roles — RLS, triggers, the booking state machine, payments, webhooks (Stripe faked at the dependency boundary), subscriptions, rate limits, deletion, search, fee parity, and a **schema/code contract test** that fails if a column or RPC used in `src/` doesn't exist in the migrations.
- `supabase/tests/roster_and_requests_rls.sql`: a manual SQL check.
- `scripts/security-regression.mjs`, `scripts/live-journey.mjs`: live negative/journey tests against the configured Supabase project (synthetic users, deleted afterwards). Not run since migrations are missing live.
- No browser end-to-end tests exist.
