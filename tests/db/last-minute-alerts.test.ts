import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, makeArtist, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("last-minute alerts switch", () => {
  it("an artist can turn their own alerts on and off", async () => {
    const id = await makeArtist(db);
    const on = await asUser(db, id, (tx) => tx.query(`update public.artists set last_minute_alerts = true where id = $1 returning last_minute_alerts`, [id]));
    expect(on.rows).toEqual([{ last_minute_alerts: true }]);
    const off = await asUser(db, id, (tx) => tx.query(`update public.artists set last_minute_alerts = false where id = $1 returning last_minute_alerts`, [id]));
    expect(off.rows).toEqual([{ last_minute_alerts: false }]);
  });
});
