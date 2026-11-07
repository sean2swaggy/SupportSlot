import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  createTestDb,
  makeArtist,
  makePromoter,
  makeSlot,
  type Db,
} from "./harness";

// Real migrations, real RLS/triggers, run in-process. These are the checks
// from the pre-launch security audit, now repeatable without a live project.
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("migrations", () => {
  it("apply cleanly from empty and seed the 6 reference venues", async () => {
    const res = await db.query<{ n: number }>(`select count(*)::int as n from public.venues`);
    expect(res.rows[0].n).toBe(6);
  });
});

describe("unauthenticated access", () => {
  it("cannot read applications, messages, or profiles", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    await db.query(
      `insert into public.applications (slot_id, artist_id, match_percent) values ($1, $2, 50)`,
      [slot, artist]
    );
    // The visitor role has no privileges on private tables at all (not merely
    // "RLS returns no rows"), so there is nothing to misconfigure later.
    for (const table of ["applications", "profiles", "messages", "bookings"]) {
      await expect(asAnon(db, (tx) => tx.query(`select id from public.${table}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("can browse open slots (public marketplace data)", async () => {
    const promoter = await makePromoter(db);
    await makeSlot(db, promoter, { headliner: "Public Show" });
    const rows = await asAnon(db, (tx) =>
      tx.query<{ headliner: string }>(`select headliner from public.slots where headliner = 'Public Show'`)
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("mass assignment and role escalation", () => {
  it("an artist cannot self-set verification on update", async () => {
    const artist = await makeArtist(db);
    await expect(
      asUser(db, artist, (tx) =>
        tx.query(
          `update public.artists set verification = 'verified' where id = $1`,
          [artist]
        )
      )
    ).rejects.toThrow(/can only be changed by the platform/);
  });

  it("an artist cannot self-insert as verified", async () => {
    const { signUp } = await import("./harness");
    const id = await signUp(db, "artist");
    await expect(
      asUser(db, id, (tx) =>
        tx.query(
          `insert into public.artists (id, handle, name, location, location_country, location_region, verification)
           values ($1, 'self-verified', 'X', 'London', 'England', 'Greater London', 'verified')`,
          [id]
        )
      )
    ).rejects.toThrow(/can only be set by the platform/);
  });

  it("a user cannot change their own role", async () => {
    const promoter = await makePromoter(db);
    await expect(
      asUser(db, promoter, (tx) =>
        tx.query(`update public.profiles set role = 'artist' where id = $1`, [promoter])
      )
    ).rejects.toThrow(/role cannot be changed/);
  });
});

describe("application integrity", () => {
  it("an artist cannot insert an application that is already booked/confirmed", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    for (const status of ["booked", "confirmed", "shortlisted", "offered"]) {
      await expect(
        asUser(db, artist, (tx) =>
          tx.query(`insert into public.applications (slot_id, artist_id, status) values ($1, $2, $3)`, [slot, artist, status])
        )
      ).rejects.toThrow();
    }
  });

  it("neither party can change an application's status with a direct UPDATE", async () => {
    const artist = await makeArtist(db);
    const promoter = await makePromoter(db);
    const slot = await makeSlot(db, promoter);
    const app = await db.query<{ id: string }>(
      `insert into public.applications (slot_id, artist_id) values ($1, $2) returning id`,
      [slot, artist]
    );
    const appId = app.rows[0].id;
    for (const who of [artist, promoter]) {
      await expect(
        asUser(db, who, (tx) => tx.query(`update public.applications set status = 'confirmed' where id = $1`, [appId]))
      ).rejects.toThrow(/permission denied/); // clients hold no UPDATE privilege on applications
    }
    const row = await db.query<{ status: string }>(`select status from public.applications where id = $1`, [appId]);
    expect(row.rows[0].status).toBe("submitted");
  });

  it("another promoter cannot see or touch an application on someone else's slot", async () => {
    const artist = await makeArtist(db);
    const owner = await makePromoter(db);
    const other = await makePromoter(db);
    const slot = await makeSlot(db, owner);
    const app = await db.query<{ id: string }>(
      `insert into public.applications (slot_id, artist_id) values ($1, $2) returning id`,
      [slot, artist]
    );
    const seen = await asUser(db, other, (tx) =>
      tx.query(`select id from public.applications where id = $1`, [app.rows[0].id])
    );
    expect(seen.rows).toHaveLength(0);
    await expect(
      asUser(db, other, (tx) => tx.query(`select public.make_offer($1)`, [app.rows[0].id]))
    ).rejects.toThrow(/not_authorized/);
  });
});
