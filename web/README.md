# Support Slot — web companion

A small web app for the same product as the iOS app: **promoters post support
(opening-act) slots, artists request them, promoters confirm one act.** It runs
entirely on sample data stored in the browser; nothing talks to Supabase yet.

```bash
cd web
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # rule tests for the data layer (8)
npm run build      # type-check + production build
```

## Try it
The landing page's "I'm an artist / I'm a promoter" buttons (or the profile menu
at the top right) sign you in as a sample person. Suggested run-through:
1. As **Maya Okafor** (artist): Find slots → open a slot → send a request.
2. Switch to **Harbour Lights Presents** (promoter): My listings → open the slot
   → Book Maya. You land on the confirmed booking.
3. Switch back to Maya: My gigs shows it under Upcoming. Cancel it with a reason;
   the slot reopens.
4. As a promoter, Post a slot, then watch it appear on the artist board.
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
- Sign-in is a demo persona switch, stored in local storage. Not secure.

## Needs real services
- **Auth** (Supabase Auth with TOTP like the iOS app) and real profiles.
- **Persistence and rules in the database** (shared with the iOS app's schema;
  new migration needed for any web-only fields). Browser storage is per-device
  and last-write-wins.
- **Notifications** (nobody is told when they're booked or cancelled except by
  opening the app) and any email.
- **Not done:** profile editing, messaging, image uploads, accessibility audit
  with a screen reader, cross-browser testing beyond the in-app browser.
