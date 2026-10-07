import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, makeArtist, makePromoter, makeSlot, type Db } from "./harness";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

// Support Slot handles no money and has no subscription: the tools that used
// to need Support+ are open to every promoter, and to no one else.
describe("promoter tools need no subscription", () => {
  it("any promoter can build a roster, templates and a show schedule", async () => {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db);
    const slot = await makeSlot(db, promoter);

    await asUser(db, promoter, (tx) =>
      tx.query(`insert into public.artist_roster (promoter_id, artist_id, notes) values ($1, $2, 'good live')`, [promoter, artist])
    );
    await asUser(db, promoter, (tx) =>
      tx.query(`update public.artist_roster set notes = 'great live' where promoter_id = $1`, [promoter])
    );
    await asUser(db, promoter, (tx) =>
      tx.query(`insert into public.event_templates (promoter_id, name) values ($1, 'Friday support')`, [promoter])
    );
    const sched = await asUser(db, promoter, (tx) =>
      tx.query<{ id: string; version: number }>(
        `insert into public.show_schedules (slot_id, promoter_id) values ($1, $2) returning id, version`,
        [slot, promoter]
      )
    );
    const v = await asUser(db, promoter, (tx) =>
      tx.query<{ v: number }>(`select public.claim_schedule_version($1, $2) as v`, [sched.rows[0].id, sched.rows[0].version])
    );
    expect(v.rows[0].v).toBe(2);
  });

  it("artists can't use any of them, and one promoter can't touch another's", async () => {
    const promoter = await makePromoter(db);
    const other = await makePromoter(db);
    const artist = await makeArtist(db);
    const slot = await makeSlot(db, promoter);

    await expect(
      asUser(db, artist, (tx) =>
        tx.query(`insert into public.artist_roster (promoter_id, artist_id) values ($1, $2)`, [artist, artist])
      )
    ).rejects.toThrow();
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.event_templates (promoter_id, name) values ($1, 'x')`, [artist]))
    ).rejects.toThrow();
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.show_schedules (slot_id, promoter_id) values ($1, $2)`, [slot, artist]))
    ).rejects.toThrow();

    const sched = await asUser(db, promoter, (tx) =>
      tx.query<{ id: string; version: number }>(
        `insert into public.show_schedules (slot_id, promoter_id) values ($1, $2) returning id, version`,
        [slot, promoter]
      )
    );
    const seen = await asUser(db, other, (tx) => tx.query(`select id from public.show_schedules`));
    expect(seen.rows).toHaveLength(0);
    await expect(
      asUser(db, artist, (tx) => tx.query(`select public.claim_schedule_version($1, $2)`, [sched.rows[0].id, sched.rows[0].version]))
    ).rejects.toThrow(/promoter_required/);
    await expect(
      asUser(db, other, (tx) => tx.query(`select public.claim_schedule_version($1, $2)`, [sched.rows[0].id, sched.rows[0].version]))
    ).rejects.toThrow(/stale_schedule_version/);
  });
});

describe("no payment machinery is left in the schema", () => {
  it("has no payment, billing or subscription tables, columns or functions", async () => {
    const pattern = "stripe|payment|payout|refund|dispute|receipt|billing|subscri|support_plus|booking_fee|processing_fee|total_pence|wallet";
    // Function bodies may legitimately say "payment" in user-facing copy
    // ("arrange payment with them directly"); check for logic, not prose.
    const bodyPattern = "stripe|payment_status|payment_intent|refund|dispute|receipt_url|billing|subscri|support_plus|booking_fee|processing_fee|total_pence|wallet";
    const cols = await db.query<{ t: string; c: string }>(
      `select table_name as t, column_name as c from information_schema.columns where table_schema = 'public' and (table_name ~* $1 or column_name ~* $1)`,
      [pattern]
    );
    const fns = await db.query<{ f: string }>(
      `select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname ~* $1 or p.prosrc ~* $2)`,
      [pattern, bodyPattern]
    );
    expect(cols.rows).toEqual([]);
    expect(fns.rows).toEqual([]);
  });

  it("an offer stores exactly the agreed fee and travel", async () => {
    const promoter = await makePromoter(db);
    const artist = await makeArtist(db, { location: "London" });
    const slot = await makeSlot(db, promoter, { supportFee: 175 });
    const app = await asUser(db, artist, (tx) =>
      tx.query<{ id: string }>(`insert into public.applications (slot_id, artist_id) values ($1, $2) returning id`, [slot, artist])
    );
    await asUser(db, promoter, (tx) => tx.query(`select public.make_offer($1, 'hello')`, [app.rows[0].id]));
    const b = await db.query<{ fee_pence: number; travel_pence: number; status: string }>(
      `select fee_pence, travel_pence, status from public.bookings where application_id = $1`,
      [app.rows[0].id]
    );
    expect(b.rows[0]).toEqual({ fee_pence: 17500, travel_pence: 0, status: "offered" });
  });
});
