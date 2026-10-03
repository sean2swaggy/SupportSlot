"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Application, SupportSlot, Venue } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { getSlot, getVenue } from "@/lib/queries";
import { useStore } from "@/lib/store";
import { formatDate, formatGBP } from "@/lib/utils";
import StatusPill from "./StatusPill";
import { ArtistApplicationControls } from "@/components/bookings/BookingControls";

export default function ApplicationRow({ application }: { application: Application }) {
  const { bookings } = useStore();
  const [slot, setSlot] = useState<SupportSlot | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    getSlot(supabase, application.slotId).then((s) => {
      if (!s) {
        setMissing(true);
        return;
      }
      setSlot(s);
      getVenue(supabase, s.venueId).then(setVenue);
    });
  }, [application.slotId]);

  // The booking is the source of truth for the agreed date and terms once an
  // offer exists; the listing can change after the fact.
  const booking = bookings.find((b) => b.applicationId === application.id && (b.status === "offered" || b.status === "confirmed" || b.status === "cancelled"));

  if (missing) {
    return (
      <div className="border border-ink-border bg-ink-raised p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-paper-dim">This listing is no longer available.</p>
        <StatusPill status={application.status} />
      </div>
    );
  }
  if (!slot) return <div className="border border-ink-border bg-ink-raised h-24 animate-pulse" aria-hidden />;

  const showControls = ["submitted", "viewed", "shortlisted", "offered", "confirmed"].includes(application.status) || (application.status === "cancelled" && booking) || application.status === "declined";

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
            {venue?.name} · {slot.city} · {formatDate(booking?.eventDate ?? slot.date, { withYear: true })}
            {slot.rescheduledAt && <span className="text-acid"> · rescheduled</span>}
            {slot.status === "cancelled" && <span className="text-signal"> · listing cancelled</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs text-paper-dim hidden sm:inline">{formatGBP(slot.supportFee)}</span>
          <StatusPill status={application.status} />
        </div>
      </Link>
      {showControls && (
        <div className="px-4 pb-4 pt-3 border-t border-ink-border">
          <ArtistApplicationControls application={application} booking={booking} />
        </div>
      )}
    </div>
  );
}
