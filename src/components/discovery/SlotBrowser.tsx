"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { searchSlots, type SlotSearchResult } from "@/lib/queries";
import { londonToday } from "@/lib/dates";
import { explainFit } from "@/lib/fit";
import { useStore } from "@/lib/store";
import SlotCard from "@/components/slots/SlotCard";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";

const any = (label: string) => ({ value: "any", label });
const CITY_OPTIONS = [any("Any location"), ...["London", "Manchester", "Birmingham", "Bristol", "Leeds", "Brighton"].map((c) => ({ value: c, label: c }))];
const GENRE_OPTIONS = [
  any("Any genre"),
  ...["Alternative", "Electronic", "Indie", "Experimental", "Hip-Hop", "Punk", "Folk", "Pop", "R&B", "Techno", "Drum & Bass", "Rock"].map((g) => ({ value: g, label: g })),
];
const DATE_OPTIONS = [any("Any date"), { value: "week", label: "Next 7 days" }, { value: "month", label: "Next 31 days" }, { value: "quarter", label: "Next 3 months" }];
const PAY_OPTIONS = [any("Any pay"), ...[80, 120, 150, 200].map((n) => ({ value: String(n), label: `£${n}+` }))];
const VENUE_OPTIONS = [any("Any venue size"), { value: "intimate", label: "Intimate (< 250)" }, { value: "mid", label: "Mid (250–400)" }, { value: "large", label: "Large (400+)" }];
const ARTIST_SIZE_OPTIONS = [any("Any artist size"), { value: "emerging", label: "Emerging" }, { value: "developing", label: "Developing" }, { value: "established", label: "Established" }];
const DISTANCE_OPTIONS = [any("Any distance"), { value: "25", label: "Within 25 miles" }, { value: "60", label: "Within 60 miles" }, { value: "120", label: "Within 120 miles" }];
const SORT_OPTIONS = [{ value: "date", label: "Soonest first" }, { value: "fee", label: "Highest fee" }, { value: "newest", label: "Newly posted" }];

const PAGE_SIZE = 12;
const RANGE_DAYS: Record<string, number> = { week: 7, month: 31, quarter: 92 };

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Public gig discovery. Works for signed-out visitors: searching, filtering,
 * sorting and paging all happen in one server-side query, and the filter
 * state lives in the URL so a search can be shared or bookmarked. Closed,
 * filled, cancelled and past listings never appear (the query excludes them).
 * When the viewer is an artist each card also explains how the listing fits
 * their profile — information only, never a ranking that affects booking.
 */
export default function SlotBrowser({ urgentOnly = false, heading }: { urgentOnly?: boolean; heading?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { currentArtist, signedIn } = useStore();

  const get = (key: string, fallback = "any") => params.get(key) ?? fallback;
  const city = get("city");
  const genre = get("genre");
  const when = get("when");
  const pay = get("pay");
  const venue = get("venue");
  const artistSize = get("size");
  const distance = get("distance");
  const sort = get("sort", "date");
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const [draftQ, setDraftQ] = useState(q);
  // The last finished search, tagged with the query it answered. "Loading" is
  // simply "the latest query hasn't answered yet" — derived, not stored.
  const [done, setDone] = useState<{ key: string; result: SlotSearchResult | null; error: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const setParam = useCallback(
    (changes: Record<string, string | null>, keepPage = false) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === "" || v === "any" || (k === "sort" && v === "date")) next.delete(k);
        else next.set(k, v);
      }
      if (!keepPage) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );

  const artistCity = currentArtist?.location;
  const queryKey = JSON.stringify([q, city, genre, when, pay, venue, artistSize, distance, sort, page, urgentOnly, artistCity, reloadKey]);
  useEffect(() => {
    let cancelled = false;
    const today = londonToday();
    searchSlots(createClient(), {
      q,
      city: city === "any" ? undefined : city,
      genre: genre === "any" ? undefined : genre,
      from: when !== "any" ? today : undefined,
      to: when !== "any" ? addDays(today, RANGE_DAYS[when] ?? 92) : undefined,
      minFee: pay === "any" ? undefined : Number(pay),
      venueSize: venue === "any" ? undefined : (venue as "intimate" | "mid" | "large"),
      artistSize: artistSize === "any" ? undefined : (artistSize as "emerging" | "developing" | "established"),
      fromCity: distance !== "any" ? artistCity : undefined,
      maxMiles: distance !== "any" && artistCity ? Number(distance) : undefined,
      urgentOnly,
      sort: sort as "date" | "fee" | "newest",
      page,
      pageSize: PAGE_SIZE,
    }).then((res) => {
      if (cancelled) return;
      setDone(res.ok ? { key: queryKey, result: res.data, error: null } : { key: queryKey, result: done?.result ?? null, error: res.error });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  const result = done?.result ?? null;
  const error = done && done.key === queryKey ? done.error : null;
  const loading = !done || done.key !== queryKey;

  const anyActive = useMemo(
    () => !!q || [city, genre, when, pay, venue, artistSize, distance].some((v) => v !== "any"),
    [q, city, genre, when, pay, venue, artistSize, distance]
  );
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      {heading}

      <form
        className="mt-8 flex gap-2 max-w-xl"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParam({ q: draftQ.trim() });
        }}
      >
        <input
          type="search"
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          placeholder="Search headliner, venue, city…"
          aria-label="Search listings"
          maxLength={80}
          className="flex-1 border border-ink-border bg-transparent px-3.5 py-3 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
        />
        <Button type="submit" size="md">Search</Button>
      </form>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <Select label="Where" value={city} onChange={(v) => setParam({ city: v })} options={CITY_OPTIONS} />
        <Select label="Genre" value={genre} onChange={(v) => setParam({ genre: v })} options={GENRE_OPTIONS} />
        <Select label="When" value={when} onChange={(v) => setParam({ when: v })} options={DATE_OPTIONS} />
        <Select label="Pay" value={pay} onChange={(v) => setParam({ pay: v })} options={PAY_OPTIONS} />
        <Select label="Venue" value={venue} onChange={(v) => setParam({ venue: v })} options={VENUE_OPTIONS} />
        <Select label="Artist size" value={artistSize} onChange={(v) => setParam({ size: v })} options={ARTIST_SIZE_OPTIONS} />
        {currentArtist && <Select label="Distance" value={distance} onChange={(v) => setParam({ distance: v })} options={DISTANCE_OPTIONS} />}
        <Select label="Sort" value={sort} onChange={(v) => setParam({ sort: v })} options={SORT_OPTIONS} />
        {anyActive && (
          <button
            onClick={() => {
              setDraftQ("");
              router.replace(pathname, { scroll: false });
            }}
            className="font-mono text-[10px] uppercase tracking-widest text-signal hover:underline px-3 py-2.5"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-10" aria-live="polite">
        {error ? (
          <div className="border border-signal/50 p-8 text-center" role="alert">
            <p className="font-display text-xl">Couldn&rsquo;t load listings</p>
            <p className="mt-2 text-sm text-paper-dim">{error}</p>
            <Button className="mt-5" size="md" onClick={() => setReloadKey((k) => k + 1)}>Try again</Button>
          </div>
        ) : loading && !result ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-80 border border-ink-border bg-ink-raised animate-pulse" aria-hidden />
            ))}
          </div>
        ) : result && result.slots.length === 0 ? (
          <div className="border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">{anyActive ? "No listings match those filters" : "No open listings right now"}</p>
            <p className="mt-2 text-sm text-paper-dim">
              {anyActive ? "Try widening a filter." : "New listings are posted by promoters regularly — check back soon."}
            </p>
          </div>
        ) : result ? (
          <>
            <p className="font-mono text-[11px] uppercase tracking-widest text-paper-dim mb-5">
              {result.total} {result.total === 1 ? "result" : "results"}
              {loading && " · updating…"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {result.slots.map((slot) => (
                <SlotCard key={slot.id} slot={slot} fit={currentArtist ? explainFit(currentArtist, slot) : undefined} />
              ))}
            </div>
            {totalPages > 1 && (
              <nav className="mt-10 flex items-center justify-center gap-4" aria-label="Pagination">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) }, true)}>
                  ← Previous
                </Button>
                <span className="font-mono text-[11px] uppercase tracking-widest text-paper-dim">
                  Page {page} of {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setParam({ page: String(page + 1) }, true)}>
                  Next →
                </Button>
              </nav>
            )}
          </>
        ) : null}
      </div>

      {!signedIn && (
        <div className="mt-14 border border-ink-border p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-sm text-paper-dim max-w-[56ch]">
            You can browse every listing without an account. Create a free artist account to apply, save gigs and see how each
            show fits your profile.
          </p>
          <Button href="/login?mode=signup" size="md">Create an artist account</Button>
        </div>
      )}

      {!urgentOnly && (
        <div className="mt-16 border-t border-ink-border pt-6">
          <Link href="/last-minute" className="font-mono text-xs uppercase tracking-widest text-signal hover:underline">
            Looking for something last-minute? See urgent slots →
          </Link>
        </div>
      )}
    </div>
  );
}
