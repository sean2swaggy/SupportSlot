import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, type Db } from "./harness";
import { effectiveTravelPence, processingFeePence } from "../../src/lib/stripe/fees";
import { distanceBetween } from "../../src/lib/geo";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => db.close());

// The TypeScript fee/travel preview must agree with the SQL that actually
// computes what's charged — otherwise the "preview" would lie.
it("processing fee: TypeScript and SQL agree", async () => {
  for (const base of [0, 1, 100, 999, 1234, 5000, 17200, 99999, 123456, 5_000_000]) {
    const r = await db.query<{ p: number }>(`select public.processing_fee_pence($1::bigint) as p`, [base]);
    expect(r.rows[0].p).toBe(processingFeePence(base));
  }
});

it("city distances and the long-travel top-up: TypeScript and SQL agree for every city pair", async () => {
  const cities = ["London", "Manchester", "Birmingham", "Bristol", "Leeds", "Brighton"];
  for (const a of cities) {
    for (const b of cities) {
      const d = await db.query<{ miles: number }>(`select public.city_distance_miles($1, $2) as miles`, [a, b]);
      expect(d.rows[0].miles).toBe(distanceBetween(a, b));
      for (const base of [0, 500, 2500]) {
        const t = await db.query<{ t: number }>(`select public.effective_travel_pence($1, $2, $3) as t`, [base, a, b]);
        expect(t.rows[0].t).toBe(effectiveTravelPence(base, distanceBetween(a, b)));
      }
    }
  }
});
