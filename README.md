# Support Slot

**Find your next stage.**

A prototype marketplace where musicians find and apply for support/opening
slots at live shows, and promoters/venues/headliners find suitable emerging
artists to fill them. Built as a front-end-first MVP with realistic mock
data — no backend or API keys required to run it.

---

## 1. Running it locally

Requirements: **Node.js 18.18+** (Node 20+ recommended) and npm.

```bash
cd support-slot
npm install
npm run dev
```

Then open **http://localhost:3000**.

Other scripts:

```bash
npm run build   # production build
npm run start   # run the production build (after `npm run build`)
npm run lint    # eslint
```

### A note on images

Photography throughout the app is placeholder imagery loaded from
[picsum.photos](https://picsum.photos) (a free, keyless placeholder image
service), seeded so the same artist/venue always gets the same image. This
needs a normal internet connection to load — if you're on a fully offline or
heavily firewalled network, image tiles will show as broken but everything
else (layout, data, interactions) works exactly the same. Swap `img()` in
`src/lib/mock-data.ts` for real uploaded photography whenever you're ready.

### First run: sign-up is mandatory

A fresh visitor (empty `localStorage`) is sent straight to `/onboarding`
and can't reach anything else — no nav, no footer — until they finish it
(age check, artist/promoter details + photo, email "verification"). This
is enforced app-wide by `src/components/layout/AppGate.tsx`, not per-page,
so it also covers any new route you add. Once `hasOnboarded` is set it
stays set (in `localStorage`), so you only see this once per browser.

### Demo accounts

There's no real authentication yet (see §4). Once past onboarding, the
navbar has an **Artist / Promoter** switcher (desktop: top right; this is a
prototype-only control, not a real product feature) that flips which
experience you're viewing — it does not create a second account:

- **Artist** — you're logged in as **slowcpu**, a London electronic/alt
  artist, with a handful of applications already in flight.
- **Promoter** — you're logged in as **Bedroom Sound Presents**, a promoter
  with several shows posted and applicants waiting to be reviewed.

State (which applications you've submitted, messages you've sent, slots
you've posted, your role, last-minute alert preferences) is kept in
`localStorage`, so it survives a refresh but is specific to your browser.
Clear site data (or open a private window) to reset the demo to its
original state.

---

## 2. Project structure

```
support-slot/
├── src/
│   ├── app/                        Next.js App Router — one folder per route
│   │   ├── page.tsx                 Landing page
│   │   ├── discover/                "Find a Slot" — browse + filter opportunities
│   │   ├── slot/[id]/               Individual support slot + apply flow
│   │   ├── last-minute/             "Needed Tonight" urgent slots + alert prefs
│   │   ├── dashboard/artist/        Artist dashboard
│   │   ├── dashboard/promoter/      Promoter dashboard
│   │   ├── applications/            Artist's full applications list
│   │   ├── artist/[handle]/         Public, shareable artist profile
│   │   ├── create-slot/             Promoter: post a new support slot
│   │   ├── promoter/slot/[id]/applicants/   Applicant management + booking
│   │   ├── messages/                Inbox (artist ⇄ promoter threads)
│   │   ├── support-plus/            Support+ subscription page
│   │   ├── trust/                   Trust & safety / no pay-to-play policy
│   │   ├── login/                   Log in / sign up
│   │   ├── onboarding/              Multi-step artist/promoter onboarding
│   │   └── layout.tsx, globals.css  Root layout, design tokens, fonts
│   │
│   ├── components/
│   │   ├── ui/                      Design-system primitives (Button, Modal,
│   │   │                            MatchBadge, VerifiedBadge, StatCard,
│   │   │                            AvatarUploadField, ImageUploadField, …)
│   │   ├── layout/                  Navbar, MobileNav, Footer, notifications,
│   │   │                            AppGate (the mandatory sign-up gate)
│   │   ├── slots/                   SlotCard, UrgentSlotCard, slot detail view
│   │   ├── artists/                 ArtistCard, ShareButton, links/listeners
│   │   │                            editors, avatar display
│   │   ├── applications/            ApplicationRow, StatusPill
│   │   ├── applicants/              Promoter-side applicant management
│   │   ├── account/                 Email verification panel + dashboard banner
│   │   ├── bookings/                Cancel / reschedule actions on a booked show
│   │   ├── payouts/                 Send-payout modal (promoter) + wallet panel
│   │   │                            (artist) — see §3
│   │   ├── trust/                   Report/block demo interactions
│   │   ├── ApplyModal.tsx           "Apply for support" flow
│   │   ├── BookModal.tsx            Booking / checkout confirmation flow
│   │   └── SubscribeModal.tsx       Support+ subscribe flow
│   │
│   └── lib/
│       ├── types.ts                 Shared TypeScript domain types
│       ├── mock-data.ts             All demo data: artists, venues, promoters,
│       │                            slots, applications, messages, notifications
│       ├── store.tsx                Client-side global state (React Context +
│       │                            localStorage) standing in for a backend —
│       │                            see CLAUDE.md before adding a new field here
│       ├── match.ts                 The guidance match-percentage algorithm
│       ├── geo.ts                   Approximate UK city-to-city distances
│       ├── travel.ts                Travel contribution + long-travel minimum
│       ├── pricing.ts               Support+ pricing/billing helpers
│       ├── artist-links.ts          Artist-edited platform links, layered over
│       │                            the mock artist's own (override pattern)
│       ├── artist-stats.ts          Self-reported monthly listeners override
│       ├── slot-schedule.ts         Reschedule overrides for booked mock slots
│       ├── wallet.ts                Payout code lookup + balance/history helpers
│       └── utils.ts                 Formatting helpers (dates, currency, etc.)
│
├── public/                          Static assets
└── package.json
```

**Design system**: colours, spacing and font tokens live in
`src/app/globals.css` under `@theme inline` (Tailwind CSS v4's CSS-first
config — there's no `tailwind.config.js`). Typography is **Space Grotesk**
for display/headings, **Inter** for body copy, and **JetBrains Mono** for
labels, tags and meta information, all self-hosted via `@fontsource/*` so
the build never depends on Google Fonts being reachable.

---

## 3. What's real vs. simulated in this prototype

Fully interactive, backed by a small client-side store
(`src/lib/store.tsx`):

- Applying to a slot (choose track + live clip + message) — creates a real
  application that immediately shows up on the artist dashboard and the
  promoter's applicant list, with a live match percentage.
- Shortlisting and booking an artist from the applicant management screen.
- The booking / checkout confirmation flow, showing the artist-fee vs.
  platform-fee split (no payment is actually processed).
- Posting a new support slot as a promoter — it appears immediately in
  Discover, Last-Minute (if marked urgent) and the promoter dashboard.
- Sending messages in a conversation thread.
- Notifications panel, last-minute alert preferences, Support+ "subscribe"
  toggle (monthly or annual billing).
- Profile picture upload for both roles, plus a slot image and optional
  "artist reference photo" upload when posting a slot — real client-side
  image resize/compression to a `localStorage`-backed data URL, no upload
  server involved.
- Cancelling or rescheduling a booked show, from either side.
- The payout system (`src/lib/wallet.ts`,
  `src/components/payouts/`) — every artist has a unique payout code,
  promoters can send an amount to any code, and it lands as a real entry in
  the artist's wallet balance/history. No real money moves.
- Mandatory sign-up: a fresh visitor can't reach anything but `/onboarding`
  until they finish it, including a mock email-verification step (see §4).

Simulated / static for this prototype:

- Authentication — login/signup and onboarding are believable UI flows that
  end by switching the demo role; there's no real account system yet, and
  "signed up" is just a `localStorage` flag, not a session.
- Payments — Stripe is not integrated; the checkout UI and the payout
  system are realistic mocks, no money actually moves.
- Email — the "send code" verification step shows the code on-screen
  instead of emailing it; there's no email provider wired up.
- Spotify/Instagram/TikTok links are illustrative and don't call real APIs.

---

## 4. Turning this into a real production marketplace

This was intentionally built as a complete front-end first, on realistic
mock data, so the product and its interactions could be evaluated before
any backend investment. To go from here to a real marketplace:

1. **Database & auth — Supabase (or similar Postgres + auth provider)**
   Model `artists`, `promoters`, `venues`, `shows`, `support_slots`,
   `applications`, `messages`, `notifications`, `payout_transactions`
   roughly matching `src/lib/types.ts`. Replace `src/lib/store.tsx` and the
   mock-data reads in `src/lib/mock-data.ts` with real queries (e.g.
   Supabase client + server actions / route handlers), and replace the
   `/login` and `/onboarding` flows — including the mandatory sign-up gate
   in `AppGate.tsx`, which currently just checks a `localStorage` flag —
   with a real session (Spotify OAuth would double as both auth and
   artist-data import). Real email verification (e.g. via a transactional
   email provider) replaces the on-screen mock code in
   `EmailVerifyPanel.tsx`.

2. **Payments & payouts — Stripe Connect**
   Give each artist a Stripe Connect account and a promoter a way to fund
   payments. `BookModal.tsx` already shows the intended fee split (artist
   fee + Support Slot booking fee), and the payout system in
   `src/lib/wallet.ts` / `src/components/payouts/` already has the whole
   UI for "send an amount to this artist's code" and "see your balance and
   history" — the `payoutCode` concept maps cleanly onto a Connect
   account's identifier. Wire `sendPayout` in `store.tsx` up to a real
   Payment Intent / Connect transfer instead of appending a mock
   transaction, and add webhook handling for booking confirmation and
   payout/transfer status.

3. **Spotify API**
   Use Spotify's Web API (OAuth) during onboarding to pull verified
   monthly-listener counts, top tracks and artist imagery automatically,
   instead of the manually-entered fields in the current onboarding flow.

4. **Maps / distance — Mapbox or Google Maps**
   Replace the approximate city-distance lookup in `src/lib/geo.ts` with
   real geocoding + routing distance, and use it to power the "distance"
   filter on Discover and more accurate match scoring.

5. **Media storage — Cloudinary (or S3 + a CDN)**
   Artist photos, banners, track artwork and live-performance video mostly
   still come from placeholder URLs in `mock-data.ts`. Profile pictures and
   slot/reference-photo uploads (`AvatarUploadField`, `ImageUploadField`)
   already have real upload UI, but they resize client-side and store the
   result as a data URL in `localStorage` — swap that for an upload to
   Cloudinary or S3 (with video transcoding for live clips) and store the
   resulting URL instead.

6. **Notifications**
   The notifications panel and last-minute alerts are currently static/local.
   Add a real-time layer (e.g. Supabase Realtime, or push notifications) so
   "shortlisted", "viewed" and urgent last-minute alerts actually fire when
   the underlying data changes — this matters a lot for the last-minute
   feature, which is only useful if it's genuinely fast.

7. **Trust & safety**
   The report/block UI on `/trust` is a working front-end demo; it needs a
   real moderation queue, rate-limiting on applications/messages, and
   promoter/venue identity verification (documents, video, etc.) behind the
   verified badge.

8. **Search & matching at scale**
   The match-percentage algorithm (`src/lib/match.ts`) is intentionally
   simple and transparent. At scale, keep it transparent (per the "no
   pay-to-play" principle) but consider a proper search index (e.g.
   Postgres full-text + pgvector, or a hosted search service) once the
   number of slots and artists grows beyond what client-side filtering can
   handle well.

9. **Testing & CI**
   Add unit tests around the match algorithm and booking-fee math, and
   integration tests around the apply/book flows, then wire up CI
   (type-check, lint, test, build) before deploying (e.g. to Vercel).
