import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Field } from "../components/ui";
import { Gate } from "../components/Gate";
import { repo } from "../data";
import { CITIES, GENRES } from "../domain/catalog";
import { addDays, todayLondon } from "../domain/dates";
import { toPence } from "../domain/money";
import { useNotice } from "../hooks";

export function ListingForm() {
  return <Gate role="promoter">{(u) => <Inner promoterId={u.id} defaultCity={u.city} />}</Gate>;
}

function Inner({ promoterId, defaultCity }: { promoterId: string; defaultCity: string }) {
  const nav = useNavigate();
  const notice = useNotice();
  const [v, setV] = useState({ venue: "", city: defaultCity, date: addDays(todayLondon(), 14), doors: "19:00", setTime: "19:45", setMinutes: "30", fee: "80", capacity: "120", notes: "" });
  const [genres, setGenres] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    const fee = toPence(v.fee);
    const mins = Number(v.setMinutes);
    const cap = Number(v.capacity);
    if (!v.venue.trim()) err.venue = "Add the venue name.";
    if (!v.date || v.date < todayLondon()) err.date = "Choose today or a later date.";
    if (!Number.isInteger(mins) || mins < 10 || mins > 90) err.setMinutes = "Between 10 and 90 minutes.";
    if (fee === null) err.fee = "Enter pounds, like 80 or 80.50. Use 0 for no fee.";
    if (!Number.isInteger(cap) || cap < 1) err.capacity = "Enter the room capacity.";
    if (genres.length === 0) err.genres = "Pick at least one genre.";
    setErrors(err); setFormError(null);
    if (Object.keys(err).length) { document.querySelector<HTMLElement>(".has-error input, .has-error select, .has-error fieldset input")?.focus(); return; }
    setBusy(true);
    try {
      const l = await repo.createListing(promoterId, { venue: v.venue, city: v.city, date: v.date, doors: v.doors, setTime: v.setTime, setMinutes: mins, genres, capacity: cap, feePence: fee!, notes: v.notes.trim() });
      notice("Slot posted. Artists can request it now.");
      nav(`/listings/${l.id}`);
    } catch (x) { setFormError((x as Error).message); setBusy(false); }
  };

  return (
    <div className="page narrow">
      <p className="crumb"><Link to="/listings">← My listings</Link></p>
      <header className="page-head"><h1>Post a support slot</h1><p className="sub">Be specific. Clear listings get better requests.</p></header>
      <form onSubmit={submit} noValidate className="form">
        {formError && <div className="banner banner-bad" role="alert">{formError}</div>}
        <Field label="Venue" htmlFor="venue" error={errors.venue}><input id="venue" value={v.venue} onChange={set("venue")} aria-invalid={!!errors.venue} aria-describedby={errors.venue ? "venue-err" : undefined} /></Field>
        <div className="grid2">
          <Field label="City" htmlFor="city"><select id="city" value={v.city} onChange={set("city")}>{[...new Set([defaultCity, ...CITIES])].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Show date" htmlFor="date" error={errors.date}><input id="date" type="date" min={todayLondon()} value={v.date} onChange={set("date")} aria-invalid={!!errors.date} /></Field>
        </div>
        <div className="grid3">
          <Field label="Doors" htmlFor="doors"><input id="doors" type="time" value={v.doors} onChange={set("doors")} /></Field>
          <Field label="Support set starts" htmlFor="setTime"><input id="setTime" type="time" value={v.setTime} onChange={set("setTime")} /></Field>
          <Field label="Set length (min)" htmlFor="setMinutes" error={errors.setMinutes}><input id="setMinutes" inputMode="numeric" value={v.setMinutes} onChange={set("setMinutes")} aria-invalid={!!errors.setMinutes} /></Field>
        </div>
        <div className="grid2">
          <Field label="Fee offered (£)" htmlFor="fee" hint="Paid to the artist by you, directly." error={errors.fee}><input id="fee" inputMode="decimal" value={v.fee} onChange={set("fee")} aria-invalid={!!errors.fee} /></Field>
          <Field label="Room capacity" htmlFor="capacity" error={errors.capacity}><input id="capacity" inputMode="numeric" value={v.capacity} onChange={set("capacity")} aria-invalid={!!errors.capacity} /></Field>
        </div>
        <fieldset className={`field${errors.genres ? " has-error" : ""}`}>
          <legend>Genres that fit</legend>
          <div className="chips">{GENRES.map((g) => (
            <label key={g} className={`chip${genres.includes(g) ? " on" : ""}`}><input type="checkbox" checked={genres.includes(g)} onChange={() => setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g])} />{g}</label>
          ))}</div>
          {errors.genres && <p className="field-error" role="alert">{errors.genres}</p>}
        </fieldset>
        <Field label="Notes for artists" htmlFor="notes" hint="Backline, load-in, parking, food, who's headlining."><textarea id="notes" rows={4} value={v.notes} onChange={set("notes")} maxLength={600} /></Field>
        <div className="actions"><button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Posting…" : "Post slot"}</button><Link className="btn btn-quiet" to="/listings">Cancel</Link></div>
      </form>
    </div>
  );
}
