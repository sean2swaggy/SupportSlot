import { describe, expect, it } from "vitest";
import { explainFit, fitRank } from "./fit";

const artist = { genres: ["Indie", "Folk"] as never[], location: "London" as const, travelRadiusMiles: 100, artistSize: "emerging" as const };
const slot = { genres: ["Indie"] as never[], city: "London" as const, artistSizeFit: ["emerging", "developing"] as Array<"emerging" | "developing" | "established"> };

describe("explainFit", () => {
  it("reports real matches with reasons, and no percentage", () => {
    const fit = explainFit(artist, slot);
    expect(fit.signals.map((s) => s.state)).toEqual(["match", "match", "match"]);
    expect(fit.summary).toBe("3 of 3 fit signals match.");
    expect(JSON.stringify(fit)).not.toMatch(/%/);
  });

  it("treats a nearby city as partial when inside the travel radius, mismatch when outside", () => {
    const near = explainFit(artist, { ...slot, city: "Brighton" }); // 55 miles
    expect(near.signals.find((s) => s.key === "location")?.state).toBe("partial");
    const far = explainFit(artist, { ...slot, city: "Leeds" }); // 200 miles
    expect(far.signals.find((s) => s.key === "location")?.state).toBe("mismatch");
  });

  it("never invents a result for missing data", () => {
    const empty = explainFit({ ...artist, genres: [] }, { ...slot, artistSizeFit: [] });
    expect(empty.signals.find((s) => s.key === "genre")?.state).toBe("unknown");
    expect(empty.signals.find((s) => s.key === "size")?.state).toBe("unknown");
    expect(empty.assessed).toBe(1);
    expect(explainFit({ ...artist, genres: [] }, { ...slot, artistSizeFit: [], city: "London" }).summary).toContain("1 of 1");
  });

  it("flags a genre mismatch plainly", () => {
    const fit = explainFit(artist, { ...slot, genres: ["Techno"] as never[] });
    const g = fit.signals.find((s) => s.key === "genre")!;
    expect(g.state).toBe("mismatch");
    expect(g.detail).toContain("Techno");
  });

  it("ranks more clear matches higher", () => {
    expect(fitRank(explainFit(artist, slot))).toBeGreaterThan(fitRank(explainFit(artist, { ...slot, genres: ["Techno"] as never[], city: "Leeds" })));
  });
});
