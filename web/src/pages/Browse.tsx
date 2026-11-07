import { useState } from "react";
import { EmptyState, ErrorState, Loading } from "../components/ui";
import { Gate } from "../components/Gate";
import { SlotRow } from "../components/SlotRow";
import { repo } from "../data";
import { CITIES, GENRES } from "../domain/catalog";
import { useAsync } from "../hooks";

export function Browse() {
  return <Gate role="artist">{(u) => <BrowseInner artistId={u.id} name={u.name} />}</Gate>;
}

function BrowseInner({ artistId, name }: { artistId: string; name: string }) {
  const [genre, setGenre] = useState("");
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useAsync(() => repo.openSlots(artistId, { genre, city, q }), [artistId, genre, city, q]);
  const filtered = !!(genre || city || q);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Open support slots</h1>
        <p className="sub">Signed in as {name}. Dates are UK show dates; the fee is what the promoter has offered.</p>
      </header>
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field"><label htmlFor="q">Search</label><input id="q" type="search" placeholder="Venue, city or keyword" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="genre">Genre</label>
          <select id="genre" value={genre} onChange={(e) => setGenre(e.target.value)}><option value="">Any genre</option>{GENRES.map((g) => <option key={g}>{g}</option>)}</select></div>
        <div className="field"><label htmlFor="city">City</label>
          <select id="city" value={city} onChange={(e) => setCity(e.target.value)}><option value="">Anywhere</option>{CITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        {filtered && <button type="button" className="btn btn-quiet" onClick={() => { setGenre(""); setCity(""); setQ(""); }}>Clear filters</button>}
      </form>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Loading label="Loading slots" /> : data && data.length === 0 ? (
        <EmptyState title={filtered ? "No slots match those filters" : "No open slots right now"}
          action={filtered ? <button className="btn" onClick={() => { setGenre(""); setCity(""); setQ(""); }}>Clear filters</button> : undefined}>
          {filtered ? "Try a different genre or city, or clear the filters to see everything that's open." : "New slots are posted by promoters through the week. Check back soon."}
        </EmptyState>
      ) : (
        <>
          <p className="count-line" aria-live="polite">{data!.length} open {data!.length === 1 ? "slot" : "slots"}</p>
          <ul className="rows" aria-busy={loading}>{data!.map((s) => <SlotRow key={s.id} slot={s} to={`/slots/${s.id}`} mode="artist" />)}</ul>
        </>
      )}
    </div>
  );
}
