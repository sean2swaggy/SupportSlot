"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Bookmark a listing for later. Only artists can save gigs; everyone else
 * (signed-out visitors, promoters) sees nothing rather than a dead control.
 */
export default function SaveGigButton({ slotId, className, label }: { slotId: string; className?: string; label?: boolean }) {
  const { role, signedIn, savedSlotIds, toggleSavedSlot } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!signedIn || role !== "artist") return null;
  const saved = savedSlotIds.includes(slotId);

  return (
    <>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={saved ? "Remove from saved gigs" : "Save this gig"}
        disabled={busy}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setBusy(true);
          setError(null);
          const result = await toggleSavedSlot(slotId);
          if (!result.ok) setError(result.error);
          setBusy(false);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 border px-2.5 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50",
          saved ? "border-acid text-acid bg-ink/80" : "border-ink-border text-paper-dim bg-ink/80 hover:border-paper hover:text-paper",
          className
        )}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 3h12v18l-6-4-6 4z" strokeLinejoin="round" />
        </svg>
        {label && (saved ? "Saved" : "Save")}
      </button>
      {error && <span role="alert" className="sr-only">{error}</span>}
    </>
  );
}
