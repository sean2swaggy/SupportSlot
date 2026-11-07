# Support Slot — web companion

A small web app for the same product as the iOS app: **promoters post support
(opening-act) slots, artists request them, promoters confirm one act.** It runs
entirely on sample data stored in the browser; nothing talks to Supabase yet.

```bash
cd web
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # rule tests for the data layer (14)
npm run build      # type-check + production build
```

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
src/data/      repo.ts = the interface every screen uses; localRepo.ts = browser
               implementation with all the rules; seed.ts = sample data
src/pages/     Landing, Browse, SlotDetail, Bookings, BookingDetail,
               Listings, ListingForm, ListingManage
tests/         rules: who may do what, state transitions, idempotency, dates
```
**Adding real persistence:** write a Supabase implementation of `Repo`
(`src/data/repo.ts`) and change the one line in `src/data/index.ts`. The rules in
`localRepo.ts` mirror the SQL state machine used by the iOS app (see
`../CLAUDE.md`); in production they must live in SQL functions, not the client.

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
- Accounts are real in the sense that sign-up, sign-in (salted SHA-256), profiles,
  in-app alerts and per-request messaging all work, but they live in this browser's
  local storage: other devices and browsers see none of it. Not secure.
- Messaging is one thread per request between the artist and that listing's
  promoter; alerts are in-app only (no email or push). Threads refresh every 5 s.

## Needs real services
- **Auth** (Supabase Auth with TOTP like the iOS app) in place of local accounts.
- **Persistence and rules in the database** (shared with the iOS app's schema;
  new migration needed for any web-only fields). Browser storage is per-device
  and last-write-wins.
- **Shared data, realtime messaging and email/push** so people on different
  devices actually see each other's requests and messages.
- **Not done:** image uploads, password reset, accessibility audit with a screen
  reader, cross-browser testing beyond the in-app browser.
