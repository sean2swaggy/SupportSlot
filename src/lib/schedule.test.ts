import { describe, expect, it } from "vitest";
import {
  applyTemplateToEvent,
  captureTemplateEntries,
  combinedTimeline,
  detectArtistDoubleBooking,
  detectMissingChangeover,
  detectStageOverlaps,
  duplicateEntryDraft,
  entriesForStage,
  nextSortOrder,
  reorderStageByDragDrop,
  reorderWithinStage,
  stagesOf,
  validateEntryTimes,
} from "@/lib/schedule";
import type { ScheduleEntry, ScheduleTemplate } from "@/lib/types";

function entry(overrides: Partial<ScheduleEntry>): ScheduleEntry {
  return {
    id: "e1",
    scheduleId: "s1",
    kind: "performance",
    title: "Entry",
    stage: "Main Stage",
    start: "2026-12-20T20:00:00",
    end: "2026-12-20T20:30:00",
    notes: "",
    sortOrder: 0,
    ...overrides,
  };
}

describe("stagesOf / entriesForStage / combinedTimeline", () => {
  it("returns the default stage for an empty schedule", () => {
    expect(stagesOf([])).toEqual(["Main Stage"]);
  });

  it("lists distinct stages in first-seen order", () => {
    const entries = [
      entry({ id: "a", stage: "Second Stage" }),
      entry({ id: "b", stage: "Main Stage" }),
      entry({ id: "c", stage: "Second Stage" }),
    ];
    expect(stagesOf(entries)).toEqual(["Second Stage", "Main Stage"]);
  });

  it("sorts entries within a stage by sortOrder, not time", () => {
    const entries = [
      entry({ id: "a", sortOrder: 2, start: "2026-12-20T18:00:00", end: "2026-12-20T18:10:00" }),
      entry({ id: "b", sortOrder: 0, start: "2026-12-20T22:00:00", end: "2026-12-20T22:10:00" }),
      entry({ id: "c", sortOrder: 1, start: "2026-12-20T20:00:00", end: "2026-12-20T20:10:00" }),
    ];
    expect(entriesForStage(entries, "Main Stage").map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("combined overview is always strictly time-ordered regardless of sortOrder", () => {
    const entries = [
      entry({ id: "a", sortOrder: 0, start: "2026-12-20T22:00:00", end: "2026-12-20T22:10:00" }),
      entry({ id: "b", sortOrder: 1, start: "2026-12-20T18:00:00", end: "2026-12-20T18:10:00" }),
    ];
    expect(combinedTimeline(entries).map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("detectStageOverlaps", () => {
  it("flags two overlapping entries on the same stage", () => {
    const entries = [
      entry({ id: "a", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00" }),
    ];
    const conflicts = detectStageOverlaps(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entryIds.sort()).toEqual(["a", "b"]);
  });

  it("does not flag overlapping entries on different stages", () => {
    const entries = [
      entry({ id: "a", stage: "Main Stage", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", stage: "Second Stage", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00" }),
    ];
    expect(detectStageOverlaps(entries)).toHaveLength(0);
  });

  it("does not flag back-to-back entries that only touch at the boundary", () => {
    const entries = [
      entry({ id: "a", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", start: "2026-12-20T20:30:00", end: "2026-12-20T21:00:00" }),
    ];
    expect(detectStageOverlaps(entries)).toHaveLength(0);
  });
});

describe("detectArtistDoubleBooking", () => {
  it("flags the same artist on two stages at overlapping times", () => {
    const entries = [
      entry({ id: "a", stage: "Main Stage", artistId: "artist-1", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", stage: "Second Stage", artistId: "artist-1", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00" }),
    ];
    const conflicts = detectArtistDoubleBooking(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("artist_double_booking");
  });

  it("does not flag different artists overlapping on different stages", () => {
    const entries = [
      entry({ id: "a", stage: "Main Stage", artistId: "artist-1", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", stage: "Second Stage", artistId: "artist-2", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00" }),
    ];
    expect(detectArtistDoubleBooking(entries)).toHaveLength(0);
  });

  it("does not flag entries with no artist assigned", () => {
    const entries = [
      entry({ id: "a", stage: "Main Stage", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", stage: "Second Stage", start: "2026-12-20T20:15:00", end: "2026-12-20T20:45:00" }),
    ];
    expect(detectArtistDoubleBooking(entries)).toHaveLength(0);
  });
});

describe("detectMissingChangeover", () => {
  it("flags back-to-back performances with too small a gap and no changeover", () => {
    const entries = [
      entry({ id: "a", kind: "performance", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", kind: "performance", start: "2026-12-20T20:33:00", end: "2026-12-20T21:00:00" }),
    ];
    const conflicts = detectMissingChangeover(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("missing_changeover");
  });

  it("does not flag when a changeover entry fills the gap", () => {
    const entries = [
      entry({ id: "a", kind: "performance", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "c", kind: "changeover", start: "2026-12-20T20:30:00", end: "2026-12-20T20:45:00" }),
      entry({ id: "b", kind: "performance", start: "2026-12-20T20:45:00", end: "2026-12-20T21:15:00" }),
    ];
    expect(detectMissingChangeover(entries)).toHaveLength(0);
  });

  it("does not flag performances with a comfortable gap", () => {
    const entries = [
      entry({ id: "a", kind: "performance", start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00" }),
      entry({ id: "b", kind: "performance", start: "2026-12-20T21:00:00", end: "2026-12-20T21:30:00" }),
    ];
    expect(detectMissingChangeover(entries)).toHaveLength(0);
  });
});

describe("reorderWithinStage", () => {
  const entries = [
    entry({ id: "a", sortOrder: 0 }),
    entry({ id: "b", sortOrder: 1 }),
    entry({ id: "c", sortOrder: 2 }),
  ];

  it("swaps sort_order with the previous entry when moving up", () => {
    const result = reorderWithinStage(entries, "Main Stage", "b", "up");
    expect(result).toEqual([
      { id: "b", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
    ]);
  });

  it("never changes start/end — only returns sortOrder pairs", () => {
    const result = reorderWithinStage(entries, "Main Stage", "b", "up");
    expect(result?.every((r) => Object.keys(r).sort())).toBeTruthy();
    expect(result?.[0]).not.toHaveProperty("start");
  });

  it("returns null when trying to move the first entry up", () => {
    expect(reorderWithinStage(entries, "Main Stage", "a", "up")).toBeNull();
  });

  it("returns null when trying to move the last entry down", () => {
    expect(reorderWithinStage(entries, "Main Stage", "c", "down")).toBeNull();
  });
});

describe("reorderStageByDragDrop", () => {
  const entries = [
    entry({ id: "a", sortOrder: 0 }),
    entry({ id: "b", sortOrder: 1 }),
    entry({ id: "c", sortOrder: 2 }),
  ];

  it("moves the dragged entry to the target's position and reindexes everything", () => {
    const result = reorderStageByDragDrop(entries, "Main Stage", "a", "c");
    expect(result).toEqual([
      { id: "b", sortOrder: 0 },
      { id: "c", sortOrder: 1 },
      { id: "a", sortOrder: 2 },
    ]);
  });

  it("returns null when dropped on itself", () => {
    expect(reorderStageByDragDrop(entries, "Main Stage", "a", "a")).toBeNull();
  });

  it("never includes start/end in the result", () => {
    const result = reorderStageByDragDrop(entries, "Main Stage", "a", "b");
    expect(result?.[0]).not.toHaveProperty("start");
  });
});

describe("applyTemplateToEvent / captureTemplateEntries", () => {
  const template: ScheduleTemplate = {
    id: "t1",
    name: "Standard night",
    entries: [
      { id: "te1", kind: "doors", title: "Doors", stage: "Main Stage", offsetMinutes: 0, durationMinutes: 30, sortOrder: 0 },
      { id: "te2", kind: "performance", title: "Support set", stage: "Main Stage", offsetMinutes: 60, durationMinutes: 25, sortOrder: 1 },
    ],
  };

  it("anchors entries at the given start time using the offsets", () => {
    const built = applyTemplateToEvent(template, "2026-12-20T19:00:00");
    expect(built[0].start).toBe("2026-12-20T19:00:00");
    expect(built[1].start).toBe("2026-12-20T20:00:00");
    expect(built[1].end).toBe("2026-12-20T20:25:00");
  });

  it("never carries artist or notes fields — they don't exist on the built entries", () => {
    const built = applyTemplateToEvent(template, "2026-12-20T19:00:00");
    expect(built[0]).not.toHaveProperty("artistId");
    expect(built[0]).not.toHaveProperty("notes");
  });

  it("rolls over into the next day when offsets push past midnight, with no special-casing needed", () => {
    const lateTemplate: ScheduleTemplate = {
      id: "t2",
      name: "Late night",
      entries: [
        { id: "te1", kind: "performance", title: "Closer", stage: "Main Stage", offsetMinutes: 300, durationMinutes: 45, sortOrder: 0 },
      ],
    };
    const built = applyTemplateToEvent(lateTemplate, "2026-12-20T22:00:00");
    expect(built[0].start).toBe("2026-12-21T03:00:00");
    expect(built[0].end).toBe("2026-12-21T03:45:00");
  });

  it("round-trips structure through capture and re-apply", () => {
    const sourceEntries: ScheduleEntry[] = [
      entry({ id: "a", kind: "doors", title: "Doors", start: "2026-12-20T19:00:00", end: "2026-12-20T19:30:00", artistId: "artist-9", notes: "private note", sortOrder: 0 }),
      entry({ id: "b", kind: "performance", title: "Support set", start: "2026-12-20T20:00:00", end: "2026-12-20T20:25:00", sortOrder: 1 }),
    ];
    const captured = captureTemplateEntries(sourceEntries);
    expect(captured[0].offsetMinutes).toBe(0);
    expect(captured[1].offsetMinutes).toBe(60);
    expect(captured[0]).not.toHaveProperty("artistId");
    expect(captured[0]).not.toHaveProperty("notes");
  });
});

describe("nextSortOrder", () => {
  it("is 0 for an empty stage", () => {
    expect(nextSortOrder([], "Main Stage")).toBe(0);
  });

  it("is one past the current maximum on that stage", () => {
    const entries = [entry({ id: "a", sortOrder: 0 }), entry({ id: "b", sortOrder: 3 })];
    expect(nextSortOrder(entries, "Main Stage")).toBe(4);
  });
});

describe("validateEntryTimes", () => {
  it("rejects an end time before the start time", () => {
    const result = validateEntryTimes("2026-12-20T20:30:00", "2026-12-20T20:00:00");
    expect(result.ok).toBe(false);
  });

  it("accepts an end time after midnight relative to the start", () => {
    const result = validateEntryTimes("2026-12-20T23:45:00", "2026-12-21T00:15:00");
    expect(result).toEqual({ ok: true });
  });
});

describe("duplicateEntryDraft", () => {
  it("offsets the copy later and marks the title", () => {
    const original = entry({ start: "2026-12-20T20:00:00", end: "2026-12-20T20:30:00", title: "Support set" });
    const draft = duplicateEntryDraft(original);
    expect(draft.title).toBe("Support set (copy)");
    expect(new Date(draft.start).getTime()).toBeGreaterThan(new Date(original.start).getTime());
    // Same duration as the original.
    expect(new Date(draft.end).getTime() - new Date(draft.start).getTime()).toBe(30 * 60000);
  });
});
