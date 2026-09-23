"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Application, SupportSlot, Venue } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { getSlot, getVenue } from "@/lib/queries";
import { formatDate, formatGBP } from "@/lib/utils";
import StatusPill from "./StatusPill";
import MatchBadge from "@/components/ui/MatchBadge";
import BookingActionsLinks from "@/components/bookings/BookingActionsLinks";

export default function ApplicationRow({ application }: { application: Application }) {
  const [slot, setSlot] = useState<SupportSlot | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);

  useEffect(() => {
    const supabase = createClient();
    getSlot(supabase, application.slotId).then((s) => {
      setSlot(s);
      if (s) getVenue(supabase, s.venueId).then(setVenue);
    });
  }, [application.slotId]);

  if (!slot) return null;

  return (
    <div className="border border-ink-border bg-ink-raised">
      <Link
        href={`/slot/${slot.id}`}
        className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 hover:bg-ink-card/60 transition-colors"
      >
        <div className="h-16 w-16 sm:h-14 sm:w-14 shrink-0 overflow-hidden border border-ink-border">
          <img src={slot.headlinerImage} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-lg truncate">{slot.headliner}</p>
          <p className="text-xs text-paper-dim">
            {venue?.name} · {slot.city} · {formatDate(slot.date, { withYear: true })}
            {slot.rescheduledAt && <span className="text-acid"> · rescheduled</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs text-paper-dim hidden sm:inline">
            {formatGBP(slot.supportFee)}
          </span>
          <MatchBadge percent={application.matchPercent} size="sm" />
          <StatusPill status={application.status} />
        </div>
      </Link>
      {application.status === "booked" && (
        <div className="px-4 pb-4 pt-1 border-t border-ink-border">
          <BookingActionsLinks application={application} slot={slot} className="flex items-center gap-4 pt-3" />
        </div>
      )}
    </div>
  );
}
