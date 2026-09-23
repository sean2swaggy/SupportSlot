// Pure, framework-free helpers for Show Schedule — kept separate from
// queries.ts (which needs a live SupabaseClient) so overlap/conflict
// detection and template application can be unit tested without a database.
import type { ScheduleEntry, ScheduleEntryKind, ScheduleTemplate, ScheduleTemplateEntry } from "@/lib/types";

export const SCHEDULE_ENTRY_KIND_LABELS: Record<ScheduleEntryKind, string> = {
  arrival: "Arrival",
  load_in: "Load-in",
  soundcheck: "Soundcheck",
  doors: "Doors",
  performance: "Performance",
  changeover: "Changeover",
  break: "Break",
  other: "Other",
};

export const DEFAULT_STAGE = "Main Stage";

// How long "consecutive performances with no changeover" is allowed to be
// before it's flagged — a real gap this short usually means someone forgot
// to add a changeover entry, not that the show is deliberately tight.
export const MIN_CHANGEOVER_MINUTES = 10;

// Every start/end in this module is a naive "YYYY-MM-DDTHH:mm[:ss]"
// wall-clock string with no timezone designator — matching both the
// database's `timestamp` (no tz) columns and what a native
// <input type="datetime-local"> produces. The app has exactly one implicit
// timezone (Europe/London; slots.city is UK-only) so there's nothing to
// convert — these two helpers just parse/format that string's digits
// through Date.UTC's getters/setters as an arbitrary offset-free scratch
// space, deliberately never through the runtime's *local* timezone (plain
// `new Date("...")` parsing or `.toISOString()`), so the exact same
// calculation produces the exact same wall-clock result no matter what
// timezone the browser or dev server process happens to be running in.
export function parseNaiveDateTime(iso: string): number {
  const [datePart, timePart = "00:00:00"] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh = "0", mm = "0", ss = "0"] = timePart.split(":");
  return Date.UTC(y, m - 1, d, Number(hh), Number(mm), Number(ss));
}

export function formatNaiveDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const SCHEDULE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatNaiveTime(iso: string): string {
  return (iso.split("T")[1] ?? "00:00:00").slice(0, 5);
}

export function formatNaiveDayLabel(iso: string): string {
  const d = new Date(parseNaiveDateTime(iso));
  return `${SCHEDULE_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// True when this entry's calendar day (UK wall-clock) differs from the
// event's own posted date — the display cue for "this is technically the
// next day" on an entry that runs past midnight.
export function crossesIntoNextDay(iso: string, eventDateIso: string): boolean {
  return iso.slice(0, 10) !== eventDateIso.slice(0, 10);
}

function startMs(e: Pick<ScheduleEntry, "start">) {
  return parseNaiveDateTime(e.start);
}
function endMs(e: Pick<ScheduleEntry, "end">) {
  return parseNaiveDateTime(e.end);
}

function overlaps(a: Pick<ScheduleEntry, "start" | "end">, b: Pick<ScheduleEntry, "start" | "end">) {
  return startMs(a) < endMs(b) && startMs(b) < endMs(a);
}

// Distinct stage names across a schedule's entries, in first-seen order —
// what the stage-tab UI iterates over. Always includes at least the default
// stage so a brand-new, empty schedule still has one tab to add entries to.
export function stagesOf(entries: ScheduleEntry[]): string[] {
  const seen: string[] = [];
  for (const e of entries) {
    if (!seen.includes(e.stage)) seen.push(e.stage);
  }
  return seen.length > 0 ? seen : [DEFAULT_STAGE];
}

// Display order within one stage's timeline — what drag-and-drop and the
// reorder buttons operate on. Never derived from start/end; ties broken by
// start time only so a freshly-added entry lands somewhere sane before the
// promoter drags it into place.
export function entriesForStage(entries: ScheduleEntry[], stage: string): ScheduleEntry[] {
  return entries
    .filter((e) => e.stage === stage)
    .sort((a, b) => a.sortOrder - b.sortOrder || startMs(a) - startMs(b));
}

// The combined, all-stages overview — strictly time-ordered, since that's
// the one view meant to answer "what's happening right now across the
// whole show," not "what order did I put these in."
export function combinedTimeline(entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].sort((a, b) => startMs(a) - startMs(b));
}

export interface ScheduleConflict {
  entryIds: [string, string];
  kind: "stage_overlap" | "artist_double_booking" | "missing_changeover";
  message: string;
}

// Two entries on the same stage whose time ranges overlap.
export function detectStageOverlaps(entries: ScheduleEntry[]): ScheduleConflict[] {
  const out: ScheduleConflict[] = [];
  for (const stage of stagesOf(entries)) {
    const onStage = entries.filter((e) => e.stage === stage);
    for (let i = 0; i < onStage.length; i++) {
      for (let j = i + 1; j < onStage.length; j++) {
        if (overlaps(onStage[i], onStage[j])) {
          out.push({
            entryIds: [onStage[i].id, onStage[j].id],
            kind: "stage_overlap",
            message: `"${onStage[i].title}" and "${onStage[j].title}" overlap on ${stage}.`,
          });
        }
      }
    }
  }
  return out;
}

// The same artist assigned to two entries, on different stages, at
// overlapping times — physically impossible, so always worth flagging even
// though nothing stops a promoter from entering it.
export function detectArtistDoubleBooking(entries: ScheduleEntry[]): ScheduleConflict[] {
  const out: ScheduleConflict[] = [];
  const withArtist = entries.filter((e) => e.artistId);
  for (let i = 0; i < withArtist.length; i++) {
    for (let j = i + 1; j < withArtist.length; j++) {
      const a = withArtist[i];
      const b = withArtist[j];
      if (a.artistId === b.artistId && a.stage !== b.stage && overlaps(a, b)) {
        out.push({
          entryIds: [a.id, b.id],
          kind: "artist_double_booking",
          message: `Same artist is scheduled on both ${a.stage} and ${b.stage} at overlapping times.`,
        });
      }
    }
  }
  return out;
}

// Back-to-back performance entries, same stage, with less than
// MIN_CHANGEOVER_MINUTES between them and no changeover entry in the gap.
export function detectMissingChangeover(
  entries: ScheduleEntry[],
  minGapMinutes: number = MIN_CHANGEOVER_MINUTES
): ScheduleConflict[] {
  const out: ScheduleConflict[] = [];
  for (const stage of stagesOf(entries)) {
    const onStage = entries.filter((e) => e.stage === stage).sort((a, b) => startMs(a) - startMs(b));
    const performances = onStage.filter((e) => e.kind === "performance");
    for (let i = 0; i < performances.length - 1; i++) {
      const current = performances[i];
      const next = performances[i + 1];
      const gapMinutes = (startMs(next) - endMs(current)) / 60000;
      if (gapMinutes >= minGapMinutes) continue;
      const hasChangeover = onStage.some(
        (e) => e.kind === "changeover" && startMs(e) >= endMs(current) && endMs(e) <= startMs(next)
      );
      if (!hasChangeover) {
        out.push({
          entryIds: [current.id, next.id],
          kind: "missing_changeover",
          message: `"${current.title}" and "${next.title}" are back-to-back on ${stage} with no changeover.`,
        });
      }
    }
  }
  return out;
}

export function detectAllConflicts(entries: ScheduleEntry[]): ScheduleConflict[] {
  return [
    ...detectStageOverlaps(entries),
    ...detectArtistDoubleBooking(entries),
    ...detectMissingChangeover(entries),
  ];
}

export function nextSortOrder(entries: ScheduleEntry[], stage: string): number {
  const onStage = entries.filter((e) => e.stage === stage);
  return onStage.length === 0 ? 0 : Math.max(...onStage.map((e) => e.sortOrder)) + 1;
}

// Swaps two entries' sort_order — the one operation drag-and-drop and the
// up/down buttons both reduce to. Deliberately returns only the two changed
// {id, sortOrder} pairs to write, not a whole-list rewrite, since a
// concurrent editor's untouched entries shouldn't be re-saved.
export function reorderWithinStage(
  entries: ScheduleEntry[],
  stage: string,
  entryId: string,
  direction: "up" | "down"
): Array<{ id: string; sortOrder: number }> | null {
  const ordered = entriesForStage(entries, stage);
  const index = ordered.findIndex((e) => e.id === entryId);
  if (index === -1) return null;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return null;
  const a = ordered[index];
  const b = ordered[targetIndex];
  return [
    { id: a.id, sortOrder: b.sortOrder },
    { id: b.id, sortOrder: a.sortOrder },
  ];
}

// Full reindex for a stage's list after a drag-and-drop move — the dragged
// entry moves to the dropped-on entry's position and every entry in the
// stage gets a fresh sequential sort_order (0..n-1). Still never touches
// start/end, same guarantee as reorderWithinStage.
export function reorderStageByDragDrop(
  entries: ScheduleEntry[],
  stage: string,
  draggedId: string,
  targetId: string
): Array<{ id: string; sortOrder: number }> | null {
  const ordered = entriesForStage(entries, stage);
  const fromIndex = ordered.findIndex((e) => e.id === draggedId);
  const toIndex = ordered.findIndex((e) => e.id === targetId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
  const reordered = [...ordered];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered.map((e, i) => ({ id: e.id, sortOrder: i }));
}

// Builds real entries (minus id/scheduleId, which the caller assigns on
// insert) for one event from a template — anchored at `anchorStart`, a
// naive "YYYY-MM-DDTHH:mm" wall-clock string (typically the slot's doors
// time on its date). Never carries an artist or notes forward: those
// columns don't exist on template entries at all, so there's nothing to
// invent here even by accident.
export function applyTemplateToEvent(
  template: ScheduleTemplate,
  anchorStart: string
): Array<Omit<ScheduleEntry, "id" | "scheduleId" | "artistId" | "notes">> {
  const anchorMs = parseNaiveDateTime(anchorStart);
  return template.entries.map((te) => {
    const startMs_ = anchorMs + te.offsetMinutes * 60000;
    const endMs_ = startMs_ + te.durationMinutes * 60000;
    return {
      kind: te.kind,
      title: te.title,
      stage: te.stage,
      start: formatNaiveDateTime(startMs_),
      end: formatNaiveDateTime(endMs_),
      sortOrder: te.sortOrder,
    };
  });
}

// The inverse of applyTemplateToEvent — captures an event's current running
// order as reusable structure. Strips exactly what the spec requires a
// template to never carry: artists, private notes, and the real dates
// (kept only as minute offsets from the earliest entry).
export function captureTemplateEntries(
  entries: ScheduleEntry[]
): Array<Omit<ScheduleTemplateEntry, "id">> {
  if (entries.length === 0) return [];
  const anchor = Math.min(...entries.map(startMs));
  return entries.map((e) => ({
    kind: e.kind,
    title: e.title,
    stage: e.stage,
    offsetMinutes: Math.round((startMs(e) - anchor) / 60000),
    durationMinutes: Math.max(1, Math.round((endMs(e) - startMs(e)) / 60000)),
    sortOrder: e.sortOrder,
  }));
}

export function validateEntryTimes(start: string, end: string): { ok: true } | { ok: false; error: string } {
  if (!start || !end) return { ok: false, error: "Set both a start and end time." };
  if (parseNaiveDateTime(end) <= parseNaiveDateTime(start)) {
    return { ok: false, error: "End time must be after the start time." };
  }
  return { ok: true };
}

// Duplicates an entry for the "duplicate" action — same stage/kind/duration,
// offset 30 minutes later so it doesn't land exactly on top of the
// original, titled distinctly so it isn't mistaken for the source entry.
export function duplicateEntryDraft(
  entry: ScheduleEntry,
  offsetMinutes: number = 30
): Omit<ScheduleEntry, "id"> {
  const durationMs = endMs(entry) - startMs(entry);
  const newStartMs = startMs(entry) + offsetMinutes * 60000;
  return {
    ...entry,
    title: `${entry.title} (copy)`,
    start: formatNaiveDateTime(newStartMs),
    end: formatNaiveDateTime(newStartMs + durationMs),
  };
}

