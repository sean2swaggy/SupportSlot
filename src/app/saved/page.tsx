"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getSlotsByIds } from "@/lib/queries";
import { explainFit } from "@/lib/fit";
import { londonToday } from "@/lib/dates";
import SlotCard from "@/components/slots/SlotCard";
import Button from "@/components/ui/Button";
import type { SupportSlot } from "@/lib/types";

export default function SavedPage() {
  const { savedSlotIds, currentArtist } = useStore();
  const [slots, setSlots] = useState<SupportSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [today] = useState(() => londonToday());
  // Re-read only when the saved SET changes (unsaving one removes it from view).
  const key = savedSlotIds.join(",");

  useEffect(() => {
    let cancelled = false;
    getSlotsByIds(createClient(), key ? key.split(",") : [])
      .then((rows) => {
        if (cancelled) return;
        setSlots(rows);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your saved gigs.");
      });
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const open = (slots ?? []).filter((s) => s.status === "open" && s.date >= today);
  const closed = (slots ?? []).filter((s) => !(s.status === "open" && s.date >= today));

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">Saved</p>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">Saved gigs</h1>
      <p className="mt-4 max-w-[54ch] text-paper-dim">Listings you&rsquo;ve bookmarked to come back to. We keep them even after they close, so you can see what happened.</p>

      {error ? (
        <div className="mt-10 border border-signal/50 p-8 text-center" role="alert">
          <p className="text-sm">{error}</p>
          <Button className="mt-4" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </div>
      ) : slots === null ? (
        <p className="mt-10 text-sm text-paper-dim">Loading…</p>
      ) : slots.length === 0 ? (
        <div className="mt-10 border border-dashed border-ink-border p-10 text-center">
          <p className="font-display text-xl">Nothing saved yet</p>
          <p className="mt-2 text-sm text-paper-dim">Tap Save on any listing to keep it here.</p>
          <Button href="/discover" className="mt-5">Find a slot</Button>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {open.map((s) => (
                <SlotCard key={s.id} slot={s} fit={currentArtist ? explainFit(currentArtist, s) : undefined} />
              ))}
            </div>
          )}
          {closed.length > 0 && (
            <>
              <h2 className="mt-12 font-mono text-[11px] uppercase tracking-widest text-paper-dim">No longer open ({closed.length})</h2>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 opacity-70">
                {closed.map((s) => (
                  <SlotCard key={s.id} slot={s} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
