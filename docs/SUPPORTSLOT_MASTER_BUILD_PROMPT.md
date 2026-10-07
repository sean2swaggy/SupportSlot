> **SUPERSEDED (7 October 2026).** This prompt describes the earlier build that used Stripe payments,
> a booking fee, payouts and a paid "Support+" tier. Those were removed: Support Slot now handles no
> money, the promoter tools are free for every promoter, and the schema is one file
> (`supabase/migrations/0001_initial_schema.sql`). Sections that mention Stripe, payment states, booking
> fees, Support+ pricing/entitlements, webhooks, Connect, refunds or the 24-migration history no longer
> apply. See `docs/CURRENT_STATE.md` for what exists today. Regenerate this prompt before reusing it.

# SupportSlot — Master Build Prompt

_Paste everything below the line into a fresh Claude Code session. It is self-contained._
_Written 5 October 2026 from an audit of the existing repository. Confirmed requirements are marked **MUST**. Recommendations are marked **OPTIONAL**. Open questions are collected in §18._

---

You are a senior full-stack engineer. Your job is to **finish, verify and harden SupportSlot** — a UK marketplace connecting independent artists with promoters who post live support (opening-act) slots — or, if no repository is present, to **rebuild it** to the specification below.

## 0. Operating rules (read first)

1. **Inspect before changing.** If a repository is present, read `CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example`, `package.json`, `src/`, `supabase/migrations/`, `tests/` and `scripts/` first. **The code is the source of truth, not this document.** Where this document and the code disagree, report the conflict and ask; do not silently pick a new product direction.
2. **Preserve.** Keep the existing branding, copy tone, design system, architecture, dependencies and pricing. Avoid unrelated rewrites and speculative features. Make small, verified changes.
3. **Next.js 16 is not the Next.js you know** (middleware is called `proxy`; APIs changed). Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code.
4. **Implement and verify behaviour, not just screens.** A feature counts as done only when it works end to end against a real (local/staging) backend and has a test that would fail if it broke. A button that does nothing must either be wired up or honestly removed/disabled with an explanation.
5. **Report honestly.** Say what you ran, what passed, what failed, and what you could not test (and why). Distinguish: *implemented* vs *verified locally* vs *verified in staging* vs *ready for live*. Never claim production readiness without evidence.
6. **Approval gates.** Do **not** deploy, change production settings, charge real cards, send real notifications to real users, run destructive operations on any production database, or put live keys anywhere. Ask first. Use a local/staging/test project, **Stripe test mode**, and fictional data only.
7. **Never expose secrets or personal data** in code, logs, commits or replies. List environment-variable **names** and purposes only.
8. Ask the owner only about things that materially change implementation (§18). For everything else pick the conventional option and say so.

### Files that must accompany this prompt
Text alone cannot reproduce assets or code that were not supplied. Ask the owner to attach the **entire repository**, in particular:
- `src/` (all pages, components, `lib/`), `supabase/migrations/0001…0023_*.sql`, `supabase/tests/`, `tests/db/`, `scripts/`
- `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`, `CLAUDE.md`, `AGENTS.md`, `README.md`
- `capacitor.config.ts`, `ios/` (including `AppIcon` and `Splash` assets), `cap-www/`, `src/app/favicon.ico`
- **Not in the repository, so they cannot be recreated from text:** a logo file (the brand is currently a text wordmark), brand photography (all photos are `picsum.photos` placeholders), design files/screenshots, a production domain, Stripe/Supabase/Resend account configuration, legal text approved by a lawyer.

If you start from an **empty repository**: follow §5–§9 literally, recreate the schema as numbered migrations, flag every missing asset/decision, and do not invent brand imagery.

---

## 1. Product vision and audience

**Tagline:** "Find your next stage." SupportSlot is the place where independent artists find and apply for support slots at live shows, and where promoters post listings, choose an act and pay them through Stripe.

- **Artists** (solo acts and bands; emerging, developing or established) want real, fairly paid gigs in front of fitting audiences without paying to play.
- **Promoters** (independent promoters, venues, headliners) want to fill a slot quickly with a suitable act, handle the offer/booking/payment in one place, and stay in control of who they book.
- **Markets:** United Kingdom only. Six cities: London, Manchester, Birmingham, Bristol, Leeds, Brighton. Currency GBP. Dates are UK calendar dates (`YYYY-MM-DD`, Europe/London).
- **Core promise:** *No pay-to-play.* Artists never pay a promoter, venue or SupportSlot to apply or perform.

## 2. Product guardrails (MUST — apply to every decision)

1. Browsing gigs, applying, messaging and receiving bookings are **free** for artists, forever. No application fees.
2. **Paid membership and advertising must never improve application rankings, visibility to promoters, or selection priority.** Promoters choose who to book; nothing can be bought to influence that.
3. Any sponsored music placement (if ever built) must be **clearly labelled** and **separate from gig selection**.
4. **Preserve existing branding and design** unless explicitly told otherwise.
5. **Preserve existing approved pricing** (§12). £9.99/month and £99/year were *discussed as proposals* — they are **not** approved and must not be applied.
6. **Do not advertise unfinished capabilities.** No "coming soon" promises. **Do not invent** gig matches, match percentages, analytics, ratings, payment confirmations, verification claims, or "sent" statuses.
7. **Protect private records and enforce permissions on the server** (row-level security + SQL functions + route checks). The client UI is never the only barrier.
8. Use local/staging data and payment-provider **test mode** during development.
9. SupportSlot is **not an escrow** or a bank, and must not say it holds funds.

## 3. Roles and permissions

| Role | How obtained | Can |
|---|---|---|
| **Visitor** (signed out) | — | Browse home, Discover, Needed Tonight, slot pages, artist pages, Trust, Terms, Privacy, Help; sign up/log in. Cannot apply, save, message. |
| **Artist** | Chosen at signup; immutable | Edit own profile/tracks/links; search/save gigs; apply once per slot; withdraw; accept/decline offers; cancel own confirmed booking; message promoters in their application threads; block/report; set up payouts (Stripe Connect); answer availability requests/invitations; delete account/export data. |
| **Promoter** | Chosen at signup; immutable | Create/edit/close/reopen/cancel/reschedule own listings; view applicants for own listings only; mark viewed, shortlist, decline, make/withdraw offers; pay confirmed bookings; message applicants; discover artists and invite them; report; **Support+** tools (roster, templates, availability requests, show schedule, CSV export). |
| **Moderator** (`profiles.admin_role='moderator'`) | Set by hand in SQL only | Reports, support inbox, suspend/unsuspend, remove listings, users search, audit log. |
| **Admin** (`admin_role='admin'`) | Set by hand in SQL only | Everything a moderator can, plus payments overview and setting verification. |
| **Suspended** | By staff | Only `/suspended`, support, privacy, terms, trust. |

Rules: no public admin signup; a user cannot change their own role, staff fields, suspension, or email in `profiles`; promoters cannot reach artist-only routes and vice-versa (redirect to own home).

## 4. Existing stack (keep it)

- **Next.js 16.3.5** App Router, **React 19.2**, **TypeScript**, **Tailwind CSS v4** (design tokens in `src/app/globals.css` `@theme inline`).
- **Supabase**: Auth (email+password, **mandatory TOTP 2FA**), Postgres with RLS, SQL functions via RPC; `@supabase/ssr`, `@supabase/supabase-js`.
- **Stripe**: PaymentIntents (Payment Element) with **destination charges**; **Connect v2 recipient accounts** (GB) for artists; **Billing** for Support+ via Checkout + customer portal; webhooks. Packages: `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`, `@stripe/connect-js`.
- **Email:** Resend via an outbox table + cron (optional until configured).
- **Fonts self-hosted:** `@fontsource/space-grotesk`, `inter`, `jetbrains-mono`.
- **iOS:** Capacitor 8 shell that loads the deployed site by URL (`capacitor.config.ts`, `CAP_SERVER_URL`); not a static export.
- **Tests:** Vitest; `@electric-sql/pglite` runs the real migrations in-process.
- **Commands:** `npm install`, `npm run dev` (http://localhost:3000), `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` (must be clean).

### Architecture rules (MUST keep)
1. **The database is the authority.** State changes (application → offer → booking → payment; listing close/cancel/reschedule; notifications) are SQL functions that lock rows in a fixed order (**slot → application → other applications**), check who is asking and the current state, and are **idempotent**. Clients have **no direct UPDATE** on `applications`/`bookings`. UI calls typed wrappers that return a `Result`; never show success before the server confirms.
2. **Money is integer pence**, computed in SQL and stored on the `bookings` row as a snapshot. The browser never sends an amount. TypeScript fee code only *previews* and a parity test proves it matches SQL.
3. A booking is **paid only** via a verified Stripe webhook or a provider-verified sync route — never because a page loaded.
4. **One pure access function** (`decideAccess` in `src/lib/routes.ts`) used by the proxy (real enforcement) and mirrored by the client shell. `next` redirects only pass through a safe-path validator.
5. **Schema/code drift fails a test** (contract test checks every `.from().select/insert/update` column and `.rpc()` name/arg against the migrations).
6. **Staff and payment tables are service-role only**; admin functions check role in SQL and write an audit row.
7. Client store (`useStore()`) reloads on focus and every 45 s; if the initial load fails show a retry screen, never an empty dashboard.

## 5. Screen-by-screen specification

Navigation: top navbar on desktop; fixed bottom `MobileNav` on phones. Visitor nav: Find a Slot · Last-Minute · Trust & Safety · Help; Log in / Sign up. Artist nav: Find a Slot · Last-Minute · Saved · Applications · Messages · Requests (+ notification bell, avatar → dashboard, settings, "Admin" if staff). Promoter nav: Discover Artists · My Gigs · Applications · Artist Roster · Messages · Support+ (+ "Post a slot"). Footer: product, role links, legal.

### Public
| Route | Purpose / content |
|---|---|
| `/` | Hero ("Find your next stage."), CTAs *Find Support Slots* / *Last-Minute Support*, "Now booking in" six cities, open slots grid (empty state "No open slots yet"), "Needed tonight" strip when urgent slots exist, 3-step How it works (Discover → See how it fits → Apply), featured artists strip. Promoters are redirected to `/discover`. |
| `/discover` | Heading "Support opportunities". Search box (headliner/venue/city) + filters: Where, Genre, When (7 days / 31 days / 3 months), Pay (£80+/120+/150+/200+), Venue size (<250 / 250–400 / larger), Artist size, Distance (artists only, from their city), Sort (Soonest / Highest fee / Newly posted). Server-side paginated query; URL-synced; loading, empty, error-with-retry states. For promoters this route shows **Discover Artists** (filters: genre, location, distance) with *Invite to gig*. |
| `/last-minute` | "Needed tonight": urgent open listings, "Live now" pulse, artist toggle "Alert me about last-minute slots" (in-app notification only). |
| `/slot/[id]` | Listing detail: headliner, venue, date, doors/set times, set length, genres, expected attendance, fee + travel, requirements, description, "Posted by", applicant count, fit explanation for artists. CTAs by state: visitor → sign up/log in (with `next`); artist → Apply / Save / "Your application" status; owner promoter → Manage applicants / Edit; other promoter → note that promoters can't apply. "No application fees." |
| `/artist/[handle]` | Public artist page: name, avatar/banner, location, genres, size, availability, self-reported monthly listeners (labelled), bio, tracks with links, social links, live-video link, verification badge, shows; Save to roster (Support+) / Invite (promoter). |
| `/trust`, `/terms`, `/privacy`, `/support` | Trust & Safety (no pay-to-play, no application fees, transparent compensation, verification badges, payment info, cancellation policy, how to report), Terms, Privacy, contact-support form (works signed in or out). |

### Auth & onboarding
`/login` (login + signup modes, role choice at signup, password strength meter, "user already registered" guidance, `next` honoured) · `/forgot-password` → `/reset-password` · `/auth/callback` (email-link code exchange) · `/mfa-setup` (QR + TOTP enrol) · `/mfa-challenge` · `/onboarding` (step 1 username + date of birth with ≥16 age gate, DOB never stored; artist: photo, name, city, genres, Spotify/Instagram, bio, verify email; promoter: photo, company, city, verify email) · `/suspended`. The access order in the proxy is: signed-out → onboarding → 2FA setup → 2FA challenge → suspension → role access.

### Artist area
- `/dashboard/artist` — greeting, profile checklist/"Finish profile", suggested open slots (by fit), applications summary, bookings & payout panel (paid / awaiting payment, "Able to receive payments ✓" or "Payout setup needed", Stripe onboarding + dashboard links, recent bank payouts from Stripe, receipt links).
- `/dashboard/artist/profile` — edit name, bio (≤1000), genres (≤5), location, travel radius (0–500), availability (Available / Limited / Not taking shows), artist size, avatar/banner, links, live-video link (no hosting), monthly listeners (self-reported), tracks (title, length `m:ss`, optional link, ≤ limits), profile checklist, "How a promoter sees you" preview.
- `/applications` — every application with status pill, offer terms, **Accept / Decline** (reason), **Withdraw**, **Cancel booking** (reason), payment status/receipt, link to message thread. Empty state.
- `/saved` — saved gigs, plus "No longer open" group.
- `/requests` — availability requests and gig invitations from promoters: *Available / Unavailable / Ask a question*.
- `/messages`, `/settings` (password change, email-notification switch, blocked promoters list, download my data, delete account with typed `DELETE` confirmation).

### Promoter area
- `/create-slot` — step 1 form: headliner/show name, optional headliner and reference photos, venue (from the 6 curated venues), date, doors/set times, set length, genres, expected attendance, artist-size fit (optional), support fee (£), travel contribution (£), **SupportSlot booking fee** (£, see §18), application deadline, requirements (one per line, max 10), description (≤2000), "last-minute" flag. Step 2 **preview** ("how artists see it; nothing is public until you publish") then publish. Inline field errors from shared validation + server errors surfaced. "No listing fees."
- `/promoter/slot/[id]/edit` — same form; date/venue/times/money lock once an offer or confirmed booking exists (explain how to proceed).
- `/dashboard/promoter` — "Needs your attention", My Gigs with status/applicant counts, links to applicants, Discover artists, roster, post slot.
- `/promoter/slot/[id]/applicants` — owner only. Each applicant: profile summary, fit explanation, featured track, message, status. Actions: shortlist, decline (optional reason), **make offer** (shows full terms and total before sending), withdraw offer, open message thread, report. Listing actions: close/reopen, cancel (reason), reschedule (blocked while offers are outstanding), **Pay** for a confirmed booking (Payment Element modal). Opening this page marks `submitted` applications as **viewed** (and notifies the artist honestly: "a promoter has looked at your application").
- **Support+ pages (promoter, Support+ gated):** `/dashboard/promoter/roster` (private roster with notes/tags, booking history), `/dashboard/promoter/requests` (availability requests + templates), `/promoter/slot/[id]/schedule` (show schedule: arrival, load-in, soundcheck, doors, performance, changeover, break; stages; drag order; templates; draft/final).
- `/support-plus` — pricing, Free vs Support+, monthly/annual toggle, checkout, status (active/past_due/cancelling/ended), manage billing (Stripe portal). Artists see "A promoter tool … everything you use to find gigs, apply, message and get paid stays free."

### Staff
`/admin` — tabs: **Reports** (reviewing / actioned / dismiss), **Support** (mark answered), **Users** (search, suspend with reason, unsuspend, mark/remove verified — admin only), **Listings** (search, remove with reason), **Payments** (admin only: bookings, payment status, refunded amount, flags such as refund review/dispute), **Audit** (immutable log). Every action writes `admin_audit_log` inside the SQL function.

### API routes
`/api/bookings/[id]/pay`, `/api/bookings/[id]/sync`, `/api/stripe/connect/{onboard,return,dashboard,payouts}`, `/api/stripe/subscriptions/{create-checkout,portal,return}`, `/api/stripe/webhooks`, `/api/account/{export,delete}`, `/api/reports/bookings` (CSV), `/api/support`, `/api/cron/{expire-offers,send-emails}`. All authenticated routes verify the user and role server-side; abuse-prone routes are rate-limited (Postgres limiter).

## 6. End-to-end journeys (each must work and be tested)

**A. Account lifecycle:** sign up (role) → 2FA enrol → onboarding → email verification → log out/in (challenge) → forgot/reset password → return to the page that required login → change password → export data → delete account (blocked while a confirmed upcoming booking or unresolved payment exists; financial records kept, names snapshotted).
**B. Artist profile:** complete profile with tracks and links → public page reflects it → invalid links/URLs rejected → availability changes reflected in discovery.
**C. Discovery:** signed-out and signed-in search/filter/sort/paginate; save/unsave; closed/past listings never shown as open; "fit" shows only real fields, "unknown" when data is missing.
**D. Promoter listing:** create → validate → preview → publish → appears in Discover → edit → close/reopen → cancel → reschedule (artist notified) — owner-only throughout.
**E. Application → booking:** apply (once; duplicate/concurrent submit safe) → promoter views → shortlists/declines → makes offer (terms stored) → artist accepts → booking confirmed, slot `filled`, all other live applications `declined`/offers `withdrawn` and notified → either side may cancel with reason. **Two artists accepting the same slot at the same instant: exactly one wins.** Offers expire (see §7).
**F. Messaging:** threads exist per application; messages persist, unread counts, pagination, failed-send retry, no false "sent"; promoters blocked by an artist cannot message; report and block work; email notification only via configured provider and never claimed sent without provider confirmation; spam/rate controls.
**G. Payments:** artist completes Stripe Connect onboarding → promoter pays a confirmed booking (server-calculated amount) → webhook (or verified sync) marks it paid → artist and promoter see status and the Stripe-hosted receipt → failed/processing/refunded/disputed states render correctly. Retried/duplicate/out-of-order webhooks are harmless.
**H. Support+:** promoter checks out → entitlement set only by webhook/verified return → benefits unlock → failed payment keeps access while Stripe retries and shows a banner → cancel in portal keeps access to period end → lapse hides write access (and, for Show Schedule, read access) without deleting data.
**I. Staff:** reports, support requests, suspension (suspended user is locked out of marketplace actions), listing removal, verification, payments view, audit trail.
**J. Notifications:** in-app list with unread state for offers, status changes, messages, bookings, payments; "Needed tonight" alerts to opted-in artists whose radius covers the city.

## 7. Business rules and state machines

### Listing (`slots.status`)
`open → closed` (promoter; blocked if a confirmed booking exists) · `closed → open` (promoter; only if date and deadline still in the future) · `open → filled` (only when an offer is accepted) · any non-closed/cancelled → `cancelled` (promoter, reason optional; cancels confirmed bookings and withdraws offers, notifies everyone; flags paid bookings for refund review). Clients cannot set `filled`/`cancelled` directly.
**Insert rules (server):** starts `open`; show date and deadline not in the past; deadline ≤ show date; headliner 1–120 chars; description ≤ 2000; support fee £0–£100,000; travel £0–£5,000; **booking fee £10–£1,000**; set length 5–240 min; attendance ≥ 1; ≥ 1 genre; ≤ 10 requirements; ≤ 10 listings per hour per promoter; suspended promoters refused. Material fields (date, times, city, venue, money, length) are **locked** once a booking is `offered` or `confirmed`; only `reschedule_slot` may change date/times (blocked while offers are outstanding; notifies the confirmed artist).
**Discovery "active":** status `open` AND deadline ≥ today AND show date ≥ today (UK time).

### Application (`applications.status`)
`submitted → viewed` (promoter opens applicants) · `submitted|viewed → shortlisted` · `submitted|viewed|shortlisted → declined` (reason `promoter_declined`) · `submitted|viewed|shortlisted → offered` (via make-offer) · `offered → confirmed` (artist accepts) · `offered → offer_declined` (artist declines) · `offered → shortlisted` (promoter withdraws offer, or offer expires) · `submitted|viewed|shortlisted|offered → withdrawn` (artist) · `confirmed → cancelled` (either party; reopens the slot if the show is still in the future) · `* → declined` when the slot is filled by another artist (reason `slot_filled`). A promoter cannot decline an application that has an outstanding offer (withdraw it first). Invalid transitions raise a named error the UI turns into a plain message.
**Apply rules:** only to an `open` slot before its deadline; one per (slot, artist) (unique); message ≤ 500 chars in DB (UI currently shows 280 — keep UI ≤ DB); featured track must belong to the applicant; ≤ 20 applications/hour/artist; suspended users refused.

### Booking (`bookings.status`) and terms snapshot
`offered → confirmed | declined | withdrawn`; `confirmed → cancelled`. Created only by `make_offer`. At offer time snapshot (integer pence): fee, travel, booking fee, processing fee, total (`total = fee + travel + booking fee + processing`, check constraint), plus artist/promoter/headliner/venue/date/times/requirements names so records survive account deletion. Offer expiry = the later of *now + 2h* and the earlier of *now + 7 days* and *show start*; a cron expires stale offers (back to `shortlisted`, both sides told). **At most one `confirmed` booking per slot** (partial unique index) and **one live booking per application**.
**Fees (as coded):** processing fee = ((1.5% × base) + 20p) grossed up so the artist's amount is intact: `P = ceil((15·base + 20000) / 985)` pence where `base = fee + travel + booking fee`. Travel: the promoter's contribution is raised to a **£10 minimum when the artist's home city is > 1 hour (≈ 40 mph from a stored city-distance table) from the venue city**. The artist receives fee + travel in full; SupportSlot keeps booking fee + processing line (as the Stripe `application_fee_amount`).

### Payment (`bookings.payment_status`)
`unpaid → processing → paid → partially_refunded | refunded`; `failed` (retryable); `disputed` (reversed only when a dispute is lost). Changed **only** by verified events through idempotent SQL functions that check PaymentIntent id and amount against the stored terms and ignore older events. Refunds are issued by an admin in the Stripe Dashboard; the webhook records them. Cancelling a paid booking sets `refund_review_required`; **no automatic refund** and the UI never promises one. Receipts are Stripe-hosted URLs.
**Webhook events handled:** `payment_intent.processing|succeeded|payment_failed`, `charge.refunded`, `charge.dispute.created|closed`, `customer.subscription.created|updated|deleted`. Signature verified against the raw body first; each event id stored once (`stripe_events`).

### Support+ subscription (promoters only)
Stripe subscription status → entitlement: **on** for `active`, `trialing`, `past_due` (grace while Stripe retries; user is warned); **off** for `canceled`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`. Cancelling in the portal keeps access until the paid period ends. The end of an *old* subscription must not revoke a newer one. Entitlement flags are writable only by the billing system (client trigger blocks them). Checkout refuses if Stripe already shows a live subscription for the customer. Core marketplace features never depend on Support+.

### Notifications and email
`notify()` writes an in-app row with a dedupe key and optionally an `email_outbox` row (respecting `profiles.email_notifications`). The cron sends via Resend and marks `sent` **only** after a 2xx with a message id; ≤ 5 attempts; with no provider configured nothing is marked sent. Only transactional mail (offers, bookings, payments) — no marketing.

### Messaging rules
One thread per (artist, promoter, application context). Message 1–2,000 chars; ≤ 20/min/sender; blocked promoter cannot start/continue; suspended sender refused; recipient gets one unread "new message" notification per thread until read.

## 8. Data entities and constraints

Keep the existing schema (23 ordered migrations). Entities and the constraints that matter:

- **profiles** (1:1 `auth.users`): `role` (artist|promoter, immutable), `username` (3–20 `[A-Za-z0-9_]`, globally unique, case-insensitive), `has_onboarded`, `email`, `email_notifications`, `suspended_at/reason`, `admin_role` (admin|moderator|null), Support+ fields (`is_support_plus`, `support_plus_status`, `…_billing_period`, `…_current_period_end`, `…_cancel_at_period_end`, `…_event_at`, `stripe_subscription_id`).
- **artists** (id = profile id): unique `handle` (fixed after creation), name ≤ 80, bio ≤ 1000, location ∈ 6 cities, genres ⊂ 12 genres (≤ 5), links, `monthly_listeners` (self-reported), `availability` (available|limited|unavailable), `travel_radius_miles` 0–500, `verification`, `artist_size` (emerging|developing|established), `last_minute_alerts`, image fields (https or resized data URL only). Children: **artist_tracks** (title, duration, optional link/cover), **artist_shows** (past|upcoming).
- **promoters:** name, company, avatar, location, verification, shows_posted.
- **venues** (curated, no client writes): Village Underground (London, 780), YES Basement (Manchester, 350), Strange Brew (Bristol, 250), The Snug (Birmingham, 180), The Warehouse Exchange (Leeds, 420), The Arch Room (Brighton, 300).
- **slots:** see §7; plus `is_urgent`, `artist_size_fit[]`, `requirements[]`, `applicant_count` (trigger-maintained), `closed_at/reason`.
- **applications:** unique (slot, artist); status per §7; `viewed_at`, `status_changed_at`, `closed_reason`, `featured_track_id`, `message`. **No match score column in use.**
- **bookings:** terms snapshot (pence), status, payment fields (`payment_status`, PaymentIntent/charge ids, `receipt_url`, `paid_at`, `refunded_pence`, `refund_review_required`), expiry, cancellation fields. FKs are `ON DELETE SET NULL` so financial records outlive accounts.
- **payment_events, stripe_events, artist_payment_accounts, promoter_billing** — private, service-role only.
- **message_threads / messages** (per-participant read state), **notifications** (dedupe key), **email_outbox**, **saved_slots**, **promoter_blocks**, **reports** (context ∈ availability_request|message|slot|profile|application|booking|other), **support_requests**, **admin_audit_log**, **rate_limits**.
- **Support+ data:** **artist_roster**, **event_templates**, **availability_requests (+recipients)**, **gig_invitations**, **show_schedules / schedule_entries / schedule_templates (+entries)**.
- Legacy: **wallet_transactions** (unused). Do not build features on it; propose removal.
- RLS enabled on every table; clients read only what they should (participants see their own applications/bookings/threads; the public sees listings, venues, artist/promoter profiles).

## 9. Design system (preserve)

- **Tone:** dark, editorial, gig-poster. **Square corners everywhere**, hairline borders, generous uppercase display type, monospace uppercase labels, subtle grain, restrained motion (`prefers-reduced-motion` honoured). Dark only (`color-scheme: dark`).
- **Colour tokens:** ink `#0a0a0b`, ink-raised `#121214`, ink-card `#17171a`, ink-border `#29292e`, paper `#f4f2ec`, paper-dim `#a9a7a0`, **acid `#d6ff3f`** (primary accent/CTA), acid-ink `#10140a`, signal `#ff5a36` (errors/destructive), ok `#38e08f`.
- **Typography:** Space Grotesk 500/600/700 for display (uppercase, tight leading); Inter 400/500/600 body; JetBrains Mono 400/500/700 for eyebrows ("tracking-[0.25em]"), buttons and data labels.
- **Wordmark:** `SUPPORT/SLOT`, display font, uppercase, the slash in acid. Keep as text unless the owner supplies a logo file.
- **Components:** `Button` (primary acid; secondary paper; ghost; outline; danger; sm/md/lg; mono uppercase), `Modal` (focus-managed), `Select`, `Tag`, `SectionHeading` (eyebrow + title + action), `StatCard`, badges (verified, Support+), urgent pulse, slot/artist cards. Cards: `ink-card` background + `ink-border`.
- **Responsive:** mobile-first; bottom nav on phones; inputs 16 px on touch devices (stops iOS zoom); date/time inputs must not overflow narrow screens; no horizontal page scroll; ≥ 44 px tap targets.
- **Accessibility (MUST verify):** keyboard operable, visible focus, labelled inputs, `aria-live`/`role="alert"` for errors and status, modal focus trap and Escape, colour contrast ≥ WCAG AA (check acid-on-ink and paper-dim), no information by colour alone, reduced-motion.

## 10. Pricing and paid entitlements

**Confirmed (in code today — preserve):**
- **Support+ (promoter subscription): £7.99 per month or £89.99 per year**, defined once in `src/lib/pricing.ts` and used by the page and checkout; created with inline Stripe `price_data` (currency GBP); cancel anytime; the savings label is computed from those two numbers.
- **Free for all:** browse, apply (no application fees), message, receive bookings; promoters can post unlimited listings, review every applicant, message artists, complete real paid bookings.
- **Booking money:** promoter pays fee + travel + SupportSlot booking fee + processing; the artist keeps fee + travel in full; no escrow.
- **Support+ benefits that exist and are server-enforced:** private artist roster (notes/tags), reusable request templates, availability requests to roster artists (guidance only — not a reservation), **show schedule builder**, bookings/payments CSV export.

**Proposals / not approved:** £9.99/month and £99/year; any artist subscription; any advertising or sponsored placement; any benefit not in the list above.
**Rules:** never advertise a benefit that is not built and enforced; never let a paid tier affect ranking, visibility or booking priority; when pricing changes, change `pricing.ts` only and update copy/tests together. The show-schedule benefit is enforced in the DB but missing from the Support+ page copy — **ask the owner** (§18) whether to advertise it.

**Advertising (not built):** if the owner approves it later, build it as a **separate phase** with: clearly labelled "Sponsored", completely separate from gig search/selection and applicant ordering, no effect on fit or ranking, honest reporting (only measurable impressions/clicks you actually record), updated Privacy/Terms text, and its own acceptance tests.

## 11. Security, privacy, moderation, payments (MUST)

- **Authorisation on the server** for every read/write (RLS + SQL function checks + route checks). Negative tests: artist cannot read another's applications; promoter cannot see another promoter's applicants/roster; artist cannot call promoter functions; no client UPDATE on bookings/applications; users cannot change role/staff fields/entitlement fields.
- **Secrets:** service-role, Stripe secret and webhook secrets, `CRON_SECRET`, `RESEND_API_KEY` are server-only; never in client bundles, logs or commits. Test-mode Stripe keys only until the owner approves go-live.
- **Input:** validate server-side (lengths, ranges, enums, URL schemes — only `http(s)`; image URLs https or resized data URLs). Escape CSV against formula injection. No raw HTML rendering of user text.
- **Headers:** keep CSP, `X-Frame-Options: DENY`, HSTS, `nosniff`, referrer and permissions policies (`next.config.ts`, `src/lib/csp.ts`). **Check that every image source the app uses is allowed by the CSP** (placeholder venue photos currently are not).
- **Abuse:** Postgres rate limits on applications, listings, messages, reports, checkout and support; uniform safe error messages; no user enumeration beyond Supabase defaults.
- **Privacy:** minimise stored data (DOB never stored); data export and account deletion work; PII never in logs or URLs; Privacy page must match reality.
- **Moderation:** report from listings, profiles, messages, applications, bookings; block promoter; staff review with an audit trail; suspension; listing removal; no public admin signup.
- **Payments:** amount/recipient/currency decided only on the server from the stored booking; PaymentIntent bound to that booking; webhook signature verified on the raw body; replay/duplicate/out-of-order safe; do not store card data; checks Stripe for the artist's real transfer capability on every payment; reconcile via the sync route; never show "paid" without provider confirmation; disputes and refunds recorded separately; no claim of escrow, guaranteed payment, or instant payout.
- **Do not claim verification** (a badge means staff checked); show "self-reported" where data is self-reported.

## 12. Error, loading, empty, success and recovery states (MUST for every screen)

- **Loading:** skeletons/spinners with `aria-busy`; never a blank flash; buttons disable and show progress while submitting (prevents double submits).
- **Empty:** every list has a specific, helpful empty state with the next action (e.g. "No applications yet" → Find a slot).
- **Error:** network/server failure shows a plain message with **Try again**; the global store shows a retry screen if the first load fails; field-level validation errors are tied to inputs; never silently swallow a failed write; never show success first.
- **Success:** explicit confirmation only after the server confirms (e.g. "Application submitted", "Offer sent", "Payment received" only after webhook/verified sync).
- **Recovery:** failed message → retry; expired offer → clear explanation and next step; `slot_filled`/`offer_expired`/`applications_closed` → plain-language messages; stale page → refresh prompts; payment `processing` → "waiting for confirmation" without double-charging; abandoned checkout can resume.
- **Honest unavailability:** if a capability cannot work (e.g. artist has no payout account, email provider not configured) say so; do not fake it.

## 13. Phased implementation priorities

**Phase 0 — Inspect and baseline.** Read the repo; run `npm install`, `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`; record real results. Confirm which migrations are applied to the target database (the target must be a **local/staging/test** project). Produce a short gap list.
**Phase 1 — Core booking journeys (highest priority).** Accounts + 2FA + onboarding; artist profile; public discovery; listing create/preview/publish/edit/close; apply; applicant management; offer/accept/decline/cancel; overbooking protection; honest "viewed". Verify with real signed-in sessions and the two-parallel-accept test.
**Phase 2 — Messaging and notifications.** Threads, unread, pagination, retry, block/report, notification list, outbox (provider optional).
**Phase 3 — Payments.** Connect onboarding, pay a booking (test mode), webhooks, sync, receipts, refund/dispute recording, failed/processing states, admin payments view.
**Phase 4 — Support+.** Checkout, status, portal, cancel, failed payment, entitlement enforcement; only advertise built benefits.
**Phase 5 — Staff and trust.** Admin console, support inbox, suspension, verification, audit.
**Phase 6 — Hardening.** Accessibility audit, responsive QA (including iOS wrapper), CSP/image check, rate-limit tests, logging/monitoring decision, cron scheduling, docs.
**OPTIONAL / only with owner approval (do not treat as launch requirements):** past-show editor for artists; press kit/EPK; thumbnail upload for the live-video link; embedded music players; Spotify OAuth; in-app refund button for admins; SupportSlot-generated receipts/invoices; artist-side calendar; advertising/sponsored placements (separate phase, §10); removal of the unused `wallet_transactions` table; light theme.

## 14. Acceptance criteria and tests

Write **meaningful automated tests** (not tests that merely call mocks). Layers: pure logic (Vitest), **real-migration Postgres tests** (PGlite) for RLS/triggers/state machine/payments/subscriptions/rate limits/deletion/search, a **schema↔code contract test**, route-handler tests with Stripe faked at the boundary, and **browser end-to-end tests** against a local server with synthetic accounts and Stripe test mode. Mark which tests use real providers and which use mocks. At minimum cover:

1. Signup → 2FA → onboarding → logout/login → password reset; return-to-page; safe-redirect rejection of external URLs.
2. Artist profile validation (links, lengths, genres, radius).
3. Public search/filter/sort/pagination; closed/past listings excluded; saved gigs.
4. Listing validation, preview, publish, owner-only edit/close/cancel/reschedule; locked fields once an offer exists.
5. Apply once; duplicate and concurrent submits; closed/after-deadline refused; track ownership.
6. Full state machine incl. viewed, shortlist, decline, offer, withdraw, accept, decline, expire, cancel, withdraw application; illegal transitions rejected.
7. **Concurrency:** two artists accept simultaneously → exactly one confirmed; five simultaneous duplicate applications → one row (use real parallel connections against a real Postgres/Supabase).
8. Fees: SQL vs TypeScript parity; total check; travel minimum; client cannot alter amounts.
9. Messaging: persistence, unread, pagination, retry, block, rate limit, email never marked sent without provider ID.
10. Payments: pay → webhook paid; duplicate/out-of-order events; failed; refund; dispute; amount mismatch rejected; unconnected artist handled; real Stripe **test-mode** payment performed manually and documented.
11. Support+: checkout → entitlement via webhook; past_due grace; cancel-at-period-end; lapse; old-subscription end doesn't revoke new one; benefits blocked server-side when not entitled; **ranking/selection unaffected**.
12. Admin: only staff can call staff functions; audit rows written; suspension blocks actions; no public admin signup; listing removal.
13. Negative/permission tests for every role boundary in §3 and §11.
14. Accessibility checks (axe or equivalent + manual keyboard pass) and responsive screenshots at phone/tablet/desktop.

**Run and report:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, e2e, plus live scripts if present. Quote real output. State exactly what could not be tested.

**Definition of done for a feature:** works end to end locally; has a failing-if-broken test; error/empty/loading states exist; permissions enforced server-side; copy is honest; documented; reported with evidence.

## 15. Local setup, test accounts, sample data, browser preview (MUST provide)

1. `npm install`; copy `.env.example` → `.env.local`; fill values for a **local/staging** Supabase project and **Stripe test-mode** keys (never live).
2. Apply migrations `0001…0023` **in order** to the **test** database only (Supabase SQL editor or CLI/Docker if available). Confirm with a read-only check. If only a hosted project exists and you cannot tell whether it is production, **stop and ask**.
3. `npm run dev` → http://localhost:3000; keep it running; give the owner the exact URL; open it in the browser preview and verify pages there.
4. Provide an **idempotent fixture script** (clearly fictional, refuses to run unless the target project id is explicitly confirmed and Stripe is in test mode) creating: one artist, a **second artist** (to check account separation), a **promoter (free)**, a **promoter on Support+**, an **admin**, and several extra fictional artists. Because 2FA is mandatory, pre-enrol TOTP for the login accounts and provide a small helper that prints the current code; store generated passwords/secrets in a **gitignored** file, not in chat or the repo.
5. Seed fictional data: artist profiles with bios, genres, sample music **links** (obviously fake/`example.com`), tracks; open, urgent, **closed**, **cancelled** and **filled** listings; applications in every stage; pending offers; confirmed bookings (unpaid — do not fabricate paid payments); conversations and notifications; free and Support+ membership states; saved gigs; a report. Create it **through the real SQL functions/RPCs** so data matches what the app produces. Re-running must not duplicate and must not overwrite user edits. Offer a guarded reset flag for fixture rows only.
6. Document a walkthrough for artist, promoter and admin, and a clear list of what needs a Stripe test connected account (real payment), a webhook forwarder (`stripe listen`), or an email provider.

## 16. Environment configuration and external setup (names and purposes only)

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser+server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser+server | Public anon key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Webhooks, payments, cron, deletion, support inbox, fixtures |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | browser | Stripe.js (test key until launch) |
| `STRIPE_SECRET_KEY` | **server only** | Stripe API (`sk_test_…` until launch) |
| `STRIPE_WEBHOOK_SECRET` | **server only** | Verifies webhook signatures |
| `NEXT_PUBLIC_SITE_URL` | server | Canonical origin for Stripe return URLs and emails (`http://localhost:3000` locally) |
| `CRON_SECRET` | **server only** | Bearer token the scheduler sends to `/api/cron/*` (routes refuse everything if unset) |
| `RESEND_API_KEY`, `EMAIL_FROM` | **server only** | Optional email provider; without them nothing is sent or reported sent |
| `CAP_SERVER_URL` | build time | URL the iOS shell loads |

**External steps (owner/approval required):** create a *separate* Supabase test project; apply migrations; configure Supabase Auth email (SMTP/templates, redirect URLs); set the first staff member by hand (`update public.profiles set admin_role = 'admin' where email = '…'`); register the Stripe webhook endpoint `https://<site>/api/stripe/webhooks` with the nine events in §7; enable Connect (GB recipient accounts); enable Billing Portal cancellation/payment-method update; enable Smart Retries and failed-payment emails; schedule `/api/cron/expire-offers` (every 15–60 min) and `/api/cron/send-emails` (every 5–10 min) with a scheduler that supports it (Vercel Hobby is daily-only); optional Resend domain; hosting; domain; lawyer review of Terms/Privacy/Trust.

**Deploy/rollback (describe, do not execute without approval):** back up first; apply migrations to staging, run the live scripts and a manual Stripe test-mode booking and Support+ checkout there; verify webhooks and crons; deploy staging → verify → only then propose production. Note migrations `0020–0023` convert legacy `booked` applications to `confirmed` and add constraints that existing rows may violate (the migration fails atomically with a message) — rehearse on a copy. Provide a rollback note (restore backup; migrations are not auto-reversible) and a post-deploy checklist (login, discover, apply, offer, pay with test card in staging, webhook receipt, admin access).

## 17. Known issues to resolve or confirm (found in the existing code)

1. **Image CSP:** `img-src` allows only self/data/blob/Supabase; seeded venue photos are `https://picsum.photos/…` and the DB accepts any `https://` image URL → likely blocked. Verify in a browser; fix by hosting images in Supabase Storage (bucket migration exists but is unused) or by an approved allow-list.
2. **Support+ page omits the Show Schedule benefit** that the DB enforces (§10 / §18).
3. **Landing copy** says apply with "a track and a live clip"; the apply modal chooses a track only. Align copy (preferred) or UI.
4. **Application message limit** UI 280 vs DB 500.
5. **Past shows** exist in the schema but have no editor; **no press kit** exists; live video is a link only.
6. **No scheduler** is configured; **no error monitoring**; **no CI**; **no e2e browser tests**; **no accessibility audit**.
7. **Stale comments** (localStorage/mock/BookModal) and a legacy notification type `match`; unused `wallet_transactions` table; README links to a missing `docs/COMPLETION_REPORT.md`.
8. **iOS:** the shell defaults to `localhost`; production URL, signing, store listing and App Store policy for selling a subscription via web checkout inside the app are unresolved.
9. Terms/Privacy/Trust text has not been legally reviewed. Upgrade Next.js to a patched 16.3.x (`next/og` advisory).

## 18. Decisions that need the owner's input

1. **Which database is the test target?** Create a separate Supabase test project (recommended) or confirm in writing that the existing project is not production. Never apply migrations or seed data until answered.
2. **Booking fee model:** today the *promoter* sets "SupportSlot booking fee" (min £10, max £1,000, default £12). Should SupportSlot set a fixed fee or percentage instead? What is the intended revenue model?
3. **Support+ price:** keep £7.99/£89.99 (current), or approve a change (£9.99/£99 was only discussed)?
4. **Show Schedule:** advertise it as a Support+ benefit, or remove its gating?
5. **Advertising/sponsored music:** build it (separate phase) or leave it out? If yes: format, placement, pricing, reporting, and privacy-copy changes.
6. **Press kits/EPK, past-show editor, hosted video:** wanted for launch or later?
7. **Images:** supply brand photography/logo? Use Supabase Storage for uploads?
8. **Refunds:** keep admin-in-Stripe-Dashboard, or build an in-app admin refund action (with audit)?
9. **Past-due grace:** keep Support+ on while Stripe retries (current), or cut access at first failure?
10. **Offer window and cancellation policy:** keep ≤ 7-day offers and cancel-with-reason, or add fees/deadlines?
11. **Hosting, domain, scheduler and email provider** choices; whether the iOS app is a launch goal.
12. **Legal:** who reviews Terms/Privacy/Trust before launch?

## 19. How to report back

When you finish a phase, give: (1) a checklist of what now works per journey A–J with **how it was verified**; (2) files changed and why; (3) every command run with real results; (4) failures and remaining bugs; (5) external blockers and exact owner actions; (6) env var names and migration/webhook/provider steps; (7) a clear split — **implemented / verified locally / verified in staging / ready for live** — with "ready for live" claimed only when evidence exists and the owner has approved. Ask before any deploy or destructive production action.
