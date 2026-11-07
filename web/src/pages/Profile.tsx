import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gate } from "../components/Gate";
import { Field } from "../components/ui";
import { repo } from "../data";
import { CITIES, GENRES } from "../domain/catalog";
import type { User } from "../domain/types";
import { useNotice, useSession } from "../hooks";

export function Profile() {
  return <Gate>{(u) => <Inner user={u} />}</Gate>;
}

function Inner({ user }: { user: User }) {
  const { setUser, signOut } = useSession();
  const nav = useNavigate();
  const notice = useNotice();
  const [name, setName] = useState(user.name);
  const [city, setCity] = useState(user.city);
  const [blurb, setBlurb] = useState(user.blurb);
  const [genres, setGenres] = useState(user.genres);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (genres.length === 0) { setError("Pick at least one genre."); return; }
    setBusy(true); setError(null);
    try { setUser(await repo.updateProfile(user.id, { name, city, genres, blurb })); notice("Profile saved."); }
    catch (x) { setError((x as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="page narrow">
      <header className="page-head"><h1>Your profile</h1><p className="sub">{user.role === "artist" ? "Promoters see this when you request a slot." : "Artists see this when they look at your listings."}</p></header>
      <form onSubmit={save} noValidate className="form">
        {error && <div className="banner banner-bad" role="alert">{error}</div>}
        <Field label={user.role === "artist" ? "Artist or band name" : "Promoter name"} htmlFor="name"><input id="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Based in" htmlFor="city"><select id="city" value={city} onChange={(e) => setCity(e.target.value)}>{[...new Set([user.city, ...CITIES])].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <fieldset className="field"><legend>Genres</legend>
          <div className="chips">{GENRES.map((g) => (
            <label key={g} className={`chip${genres.includes(g) ? " on" : ""}`}><input type="checkbox" checked={genres.includes(g)} onChange={() => setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g])} />{g}</label>
          ))}</div></fieldset>
        <Field label="About you" htmlFor="blurb"><textarea id="blurb" rows={4} value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={300} /></Field>
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
      <section className="danger-zone"><h2>Session</h2><p className="prose">Signed in on this browser only.</p>
        <button className="btn" onClick={() => { signOut(); nav("/"); }}>Sign out</button></section>
    </div>
  );
}
