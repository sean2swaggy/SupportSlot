import { cn } from "@/lib/utils";
import type { Fit, FitState } from "@/lib/fit";

const DOT: Record<FitState, string> = {
  match: "bg-ok",
  partial: "bg-acid",
  mismatch: "bg-signal",
  unknown: "bg-paper-dim/50",
};
const WORD: Record<FitState, string> = {
  match: "Fits",
  partial: "Partly",
  mismatch: "Doesn't fit",
  unknown: "Unknown",
};

/**
 * The honest replacement for the old "NN% match" badge: which of the fit
 * signals (genre, location, act size) actually line up, with the reason for
 * each. It's information, never a score and never a booking priority.
 */
export default function FitSummary({ fit, compact, className }: { fit: Fit; compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <span className={cn("font-mono text-[10px] uppercase tracking-wider text-paper-dim", className)} title={fit.summary}>
        {fit.assessed === 0 ? "Fit unknown" : `${fit.matched}/${fit.assessed} fit`}
      </span>
    );
  }
  return (
    <div className={cn("border border-ink-border p-4", className)}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Fit with this show</p>
      <p className="mt-1 text-sm">{fit.summary}</p>
      <ul className="mt-3 space-y-2">
        {fit.signals.map((s) => (
          <li key={s.key} className="flex gap-2.5 text-xs">
            <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", DOT[s.state])} aria-hidden />
            <span>
              <span className="font-medium">
                {s.label}: {WORD[s.state]}.
              </span>{" "}
              <span className="text-paper-dim">{s.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-paper-dim">
        Based only on what&rsquo;s on profiles. It never affects who gets booked — promoters decide.
      </p>
    </div>
  );
}
