import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, makeArtist, makePromoter, makeSlot, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

async function apply(artist: string, slot: string) {
  const r = await asUser(db, artist, (tx) =>
    tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id, message) values ($1, $2, 'Hi') returning id`, [slot, artist]));
  return r.rows[0].id;
}
const call = (user: string, fn: string, ...args: unknown[]) =>
  asUser(db, user, (tx) => tx.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));
const notifs = (user: string) =>
  asUser(db, user, (tx) => tx.query<{ type: string; href: string }>(`select type, href from public.notifications order by created_at`));

describe("offer message in Messages", () => {
  it("an offer with a message puts it in the conversation for both people, and tells the artist", async () => {
    const artist = await makeArtist(db); const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const appId = await apply(artist, slot);
    await call(promoter, "make_offer", appId, "  We'd love you to play. Doors at 7.  ");

    const mine = (await asUser(db, artist, (tx) => tx.query<{ text: string; sender_id: string }>(
      `select m.text, m.sender_id from public.messages m join public.message_threads t on t.id = m.thread_id where t.application_id = $1`, [appId]))).rows;
    expect(mine).toEqual([{ text: "We'd love you to play. Doors at 7.", sender_id: promoter }]);
    const theirs = (await asUser(db, promoter, (tx) => tx.query(
      `select m.text from public.messages m join public.message_threads t on t.id = m.thread_id where t.application_id = $1`, [appId]))).rows;
    expect(theirs).toHaveLength(1);

    const n = (await notifs(artist)).rows.filter((r) => r.type === "message");
    expect(n).toHaveLength(1);
    expect(n[0].href).toMatch(/^\/messages\?thread=[0-9a-f-]{36}$/);
    // The message is still on the booking with the terms.
    const booking = (await asUser(db, artist, (tx) => tx.query<{ offer_message: string }>(`select offer_message from public.bookings where application_id = $1`, [appId]))).rows[0];
    expect(booking.offer_message).toBe("We'd love you to play. Doors at 7.");
  });

  it("an offer without a message creates no message and no thread", async () => {
    const artist = await makeArtist(db); const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const appId = await apply(artist, slot);
    await call(promoter, "make_offer", appId, "   ");
    const m = (await asUser(db, artist, (tx) => tx.query(`select 1 from public.messages m join public.message_threads t on t.id = m.thread_id where t.application_id = $1`, [appId]))).rows;
    expect(m).toEqual([]);
    expect((await notifs(artist)).rows.filter((r) => r.type === "message")).toEqual([]);
  });

  it("a blocked promoter still can't offer (and so can't message)", async () => {
    const artist = await makeArtist(db); const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const appId = await apply(artist, slot);
    await asUser(db, artist, (tx) => tx.query(`insert into public.promoter_blocks (artist_id, promoter_id) values ($1, $2)`, [artist, promoter]));
    await expect(call(promoter, "make_offer", appId, "hello")).rejects.toThrow(/blocked/);
  });
});

describe("notification links", () => {
  it("the artist's offer notification links to that application, and the promoter's reply links to that listing", async () => {
    const artist = await makeArtist(db); const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const appId = await apply(artist, slot);
    await call(promoter, "make_offer", appId, null);
    const offer = (await notifs(artist)).rows.find((r) => r.type === "offer")!;
    expect(offer.href).toBe(`/application/${appId}`);

    await call(artist, "respond_to_offer", appId, true, null);
    const accepted = (await notifs(promoter)).rows.find((r) => r.type === "offer_accepted")!;
    expect(accepted.href).toBe(`/listing/${slot}`);
  });

  it("shortlisting and declining link to the application too, and other links are left alone", async () => {
    const artist = await makeArtist(db); const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const appId = await apply(artist, slot);
    await call(promoter, "shortlist_application", appId);
    const shortlisted = (await notifs(artist)).rows.find((r) => r.type === "shortlisted")!;
    expect(shortlisted.href).toBe(`/application/${appId}`);
    await call(promoter, "decline_application", appId, null);
    const declined = (await notifs(artist)).rows.find((r) => r.type === "application_declined")!;
    expect(declined.href).toBe(`/application/${appId}`);
  });
});
