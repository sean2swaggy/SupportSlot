export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatGBP(amount: number) {
  return `£${amount.toLocaleString("en-GB")}`;
}

export function formatNumber(n: number) {
  return n.toLocaleString("en-GB");
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDate(iso: string, opts?: { withYear?: boolean }) {
  const d = new Date(iso);
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  if (opts?.withYear) return `${month} ${day}, ${d.getFullYear()}`;
  return `${month} ${day}`;
}

export function formatWeekday(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "long" });
}

export function daysUntil(iso: string) {
  const now = new Date();
  const target = new Date(iso);
  const diff = Math.ceil(
    (target.getTime() - new Date(now.toDateString()).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  return diff;
}

export function applicationCloseLabel(iso: string) {
  const d = daysUntil(iso);
  if (d < 0) return "Applications closed";
  if (d === 0) return "Applications close today";
  if (d === 1) return "Applications close tomorrow";
  return `Applications close in ${d} days`;
}

export function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function matchTier(pct: number): "high" | "mid" | "low" {
  if (pct >= 85) return "high";
  if (pct >= 65) return "mid";
  return "low";
}
