import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Gate } from "../components/Gate";
import { Badge, EmptyState, ErrorState, Loading, listingBadge } from "../components/ui";
import { repo } from "../data";
import { isPast, longDate } from "../domain/dates";
import { pounds } from "../domain/money";
import type { ApplicantView } from "../domain/types";
import { useAsync, useNotice } from "../hooks";

export function ListingManage() {
  return <Gate role="promoter">{(u) => <Inner promoterId={u.id} />}</Gate>;
}

function Inner({ promoterId }: { promoterId: string }) {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const notice = useNotice();
  const { data, error, loading, reload } = useAsync(() => repo.applicants(id, promoterId), [id, promoterId]);
  const [pick, setPick] = useState<ApplicantView | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /><p className="crumb"><Link to="/listings">← My listings</Link></p></div>;
  if (loading && !data) return <div className="page"><Loading label="Loading listing" /></div>;
  const { listing: l, applicants, booking } = data!;
  const pending = applicants.filter((a) => a.status === "pending");
  const past = isPast(l.date);

  const decline = async (a: ApplicantView) => {
    setRowError(null);
    try { await repo.decline(a.id, promoterId); notice(`Declined ${a.artist.name}.`); reload(); }
    catch (e) { setRowError((e as Error).message); }
  };

  return (
    <div className="page narrow">
      <p className="crumb"><Link to="/listings">← My listings</Link></p>
      <header className="detail-head">
        <p className="eyebrow">{longDate(l.date)}</p>
        <h1>{l.venue}, {l.city}</h1>
        <p className="status-line">{listingBadge(l.status)}<span>Doors {l.doors} · set {l.setTime}, {l.setMinutes} min · {pounds(l.feePence)}</span></p>
      </header>

      {booking && (
        <div className="banner banner-good"><strong>{booking.artist.name} is booked.</strong> Ref {booking.ref}. <Link to={`/bookings/${booking.id}`}>View booking</Link></div>
      )}

      <section>
        <h2>Requests {pending.length > 0 && <span className="tab-count">{pending.length}</span>}</h2>
        {rowError && <div className="banner banner-bad" role="alert">{rowError}</div>}
        {applicants.length === 0 ? (
          <EmptyState title="No requests yet">Artists see this slot on the board. Requests will appear here.</EmptyState>
        ) : (
          <ul className="applicants">
            {applicants.map((a) => (
              <li key={a.id} className={`applicant ${a.status}`}>
                <div className="app-head"><h3>{a.artist.name}</h3><span className="meta">{a.artist.city} · {a.artist.genres.join(", ")}</span>
                  {a.status !== "pending" && <Badge tone={a.status === "accepted" ? "confirmed" : "neutral"}>{a.status === "accepted" ? "Booked" : a.status === "declined" ? "Declined" : "Withdrawn"}</Badge>}</div>
                <p className="prose">“{a.message}”</p>
                <p className="small-note">{a.artist.blurb}</p>
                {a.status === "pending" && l.status === "open" && !past && (
                  <div className="actions"><button className="btn btn-primary" onClick={() => setPick(a)}>Book {a.artist.name}</button><button className="btn btn-quiet" onClick={() => decline(a)}>Decline</button><Link className="btn btn-quiet" to={`/messages/${l.id}/${a.artistId}`}>Message</Link></div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {l.status === "open" && !past && (
        <section className="danger-zone"><h2>Cancel this listing</h2><p className="prose">Pending requests will be declined. Artists won't be able to apply.</p>
          <button className="btn btn-danger" onClick={() => setCancelling(true)}>Cancel listing</button></section>
      )}
      {pick && (
        <ConfirmDialog title={`Book ${pick.artist.name}?`} confirmLabel="Confirm booking" onClose={() => setPick(null)}
          onConfirm={async () => { const bid = await repo.accept(pick.id, promoterId); notice("Booking confirmed."); nav(`/bookings/${bid}?confirmed=1`); }}>
          {pick.artist.name} will play support at {l.venue} on {longDate(l.date)} for {pounds(l.feePence)}, paid by you directly. Other requests for this slot will be declined.
        </ConfirmDialog>
      )}
      {cancelling && (
        <ConfirmDialog title="Cancel this listing?" confirmLabel="Cancel listing" danger dismissLabel="Keep listing" onClose={() => setCancelling(false)}
          onConfirm={async () => { await repo.cancelListing(l.id, promoterId); notice("Listing cancelled."); reload(); }}>
          This takes {l.venue} on {longDate(l.date)} off the board.
        </ConfirmDialog>
      )}
    </div>
  );
}
