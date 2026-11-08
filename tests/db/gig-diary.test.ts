import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

const add = (user: string, cols: Record<string, unknown>) => {
  const keys = Object.keys(cols);
  return asUser(db, user, (tx) => tx.query<{ id: string }>(
    `insert into public.gig_diary_entries (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    keys.map((k) => cols[k])));
};

describe("gig diary", () => {
  it("an artist can add, edit and remove their own entries, and sees only their own", async () => {
    const a = await makeArtist(db); const b = await makeArtist(db);
    const id = (await add(a, { artist_id: a, show_date: "2026-05-01", venue: "The Old Hall", city: "Leeds", fee_pence: 15000, expenses_pence: 2000 })).rows[0].id;
    await add(b, { artist_id: b, show_date: "2026-05-02", venue: "Other Room" });
    expect((await asUser(db, a, (tx) => tx.query(`select venue from public.gig_diary_entries`))).rows).toEqual([{ venue: "The Old Hall" }]);
    const upd = await asUser(db, a, (tx) => tx.query(`update public.gig_diary_entries set fee_pence = 20000 where id = $1 returning fee_pence`, [id]));
    expect(upd.rows).toEqual([{ fee_pence: 20000 }]);
    // Someone else's update or removal touches nothing.
    expect((await asUser(db, b, (tx) => tx.query(`update public.gig_diary_entries set fee_pence = 1 where id = $1 returning id`, [id]))).rows).toEqual([]);
    expect((await asUser(db, b, (tx) => tx.query(`delete from public.gig_diary_entries where id = $1 returning id`, [id]))).rows).toEqual([]);
    expect((await asUser(db, a, (tx) => tx.query(`delete from public.gig_diary_entries where id = $1 returning id`, [id]))).rows).toHaveLength(1);
  });

  it("cannot write for someone else, link someone else's booking, or break the limits", async () => {
    const a = await makeArtist(db); const b = await makeArtist(db); const p = await makePromoter(db);
    await expect(add(a, { artist_id: b, show_date: "2026-05-01", venue: "X" })).rejects.toThrow();
    const slot = await makeSlot(db, p, {});
    const booking = (await asService(db, (tx) => tx.query<{ id: string }>(
      `insert into public.bookings (slot_id, artist_id, promoter_id, status, artist_name, promoter_company, headliner, venue_name, venue_address, venue_city, event_date, doors_time, set_time, set_length_mins, fee_pence, travel_pence, offer_expires_at)
       values ($1, $2, $3, 'confirmed', 'B', 'P', 'H', 'V', 'A', 'London', '2020-01-01', '19:00', '20:00', 30, 100, 0, now()) returning id`, [slot, b, p]))).rows[0].id;
    await expect(add(a, { artist_id: a, show_date: "2020-01-01", venue: "X", booking_id: booking })).rejects.toThrow();
    await add(b, { artist_id: b, show_date: "2020-01-01", venue: "X", booking_id: booking });
    await expect(add(b, { artist_id: b, show_date: "2020-01-01", venue: "X", booking_id: booking })).rejects.toThrow(/unique|duplicate/i);
    await expect(add(a, { artist_id: a, show_date: "2026-05-01", venue: "" })).rejects.toThrow();
    await expect(add(a, { artist_id: a, show_date: "2026-05-01", venue: "V", fee_pence: -1 })).rejects.toThrow();
    await expect(add(a, { artist_id: a, show_date: "2026-05-01", venue: "V", notes: "x".repeat(2001) })).rejects.toThrow();
  });

  it("stops at 2,000 entries, is closed to visitors and promoters, and appears in the data export", async () => {
    const a = await makeArtist(db); const p = await makePromoter(db);
    await asService(db, (tx) => tx.query(
      `insert into public.gig_diary_entries (artist_id, show_date, venue) select $1, date '2026-01-01' + g, 'V' from generate_series(1, 2000) g`, [a]));
    await expect(add(a, { artist_id: a, show_date: "2026-12-01", venue: "One more" })).rejects.toThrow(/limit_reached/);
    await expect(asAnon(db, (tx) => tx.query(`select * from public.gig_diary_entries`))).rejects.toThrow(/permission denied/);
    await expect(add(p, { artist_id: p, show_date: "2026-05-01", venue: "X" })).rejects.toThrow();
    const out = (await asUser(db, a, (tx) => tx.query<{ r: any }>(`select public.export_my_data() as r`))).rows[0].r;
    expect(out.gig_diary).toHaveLength(2000);
  }, 60_000);
});
