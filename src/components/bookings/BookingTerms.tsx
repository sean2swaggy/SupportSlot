import { formatDate, formatPence } from "@/lib/utils";
import type { Booking } from "@/lib/types";

function Row({ label, value, bold, note }: { label: string; value: string; bold?: boolean; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <span className={bold ? "font-display" : "text-sm text-paper-dim"}>
        {label}
        {note && <span className="block text-[11px] text-paper-dim/80 font-normal">{note}</span>}
      </span>
      <span className={bold ? "font-display text-lg" : "text-sm"}>{value}</span>
    </div>
  );
}

/**
 * The agreed terms exactly as stored on the booking when the offer was made.
 * Later edits to the listing can't change these. The artist sees what they
 * receive; the promoter also sees the booking-fee and processing lines they
 * pay on top.
 */
export default function BookingTerms({ booking, viewer }: { booking: Booking; viewer: "artist" | "promoter" }) {
  return (
    <div>
      <div className="border border-ink-border divide-y divide-ink-border">
        <Row label="Show" value={booking.headliner} />
        <Row label="Venue" value={`${booking.venueName}, ${booking.venueCity}`} note={booking.venueAddress} />
        <Row label="Date" value={formatDate(booking.eventDate, { withYear: true })} />
        <Row label="Doors / on stage" value={`${booking.doorsTime.slice(0, 5)} / ${booking.setTime.slice(0, 5)}`} note={`${booking.setLengthMins}-minute set`} />
        <Row label="Performance fee" value={formatPence(booking.feePence)} />
        {booking.travelPence > 0 && <Row label="Travel contribution" value={formatPence(booking.travelPence)} />}
        {viewer === "artist" ? (
          <Row label="You receive" value={formatPence(booking.feePence + booking.travelPence)} bold note="Support Slot's fees are paid by the promoter, never taken from you." />
        ) : (
          <>
            <Row label="Support Slot booking fee" value={formatPence(booking.bookingFeePence)} />
            <Row label="Card processing" value={formatPence(booking.processingFeePence)} />
            <Row label="Total you pay" value={formatPence(booking.totalPence)} bold />
          </>
        )}
      </div>
      {booking.requirements.length > 0 && (
        <p className="mt-3 text-xs text-paper-dim">
          <span className="font-mono uppercase tracking-widest text-[10px]">Requirements: </span>
          {booking.requirements.join(" · ")}
        </p>
      )}
      {booking.offerMessage && <p className="mt-3 text-sm border-l-2 border-acid pl-3">{booking.offerMessage}</p>}
    </div>
  );
}
