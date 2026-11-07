import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("0011 hardening", () => {
  it("no trigger function is executable by visitors or signed-in users", async () => {
    const rows = (await asService(db, (tx) => tx.query<{ sig: string; anon: boolean; auth: boolean }>(
      `select p.oid::regprocedure::text as sig,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prorettype = 'trigger'::regtype`))).rows;
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => r.anon || r.auth)).toEqual([]);
  });

  it("triggers still fire after the revoke (a signed-in write still hits its guards)", async () => {
    const a = await makeArtist(db);
    const res = await asUser(db, a, (tx) => tx.query(`update public.artists set bio = 'hello' where id = $1 returning bio`, [a]));
    expect(res.rows).toEqual([{ bio: "hello" }]);
  });

  it("the data export now carries reviews and saved searches, and stays closed to visitors", async () => {
    const a = await makeArtist(db);
    await asUser(db, a, (tx) => tx.query(`select public.save_search('Folk', '{Folk}', null)`));
    const out = (await asUser(db, a, (tx) => tx.query<{ r: any }>(`select public.export_my_data() as r`))).rows[0].r;
    expect(out.saved_searches).toHaveLength(1);
    expect(out.reviews_written).toEqual([]);
    expect(out.reviews_received).toEqual([]);
    expect(out.account.id).toBe(a);
    await expect(asAnon(db, (tx) => tx.query(`select public.export_my_data()`))).rejects.toThrow(/permission denied/);
    await makePromoter(db);
  });
});
