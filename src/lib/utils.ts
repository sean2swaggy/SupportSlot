export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatGBP(amount: number) {
  return `£${amount.toLocaleString("en-GB")}`;
}

/** Integer pence -> "£1,234.50". */
export function formatPence(pence: number) {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(n: number) {
  return n.toLocaleString("en-GB");
}

import { applicationCloseText, daysUntilLondon, formatShowDate, showWeekday } from "./dates";

// Show dates are UK calendar dates (YYYY-MM-DD), so these delegate to
// dates.ts rather than parsing them as instants — see that file for why.
export function formatDate(iso: string, opts?: { withYear?: boolean }) {
  return formatShowDate(iso, opts);
}

export function formatWeekday(iso: string) {
  return showWeekday(iso);
}

export function daysUntil(iso: string) {
  return daysUntilLondon(iso);
}

export function applicationCloseLabel(iso: string) {
  return applicationCloseText(iso);
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
