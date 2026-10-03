import { describe, expect, it } from "vitest";
import { bookingBreakdown, effectiveTravelPence, processingFeePence, toPence } from "./fees";

describe("booking money (integer pence)", () => {
  it("grosses the processing fee up so the artist keeps their full fee", () => {
    const b = bookingBreakdown({ feePence: 15000, travelPence: 1000, bookingFeePence: 1200 });
    expect(b.processingFeePence).toBe(283);
    expect(b.totalPence).toBe(17483);
    expect(b.artistReceivesPence).toBe(16000);
    expect(b.platformFeePence).toBe(1200 + 283);
    // The platform's cut plus the artist's share is exactly what's charged.
    expect(b.artistReceivesPence + b.platformFeePence).toBe(b.totalPence);
  });

  it("covers a real 1.5% + 20p Stripe fee on the charged total, to within a penny, at many sizes", () => {
    for (const base of [100, 999, 1234, 5000, 17200, 99999, 500000]) {
      const p = processingFeePence(base);
      const stripeFee = Math.round((base + p) * 0.015 + 20);
      expect(p).toBeGreaterThanOrEqual(stripeFee - 1);
      expect(p).toBeLessThanOrEqual(stripeFee + 1);
    }
  });

  it("applies the long-journey travel minimum only over an hour away", () => {
    expect(effectiveTravelPence(0, 40)).toBe(0);
    expect(effectiveTravelPence(0, 41)).toBe(1000);
    expect(effectiveTravelPence(2500, 200)).toBe(2500);
  });

  it("converts pounds to pence without float drift", () => {
    expect(toPence(7.99)).toBe(799);
    expect(toPence(89.99)).toBe(8999);
    expect(toPence(0.1 + 0.2)).toBe(30);
  });
});
