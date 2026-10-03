"use client";

import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupportSlot, Venue } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { getVenue } from "@/lib/queries";
import { formatDate, formatGBP, applicationCloseLabel } from "@/lib/utils";
import { GenreTag } from "@/components/ui/Tag";
import FitSummary from "@/components/ui/FitSummary";
import SaveGigButton from "./SaveGigButton";
import type { Fit } from "@/lib/fit";

export default function SlotCard({
  slot,
  fit,
}: {
  slot: SupportSlot;
  fit?: Fit;
}) {
  // Most queries join the venue; only fall back to a request when they didn't.
  const [fetchedVenue, setFetchedVenue] = useState<Venue | null>(null);
  useEffect(() => {
    if (slot.venue) return;
    getVenue(createClient(), slot.venueId).then(setFetchedVenue);
  }, [slot.venue, slot.venueId]);
  const venue = slot.venue ?? fetchedVenue;
  return (
    <div className="relative">
    <Link
      href={`/slot/${slot.id}`}
      className="group block border border-ink-border bg-ink-raised transition-colors hover:border-paper"
    >
      <div className="relative aspect-[16/10] overflow-hidden border-b border-ink-border">
        <img
          src={slot.headlinerImage || DEFAULT_FALLBACK}
          alt={slot.headliner}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
            Support Needed
          </p>
          <p className="font-display text-lg leading-tight">{slot.headliner}</p>
        </div>
        {slot.isUrgent && (
          <span className="absolute top-3 left-3 bg-signal px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-white">
            Tonight
          </span>
        )}
        {slot.artistPhoto && (
          <img
            src={slot.artistPhoto}
            alt="Reference photo of the artist the promoter is picturing"
            title="What the promoter's picturing"
            className="absolute bottom-3 right-3 h-11 w-11 rounded-full border-2 border-ink object-cover shadow-md"
          />
        )}
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-paper-dim">
          <span>{slot.city}</span>
          <span>{formatDate(slot.date)}</span>
        </div>
        <p className="text-sm text-paper-dim">{venue?.name}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {slot.genres.map((g) => (
            <GenreTag key={g} genre={g} />
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-ink-border">
          <span className="font-display text-lg">
            {formatGBP(slot.supportFee)}
            {slot.travelContribution > 0 && (
              <span className="text-paper-dim text-xs font-body"> + travel</span>
            )}
          </span>
          <span className="text-xs text-paper-dim">
            {slot.performanceLengthMins} min set
          </span>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
          {applicationCloseLabel(slot.applicationDeadline)}
        </p>
        {fit && <FitSummary fit={fit} compact />}
      </div>
    </Link>
    <SaveGigButton slotId={slot.id} className="absolute top-3 right-3" />
    </div>
  );
}
