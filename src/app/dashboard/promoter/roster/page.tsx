"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getBookingHistoryWithArtist, getRoster, removeFromRoster, updateRosterEntry } from "@/lib/queries";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import { formatDate, formatGBP } from "@/lib/utils";
import Button from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import type { Application, Genre, RosterEntry, SupportSlot } from "@/lib/types";

export default function RosterPage() {
  const { currentPromoterId, isSupportPlus } = useStore();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState<Genre | null>(null);
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<RosterEntry | null>(null);

  const load = () => {
    if (!currentPromoterId) return;
    getRoster(createClient(), currentPromoterId).then((r) => {
      setRoster(r);
      setLoading(false);
    });
  };

  useEffect(load, [currentPromoterId]);

  const genres = useMemo(
    () => Array.from(new Set(roster.flatMap((r) => r.artist.genres))).sort(),
    [roster]
  );
  const locations = useMemo(
    () => Array.from(new Set(roster.map((r) => r.artist.location))).sort(),
    [roster]
  );
  const tags = useMemo(() => Array.from(new Set(roster.flatMap((r) => r.tags))).sort(), [roster]);

  const filtered = roster.filter((r) => {
    if (search && !r.artist.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (genreFilter && !r.artist.genres.includes(genreFilter)) return false;
    if (locationFilter && r.artist.location !== locationFilter) return false;
    if (tagFilter && !r.tags.includes(tagFilter)) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <Link
        href="/dashboard/promoter"
        className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-paper"
      >
        ← Back to dashboard
      </Link>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-2">
            Support+ · Private
          </p>
          <h1 className="font-display uppercase text-3xl sm:text-5xl leading-none">Artist roster</h1>
          <p className="mt-3 max-w-[60ch] text-paper-dim">
            Artists you&rsquo;ve saved from profiles or applications. Only you can see this list —
            artists are never notified, and it never affects their match score or ranking.
          </p>
        </div>
        <Button href="/dashboard/promoter/requests" size="md">
          Availability requests
        </Button>
      </div>

      {!isSupportPlus && (
        <div className="mt-8 border border-acid/50 bg-acid/5 p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-acid mb-1">
            Support+ has lapsed
          </p>
          <p className="text-sm text-paper-dim">
            Your roster is preserved and still visible below, but adding artists or editing notes
            needs an active Support+ subscription.{" "}
            <Link href="/support-plus" className="underline hover:text-paper">
              Resubscribe
            </Link>
            .
          </p>
        </div>
      )}

      {roster.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="border border-ink-border bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
          />
          <select
            value={genreFilter ?? ""}
            onChange={(e) => setGenreFilter((e.target.value as Genre) || null)}
            className="border border-ink-border bg-transparent px-3 py-2.5 text-sm outline-none focus:border-paper"
          >
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={locationFilter ?? ""}
            onChange={(e) => setLocationFilter(e.target.value || null)}
            className="border border-ink-border bg-transparent px-3 py-2.5 text-sm outline-none focus:border-paper"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {tags.length > 0 && (
            <select
              value={tagFilter ?? ""}
              onChange={(e) => setTagFilter(e.target.value || null)}
              className="border border-ink-border bg-transparent px-3 py-2.5 text-sm outline-none focus:border-paper"
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mt-8 space-y-4">
        {loading ? (
          <p className="text-sm text-paper-dim">Loading roster…</p>
        ) : roster.length === 0 ? (
          <div className="border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">Your roster is empty</p>
            <p className="mt-2 text-sm text-paper-dim max-w-[46ch] mx-auto">
              Save artists from their profile or from an applicant list to build your private
              roster — genre, location and note filters show up here once you have a few.
            </p>
            <Button href="/discover" size="md" className="mt-5">
              Browse artists
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-paper-dim">No saved artists match those filters.</p>
        ) : (
          filtered.map((entry) => (
            <RosterCard
              key={entry.id}
              entry={entry}
              editable={isSupportPlus}
              onRemoved={load}
              onOpenHistory={() => setHistoryFor(entry)}
            />
          ))
        )}
      </div>

      {historyFor && (
        <BookingHistoryPanel entry={historyFor} promoterId={currentPromoterId} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

function RosterCard({
  entry,
  editable,
  onRemoved,
  onOpenHistory,
}: {
  entry: RosterEntry;
  editable: boolean;
  onRemoved: () => void;
  onOpenHistory: () => void;
}) {
  const [notes, setNotes] = useState(entry.notes);
  const [saved, setSaved] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState(entry.tags);
  const [removing, setRemoving] = useState(false);

  const saveNotes = async () => {
    const ok = await updateRosterEntry(createClient(), entry.id, { notes });
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  const addTag = async () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
    const ok = await updateRosterEntry(createClient(), entry.id, { tags: next });
    if (ok) {
      setTags(next);
      setTagInput("");
    }
  };

  const removeTag = async (t: string) => {
    const next = tags.filter((x) => x !== t);
    const ok = await updateRosterEntry(createClient(), entry.id, { tags: next });
    if (ok) setTags(next);
  };

  const remove = async () => {
    setRemoving(true);
    const ok = await removeFromRoster(createClient(), entry.id);
    if (ok) onRemoved();
    else setRemoving(false);
  };

  return (
    <div className="border border-ink-border bg-ink-raised p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
        <Link href={`/artist/${entry.artist.handle}`} className="flex items-center gap-3 min-w-0">
          <img
            src={entry.artist.image || DEFAULT_FALLBACK}
            alt=""
            className="h-14 w-14 object-cover shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm">{entry.artist.name}</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              {entry.artist.location} · {entry.artist.genres.join(" / ")}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenHistory}
            className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-paper transition-colors"
          >
            Booking history
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            className="font-mono text-[10px] uppercase tracking-widest text-signal hover:underline disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim mb-1.5">
          Private notes
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          disabled={!editable}
          rows={2}
          placeholder="Only visible to you..."
          className="w-full resize-none border border-ink-border bg-transparent p-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60 disabled:opacity-50"
        />
        {saved && <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ok">Saved</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tags.map((t) => (
          <Tag key={t} className="flex items-center gap-1.5">
            {t}
            {editable && (
              <button type="button" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}>
                ×
              </button>
            )}
          </Tag>
        ))}
        {editable && (
          <div className="flex items-center gap-1">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              placeholder="Add tag..."
              className="w-24 border border-ink-border bg-transparent px-2 py-1 text-xs outline-none focus:border-paper placeholder:text-paper-dim/60"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BookingHistoryPanel({
  entry,
  promoterId,
  onClose,
}: {
  entry: RosterEntry;
  promoterId: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<Array<Application & { slot: SupportSlot }> | null>(null);

  useEffect(() => {
    getBookingHistoryWithArtist(createClient(), promoterId, entry.artist.id).then(setHistory);
  }, [promoterId, entry.artist.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/85 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-lg max-h-[85vh] overflow-y-auto bg-ink-card border border-ink-border sm:mx-4 p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
              Booking history
            </p>
            <h2 className="font-display text-2xl mt-1">{entry.artist.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-paper-dim hover:text-paper text-xl leading-none">
            ×
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {history === null ? (
            <p className="text-sm text-paper-dim">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-paper-dim">
              No applications or bookings with this artist yet.
            </p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 border border-ink-border p-3">
                <div className="min-w-0">
                  <p className="text-sm truncate">{h.slot.headliner}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                    {formatDate(h.slot.date, { withYear: true })} · {formatGBP(h.slot.supportFee)}
                  </p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-paper-dim shrink-0">
                  {h.status.replace("_", " ")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
