import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, PLACES, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

const call = (user: string, fn: string, ...args: unknown[]) =>
  asUser(db, user, (tx) => tx.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));

async function booking(artist: string, promoter: string, date: string, status = "confirmed"): Promise<string> {
  const slot = await makeSlot(db, promoter, { date: "2099-12-01", deadline: "2099-11-01" });
  const res = await asService(db, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.bookings (slot_id, artist_id, promoter_id, status, artist_name, promoter_company, headliner,
         venue_name, venue_address, venue_city, event_date, doors_time, set_time, set_length_mins, fee_pence, travel_pence, offer_expires_at)
       values ($1, $2, $3, $4, 'The Artist', 'The Promoter Co', 'Show', 'V', 'A', 'London', $5, '19:00', '20:00', 30, 100, 0, now()) returning id`,
      [slot, artist, promoter, status, date]
    )
  );
  return res.rows[0].id;
}

describe("reviews", () => {
  it("both sides can review once the show has happened, one review each", async () => {
    const a = await makeArtist(db); const p = await makePromoter(db);
    const b = await booking(a, p, "2020-01-01");
    await call(a, "submit_review", b, 5, "  Great promoter  ");
    await call(p, "submit_review", b, 4, null);
    const rows = (await asUser(db, a, (tx) => tx.query<any>(`select reviewer_name, rating, comment, reviewee_id from public.reviews where booking_id = $1 order by rating desc`, [b]))).rows;
    expect(rows).toEqual([
      { reviewer_name: "The Artist", rating: 5, comment: "Great promoter", reviewee_id: p },
      { reviewer_name: "The Promoter Co", rating: 4, comment: null, reviewee_id: a },
    ]);
    await expect(call(a, "submit_review", b, 3, null)).rejects.toThrow(/already_reviewed/);
  });

  it("is refused before the show, for unconfirmed bookings, for strangers, and for bad input", async () => {
    const a = await makeArtist(db); const p = await makePromoter(db); const stranger = await makeArtist(db);
    const future = await booking(a, p, "2099-01-01");
    const offered = await booking(a, p, "2020-01-01", "offered");
    const past = await booking(a, p, "2020-01-01");
    await expect(call(a, "submit_review", future, 5, null)).rejects.toThrow(/too_early/);
    await expect(call(a, "submit_review", offered, 5, null)).rejects.toThrow(/not_confirmed/);
    await expect(call(stranger, "submit_review", past, 5, null)).rejects.toThrow(/not_found/);
    await expect(call(a, "submit_review", past, 6, null)).rejects.toThrow(/invalid_rating/);
    await expect(call(a, "submit_review", past, 0, null)).rejects.toThrow(/invalid_rating/);
    await expect(call(a, "submit_review", past, 5, "x".repeat(501))).rejects.toThrow(/invalid_comment/);
  });

  it("notifies the person reviewed, can't be written directly, and is closed to visitors", async () => {
    const a = await makeArtist(db); const p = await makePromoter(db);
    const b = await booking(a, p, "2020-01-01");
    await call(a, "submit_review", b, 5, null);
    const n = await asUser(db, p, (tx) => tx.query<any>(`select type, text from public.notifications where type = 'review_received'`));
    expect(n.rows).toEqual([{ type: "review_received", text: "The Artist left you a review." }]);
    await expect(asUser(db, a, (tx) => tx.query(`insert into public.reviews (booking_id, reviewer_id, reviewee_id, reviewer_name, rating) values ($1,$2,$3,'x',5)`, [b, a, p]))).rejects.toThrow();
    await expect(asUser(db, a, (tx) => tx.query(`update public.reviews set rating = 1`))).rejects.toThrow();
    await expect(asAnon(db, (tx) => tx.query(`select * from public.reviews`))).rejects.toThrow(/permission denied/);
  });
});

describe("saved searches", () => {
  it("an artist keeps up to 10, only artists can save, and only the owner sees them", async () => {
    const a = await makeArtist(db); const other = await makeArtist(db); const p = await makePromoter(db);
    await call(a, "save_search", "Folk nearby", ["Folk"], 30);
    expect((await asUser(db, other, (tx) => tx.query(`select id from public.saved_searches`))).rows).toEqual([]);
    await expect(call(p, "save_search", "x", ["Folk"], null)).rejects.toThrow(/forbidden/);
    await expect(call(a, "save_search", "", ["Folk"], null)).rejects.toThrow(/invalid_label/);
    await expect(call(a, "save_search", "Nothing", [], null)).rejects.toThrow(/invalid_search/);
    for (let i = 1; i < 10; i++) await call(a, "save_search", `S${i}`, ["Rock"], null);
    await expect(call(a, "save_search", "One too many", ["Rock"], null)).rejects.toThrow(/limit_reached/);
  });

  it("a matching new listing sends one in-app alert per artist; non-matches send none", async () => {
    const leeds = await makeArtist(db, { place: PLACES.leeds });
    const bristolFolk = await makeArtist(db, { place: PLACES.bristol });
    const p = await makePromoter(db);
    await call(leeds, "save_search", "Indie in Leeds", ["Indie"], 40);
    await call(leeds, "save_search", "Any indie", ["Indie"], null); // two matching searches, still one alert
    await call(bristolFolk, "save_search", "Folk", ["Folk"], null);
    const alerts = async (u: string) => (await asUser(db, u, (tx) => tx.query<any>(`select text from public.notifications where type = 'saved_search'`))).rows;
    await makeSlot(db, p, { headliner: "Leeds Night", genres: ["Indie"], place: PLACES.leeds });
    expect(await alerts(leeds)).toHaveLength(1);
    expect(await alerts(bristolFolk)).toHaveLength(0);
    // Bristol is far outside a 40-mile search, but the any-distance search still matches: exactly one more alert.
    await makeSlot(db, p, { headliner: "Bristol Night", genres: ["Indie"], place: PLACES.bristol });
    expect(await alerts(leeds)).toHaveLength(2);
  });
});
