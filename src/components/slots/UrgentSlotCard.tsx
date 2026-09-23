"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupportSlot, Venue } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { getVenue } from "@/lib/queries";
import { formatGBP, timeAgo } from "@/lib/utils";
import { GenreTag } from "@/components/ui/Tag";
import UrgentPulse from "@/components/ui/UrgentPulse";

export default function UrgentSlotCard({ slot }: { slot: SupportSlot }) {
  const [venue, setVenue] = useState<Venue | null>(null);
  useEffect(() => {
    getVenue(createClient(), slot.venueId).then(setVenue);
  }, [slot.venueId]);
  return (
    <Link
      href={`/slot/${slot.id}`}
      className="group block border border-signal/40 bg-ink-raised p-5 transition-colors hover:border-signal"
    >
      <div className="flex items-start justify-between">
        <UrgentPulse label="Needed tonight" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
          Posted {timeAgo(slot.postedAt)}
        </span>
      </div>
      <p className="font-display text-2xl mt-4 leading-tight">{slot.headliner}</p>
      <p className="text-sm text-paper-dim mt-1">
        {venue?.name} · {slot.city}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2 border-y border-ink-border py-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-paper-dim">Doors</p>
          <p className="text-sm mt-1">{slot.doorsTime}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-paper-dim">Set</p>
          <p className="text-sm mt-1">{slot.performanceLengthMins} min</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-paper-dim">Fee</p>
          <p className="text-sm mt-1">{formatGBP(slot.supportFee)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {slot.genres.map((g) => (
            <GenreTag key={g} genre={g} />
          ))}
        </div>
        <span className="font-mono text-[11px] uppercase tracking-widest text-signal group-hover:underline">
          I&rsquo;m available →
        </span>
      </div>
    </Link>
  );
}
