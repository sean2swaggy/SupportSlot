import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, type Db } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

const call = (user: string, fn: string, ...args: unknown[]) =>
  asUser(db, user, (tx) => tx.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));

async function apply(artist: string, slot: string) {
  return (
    await asUser(db, artist, (tx) =>
      tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1, $2) returning id`, [slot, artist])
    )
  ).rows[0].id;
}

describe("delete_my_account", () => {
  it("removes the login and profile, withdraws open applications, keeps past booking records unlinked", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app);

    await call(artist, "delete_my_account");

    expect((await db.query(`select 1 from auth.users where id = $1`, [artist])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.profiles where id = $1`, [artist])).rows).toHaveLength(0);
    // the application went with the artist; the promoter's listing is untouched
    expect((await db.query(`select 1 from public.applications where id = $1`, [app])).rows).toHaveLength(0);
    const b = await db.query<{ status: string; artist_id: string | null; artist_name: string }>(
      `select status, artist_id, artist_name from public.bookings where slot_id = $1`,
      [slot]
    );
    expect(b.rows[0]).toMatchObject({ status: "withdrawn", artist_id: null, artist_name: "Test Artist" });
  });

  it("is refused while there's an upcoming confirmed booking, and for anonymous callers", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    await call(promoter, "make_offer", app);
    await call(artist, "respond_to_offer", app, true, null);

    await expect(call(artist, "delete_my_account")).rejects.toThrow(/deletion_blocked/);
    await expect(call(promoter, "delete_my_account")).rejects.toThrow(/deletion_blocked/);
    expect((await db.query(`select 1 from auth.users where id = $1`, [artist])).rows).toHaveLength(1);
    await expect(asAnon(db, (tx) => tx.query(`select public.delete_my_account()`))).rejects.toThrow(/permission denied/);

    // once the booking is cancelled, deletion goes through
    await call(artist, "cancel_booking", app, "can no longer play");
    await call(artist, "delete_my_account");
    expect((await db.query(`select 1 from auth.users where id = $1`, [artist])).rows).toHaveLength(0);
  });
});

describe("export_my_data", () => {
  it("contains my own records and nobody else's", async () => {
    const a1 = await makeArtist(db, { name: "Export Me" });
    const a2 = await makeArtist(db, { name: "Not Me" });
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await apply(a1, slot);
    await apply(a2, slot);

    const out = (await asUser(db, a1, (tx) => tx.query<{ r: any }>(`select public.export_my_data() as r`))).rows[0].r;
    expect(out.artist.name).toBe("Export Me");
    expect(out.promoter).toBeNull();
    expect(out.applications).toHaveLength(1);
    expect(out.applications[0].artist_id).toBe(a1);
    expect(JSON.stringify(out)).not.toContain("Not Me");

    await expect(asAnon(db, (tx) => tx.query(`select public.export_my_data()`))).rejects.toThrow(/permission denied/);
  });
});

describe("submit_support_request", () => {
  const send = (topic: string, message: string, email: string | null) =>
    asAnon(db, (tx) => tx.query<{ id: string }>(`select public.submit_support_request($1, $2, $3) as id`, [topic, message, email]));

  it("works signed out (with a reply address) and signed in (using the account email)", async () => {
    const out = await send("account", "I can't get into my account any more.", "Locked.Out@Example.test");
    const row = (await db.query<{ email: string; profile_id: string | null; status: string }>(`select email, profile_id, status from public.support_requests where id = $1`, [out.rows[0].id])).rows[0];
    expect(row).toEqual({ email: "locked.out@example.test", profile_id: null, status: "open" });

    const artist = await makeArtist(db);
    const mine = await asUser(db, artist, (tx) => tx.query<{ id: string }>(`select public.submit_support_request('bug', 'The apply button spins forever.', null) as id`));
    const r2 = (await db.query<{ profile_id: string }>(`select profile_id from public.support_requests where id = $1`, [mine.rows[0].id])).rows[0];
    expect(r2.profile_id).toBe(artist);
  });

  it("validates topic, message length and the reply address", async () => {
    await expect(send("payment", "A long enough message here.", "a@example.test")).rejects.toThrow(/support_invalid/);
    await expect(send("bug", "short", "a@example.test")).rejects.toThrow(/at least 10/);
    await expect(send("bug", "A long enough message here.", "not-an-email")).rejects.toThrow(/reply to/);
    await expect(send("bug", "A long enough message here.", null)).rejects.toThrow(/reply to/);
  });

  it("is rate limited per address", async () => {
    for (let i = 0; i < 5; i++) await send("other", `Flooding attempt number ${i + 1}, hello`, "flood@example.test");
    await expect(send("other", "Flooding attempt number six, hello", "flood@example.test")).rejects.toThrow(/rate_limited/);
  });
});

describe("refresh_expired_offers", () => {
  it("expires offers past their deadline for everyone, and nothing else", async () => {
    const artist = await makeArtist(db);
    const other = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await apply(artist, slot);
    const app2 = await apply(other, slot);
    await call(promoter, "make_offer", app);
    await call(promoter, "make_offer", app2);
    await asService(db, (tx) =>
      tx.query(`update public.bookings set offer_expires_at = now() - interval '1 hour' where application_id = $1`, [app])
    );

    const n = (await call(other, "refresh_expired_offers")).rows[0].r;
    expect(Number(n)).toBeGreaterThanOrEqual(1);
    const s = (id: string) => db.query<{ status: string }>(`select status from public.applications where id = $1`, [id]);
    expect((await s(app)).rows[0].status).toBe("shortlisted");
    expect((await s(app2)).rows[0].status).toBe("offered"); // still within its deadline
    await expect(asAnon(db, (tx) => tx.query(`select public.refresh_expired_offers()`))).rejects.toThrow(/permission denied/);
  });
});
