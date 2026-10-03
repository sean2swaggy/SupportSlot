import { cn } from "@/lib/utils";
import type { ApplicationStatus } from "@/lib/types";

const CONFIG: Record<ApplicationStatus, { label: string; className: string }> = {
  submitted: { label: "Submitted", className: "text-paper-dim border-ink-border" },
  viewed: { label: "Viewed", className: "text-paper border-paper-dim" },
  shortlisted: { label: "Shortlisted", className: "text-acid-ink bg-acid border-acid" },
  offered: { label: "Offer made", className: "text-acid border-acid" },
  confirmed: { label: "Confirmed", className: "text-ink bg-ok border-ok" },
  declined: { label: "Not selected", className: "text-paper-dim border-ink-border" },
  offer_declined: { label: "Offer declined", className: "text-paper-dim border-ink-border" },
  withdrawn: { label: "Withdrawn", className: "text-paper-dim border-ink-border" },
  cancelled: { label: "Cancelled", className: "text-signal border-signal/60" },
};

/** Statuses where the application is still live (not closed out). */
export const OPEN_STATUSES: ApplicationStatus[] = ["submitted", "viewed", "shortlisted", "offered"];

export default function StatusPill({ status }: { status: ApplicationStatus }) {
  const c = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest",
        c.className
      )}
    >
      {c.label}
    </span>
  );
}
