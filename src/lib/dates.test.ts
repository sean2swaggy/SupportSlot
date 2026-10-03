import { describe, expect, it } from "vitest";
import { applicationCloseText, deadlinePassed, diffDays, formatShowDate, londonToday, showWeekday } from "./dates";

describe("UK calendar dates", () => {
  it("computes today in London, not UTC, around midnight and DST", () => {
    // 23:30 UTC on 30 Jun is 00:30 BST on 1 Jul in London.
    expect(londonToday(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    // In winter London == UTC.
    expect(londonToday(new Date("2026-12-30T23:30:00Z"))).toBe("2026-12-30");
    // Clocks go back 25 Oct 2026: 23:30 UTC on the 24th is 23:30... London is still on BST until 01:00 UTC on the 25th.
    expect(londonToday(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
  });

  it("diffs whole calendar days across month, year and DST boundaries", () => {
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2); // spans the March DST change
    expect(diffDays("2026-12-31", "2027-01-01")).toBe(1);
    expect(diffDays("2026-02-28", "2026-03-01")).toBe(1);
    expect(diffDays("2026-05-10", "2026-05-09")).toBe(-1);
  });

  it("formats show dates the same regardless of the viewer's timezone", () => {
    expect(formatShowDate("2026-12-01", { withYear: true })).toBe("Dec 1, 2026");
    expect(formatShowDate("2026-01-31")).toBe("Jan 31");
    expect(showWeekday("2026-10-03")).toBe("Saturday");
  });

  it("describes and detects deadlines at the day boundary", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(applicationCloseText("2026-10-02", now)).toBe("Applications closed");
    expect(applicationCloseText("2026-10-03", now)).toBe("Applications close today");
    expect(applicationCloseText("2026-10-04", now)).toBe("Applications close tomorrow");
    expect(applicationCloseText("2026-10-10", now)).toBe("Applications close in 7 days");
    expect(deadlinePassed("2026-10-03", now)).toBe(false); // the whole day still counts
    expect(deadlinePassed("2026-10-02", now)).toBe(true);
  });
});
