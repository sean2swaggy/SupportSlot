import { Link } from "react-router-dom";
import { Gate } from "../components/Gate";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { repo } from "../data";
import { useAsync } from "../hooks";

export function Notifications() {
  return <Gate>{(u) => <Inner id={u.id} />}</Gate>;
}

function Inner({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => repo.notifications(id), [id]);
  const unread = data?.filter((n) => !n.read).length ?? 0;
  return (
    <div className="page narrow">
      <header className="page-head split-head"><div><h1>Alerts</h1><p className="sub">Things that happened to your requests, bookings and messages.</p></div>
        {unread > 0 && <button className="btn" onClick={async () => { await repo.markAllRead(id); reload(); }}>Mark all read</button>}</header>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Loading label="Loading alerts" /> : data!.length === 0 ? (
        <EmptyState title="Nothing yet">You'll see a line here when someone requests, books, declines, cancels or messages you.</EmptyState>
      ) : (
        <ul className="rows">{data!.map((n) => (
          <li key={n.id}><Link to={n.link} className={`row note${n.read ? "" : " unread"}`} onClick={() => repo.markAllRead(id).catch(() => {})}>
            <span className="note-dot" aria-hidden="true" />
            <div className="row-main"><p className="note-text">{n.read ? "" : <span className="sr-only">Unread: </span>}{n.text}</p><p className="meta">{new Date(n.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></div>
          </Link></li>
        ))}</ul>
      )}
    </div>
  );
}
