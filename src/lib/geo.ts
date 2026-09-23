import type { UKCity } from "./types";

// Rough approximate road-distance matrix (miles) between UK city centres.
// Good enough for a prototype "distance" filter — not for real routing.
const DISTANCES: Record<string, number> = {
  "London-Manchester": 200,
  "London-Birmingham": 120,
  "London-Bristol": 120,
  "London-Leeds": 200,
  "London-Brighton": 55,
  "Manchester-Birmingham": 90,
  "Manchester-Bristol": 170,
  "Manchester-Leeds": 45,
  "Manchester-Brighton": 250,
  "Birmingham-Bristol": 90,
  "Birmingham-Leeds": 120,
  "Birmingham-Brighton": 170,
  "Bristol-Leeds": 210,
  "Bristol-Brighton": 130,
  "Leeds-Brighton": 240,
};

export function distanceBetween(a: UKCity | string, b: UKCity | string): number {
  if (a === b) return 0;
  const key1 = `${a}-${b}`;
  const key2 = `${b}-${a}`;
  return DISTANCES[key1] ?? DISTANCES[key2] ?? 150;
}
