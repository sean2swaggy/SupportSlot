import { Link } from "react-router-dom";
import { Gate } from "../components/Gate";
import { SlotRow } from "../components/SlotRow";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { repo } from "../data";
import { isPast } from "../domain/dates";
import { useAsync } from "../hooks";

export function Listings() {
  return <Gate role="promoter">{(u) => <Inner id={u.id} name={u.name} />}</Gate>;
}

function Inner({ id, name }: { id: string; name: string }) {
  const { data, error, loading, reload } = useAsync(() => repo.myListings(id), [id]);
  const upcoming = data?.filter((l) => !isPast(l.date)) ?? [];
  const past = (data?.filter((l) => isPast(l.date)) ?? []).reverse();
  return (
    <div className="page">
      <header className="page-head split-head">
        <div><h1>My listings</h1><p className="sub">Support slots posted by {name}.</p></div>
        <Link to="/listings/new" className="btn btn-primary">Post a slot</Link>
      </header>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Loading label="Loading listings" /> : data!.length === 0 ? (
        <EmptyState title="You haven't posted a slot yet" action={<Link className="btn btn-primary" to="/listings/new">Post your first slot</Link>}>Add a date, venue, set length and fee. Artists can request it straight away.</EmptyState>
      ) : (
        <>
          <h2 className="section-h">Upcoming</h2>
          {upcoming.length ? <ul className="rows">{upcoming.map((s) => <SlotRow key={s.id} slot={s} to={`/listings/${s.id}`} mode="promoter" />)}</ul> : <p className="prose muted-text">No upcoming slots.</p>}
          {past.length > 0 && <><h2 className="section-h">Past</h2><ul className="rows">{past.map((s) => <SlotRow key={s.id} slot={s} to={`/listings/${s.id}`} mode="promoter" />)}</ul></>}
        </>
      )}
    </div>
  );
}
