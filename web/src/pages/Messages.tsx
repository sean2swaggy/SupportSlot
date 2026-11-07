import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Gate } from "../components/Gate";
import { DateBlock, EmptyState, ErrorState, Loading } from "../components/ui";
import { repo } from "../data";
import { longDate } from "../domain/dates";
import { useAsync } from "../hooks";

export function Messages() {
  return <Gate>{(u) => <Inner id={u.id} />}</Gate>;
}

function Inner({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => repo.threads(id), [id]);
  return (
    <div className="page">
      <header className="page-head"><h1>Messages</h1><p className="sub">One conversation per request. You can talk once a request has been sent.</p></header>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Loading label="Loading messages" /> : data!.length === 0 ? (
        <EmptyState title="No conversations yet">When an artist requests a slot, you can message each other here.</EmptyState>
      ) : (
        <ul className="rows">{data!.map((t) => (
          <li key={`${t.listing.id}-${t.artistId}`}><Link to={`/messages/${t.listing.id}/${t.artistId}`} className="row">
            <DateBlock date={t.listing.date} muted />
            <div className="row-main"><h3>{t.other.name}</h3>
              <p className="meta">{t.listing.venue}, {t.listing.city} · {t.last ? `${t.last.fromId === id ? "You: " : ""}${t.last.text}` : "No messages yet"}</p></div>
            <div className="row-side">{t.unreadHint && <span className="badge badge-pending">Reply</span>}</div>
          </Link></li>
        ))}</ul>
      )}
    </div>
  );
}

export function Thread() {
  return <Gate>{(u) => <ThreadInner id={u.id} />}</Gate>;
}

function ThreadInner({ id }: { id: string }) {
  const { listingId = "", artistId = "" } = useParams();
  const { data, error, loading, reload } = useAsync(() => repo.thread(listingId, artistId, id), [listingId, artistId, id]);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);
  useEffect(() => { const t = window.setInterval(reload, 5000); return () => window.clearInterval(t); }, [reload]);

  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /><p className="crumb"><Link to="/messages">← Messages</Link></p></div>;
  if (loading && !data) return <div className="page"><Loading label="Loading conversation" /></div>;
  const t = data!;
  const other = id === t.artist.id ? t.promoter : t.artist;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setSendError(null);
    try { await repo.sendMessage(listingId, artistId, id, text); setText(""); reload(); }
    catch (x) { setSendError((x as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="page narrow thread">
      <p className="crumb"><Link to="/messages">← Messages</Link></p>
      <header className="detail-head"><h1>{other.name}</h1><p className="sub">About {t.listing.venue}, {t.listing.city} on {longDate(t.listing.date)}</p></header>
      <ul className="bubbles" aria-label="Conversation">
        {t.messages.length === 0 && <li className="muted-text">Nothing said yet. Start the conversation below.</li>}
        {t.messages.map((m) => (
          <li key={m.id} className={m.fromId === id ? "mine" : "theirs"}><p>{m.text}</p>
            <span className="meta">{m.fromId === id ? "You" : other.name} · {new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></li>
        ))}
      </ul>
      <div ref={end} />
      <form onSubmit={send} className="composer" noValidate>
        <label htmlFor="msg" className="sr-only">Message</label>
        <textarea id="msg" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={`Message ${other.name}`} />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
        {sendError && <p className="field-error" role="alert">{sendError}</p>}
      </form>
    </div>
  );
}
