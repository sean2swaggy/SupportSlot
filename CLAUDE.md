# Support Slot — project guide for Claude Code

Read this before making changes. It's the fast-context version; `README.md`
has the full project overview, folder structure and production roadmap —
read that too for anything not covered here.

## What this is

A prototype marketplace connecting musicians ("artists") with promoters
posting "support slot" (opening act) opportunities at live shows. Next.js
16 App Router, TypeScript, Tailwind CSS v4, React 19. No real backend: it's
a front-end-first MVP over realistic mock data.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build — must be clean before calling anything done
npm run start   # serve the production build (after build)
npm run lint    # eslint
```

## The whole app is one client-side store — read this before touching data

There is no database and no API routes. `src/lib/store.tsx` is a React
Context + `localStorage` "backend" that every page reads and writes
through `useStore()`. `src/lib/mock-data.ts` is the seed data (artists,
venues, promoters, slots, applications, messages, notifications) — treat it
as read-only; the store layers user edits on top rather than mutating it
(see "override-layering pattern" below).

**Adding any new field that needs to persist follows the same five-touch
pattern every existing field uses — don't invent a different one:**

1. Add it to the `StoreShape` interface.
2. Add a `useState` for it.
3. Add it to the one-time hydration `useEffect` — both the `safeLoad`
   fallback object and the `setXxx(saved.xxx ?? default)` call.
4. Add it to the persistence `useEffect` — both the object being
   `JSON.stringify`'d and that effect's own dependency array.
5. Add it to the memoized `value` object **and** its `useMemo` dependency
   array.

Miss step 3 or 4 and the field silently won't survive a reload; miss step 5
and consumers won't re-render when it changes.

**Override-layering pattern** (used for artist links, monthly listeners,
slot reschedules): rather than mutating the imported mock-data constants,
the store keeps a `Record<id, Partial<T>>` override map and a small helper
merges it onto the base object at read time (e.g. `withScheduleOverride`
in `src/lib/slot-schedule.ts`). A promoter's own **locally posted** slots
(already owned in `postedSlots`) are the one exception — those are updated
in place since nothing imported is being mutated.

## There is exactly one mock account per role

`CURRENT_ARTIST_ID` ("slowcpu") and `CURRENT_PROMOTER_ID` ("Bedroom Sound
Presents") in `src/lib/store.tsx` / `mock-data.ts` are fixed — the navbar's
Artist/Promoter switcher just changes which dashboard you're looking at,
it's not real multi-user auth. Every other artist/promoter in
`mock-data.ts` is browsable but not "logged in" — e.g. the payout system
can send money to any artist's code, but only the current artist has a
wallet UI to view it land.

**Sign-up is mandatory and gates the entire app** (`src/components/layout/
AppGate.tsx`, `hasOnboarded` in the store). A fresh visitor is redirected to
`/onboarding` on every route until they finish it; the app's nav/footer
don't render until then either. If you add a new top-level route, it's
covered automatically — the gate wraps `{children}` in the root layout, not
individual pages. One easy-to-reintroduce bug: don't let anything flip
`hasOnboarded` while still rendering the `/onboarding` route itself unless
that route's own layout branch is also route-based rather than
`hasOnboarded`-based — see the comment in `AppGate.tsx` for why (it caused
a full remount / lost-progress bug during development).

## Feature inventory (so you don't rebuild something that already exists)

- Discover / Last-Minute / Trust / Support+ marketing & browse pages
- Artist public profile: bio, tracks, past/upcoming shows, platform links,
  self-reported monthly listeners, live-video thumbnail
- Apply flow (`ApplyModal`) and booking flow (`BookModal`) with a live
  match-percentage algorithm (`src/lib/match.ts`)
- Promoter: post a slot (`create-slot`), manage applicants, shortlist/book
- Support+ — a **promoter-only** paid subscription (real Stripe Billing
  Checkout + webhook, see `src/app/api/stripe/subscriptions/`), never
  artist-facing. `profiles.is_support_plus` is locked down at the DB level
  (see `0010_promoter_support_plus.sql`) — only the service-role key can
  set it, driven by a real subscription event, never a client call.
- Artist Roster (Support+) — a promoter's private, saved artist list with
  notes/tags/booking history (`src/app/dashboard/promoter/roster`)
- Availability requests (Support+) — pre-booking "are you free" enquiries
  to roster artists, answered for free by any artist
  (`src/app/dashboard/promoter/requests`, `src/app/requests` for artists).
  Never a reservation — turning a response into a real booking still goes
  through the existing apply/book/pay flow.
- Profile picture upload for both roles (`AvatarUploadField`) and a slot
  image / optional "artist reference photo" upload on `create-slot`
  (`ImageUploadField`) — both resize/compress client-side to a data URL
- Travel contribution fee, with an automatic minimum top-up for long
  journeys (`src/lib/travel.ts`)
- Mandatory age-verification step and mandatory email verification (mock —
  a 6-digit code is shown on screen, no real email is sent) during
  onboarding, plus a dashboard banner to (re)verify later
- Cancel and reschedule actions on a booked show, available to both the
  artist and the promoter (`BookingActionsLinks`), with a "cancelled"
  application status and a rescheduled-date indicator
- Mandatory sign-up gate — see above
- Payout system (`src/lib/wallet.ts`, `src/components/payouts/`): every
  artist has a unique `$cashtag`-style `payoutCode`; promoters send an
  amount to a code from the promoter dashboard, a booked artist's card, or
  the applicant-management page; the artist dashboard shows a running
  balance and transaction history (`WalletPanel`)

Everything above is simulated, not wired to a real payment processor, email
service, or auth system — see README.md §3 and §4 for exactly what's real
vs. simulated and how to wire up a production backend later.

## Before calling any change done

1. `rm -rf .next && npm run build` — must complete with no errors.
2. `npx eslint <changed files> --max-warnings=999` — must report **zero
   errors**. Warnings are fine only for the pre-existing `@next/next/
   no-img-element` warnings on plain `<img>` tags (this project intentionally
   uses `<img>`, not `next/image`, throughout); don't add new warning types.
3. There's no committed test suite. Manually verify behavior by running
   `npm run build && npm run start` and driving the flow with a throwaway
   Playwright script (or by hand) — don't skip this for anything that
   touches `store.tsx`, since a broken hydration/persistence effect fails
   silently (no type error, no lint error, just data that won't save).

## Gotchas worth knowing up front

- `react-hooks/purity`: never call `new Date()` / `Date.now()` during
  render — only inside a lazy `useState(() => ...)` initializer or inside
  an event-handler callback.
- You can't nest interactive elements (buttons, links) inside an `<a>` /
  `<Link>`. Cards that need both a primary click-through and secondary
  actions use an outer non-interactive wrapper with an inner `<Link>` plus
  a sibling actions block (see `ApplicationRow.tsx`).
- To reset a modal's internal form state when it reopens for a different
  target, pass a changing `key` prop from the parent rather than an effect
  that calls `setState` on mount/prop-change — the latter trips
  `react-hooks/set-state-in-effect` and is the pattern this codebase
  deliberately avoids (see `PayoutModal.tsx` and its callers).
- Design tokens (colors, fonts) live in `src/app/globals.css` under
  `@theme inline` — Tailwind v4's CSS-first config, there's no
  `tailwind.config.js`. Fonts are self-hosted via `@fontsource/*` packages,
  not Google Fonts, so the build never depends on external font hosts.
