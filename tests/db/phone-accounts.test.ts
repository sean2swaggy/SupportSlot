import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, signUp, type Db } from "./harness";

// Phone sign-ups (migration 0008): a person with a phone number and no email.

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

const profile = async (id: string) =>
  (await db.query<{ email: string | null; role: string }>(`select email, role from public.profiles where id = $1`, [id])).rows[0];

describe("a phone-only account", () => {
  it("gets a profile with no email, and the role it signed up with", async () => {
    const id = await signUp(db, "promoter", { phone: "447700900123" });
    expect(await profile(id)).toEqual({ email: null, role: "promoter" });
  });

  it("can use the app like any signed-in account (status, own profile)", async () => {
    const id = await signUp(db, "artist", { phone: "447700900124" });
    const st = await asUser(db, id, (tx) => tx.query(`select * from public.my_account_status()`));
    expect(st.rows).toHaveLength(1);
    expect((await asUser(db, id, (tx) => tx.query(`select id from public.profiles`))).rows).toHaveLength(1);
  });

  it("cannot be given an email by the client (the platform owns it)", async () => {
    const id = await signUp(db, "artist", { phone: "447700900125" });
    await expect(asUser(db, id, (tx) => tx.query(`update public.profiles set email = 'x@example.test' where id = $1`, [id]))).rejects.toThrow(/only be changed by the platform/);
  });
});

describe("the support form without an email on file", () => {
  it("makes a phone-only account give a reply-to address, then accepts it", async () => {
    const id = await signUp(db, "artist", { phone: "447700900126" });
    await expect(asUser(db, id, (tx) => tx.query(`select public.submit_support_request('account', 'I cannot get into my account', null)`))).rejects.toThrow(/reply to/);
    const ok = await asUser(db, id, (tx) => tx.query(`select public.submit_support_request('account', 'I cannot get into my account', 'me@example.test')`));
    expect(ok.rows).toHaveLength(1);
    const row = await db.query<{ email: string; profile_id: string }>(`select email, profile_id from public.support_requests where profile_id = $1`, [id]);
    expect(row.rows[0].email).toBe("me@example.test");
  });

  it("still uses the profile's email for an email account, and still needs one from visitors", async () => {
    const id = await makeArtist(db);
    const have = (await profile(id)).email!;
    await asUser(db, id, (tx) => tx.query(`select public.submit_support_request('bug', 'Something is not working', null)`));
    const row = await db.query<{ email: string }>(`select email from public.support_requests where profile_id = $1`, [id]);
    expect(row.rows[0].email).toBe(have);
    await expect(asAnon(db, (tx) => tx.query(`select public.submit_support_request('bug', 'Something is not working', null)`))).rejects.toThrow(/reply to/);
  });
});

describe("download my data", () => {
  it("includes the phone number for a phone account and null for an email account", async () => {
    const p = await signUp(db, "artist", { phone: "447700900127" });
    const e = await makeArtist(db);
    const pj = (await asUser(db, p, (tx) => tx.query<{ export_my_data: any }>(`select public.export_my_data()`))).rows[0].export_my_data;
    expect(pj.account.phone).toBe("447700900127");
    expect(pj.account.email).toBeNull();
    const ej = (await asUser(db, e, (tx) => tx.query<{ export_my_data: any }>(`select public.export_my_data()`))).rows[0].export_my_data;
    expect(ej.account.phone).toBeNull();
    expect(ej.account.email).toMatch(/@/);
    expect(Object.keys(ej)).toContain("applications");
  });

  it("keeps the renamed core function closed to clients and refuses visitors", async () => {
    const id = await makeArtist(db);
    await expect(asUser(db, id, (tx) => tx.query(`select public._export_my_data_core()`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query(`select public.export_my_data()`))).rejects.toThrow(/permission denied/);
    await asService(db, async () => {});
  });
});
