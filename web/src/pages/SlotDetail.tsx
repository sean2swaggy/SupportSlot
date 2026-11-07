import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Gate } from "../components/Gate";
import { Badge, ErrorState, Loading } from "../components/ui";
import { repo } from "../data";
import { isPast, longDate, relative } from "../domain/dates";
import { pounds } from "../domain/money";
import { useAsync, useNotice } from "../hooks";

export function SlotDetail() {
  return <Gate role="artist">{(u) => <Inner artistId={u.id} />}</Gate>;
}

function Inner({ artistId }: { artistId: string }) {
  const { id = "" } = useParams();
  const notice = useNotice();
  const { data, error, loading, reload } = useAsync(async () => {
    const [slot, mine] = await Promise.all([repo.slot(id, artistId), repo.myApplications(artistId)]);
    return { slot, application: mine.find((a) => a.listingId === id) };
  }, [id, artistId]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  if (loading && !data) return <div className="page"><Loading label="Loading slot" /></div>;
  const { slot, application } = data!;
  const closed = slot.status !== "open" || isPast(slot.date);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try { await repo.apply(slot.id, artistId, message); notice("Request sent to " + slot.promoterName + "."); setMessage(""); reload(); }
    catch (err) { setFormError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page narrow">
      <p className="crumb"><Link to="/slots">← All open slots</Link></p>
      <header className="detail-head">
        <p className="eyebrow">{relative(slot.date)} · {longDate(slot.date)}</p>
        <h1>{slot.venue}, {slot.city}</h1>
        <p className="sub">Promoted by {slot.promoterName}</p>
      </header>
      <dl className="facts">
        <div><dt>Doors</dt><dd>{slot.doors}</dd></div>
        <div><dt>Your set</dt><dd>{slot.setTime}, {slot.setMinutes} min</dd></div>
        <div><dt>Capacity</dt><dd>{slot.capacity}</dd></div>
        <div><dt>Genres</dt><dd>{slot.genres.join(", ")}</dd></div>
        <div className="fact-fee"><dt>Fee offered</dt><dd>{pounds(slot.feePence)}</dd></div>
      </dl>
      <section aria-labelledby="notes-h"><h2 id="notes-h">From the promoter</h2><p className="prose">{slot.notes || "No extra notes."}</p>
        <p className="small-note">The fee is paid to you directly by the promoter. Support Slot takes nothing and handles no money.</p></section>

      <section id="apply" className="apply" aria-labelledby="apply-h">
        <h2 id="apply-h">Request this slot</h2>
        {application ? (
          <div className="requested">
            <Badge tone="pending">Request sent</Badge>
            <p className="prose">Your note: “{application.message}”</p>
            <p className="small-note">{slot.promoterName} will confirm one act. You'll see it under My gigs if it's you.</p>
            <div className="actions"><Link className="btn" to="/bookings">Go to my gigs</Link><button className="btn btn-quiet" onClick={() => setWithdrawing(true)}>Withdraw request</button></div>
          </div>
        ) : closed ? (
          <p className="prose">{slot.status === "booked" ? "This slot has been filled." : slot.status === "cancelled" ? "This listing was cancelled." : "This show date has passed."}</p>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className={`field${formError ? " has-error" : ""}`}>
              <label htmlFor="msg">A few lines about your set</label>
              <textarea id="msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={600} aria-describedby="msg-hint" />
              <p className="hint" id="msg-hint">What you play, how long you need to set up, anything the promoter should know. {message.length}/600</p>
              {formError && <p className="field-error" role="alert">{formError}</p>}
            </div>
            <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
          </form>
        )}
      </section>

      {!application && !closed && (
        <div className="stickybar"><span><strong>{pounds(slot.feePence)}</strong> · {slot.setMinutes} min set</span><a className="btn btn-primary" href="#apply" onClick={() => document.getElementById("msg")?.focus()}>Request slot</a></div>
      )}
      {withdrawing && application && (
        <ConfirmDialog title="Withdraw your request?" confirmLabel="Withdraw" danger dismissLabel="Keep request" onClose={() => setWithdrawing(false)}
          onConfirm={async () => { await repo.withdraw(application.id, artistId); notice("Request withdrawn."); reload(); }}>
          The promoter will no longer see it. You can request the slot again while it's open.
        </ConfirmDialog>
      )}
    </div>
  );
}
