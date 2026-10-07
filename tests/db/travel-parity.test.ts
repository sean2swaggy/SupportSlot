import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type Db } from "./harness";
import { effectiveTravelContribution } from "../../src/lib/travel";
import { distanceBetween } from "../../src/lib/geo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

// The TypeScript travel preview must agree with the SQL that actually fixes
// the travel amount on an offer — otherwise the "preview" would lie.
it("city distances and the long-travel top-up: TypeScript and SQL agree for every city pair", async () => {
  const cities = ["London", "Manchester", "Birmingham", "Bristol", "Leeds", "Brighton"];
  for (const a of cities) {
    for (const b of cities) {
      const d = await db.query<{ miles: number }>(`select public.city_distance_miles($1, $2) as miles`, [a, b]);
      expect(d.rows[0].miles).toBe(distanceBetween(a, b));
      for (const pounds of [0, 5, 25]) {
        const t = await db.query<{ t: number }>(`select public.effective_travel_pence($1, $2, $3) as t`, [pounds * 100, a, b]);
        expect(t.rows[0].t).toBe(Math.round(effectiveTravelContribution(pounds, a, b) * 100));
      }
    }
  }
});
