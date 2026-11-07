# Support Slot — web companion

A web app for the same product as the iOS app: **promoters post support
(opening-act) slots, artists request them, promoters confirm one act.** It has
two modes, and neither needs Supabase, Docker or any account:

```bash
cd web
npm install
npm run app        # the real app: http://127.0.0.1:8787
npm run dev        # browser-only demo (data in local storage): http://127.0.0.1:5173
npm test           # rules + server integration tests (20)
npm run build      # type-check + production build
```

**`npm run app`** builds the site and starts one Node process that serves it and
a JSON API. Accounts, listings, bookings, alerts and messages live in
`web/data/db.json` (gitignored), so every browser or device that reaches the
server shares them. Sessions are random tokens held server-side; the server
decides who is acting and ignores any user id the client sends. Delete `web/data/`
to reset to the sample data. To let other devices on your network use it:
`HOST=0.0.0.0 npm run app` (then browse to your Mac's address; there is no HTTPS).
`PORT` and `DATA_FILE` are also read from the environment.

## Try it
Join as an artist or promoter on the landing page, or sign in with a sample
account (buttons on the sign-in page; password `demo1234`, emails
`maya@`, `orchard@`, `harbour@`, `north@example.test`). Suggested run-through:
1. Join as a **promoter**, post a slot.
2. Sign out, sign in as **Maya** (artist), open the slot, send a request, then
   message the promoter.
3. Sign back in as the promoter: the Alerts badge shows the request and message.
   Reply, then Book Maya.
4. As Maya, Alerts shows the booking; My gigs lists it. Cancel with a reason and
   the slot reopens (the promoter is notified).
5. Add `?simulate=error` to any URL to see the error states.

## Structure
```
src/domain/    types, UK date maths (strings, never Date-from-ISO), pence money
src/data/      repo.ts = the interface every screen uses; localRepo.ts = all the
               rules (used in the browser and by the server); httpRepo.ts = client
               for the server; seed.ts = sample data
server/        server.ts: static files + /api/rpc, sessions, sign-in throttle
src/pages/     Landing, Browse, SlotDetail, Bookings, BookingDetail,
               Listings, ListingForm, ListingManage
tests/         rules: who may do what, state transitions, idempotency, dates
```
**Swapping the backend:** anything that implements `Repo` (`src/data/repo.ts`)
can replace the server; `src/data/index.ts` picks the implementation. The rules in
`localRepo.ts` mirror the SQL state machine the iOS app uses (see `../CLAUDE.md`).

## Assumptions
- Support Slot means what the repo says: artist/promoter opening-act marketplace
  (not appointment booking). "Provider" = promoter, "customer" = artist.
- Simplified from the iOS flow: **request → promoter books** (the iOS app has an
  extra offer/accept step with computed travel). Fee is a single listing figure
  in integer pence; no travel calculation here.
- No money passes through the platform. No payment, fees or subscriptions.
- Show dates are UK calendar dates; a show counts as past the day after its date.
  Cancelling is allowed until the show date has passed, with a required reason.
- If an artist cancels, the slot reopens; if a promoter cancels, the listing is
  cancelled. A promoter can't cancel a listing that has a confirmed act; they
  cancel the booking instead so the artist sees why.
- Every request is idempotent (double-clicks don't double-book); accepting one act
  declines the other pending requests.
- Sample data is fictional and generated relative to today. Reset it by clearing
  this site's local storage.
- Accounts: sign-up, sign-in (salted SHA-256), profiles, in-app alerts and
  per-request messaging. In `npm run app` they're server-side and shared; in
  `npm run dev` they're local to the browser.
- Messaging is one thread per request between the artist and that listing's
  promoter; alerts are in-app only (no email or push). Threads refresh every 5 s.

## Limits (be honest about what this is)
- One Node process writing one JSON file: fine for a small group or a pilot, not
  for scale or for several server processes. Back up `web/data/db.json`.
- No HTTPS, no email (so no password reset or email verification), no push,
  no rate limiting beyond a per-email sign-in throttle, no 2FA. Put it behind a
  proper host and TLS before exposing it to the internet.
- Alerts are in-app; the alert badge refreshes every 4 s and threads every 5 s.
- Not done: image uploads, screen-reader and cross-browser testing.
- The iOS app is separate and still needs its own Supabase project; this server
  does not speak to it.
