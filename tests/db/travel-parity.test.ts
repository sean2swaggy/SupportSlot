import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestDb, type Db } from "./harness";

// The app previews travel from Logic/Travel.swift; the database fixes it on the
// offer (effective_travel_pence). This proves the two agree for every ordered
// pair of cities, for the distance and for the money, including the £10 top-up.

const SWIFT = fs.readFileSync(path.resolve(__dirname, "../../SupportSlot/SupportSlot/Logic/Travel.swift"), "utf8");
const swiftDistances = new Map<string, number>();
for (const m of SWIFT.matchAll(/"(\w+)-(\w+)":\s*(\d+),/g)) swiftDistances.set(`${m[1]}-${m[2]}`, Number(m[3]));
const swiftFallback = Number(SWIFT.match(/\?\? (\d+)\n/)![1]);
const swiftMiles = (a: string, b: string) => (a === b ? 0 : swiftDistances.get(`${a}-${b}`) ?? swiftDistances.get(`${b}-${a}`) ?? swiftFallback);
const SPEED = Number(SWIFT.match(/averageSpeedMph = (\d+)/)![1]);
const MIN_POUNDS = Number(SWIFT.match(/minimumLongTravelPounds = (\d+)/)![1]);
const swiftPence = (pounds: number, a: string, b: string) => {
  const long = swiftMiles(a, b) / SPEED > 1;
  return (long ? Math.max(pounds, MIN_POUNDS) : pounds) * 100;
};

const cities = [...new Set([...swiftDistances.keys()].flatMap((k) => k.split("-")))];
let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

describe("Travel.swift ↔ SQL", () => {
  it("knows the same six cities as the database", async () => {
    const r = await db.query<{ c: string }>(`select city_a as c from city_distances union select city_b from city_distances`);
    expect(r.rows.map((x) => x.c).sort()).toEqual([...cities].sort());
  });

  it("agrees on the distance for every ordered pair, in both directions", async () => {
    const diffs: string[] = [];
    for (const a of cities) {
      for (const b of cities) {
        const r = await db.query<{ m: number }>(`select city_distance_miles($1, $2) as m`, [a, b]);
        if (r.rows[0].m !== swiftMiles(a, b)) diffs.push(`${a}→${b}: sql ${r.rows[0].m}, swift ${swiftMiles(a, b)}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it("agrees on the travel money for every ordered pair and a spread of amounts", async () => {
    const diffs: string[] = [];
    for (const a of cities) {
      for (const b of cities) {
        for (const pounds of [0, 5, 10, 11, 40]) {
          const r = await db.query<{ p: number }>(`select effective_travel_pence($1, $2, $3) as p`, [pounds * 100, a, b]);
          if (r.rows[0].p !== swiftPence(pounds, a, b)) diffs.push(`${a}→${b} £${pounds}: sql ${r.rows[0].p}, swift ${swiftPence(pounds, a, b)}`);
        }
      }
    }
    expect(diffs).toEqual([]);
  });

  it("falls back to the same distance for a city it doesn't know", async () => {
    const r = await db.query<{ m: number }>(`select city_distance_miles('London', 'Glasgow') as m`);
    expect(r.rows[0].m).toBe(swiftMiles("London", "Glasgow"));
  });
});
