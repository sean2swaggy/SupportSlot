import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createTestDb, makeArtist, makePromoter, makeSlot, signUp, type Db } from "./harness";

// The permission matrix (docs/PERMISSIONS.md), proved against the real
// migrations: public visitor / signed-in user / suspended / staff. Sign-in is
// password-only (migration 0007 removed the two-factor requirement), so the
// `aal` claim in the JWT is ignored. "Real Supabase" sessions are modelled by
// the JWT claims Postgres sees (sub, role): the same source auth.uid() reads.

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

const AAL1 = { aal: "aal1" as const };

describe("every table is behind the signed-in + not-suspended policy", () => {
  it("has row-level security and the restrictive policy on all public tables", async () => {
    const r = await db.query<{ tablename: string; rls: boolean; has_policy: boolean; old_policy: boolean }>(`
      select t.tablename, c.relrowsecurity as rls,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
                     and p.policyname = 'active_session_required' and p.permissive = 'RESTRICTIVE') as has_policy,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename
                     and p.policyname = 'aal2_active_session_required') as old_policy
      from pg_tables t join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
      where t.schemaname = 'public' order by 1`);
    expect(r.rows.length).toBeGreaterThan(20);
    expect(r.rows.filter((x) => !x.rls || !x.has_policy || x.old_policy)).toEqual([]);
  });
});

describe("two-factor is not required: the aal claim makes no difference", () => {
  it("a password-only session reads and writes its own data exactly like any signed-in session", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1, $2)`, [slot, artist]), AAL1);
    const count = async (who: string, table: string, aal: "aal1" | "aal2") =>
      (await asUser(db, who, (tx) => tx.query(`select 1 from public.${table}`), { aal })).rows.length;
    expect(await count(artist, "profiles", "aal1")).toBe(await count(artist, "profiles", "aal2"));
    expect(await count(artist, "applications", "aal1")).toBe(1);
    expect(await count(artist, "applications", "aal2")).toBe(1);
    const r = await asUser(db, artist, (tx) => tx.query(`select * from public.my_account_status()`), AAL1);
    expect(r.rows).toHaveLength(1);
  });

  it("visitors who are not signed in still get nothing private, and cannot write", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1, $2)`, [slot, artist]));
    await expect(asAnon(db, (tx) => tx.query(`select 1 from public.applications`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query(`select 1 from public.profiles`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1, $2)`, [slot, artist]))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query(`select * from public.my_account_status()`))).rejects.toThrow(/permission denied/);
  });

  it("can still contact support, and a signed-in user may leave out an email address", async () => {
    const user = await makeArtist(db);
    const r = await asUser(db, user, (tx) => tx.query(`select public.submit_support_request('account', 'I need some help please', null)`), AAL1);
    expect(r.rows).toHaveLength(1);
  });

  it("staff functions need a staff account, not a second factor", async () => {
    const p = await makePromoter(db);
    await expect(asUser(db, p, (tx) => tx.query(`select * from public.staff_audit_log(10)`), AAL1)).rejects.toThrow(/not_authorized/);
    await asService(db, (tx) => tx.query(`update public.profiles set admin_role = 'admin' where id = $1`, [p]));
    expect((await asUser(db, p, (tx) => tx.query(`select * from public.staff_audit_log(10)`), AAL1)).rows).toBeDefined();
  });
});

describe("the claims are the only source of truth", () => {
  it("a client cannot become another identity or staff by anything it sends", async () => {
    const artist = await makeArtist(db);
    const victim = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    // Payload tricks: user_metadata / app_metadata claims named like authority don't count.
    const tricks = { aal: "aal1" as const, extraClaims: { user_metadata: { aal: "aal2", role: "service_role", admin_role: "admin" }, app_metadata: { admin_role: "admin" } } };
    await expect(asUser(db, artist, (tx) => tx.query(`select * from public.staff_audit_log(10)`), tricks)).rejects.toThrow(/not_authorized/);
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1, $2)`, [slot, victim]), tricks)
    ).rejects.toThrow(/row-level security/);
  });

  it("an artist cannot create promoter-owned rows, a promoter cannot create artist rows", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.promoters (id, name, company, location, location_country) values ($1, 'x', 'x', 'London', 'England')`, [artist]))
    ).rejects.toThrow();
    await expect(
      asUser(db, promoter, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ((select id from public.slots limit 1), $1)`, [promoter]))
    ).rejects.toThrow();
  });
});

describe("suspension is enforced in SQL, including for sessions issued earlier", () => {
  it("a session minted before the suspension stops working on the next request", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    // Same long-lived session before and after.
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.profiles`))).rows).toHaveLength(1);
    await asService(db, (tx) => tx.query(`update public.profiles set suspended_at = now(), suspension_reason = 'test' where id = $1`, [artist]));

    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.profiles`))).rows).toHaveLength(0);
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.notifications`))).rows).toHaveLength(0);
    await expect(
      asUser(db, artist, (tx) => tx.query(`insert into public.applications (slot_id, artist_id) values ($1, $2)`, [slot, artist]))
    ).rejects.toThrow(/row-level security|account_suspended/);
    for (const call of [
      `select public.withdraw_application(gen_random_uuid())`,
      `select public.submit_report('other', null, null, 'something happened here')`,
      `select public.refresh_expired_offers()`,
    ]) {
      await expect(asUser(db, artist, (tx) => tx.query(call))).rejects.toThrow(/account_suspended/);
    }
  });

  it("a suspended account can still see that it is suspended, export its data, and ask for help", async () => {
    const artist = await makeArtist(db);
    await asService(db, (tx) => tx.query(`update public.profiles set suspended_at = now(), suspension_reason = 'Spamming applicants' where id = $1`, [artist]));
    const status = await asUser(db, artist, (tx) => tx.query<{ suspended: boolean; suspension_reason: string }>(`select * from public.my_account_status()`));
    expect(status.rows[0].suspended).toBe(true);
    expect(status.rows[0].suspension_reason).toBe("Spamming applicants");
    const exp = await asUser(db, artist, (tx) => tx.query<{ d: { account: { suspended: boolean } } }>(`select public.export_my_data() as d`));
    expect(exp.rows[0].d.account.suspended).toBe(true);
    await asUser(db, artist, (tx) => tx.query(`select public.submit_support_request('account', 'Please review my suspension', null)`));
  });

  it("a suspended staff-looking session loses staff powers too, and staff cannot be suspended", async () => {
    const mod = await makePromoter(db);
    const admin = await makePromoter(db);
    await asService(db, async (tx) => {
      await tx.query(`update public.profiles set admin_role = 'moderator' where id = $1`, [mod]);
      await tx.query(`update public.profiles set admin_role = 'admin' where id = $1`, [admin]);
    });
    await expect(asUser(db, admin, (tx) => tx.query(`select public.admin_suspend_user($1, 'trying to suspend staff')`, [mod]))).rejects.toThrow(/cannot_suspend_staff/);
    await asService(db, (tx) => tx.query(`update public.profiles set suspended_at = now() where id = $1`, [mod]));
    await expect(asUser(db, mod, (tx) => tx.query(`select * from public.staff_audit_log(5)`))).rejects.toThrow(/account_suspended/);
  });

  it("staff suspending a user takes effect immediately and is audited atomically", async () => {
    const admin = await makePromoter(db);
    await asService(db, (tx) => tx.query(`update public.profiles set admin_role = 'admin' where id = $1`, [admin]));
    const artist = await makeArtist(db);
    const before = Number((await db.query<{ n: string }>(`select count(*) n from public.admin_audit_log`)).rows[0].n);
    // A failing mutation (reason too short) leaves NO audit row and NO state change.
    await expect(asUser(db, admin, (tx) => tx.query(`select public.admin_suspend_user($1, 'no')`, [artist]))).rejects.toThrow(/reason_required/);
    expect(Number((await db.query<{ n: string }>(`select count(*) n from public.admin_audit_log`)).rows[0].n)).toBe(before);
    await asUser(db, admin, (tx) => tx.query(`select public.admin_suspend_user($1, 'Harassing promoters')`, [artist]));
    const log = await db.query<{ action: string; actor_id: string; target_id: string; details: { reason: string } }>(
      `select action, actor_id, target_id, details from public.admin_audit_log order by created_at desc limit 1`);
    expect(log.rows[0]).toMatchObject({ action: "user.suspend", actor_id: admin, target_id: artist });
    expect(log.rows[0].details.reason).toBe("Harassing promoters");
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.profiles`))).rows).toHaveLength(0);
    await asUser(db, admin, (tx) => tx.query(`select public.admin_unsuspend_user($1)`, [artist]));
    expect((await asUser(db, artist, (tx) => tx.query(`select 1 from public.profiles`))).rows).toHaveLength(1);
    await expect(asUser(db, admin, (tx) => tx.query(`select public.admin_unsuspend_user(gen_random_uuid())`))).rejects.toThrow(/not_found/);
  });
});

describe("staff boundaries", () => {
  async function staff(role: "moderator" | "admin") {
    const p = await makePromoter(db);
    await asService(db, (tx) => tx.query(`update public.profiles set admin_role = $2 where id = $1`, [p, role]));
    return p;
  }

  it("moderators can moderate but not verify users or read bookings; admins can", async () => {
    const mod = await staff("moderator");
    const admin = await staff("admin");
    const artist = await makeArtist(db);
    await expect(asUser(db, mod, (tx) => tx.query(`select public.admin_set_verification($1, true)`, [artist]))).rejects.toThrow(/not_authorized/);
    await expect(asUser(db, mod, (tx) => tx.query(`select * from public.admin_recent_bookings(5)`))).rejects.toThrow(/not_authorized/);
    expect((await asUser(db, mod, (tx) => tx.query(`select * from public.staff_open_reports('all', 5)`))).rows).toBeDefined();
    await asUser(db, admin, (tx) => tx.query(`select public.admin_set_verification($1, true)`, [artist]));
    expect((await db.query<{ verification: string }>(`select verification from public.artists where id = $1`, [artist])).rows[0].verification).toBe("verified");
    expect((await db.query<{ action: string }>(`select action from public.admin_audit_log order by created_at desc limit 1`)).rows[0].action).toBe("verification.verified");
    expect((await asUser(db, admin, (tx) => tx.query(`select * from public.admin_recent_bookings(5)`))).rows).toBeDefined();
  });

  it("nobody but the database owner can write the audit log, and staff roles can't be self-assigned", async () => {
    const mod = await staff("moderator");
    await expect(asUser(db, mod, (tx) => tx.query(`insert into public.admin_audit_log (actor_role, action, target_type) values ('admin', 'x', 'y')`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, mod, (tx) => tx.query(`update public.admin_audit_log set action = 'edited'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, mod, (tx) => tx.query(`delete from public.admin_audit_log`))).rejects.toThrow(/permission denied/);
    const plain = await makeArtist(db);
    await expect(asUser(db, plain, (tx) => tx.query(`update public.profiles set admin_role = 'admin' where id = $1`, [plain]))).rejects.toThrow(/only be changed by the platform/);
  });

  it("listing removal winds the listing down and writes an audit row; support and report updates are audited", async () => {
    const mod = await staff("moderator");
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await asUser(db, mod, (tx) => tx.query(`select public.admin_remove_listing($1, 'Not a real gig')`, [slot]));
    expect((await db.query<{ status: string }>(`select status from public.slots where id = $1`, [slot])).rows[0].status).toBe("cancelled");
    const sr = await asAnon(db, (tx) => tx.query<{ id: string }>(`select public.submit_support_request('bug', 'The button does nothing at all', 'a@example.test') as id`));
    const id = (sr.rows[0] as unknown as { id: string }).id;
    await asUser(db, mod, (tx) => tx.query(`select public.admin_update_support_request($1, 'answered', 'Replied by email')`, [id]));
    const actions = (await db.query<{ action: string }>(`select action from public.admin_audit_log where actor_id = $1 order by created_at`, [mod])).rows.map((r) => r.action);
    expect(actions).toEqual(["listing.remove", "support.answered"]);
  });
});

describe("what a visitor (anon key) can and cannot do", () => {
  it("holds privileges on exactly the public tables and functions", async () => {
    const tables = await db.query<{ t: string }>(`
      select distinct table_name t from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public' order by 1`);
    expect(tables.rows.map((r) => r.t)).toEqual(["artist_shows", "artist_tracks", "artists", "promoters", "slots", "venues"]);
    const fns = await db.query<{ name: string }>(`
      select p.proname as name from pg_proc p where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('anon', p.oid, 'execute') and p.prorettype <> 'trigger'::regtype order by 1`);
    expect(fns.rows.map((r) => r.name)).toEqual([
      "haversine_miles", "london_today", "long_journey_miles", "minimum_long_journey_travel_pence", "search_slots", "submit_support_request",
    ]);
  });

  it("sees public listings and profiles, never the private location, roster or messages", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    await makeSlot(db, promoter);
    const r = await asAnon(db, async (tx) => ({
      slots: (await tx.query(`select 1 from public.slots`)).rows.length,
      artists: (await tx.query<Record<string, unknown>>(`select * from public.artists where id = $1`, [artist])).rows,
    }));
    expect(r.slots).toBeGreaterThan(0);
    expect(Object.keys(r.artists[0]).filter((k) => /lat|lon|coord/.test(k))).toEqual([]);
    for (const t of ["artist_locations", "artist_roster", "messages", "profiles"]) {
      await expect(asAnon(db, (tx) => tx.query(`select 1 from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("cannot call state functions", async () => {
    await expect(asAnon(db, (tx) => tx.query(`select public.make_offer(gen_random_uuid(), null)`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query(`select public.is_username_available('someone')`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query(`select public.export_my_data()`))).rejects.toThrow(/permission denied/);
  });
});

describe("SECURITY DEFINER audit", () => {
  it("every definer function pins its search_path", async () => {
    const r = await db.query<{ sig: string }>(`
      select p.oid::regprocedure::text as sig from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(r.rows).toEqual([]);
  });

  it("internal helpers are not callable by clients", async () => {
    const user = await makeArtist(db);
    for (const call of [
      `select public._audit('x', 'y', 'z', '{}')`,
      `select public.notify(gen_random_uuid(), 'system', 'x', null, null, false)`,
      `select public.rate_limit_hit('k', 1, 60)`,
      `select public.expire_stale_offers()`,
      `select public.prepare_account_deletion(gen_random_uuid())`,
      `select public._travel_terms(0, gen_random_uuid(), 51.5, -0.1)`,
      `select public._promoter_blocked_by(gen_random_uuid(), gen_random_uuid())`,
    ]) {
      await expect(asUser(db, user, (tx) => tx.query(call))).rejects.toThrow(/permission denied/);
    }
  });

  it("a user cannot sign up as staff or smuggle a role through signup metadata", async () => {
    // handle_new_user only reads `role` and the profile CHECK allows artist|promoter only.
    await expect(
      db.query(`insert into auth.users (email, raw_user_meta_data) values ('x@example.test', '{"role":"admin"}')`)
    ).rejects.toThrow();
    const id = await signUp(db, "promoter");
    expect((await db.query<{ admin_role: string | null }>(`select admin_role from public.profiles where id = $1`, [id])).rows[0].admin_role).toBeNull();
  });
});
