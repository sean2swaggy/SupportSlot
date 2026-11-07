/** Show dates are UK calendar dates (YYYY-MM-DD). All day maths is done on
 *  the string via UTC so the viewer's timezone can never shift a date. */
export function todayLondon(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function isPast(iso: string, today = todayLondon()): boolean {
  return iso < today;
}

export function daysUntil(iso: string, today = todayLondon()): number {
  const [y, m, d] = parts(iso);
  const [ty, tm, td] = parts(today);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
}

export const weekday = (iso: string) => fmt(iso, { weekday: "short" });
export const dayNum = (iso: string) => fmt(iso, { day: "numeric" });
export const monthShort = (iso: string) => fmt(iso, { month: "short" });
export const longDate = (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function relative(iso: string, today = todayLondon()): string {
  const n = daysUntil(iso, today);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1) return `In ${n} days`;
  if (n === -1) return "Yesterday";
  return `${-n} days ago`;
}
