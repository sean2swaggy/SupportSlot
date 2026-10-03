"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { addTrack, deleteTrack, updateArtistProfile, updateTrack } from "@/lib/actions";
import { isValidDuration, profileChecklist, profileCompletion, trackUrlError } from "@/lib/profile";
import { isSafeExternalUrl } from "@/lib/artist-links";
import type { Result } from "@/lib/result";
import type { Artist, Genre } from "@/lib/types";
import Button from "@/components/ui/Button";
import ArtistCard from "@/components/artists/ArtistCard";
import ArtistLinksEditor from "@/components/artists/ArtistLinksEditor";
import ArtistMonthlyListenersEditor from "@/components/artists/ArtistMonthlyListenersEditor";
import { cn } from "@/lib/utils";

const GENRES: Genre[] = ["Alternative", "Electronic", "Indie", "Experimental", "Hip-Hop", "Punk", "Folk", "Pop", "R&B", "Techno", "Drum & Bass", "Rock"];
const CITIES = ["London", "Manchester", "Birmingham", "Bristol", "Leeds", "Brighton"];
const fieldCls = "w-full border border-ink-border bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-2 block";

function useSave() {
  const { reload } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const run = async (fn: () => Promise<Result<unknown>>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await fn();
    if (result.ok) {
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else setError(result.error);
    setBusy(false);
    return result.ok;
  };
  return { busy, error, saved, run };
}

function Status({ error, saved }: { error: string | null; saved: boolean }) {
  return (
    <>
      {saved && <span className="font-mono text-[10px] uppercase tracking-widest text-ok">Saved ✓</span>}
      {error && <p className="basis-full text-sm text-signal" role="alert">{error}</p>}
    </>
  );
}

function BasicsEditor({ artist }: { artist: Artist }) {
  const [name, setName] = useState(artist.name);
  const [location, setLocation] = useState<string>(artist.location);
  const [genres, setGenres] = useState<string[]>(artist.genres);
  const [bio, setBio] = useState(artist.bio);
  const [availability, setAvailability] = useState(artist.availability);
  const [radius, setRadius] = useState(String(artist.travelRadiusMiles));
  const [video, setVideo] = useState(artist.liveVideoUrl ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useSave();

  const submit = () => {
    setLocalError(null);
    if (name.trim().length < 1) return setLocalError("Enter your artist name.");
    if (genres.length < 1) return setLocalError("Choose at least one genre.");
    if (genres.length > 5) return setLocalError("Choose at most 5 genres.");
    const miles = Number(radius);
    if (!Number.isInteger(miles) || miles < 0 || miles > 500) return setLocalError("Travel radius must be a whole number of miles between 0 and 500.");
    if (video.trim() && !isSafeExternalUrl(video.trim())) return setLocalError("The live video link must start with https://");
    void save.run(() =>
      updateArtistProfile(createClient(), artist.id, {
        name: name.trim(),
        location,
        genres,
        bio: bio.trim(),
        availability,
        travel_radius_miles: miles,
        live_video_url: video.trim() || null,
      })
    );
  };

  return (
    <section className="border border-ink-border p-5 sm:p-6">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-5">About you</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="pf-name" className={labelCls}>Artist name</label>
          <input id="pf-name" className={fieldCls} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pf-city" className={labelCls}>Based in</label>
          <select id="pf-city" className={cn(fieldCls, "appearance-none")} value={location} onChange={(e) => setLocation(e.target.value)}>
            {CITIES.map((c) => (
              <option key={c} value={c} className="bg-ink-card">{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-avail" className={labelCls}>Availability</label>
          <select id="pf-avail" className={cn(fieldCls, "appearance-none")} value={availability} onChange={(e) => setAvailability(e.target.value as Artist["availability"])}>
            <option value="available" className="bg-ink-card">Available for shows</option>
            <option value="limited" className="bg-ink-card">Limited availability</option>
            <option value="unavailable" className="bg-ink-card">Not taking shows</option>
          </select>
        </div>
        <div>
          <label htmlFor="pf-radius" className={labelCls}>Travel radius (miles)</label>
          <input id="pf-radius" inputMode="numeric" className={fieldCls} value={radius} onChange={(e) => setRadius(e.target.value.replace(/[^0-9]/g, ""))} />
        </div>
      </div>
      <div className="mt-5">
        <p className={labelCls}>Genres (up to 5)</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Genres">
          {GENRES.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={genres.includes(g)}
              onClick={() => setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))}
              className={cn("font-mono text-[10px] uppercase tracking-widest px-3 py-2 border transition-colors", genres.includes(g) ? "border-acid text-acid" : "border-ink-border text-paper-dim hover:border-paper")}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5">
        <label htmlFor="pf-bio" className={labelCls}>Bio</label>
        <textarea id="pf-bio" rows={4} maxLength={1000} className={fieldCls} value={bio} onChange={(e) => setBio(e.target.value)} />
        <p className="mt-1 text-right font-mono text-[10px] text-paper-dim">{bio.length}/1000</p>
      </div>
      <div className="mt-3">
        <label htmlFor="pf-video" className={labelCls}>Live performance video (link)</label>
        <input id="pf-video" className={fieldCls} placeholder="https://youtube.com/watch?v=…" value={video} onChange={(e) => setVideo(e.target.value)} />
        <p className="mt-1.5 text-xs text-paper-dim">Shown to promoters as a link to watch you play live. We don&rsquo;t host the video.</p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={save.busy}>{save.busy ? "Saving…" : "Save"}</Button>
        <Status error={localError ?? save.error} saved={save.saved} />
      </div>
    </section>
  );
}

function TrackRow({ artist, track, index }: { artist: Artist; track: Artist["tracks"][number]; index: number }) {
  const [title, setTitle] = useState(track.title);
  const [duration, setDuration] = useState(track.duration);
  const [url, setUrl] = useState(track.url ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useSave();
  const dirty = title !== track.title || duration !== track.duration || url !== (track.url ?? "");

  const submit = () => {
    setLocalError(null);
    if (!title.trim()) return setLocalError("Give the track a title.");
    if (!isValidDuration(duration)) return setLocalError("Enter the length as m:ss, e.g. 3:24.");
    const urlProblem = trackUrlError(url);
    if (urlProblem) return setLocalError(urlProblem);
    void save.run(() => updateTrack(createClient(), artist.id, track.id, { title, duration, url: url.trim() || null }));
  };

  return (
    <li className="border border-ink-border p-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_1.3fr] gap-3">
        <input aria-label={`Track ${index + 1} title`} className={fieldCls} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input aria-label={`Track ${index + 1} length`} className={fieldCls} placeholder="3:24" value={duration} onChange={(e) => setDuration(e.target.value)} />
        <input aria-label={`Track ${index + 1} link`} className={fieldCls} placeholder="Link to the song (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={submit} disabled={!dirty || save.busy}>{save.busy ? "Saving…" : "Save track"}</Button>
        <button
          type="button"
          disabled={save.busy}
          onClick={() => {
            if (window.confirm(`Remove “${track.title}”? Applications already sent keep working.`)) void save.run(() => deleteTrack(createClient(), artist.id, track.id));
          }}
          className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal hover:underline"
        >
          Remove
        </button>
        <Status error={localError ?? save.error} saved={save.saved} />
      </div>
    </li>
  );
}

function TracksEditor({ artist }: { artist: Artist }) {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [url, setUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useSave();

  const add = async () => {
    setLocalError(null);
    if (!title.trim()) return setLocalError("Give the track a title.");
    if (!isValidDuration(duration)) return setLocalError("Enter the length as m:ss, e.g. 3:24.");
    const urlProblem = trackUrlError(url);
    if (urlProblem) return setLocalError(urlProblem);
    const ok = await save.run(() => addTrack(createClient(), artist.id, { title, duration, url: url.trim() || null }, artist.tracks.length));
    if (ok) {
      setTitle("");
      setDuration("");
      setUrl("");
    }
  };

  return (
    <section className="border border-ink-border p-5 sm:p-6">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-1">Your tracks</h2>
      <p className="text-xs text-paper-dim mb-5 max-w-[56ch]">When you apply, you pick one track to feature. Add a link so promoters can listen.</p>
      {artist.tracks.length > 0 && (
        <ul className="space-y-3 mb-6">
          {artist.tracks.map((t, i) => (
            <TrackRow key={t.id + t.title + t.duration + (t.url ?? "")} artist={artist} track={t} index={i} />
          ))}
        </ul>
      )}
      <p className={labelCls}>Add a track</p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_1.3fr] gap-3">
        <input aria-label="New track title" className={fieldCls} placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input aria-label="New track length" className={fieldCls} placeholder="3:24" value={duration} onChange={(e) => setDuration(e.target.value)} />
        <input aria-label="New track link" className={fieldCls} placeholder="Link to the song (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={add} disabled={save.busy}>{save.busy ? "Adding…" : "Add track"}</Button>
        <Status error={localError ?? save.error} saved={save.saved} />
      </div>
    </section>
  );
}

export default function ArtistProfilePage() {
  const { currentArtist } = useStore();
  if (!currentArtist) return null;
  const artist = currentArtist;
  const items = profileChecklist(artist);
  const { done, total, percent } = profileCompletion(items);

  return (
    <div className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <Link href="/dashboard/artist" className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper">
        ← Back to dashboard
      </Link>
      <h1 className="mt-4 font-display uppercase text-3xl sm:text-5xl leading-none">Your profile</h1>
      <p className="mt-3 max-w-[60ch] text-paper-dim">What promoters see when you apply. Changes save to your public profile straight away.</p>

      <section className="mt-8 border border-ink-border p-5 sm:p-6" aria-labelledby="checklist-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="checklist-title" className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">Profile checklist</h2>
          <p className="font-mono text-xs">{done}/{total} done</p>
        </div>
        <div className="mt-3 h-1.5 bg-ink-border" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completion">
          <div className="h-full bg-acid" style={{ width: `${percent}%` }} />
        </div>
        <ul className="mt-4 space-y-2">
          {items.map((i) => (
            <li key={i.key} className="flex gap-3 text-sm">
              <span className={i.done ? "text-ok" : "text-paper-dim"} aria-hidden>{i.done ? "✓" : "○"}</span>
              <span>
                <span className={i.done ? "text-paper-dim line-through" : ""}>{i.label}</span>
                {!i.done && <span className="block text-xs text-paper-dim">{i.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 space-y-6">
        <BasicsEditor key={`${artist.name}|${artist.bio}|${artist.location}|${artist.genres.join()}|${artist.availability}|${artist.travelRadiusMiles}|${artist.liveVideoUrl ?? ""}`} artist={artist} />
        <TracksEditor artist={artist} />
        <ArtistLinksEditor artist={artist} />
        <ArtistMonthlyListenersEditor artist={artist} />
      </div>

      <section className="mt-10" aria-labelledby="preview-title">
        <h2 id="preview-title" className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-3">How a promoter sees you</h2>
        <ArtistCard artist={artist}>
          <p className="w-full text-sm text-paper-dim line-clamp-3">{artist.bio || "No bio yet."}</p>
          <p className="w-full text-xs text-paper-dim">
            {artist.tracks.length} track{artist.tracks.length === 1 ? "" : "s"} · {artist.liveVideoUrl ? "live video linked" : "no live video"}
          </p>
        </ArtistCard>
        <div className="mt-3">
          <Button href={`/artist/${artist.handle}`} variant="outline" size="sm">Open public profile</Button>
        </div>
      </section>
    </div>
  );
}
