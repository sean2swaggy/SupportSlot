// Show dates and application deadlines are calendar dates in UK time
// ("YYYY-MM-DD" strings, no clock time), so they must be compared as dates in
// Europe/London — not parsed as instants, which shifts them by a day for
// anyone viewing from another timezone and around midnight/DST changes.

const LONDON = "Europe/London";

/** Today's date in the UK, as YYYY-MM-DD. */
export function londonToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parts(isoDate: string): { y: number; m: number; d: number } {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). Negative if `to` is earlier. */
export function diffDays(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function daysUntilLondon(isoDate: string, now: Date = new Date()): number {
  return diffDays(londonToday(now), isoDate);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatShowDate(isoDate: string, opts?: { withYear?: boolean }): string {
  const { y, m, d } = parts(isoDate);
  return opts?.withYear ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

export function showWeekday(isoDate: string): string {
  const { y, m, d } = parts(isoDate);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function applicationCloseText(deadline: string, now: Date = new Date()): string {
  const d = daysUntilLondon(deadline, now);
  if (d < 0) return "Applications closed";
  if (d === 0) return "Applications close today";
  if (d === 1) return "Applications close tomorrow";
  return `Applications close in ${d} days`;
}

/** True once the deadline's whole day has passed in the UK. */
export function deadlinePassed(deadline: string, now: Date = new Date()): boolean {
  return daysUntilLondon(deadline, now) < 0;
}
