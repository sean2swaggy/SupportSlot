import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDb, makeArtist, type Db } from "./harness";

// Migration 0009 undoes the phone-account change: email is required again.

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

describe("sign-up is by email only", () => {
  it("requires an email on every profile again", async () => {
    const r = await db.query<{ is_nullable: string }>(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'`);
    expect(r.rows[0].is_nullable).toBe("NO");
    await expect(db.query(`insert into auth.users (email, raw_user_meta_data) values (null, '{"role":"artist"}')`)).rejects.toThrow(/null value|email/i);
  });

  it("uses the profile's email for a signed-in support request, and still needs one from visitors", async () => {
    const id = await makeArtist(db);
    const have = (await db.query<{ email: string }>(`select email from public.profiles where id = $1`, [id])).rows[0].email;
    await asUser(db, id, (tx) => tx.query(`select public.submit_support_request('bug', 'Something is not working', null)`));
    expect((await db.query<{ email: string }>(`select email from public.support_requests where profile_id = $1`, [id])).rows[0].email).toBe(have);
    await expect(asAnon(db, (tx) => tx.query(`select public.submit_support_request('bug', 'Something is not working', null)`))).rejects.toThrow(/reply to/);
  });

  it("downloads the original data export (no phone number), for signed-in users only", async () => {
    const id = await makeArtist(db);
    const j = (await asUser(db, id, (tx) => tx.query<{ export_my_data: any }>(`select public.export_my_data()`))).rows[0].export_my_data;
    expect(j.account.email).toMatch(/@/);
    expect("phone" in j.account).toBe(false);
    await expect(asAnon(db, (tx) => tx.query(`select public.export_my_data()`))).rejects.toThrow(/permission denied/);
    const core = await db.query(`select 1 from pg_proc where proname = '_export_my_data_core'`);
    expect(core.rows).toHaveLength(0);
  });
});
