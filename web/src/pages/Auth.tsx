import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Field } from "../components/ui";
import { CITIES, GENRES } from "../domain/catalog";
import type { Role, User } from "../domain/types";
import { DEMO_EMAILS, DEMO_PASSWORD } from "../data/auth";
import { useSession } from "../hooks";

const home = (u: User) => (u.role === "artist" ? "/slots" : "/listings");

export function SignIn() {
  const { user, signIn } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={home(user)} replace />;

  const go = async (e: string, p: string) => {
    setBusy(true); setError(null);
    try { const u = await signIn(e, p); nav((loc.state as { from?: string } | null)?.from ?? home(u), { replace: true }); }
    catch (x) { setError((x as Error).message); setBusy(false); }
  };
  return (
    <div className="page narrow">
      <header className="page-head"><h1>Sign in</h1><p className="sub">New here? <Link to="/signup">Create an account</Link>.</p></header>
      <form onSubmit={(e) => { e.preventDefault(); go(email, password); }} noValidate>
        {error && <div className="banner banner-bad" role="alert">{error}</div>}
        <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <section className="demo-box" aria-labelledby="demo-h">
        <h2 id="demo-h">Try a sample account</h2>
        <p className="small-note">Pre-filled with sample shows, requests and bookings. All fictional.</p>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => go(DEMO_EMAILS["u-maya"], DEMO_PASSWORD)}>Maya, an artist</button>
          <button className="btn" disabled={busy} onClick={() => go(DEMO_EMAILS["u-harbour"], DEMO_PASSWORD)}>Harbour Lights, a promoter</button>
        </div>
      </section>
    </div>
  );
}

export function SignUp() {
  const { user, signUp } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "promoter" ? "promoter" : "artist");
  const [v, setV] = useState({ email: "", password: "", name: "", city: "Bristol", blurb: "" });
  const [genres, setGenres] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={home(user)} replace />;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) err.email = "Enter a valid email address.";
    if (v.password.length < 8) err.password = "Use at least 8 characters.";
    if (!v.name.trim()) err.name = role === "artist" ? "Add your artist or band name." : "Add your promoter name.";
    if (genres.length === 0) err.genres = "Pick at least one genre.";
    setErrors(err); setFormError(null);
    if (Object.keys(err).length) { document.querySelector<HTMLElement>(".has-error input, .has-error select")?.focus(); return; }
    setBusy(true);
    try { const u = await signUp({ ...v, role, genres }); nav(home(u), { replace: true }); }
    catch (x) { setFormError((x as Error).message); setBusy(false); }
  };

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Create an account</h1><p className="sub">Already have one? <Link to="/signin">Sign in</Link>.</p></header>
      <form onSubmit={submit} noValidate className="form">
        {formError && <div className="banner banner-bad" role="alert">{formError}</div>}
        <fieldset className="field"><legend>I am a…</legend>
          <div className="chips">{(["artist", "promoter"] as Role[]).map((r) => (
            <label key={r} className={`chip${role === r ? " on" : ""}`}><input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />{r === "artist" ? "Artist or band" : "Promoter"}</label>
          ))}</div></fieldset>
        <Field label="Email" htmlFor="email" error={errors.email}><input id="email" type="email" autoComplete="email" value={v.email} onChange={set("email")} aria-invalid={!!errors.email} /></Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters." error={errors.password}><input id="password" type="password" autoComplete="new-password" value={v.password} onChange={set("password")} aria-invalid={!!errors.password} /></Field>
        <Field label={role === "artist" ? "Artist or band name" : "Promoter name"} htmlFor="name" error={errors.name}><input id="name" value={v.name} onChange={set("name")} aria-invalid={!!errors.name} /></Field>
        <Field label="Based in" htmlFor="city"><select id="city" value={v.city} onChange={set("city")}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <fieldset className={`field${errors.genres ? " has-error" : ""}`}><legend>Genres</legend>
          <div className="chips">{GENRES.map((g) => (
            <label key={g} className={`chip${genres.includes(g) ? " on" : ""}`}><input type="checkbox" checked={genres.includes(g)} onChange={() => setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g])} />{g}</label>
          ))}</div>
          {errors.genres && <p className="field-error" role="alert">{errors.genres}</p>}</fieldset>
        <Field label="A line or two about you" htmlFor="blurb" hint="Shown to the other side when you request or book a slot."><textarea id="blurb" rows={3} value={v.blurb} onChange={set("blurb")} maxLength={300} /></Field>
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
    </div>
  );
}
