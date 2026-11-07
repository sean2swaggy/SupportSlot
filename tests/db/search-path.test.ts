import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createTestDb(); }, 60_000);
afterAll(async () => db.close());

const PINNED = ["_check_place", "bookings_touch", "haversine_miles", "london_today", "long_journey_miles", "minimum_long_journey_travel_pence", "prevent_role_change"];

describe("0006 function search paths", () => {
  it("pins search_path on every helper the security advisor flagged", async () => {
    const r = await db.query<{ proname: string; proconfig: string[] | null }>(
      `select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [PINNED]);
    const rows = r.rows as { proname: string; proconfig: string[] | null }[];
    expect(rows.map((x) => x.proname).sort()).toEqual([...PINNED].sort());
    for (const x of rows) expect(x.proconfig?.join(","), x.proname).toMatch(/search_path=public, pg_temp/);
  });
  it("does not change what the helpers return", async () => {
    const d = await db.query<{ d: number }>(`select public.haversine_miles(51.5, -0.12, 53.48, -2.24) as d`);
    expect(Math.round((d.rows as { d: number }[])[0].d)).toBeGreaterThan(150);
    expect(Math.round((d.rows as { d: number }[])[0].d)).toBeLessThan(200);
    const t = await db.query<{ t: string }>(`select public.london_today()::text as t`);
    expect((t.rows as { t: string }[])[0].t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
