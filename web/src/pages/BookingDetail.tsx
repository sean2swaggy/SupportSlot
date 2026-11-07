import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Gate } from "../components/Gate";
import { ErrorState, Loading, bookingBadge } from "../components/ui";
import { repo } from "../data";
import { daysUntil, isPast, longDate } from "../domain/dates";
import { pounds } from "../domain/money";
import type { User } from "../domain/types";
import { useAsync, useNotice } from "../hooks";

export function BookingDetail() {
  return <Gate>{(u) => <Inner user={u} />}</Gate>;
}

function Inner({ user }: { user: User }) {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const notice = useNotice();
  const { data: b, error, loading, reload } = useAsync(() => repo.booking(id, user.id), [id, user.id]);
  const [cancelling, setCancelling] = useState(false);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /><p className="crumb"><Link to="/bookings">← Back to bookings</Link></p></div>;
  if (loading && !b) return <div className="page"><Loading label="Loading booking" /></div>;
  const booking = b!;
  const past = isPast(booking.listing.date);
  const isArtist = user.id === booking.artistId;
  const other = isArtist ? booking.promoter : booking.artist;
  const cancellable = booking.status === "confirmed" && !past;
  const d = daysUntil(booking.listing.date);

  return (
    <div className="page narrow">
      <p className="crumb"><Link to="/bookings">← {isArtist ? "My gigs" : "Bookings"}</Link></p>
      {params.get("confirmed") && booking.status === "confirmed" && (
        <div className="banner banner-good" role="status"><strong>Booking confirmed.</strong> {booking.artist.name} is playing support. Booking reference {booking.ref}.</div>
      )}
      <header className="detail-head">
        <p className="eyebrow">Booking {booking.ref}</p>
        <h1>{booking.listing.venue}, {booking.listing.city}</h1>
        <p className="status-line">{bookingBadge(booking.status, past)}<span>{longDate(booking.listing.date)}{booking.status === "confirmed" && !past && d >= 0 ? (d === 0 ? " · tonight" : ` · in ${d} day${d === 1 ? "" : "s"}`) : ""}</span></p>
      </header>

      {booking.status === "cancelled" && (
        <div className="banner banner-bad" role="status">
          <strong>Cancelled by {booking.cancelledBy === user.id ? "you" : (booking.cancelledBy === booking.artistId ? booking.artist.name : booking.promoter.name)}.</strong>
          <p>“{booking.cancelReason}”</p>
        </div>
      )}

      <dl className="facts">
        <div><dt>{isArtist ? "Promoter" : "Artist"}</dt><dd>{other.name}</dd></div>
        <div><dt>Doors</dt><dd>{booking.listing.doors}</dd></div>
        <div><dt>Set</dt><dd>{booking.listing.setTime}, {booking.listing.setMinutes} min</dd></div>
        <div className="fact-fee"><dt>Agreed fee</dt><dd>{pounds(booking.feePence)}</dd></div>
      </dl>
      <section><h2>Venue notes</h2><p className="prose">{booking.listing.notes || "None."}</p></section>
      {booking.status === "confirmed" && <section><h2>Payment</h2><p className="prose">{isArtist ? `${booking.promoter.name} pays you ${pounds(booking.feePence)} directly. Agree how and when with them.` : `You pay ${booking.artist.name} ${pounds(booking.feePence)} directly. Support Slot doesn't handle payment.`}</p></section>}

      {cancellable && (
        <section className="danger-zone"><h2>Cancel this booking</h2>
          <p className="prose">{isArtist ? "If you can't play, cancel as early as you can. The slot reopens so the promoter can pick someone else." : "The artist will see your reason. This listing will be marked cancelled."}</p>
          <button className="btn btn-danger" onClick={() => setCancelling(true)}>Cancel booking</button></section>
      )}
      {cancelling && (
        <ConfirmDialog title="Cancel this booking?" confirmLabel="Cancel booking" danger dismissLabel="Keep booking" reasonLabel={`Reason for ${other.name}`} onClose={() => setCancelling(false)}
          onConfirm={async (reason) => { await repo.cancelBooking(booking.id, user.id, reason); notice("Booking cancelled."); reload(); }}>
          {booking.listing.venue} on {longDate(booking.listing.date)}. {other.name} will be able to see why.
        </ConfirmDialog>
      )}
    </div>
  );
}
