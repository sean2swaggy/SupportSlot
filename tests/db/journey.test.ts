import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asUser,
  createTestDb,
  makeArtist,
  makePromoter,
  makeSlot,
  type Db,
} from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

// --- tiny helpers over the SQL API the app calls ---------------------------
async function apply(artist: string, slot: string, message = "Hello") {
  const r = await asUser(db, artist, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.applications (slot_id, artist_id, message) values ($1, $2, $3) returning id`,
      [slot, artist, message]
    )
  );
  return r.rows[0].id;
}
const call = (user: string, fn: string, ...args: unknown[]) =>
  asUser(db, user, (tx) =>
    tx.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)
  );
async function appStatus(id: string) {
  const r = await db.query<{ status: string }>(`select status from public.applications where id = $1`, [id]);
  return r.rows[0].status;
}
async function booking(appId: string, onlyActive = true) {
  const r = await db.query<Record<string, unknown>>(
    `select *, event_date::text as event_date_text from public.bookings where application_id = $1 ${onlyActive ? "and status in ('offered','confirmed')" : ""} order by created_at desc limit 1`,
    [appId]
  );
  return r.rows[0];
}
async function notifications(profile: string, type?: string) {
  const r = await db.query<{ text: string; type: string }>(
    `select text, type from public.notifications where profile_id = $1 ${type ? "and type = $2" : ""} order by created_at`,
    type ? [profile, type] : [profile]
  );
  return r.rows;
}

describe("A. applying", () => {
  it("an artist can apply once; a second application to the same slot is refused", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const id = await apply(artist, slot);
    expect(await appStatus(id)).toBe("submitted");
    await expect(apply(artist, slot)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("cannot apply to a closed listing or after the deadline", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const closed = await makeSlot(db, promoter);
    await call(promoter, "close_slot", closed);
    await expect(apply(artist, closed)).rejects.toThrow(/listing_not_open/);

    const expired = await makeSlot(db, promoter);
    await asService(db, (tx) =>
      tx.query(`update public.slots set application_deadline = '2000-01-01' where id = $1`, [expired])
    );
    await expect(apply(artist, expired)).rejects.toThrow(/applications_closed/);
  });

  it("the featured track must belong to the applying artist", async () => {
    const artist = await makeArtist(db);
    const other = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const t = await db.query<{ id: string }>(
      `insert into public.artist_tracks (artist_id, title, duration) values ($1, 'Mine', '3:00') returning id`,
      [other]
    );
    await expect(
      asUser(db, artist, (tx) =>
        tx.query(`insert into public.applications (slot_id, artist_id, featured_track_id) values ($1, $2, $3)`, [slot, artist, t.rows[0].id])
      )
    ).rejects.toThrow(/isn't on your profile/);
  });
});

describe("B. promoter review", () => {
  it("'viewed' is only set by the owning promoter's genuine view, and is idempotent", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const stranger = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);

    await expect(call(stranger, "mark_application_viewed", app)).rejects.toThrow(/not_authorized/);
    await expect(call(artist, "mark_application_viewed", app)).rejects.toThrow(/not_authorized/);
    expect(await appStatus(app)).toBe("submitted");

    await call(promoter, "mark_application_viewed", app);
    await call(promoter, "mark_application_viewed", app);
    expect(await appStatus(app)).toBe("viewed");
    expect((await notifications(artist, "viewed")).length).toBe(1);
  });

  it("shortlist and decline follow the state rules", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "shortlist_application", app);
    expect(await appStatus(app)).toBe("shortlisted");
    await expect(call(promoter, "shortlist_application", app)).rejects.toThrow(/invalid_transition/);
    await call(promoter, "decline_application", app, "not this time");
    expect(await appStatus(app)).toBe("declined");
    await expect(call(promoter, "shortlist_application", app)).rejects.toThrow(/invalid_transition/);
    await expect(call(promoter, "make_offer", app)).rejects.toThrow(/invalid_transition/);
    expect((await notifications(artist, "application_declined")).length).toBe(1);
  });
});

describe("C. offer -> accept -> confirmed booking", () => {
  it("computes the agreed terms server-side, in pence, with the artist keeping their full fee", async () => {
    const artist = await makeArtist(db, { location: "Manchester" });
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter, { supportFee: 150 }); // London slot, £150
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app, "Looking forward to it");

    const b = await booking(app);
    expect(b.status).toBe("offered");
    expect(b.fee_pence).toBe(15000);
    // Manchester -> London is 200 miles (>1h at 40mph): guaranteed £10 minimum travel.
    expect(b.travel_pence).toBe(1000);
    expect(b.booking_fee_pence).toBe(1200);
    // (15·17200 + 20000 + 984) / 985, rounded up to the penny.
    expect(b.processing_fee_pence).toBe(283);
    expect(b.total_pence).toBe(15000 + 1000 + 1200 + 283);
    expect(b.artist_name).toBe("Test Artist");
    expect(b.venue_name).toBeTruthy();
    expect(await appStatus(app)).toBe("offered");
    expect((await notifications(artist, "offer")).length).toBe(1);
  });

  it("the artist sees the booking; an unrelated artist does not", async () => {
    const artist = await makeArtist(db);
    const outsider = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app);
    const mine = await asUser(db, artist, (tx) => tx.query(`select id from public.bookings`));
    const theirs = await asUser(db, outsider, (tx) => tx.query(`select id from public.bookings`));
    expect(mine.rows).toHaveLength(1);
    expect(theirs.rows).toHaveLength(0);
  });

  it("only the artist can accept; accepting confirms the booking and fills the slot for both accounts", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app);

    await expect(call(promoter, "respond_to_offer", app, true, null)).rejects.toThrow(/not_authorized/);
    const res = await call(artist, "respond_to_offer", app, true, null);
    expect((res.rows[0] as { r: string }).r).toBe("confirmed");

    expect(await appStatus(app)).toBe("confirmed");
    expect((await booking(app)).status).toBe("confirmed");
    const slotRow = await db.query<{ status: string }>(`select status from public.slots where id = $1`, [slot]);
    expect(slotRow.rows[0].status).toBe("filled");

    // Both accounts read the same confirmed booking through RLS.
    const a = await asUser(db, artist, (tx) => tx.query<{ status: string; total_pence: number }>(`select status, total_pence from public.bookings`));
    const p = await asUser(db, promoter, (tx) => tx.query<{ status: string; total_pence: number }>(`select status, total_pence from public.bookings`));
    expect(a.rows[0]).toEqual(p.rows[0]);
    expect(a.rows[0].status).toBe("confirmed");
    expect((await notifications(promoter, "offer_accepted")).length).toBe(1);

    // Accepting twice is refused, not double-applied.
    await expect(call(artist, "respond_to_offer", app, true, null)).rejects.toThrow(/invalid_transition/);
  });

  it("two outstanding offers: the first acceptance wins, the other artist is told the slot is gone and cannot accept", async () => {
    const a1 = await makeArtist(db);
    const a2 = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app1 = await apply(a1, slot);
    const app2 = await apply(a2, slot);
    await call(promoter, "make_offer", app1);
    await call(promoter, "make_offer", app2);

    await call(a2, "respond_to_offer", app2, true, null);
    await expect(call(a1, "respond_to_offer", app1, true, null)).rejects.toThrow(/invalid_transition/);
    expect(await appStatus(app1)).toBe("declined");
    expect((await booking(app1, false)).status).toBe("withdrawn");
    expect((await notifications(a1, "application_declined")).length).toBe(1);
    // Nobody can make another offer on a filled slot.
    const a3 = await makeArtist(db);
    await expect(apply(a3, slot)).rejects.toThrow(/listing_not_open/);
  });

  it("the database itself refuses a second confirmed booking for one slot", async () => {
    const a1 = await makeArtist(db);
    const a2 = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app1 = await apply(a1, slot);
    await call(promoter, "make_offer", app1);
    await call(a1, "respond_to_offer", app1, true, null);
    const b1 = await booking(app1);
    await expect(
      asService(db, (tx) =>
        tx.query(
          `insert into public.bookings (slot_id, artist_id, promoter_id, status, artist_name, promoter_company, headliner,
             venue_name, venue_address, venue_city, event_date, doors_time, set_time, set_length_mins,
             fee_pence, travel_pence, booking_fee_pence, processing_fee_pence, total_pence, offer_expires_at)
           values ($1, $2, $3, 'confirmed', 'x', 'y', 'z', 'v', 'a', 'London', '2099-12-01', '19:00', '20:00', 30, 1, 0, 0, 0, 1, now())`,
          [slot, a2, promoter]
        )
      )
    ).rejects.toThrow(/bookings_one_confirmed_per_slot|unique/i);
    expect(b1.status).toBe("confirmed");
  });

  it("declining an offer, and withdrawing an offer, leave consistent states", async () => {
    const a1 = await makeArtist(db);
    const a2 = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app1 = await apply(a1, slot);
    const app2 = await apply(a2, slot);

    await call(promoter, "make_offer", app1);
    await call(a1, "respond_to_offer", app1, false, "can't make it");
    expect(await appStatus(app1)).toBe("offer_declined");
    expect((await booking(app1, false)).status).toBe("declined");
    expect((await notifications(promoter, "offer_declined")).length).toBe(1);

    await call(promoter, "make_offer", app2);
    await call(promoter, "withdraw_offer", app2);
    expect(await appStatus(app2)).toBe("shortlisted");
    // A withdrawn offer can be re-made (new booking row, one live at a time).
    await call(promoter, "make_offer", app2);
    expect((await booking(app2)).status).toBe("offered");
    const all = await db.query(`select 1 from public.bookings where application_id = $1`, [app2]);
    expect(all.rows).toHaveLength(2);
  });

  it("an expired offer cannot be accepted, and the sweep returns it to the shortlist", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app);
    await asService(db, (tx) =>
      tx.query(`update public.bookings set offer_expires_at = now() - interval '1 hour' where application_id = $1`, [app])
    );
    await expect(call(artist, "respond_to_offer", app, true, null)).rejects.toThrow(/offer_expired/);
    const n = await asService(db, (tx) => tx.query<{ n: number }>(`select public.expire_stale_offers() as n`));
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await appStatus(app)).toBe("shortlisted");
  });

  it("an artist can withdraw before confirmation but not after; a confirmed booking must be cancelled instead", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(artist, "withdraw_application", app);
    expect(await appStatus(app)).toBe("withdrawn");
    await expect(call(artist, "withdraw_application", app)).rejects.toThrow(/invalid_transition/);

    const a2 = await makeArtist(db);
    const slot2 = await makeSlot(db, promoter);
    const app2 = await apply(a2, slot2);
    await call(promoter, "make_offer", app2);
    await call(a2, "respond_to_offer", app2, true, null);
    await expect(call(a2, "withdraw_application", app2)).rejects.toThrow(/invalid_transition/);
  });
});

describe("D. cancellation, closing and rescheduling", () => {
  async function confirmed() {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app);
    await call(artist, "respond_to_offer", app, true, null);
    return { artist, promoter, slot, app };
  }

  it("either party can cancel a confirmed booking with a reason; the listing reopens", async () => {
    const { artist, promoter, slot, app } = await confirmed();
    await expect(call(artist, "cancel_booking", app, "")).rejects.toThrow(/give a reason/);
    await call(artist, "cancel_booking", app, "van broke down");
    expect(await appStatus(app)).toBe("cancelled");
    const b = await booking(app, false);
    expect(b.status).toBe("cancelled");
    expect(b.refund_review_required).toBe(false); // nothing had been paid
    const s = await db.query<{ status: string }>(`select status from public.slots where id = $1`, [slot]);
    expect(s.rows[0].status).toBe("open");
    expect((await notifications(promoter, "booking_cancelled")).length).toBe(1);
  });

  it("cancelling a PAID booking flags it for a human refund decision and promises nothing", async () => {
    const { artist, app } = await confirmed();
    await asService(db, (tx) =>
      tx.query(`update public.bookings set payment_status = 'paid' where application_id = $1`, [app])
    );
    await call(artist, "cancel_booking", app, "can't play any more");
    expect((await booking(app, false)).refund_review_required).toBe(true);
  });

  it("closing a listing declines pending applicants but is refused while a booking is confirmed", async () => {
    const a1 = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(a1, slot);
    await call(promoter, "close_slot", slot);
    expect(await appStatus(app)).toBe("declined");

    const { promoter: p2, slot: s2 } = await confirmed();
    await expect(call(p2, "close_slot", s2)).rejects.toThrow(/has_confirmed_booking/);
    await call(p2, "cancel_slot", s2, "venue closed");
    const r = await db.query<{ status: string }>(`select status from public.slots where id = $1`, [s2]);
    expect(r.rows[0].status).toBe("cancelled");
  });

  it("material edits are locked once an offer exists; reschedule updates the agreed terms and tells the artist", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app);

    await expect(
      asUser(db, promoter, (tx) => tx.query(`update public.slots set support_fee = 999 where id = $1`, [slot]))
    ).rejects.toThrow(/listing_locked/);
    await expect(call(promoter, "reschedule_slot", slot, "2099-12-15", "18:00", "19:00")).rejects.toThrow(/offers_outstanding/);
    // Non-material edits are fine.
    await asUser(db, promoter, (tx) => tx.query(`update public.slots set description = 'now with extra detail' where id = $1`, [slot]));

    await call(artist, "respond_to_offer", app, true, null);
    await call(promoter, "reschedule_slot", slot, "2099-12-15", "18:00", "19:00");
    const b = await booking(app);
    expect(b.event_date_text).toBe("2099-12-15");
    expect(b.fee_pence).toBe(15000); // money terms untouched
    expect((await notifications(artist, "listing_changed")).length).toBe(1);
    // The artist cannot move someone else's show.
    await expect(call(artist, "reschedule_slot", slot, "2099-12-20", "18:00", "19:00")).rejects.toThrow(/not_authorized/);
  });

  it("listing validation runs in the database, not just the form", async () => {
    const promoter = await makePromoter(db);
    const base = (over: Record<string, unknown>) =>
      asUser(db, promoter, (tx) =>
        tx.query(
          `insert into public.slots (promoter_id, venue_id, headliner, city, date, doors_time, set_time, performance_length_mins,
             expected_attendance, support_fee, application_deadline, genres, booking_fee)
           values ($1, (select id from public.venues limit 1), $2, 'London', $3, '19:00', '20:00', $4, 100, $5, $6, $7, 12)`,
          [promoter, over.headliner ?? "OK", over.date ?? "2099-12-01", over.mins ?? 30, over.fee ?? 100, over.deadline ?? "2099-11-01", over.genres ?? ["Indie"]]
        )
      );
    await expect(base({ date: "2000-01-01" })).rejects.toThrow(/in the past/);
    await expect(base({ deadline: "2099-12-30" })).rejects.toThrow(/on or before the show date/);
    await expect(base({ fee: -5 })).rejects.toThrow(/support fee/);
    await expect(base({ mins: 0 })).rejects.toThrow(/set length/);
    await expect(base({ genres: [] })).rejects.toThrow(/at least one genre/);
    await expect(base({ headliner: "   " })).rejects.toThrow(/headliner/);
    await base({}); // a valid one still works
  });
});
