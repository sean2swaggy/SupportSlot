"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getOpenSlots, getVenues } from "@/lib/queries";
import { computeMatch, matchFactors } from "@/lib/match";
import { distanceBetween } from "@/lib/geo";
import SlotCard from "@/components/slots/SlotCard";
import Select from "@/components/ui/Select";
import SectionHeading from "@/components/ui/SectionHeading";
import { useStore } from "@/lib/store";
import PromoterDiscoverArtists from "@/components/discovery/PromoterDiscoverArtists";
import type { SupportSlot, Venue } from "@/lib/types";

const CITY_OPTIONS = [
  { value: "any", label: "Any location" },
  { value: "London", label: "London" },
  { value: "Manchester", label: "Manchester" },
  { value: "Birmingham", label: "Birmingham" },
  { value: "Bristol", label: "Bristol" },
  { value: "Leeds", label: "Leeds" },
  { value: "Brighton", label: "Brighton" },
];

const GENRE_OPTIONS = [
  { value: "any", label: "Any genre" },
  { value: "Alternative", label: "Alternative" },
  { value: "Electronic", label: "Electronic" },
  { value: "Indie", label: "Indie" },
  { value: "Experimental", label: "Experimental" },
  { value: "Hip-Hop", label: "Hip-Hop" },
  { value: "Punk", label: "Punk" },
  { value: "Folk", label: "Folk" },
  { value: "Pop", label: "Pop" },
  { value: "R&B", label: "R&B" },
  { value: "Techno", label: "Techno" },
  { value: "Drum & Bass", label: "Drum & Bass" },
  { value: "Rock", label: "Rock" },
];

const DATE_OPTIONS = [
  { value: "any", label: "Any date" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "Next 3 months" },
];

const PAY_OPTIONS = [
  { value: "any", label: "Any pay" },
  { value: "80", label: "£80+" },
  { value: "120", label: "£120+" },
  { value: "150", label: "£150+" },
  { value: "200", label: "£200+" },
];

const VENUE_SIZE_OPTIONS = [
  { value: "any", label: "Any venue size" },
  { value: "intimate", label: "Intimate (< 250)" },
  { value: "mid", label: "Mid (250–400)" },
  { value: "large", label: "Large (400+)" },
];

const DISTANCE_OPTIONS = [
  { value: "any", label: "Any distance" },
  { value: "25", label: "Within 25 miles" },
  { value: "60", label: "Within 60 miles" },
  { value: "120", label: "Within 120 miles" },
  { value: "999", label: "Nationwide" },
];

const ARTIST_SIZE_OPTIONS = [
  { value: "any", label: "Any artist size" },
  { value: "emerging", label: "Emerging" },
  { value: "developing", label: "Developing" },
  { value: "established", label: "Established" },
];

// Role-aware on purpose, same URL either way — a promoter's old bookmark
// to /discover should lead to artist discovery, without breaking an
// artist's own bookmark to the same URL (see the "Discover Artists"
// change: promoter discovery was previously just this same slot-browsing
// page, unchanged, which is exactly the bug being fixed).
export default function DiscoverPage() {
  // AppGate never renders this page until the store has hydrated, so role
  // is already reliable here — no loading branch needed.
  const { role } = useStore();

  if (role === "promoter") {
    return <PromoterDiscoverArtists />;
  }

  return <ArtistDiscoverSlots />;
}

function ArtistDiscoverSlots() {
  const { currentArtist } = useStore();
  const me = currentArtist;

  const [location, setLocation] = useState("any");
  const [genre, setGenre] = useState("any");
  const [date, setDate] = useState("any");
  const [pay, setPay] = useState("any");
  const [venueSize, setVenueSize] = useState("any");
  const [distance, setDistance] = useState("any");
  const [artistSize, setArtistSize] = useState("any");
  const [now] = useState(() => Date.now());

  const [openSlots, setOpenSlots] = useState<SupportSlot[]>([]);
  const [venuesById, setVenuesById] = useState<Record<string, Venue>>({});
  useEffect(() => {
    const supabase = createClient();
    getOpenSlots(supabase).then(setOpenSlots);
    getVenues(supabase).then((venues) =>
      setVenuesById(Object.fromEntries(venues.map((v) => [v.id, v])))
    );
  }, []);

  const withMatch = useMemo(
    () => (me ? openSlots.map((s) => ({ slot: s, match: computeMatch(me, s) })) : []),
    [openSlots, me]
  );

  const recommended = useMemo(
    () => [...withMatch].sort((a, b) => b.match - a.match).slice(0, 4),
    [withMatch]
  );

  const filtered = useMemo(() => {
    return withMatch.filter(({ slot }) => {
      if (location !== "any" && slot.city !== location) return false;
      if (genre !== "any" && !slot.genres.includes(genre as never)) return false;
      if (date !== "any") {
        const days = Math.ceil(
          (new Date(slot.date).getTime() - now) / (1000 * 60 * 60 * 24)
        );
        if (date === "week" && days > 7) return false;
        if (date === "month" && days > 31) return false;
        if (date === "quarter" && days > 92) return false;
      }
      if (pay !== "any" && slot.supportFee < Number(pay)) return false;
      if (venueSize !== "any") {
        const cap = venuesById[slot.venueId]?.capacity ?? 0;
        if (venueSize === "intimate" && cap >= 250) return false;
        if (venueSize === "mid" && (cap < 250 || cap > 400)) return false;
        if (venueSize === "large" && cap <= 400) return false;
      }
      if (distance !== "any" && me) {
        const d = distanceBetween(me.location, slot.city);
        if (d > Number(distance)) return false;
      }
      if (artistSize !== "any" && !slot.artistSizeFit.includes(artistSize as never))
        return false;
      return true;
    });
  }, [withMatch, location, genre, date, pay, venueSize, distance, artistSize, me, venuesById, now]);

  const resetFilters = () => {
    setLocation("any");
    setGenre("any");
    setDate("any");
    setPay("any");
    setVenueSize("any");
    setDistance("any");
    setArtistSize("any");
  };

  const anyActive =
    location !== "any" ||
    genre !== "any" ||
    date !== "any" ||
    pay !== "any" ||
    venueSize !== "any" ||
    distance !== "any" ||
    artistSize !== "any";

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        Find a slot
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-6xl leading-[0.95] tracking-tight">
        Support opportunities
      </h1>
      <p className="mt-4 max-w-[54ch] text-paper-dim">
        Browse every open support slot on the platform. Filter by location,
        genre, date, pay, venue size and artist size to find the shows that
        actually fit.
      </p>

      {/* FILTERS */}
      <div className="mt-9 flex flex-wrap gap-2.5">
        <Select label="Where" value={location} onChange={setLocation} options={CITY_OPTIONS} />
        <Select label="Genre" value={genre} onChange={setGenre} options={GENRE_OPTIONS} />
        <Select label="When" value={date} onChange={setDate} options={DATE_OPTIONS} />
        <Select label="Pay" value={pay} onChange={setPay} options={PAY_OPTIONS} />
        <Select
          label="Venue"
          value={venueSize}
          onChange={setVenueSize}
          options={VENUE_SIZE_OPTIONS}
        />
        <Select
          label="Distance"
          value={distance}
          onChange={setDistance}
          options={DISTANCE_OPTIONS}
        />
        <Select
          label="Artist size"
          value={artistSize}
          onChange={setArtistSize}
          options={ARTIST_SIZE_OPTIONS}
        />
        {anyActive && (
          <button
            onClick={resetFilters}
            className="font-mono text-[10px] uppercase tracking-widest text-signal hover:underline px-3 py-2.5"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* RECOMMENDED */}
      {!anyActive && (
        <div className="mt-14">
          <SectionHeading
            eyebrow="Personalised"
            title="Recommended for you"
            action={
              <p className="max-w-[30ch] text-right text-xs text-paper-dim hidden sm:block">
                Guidance only, based on {matchFactors().join(", ").toLowerCase()}.
              </p>
            }
          />
          <div className="mt-6 -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-5 overflow-x-auto no-scrollbar sm:grid sm:grid-cols-2 lg:grid-cols-4">
            {recommended.map(({ slot, match }) => (
              <div key={slot.id} className="min-w-[260px] sm:min-w-0">
                <SlotCard slot={slot} matchPercent={match} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RESULTS */}
      <div className="mt-14">
        <SectionHeading
          eyebrow="Open slots"
          title={`${filtered.length} ${filtered.length === 1 ? "result" : "results"}`}
        />
        {filtered.length === 0 ? (
          <div className="mt-10 border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">No slots match those filters</p>
            <p className="mt-2 text-sm text-paper-dim">
              Try widening your distance or clearing a filter.
            </p>
            <button
              onClick={resetFilters}
              className="mt-5 font-mono text-xs uppercase tracking-widest text-acid hover:underline"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered
              .sort((a, b) => new Date(a.slot.date).getTime() - new Date(b.slot.date).getTime())
              .map(({ slot, match }) => (
                <SlotCard key={slot.id} slot={slot} matchPercent={match} />
              ))}
          </div>
        )}
      </div>

      <div className="mt-16 border-t border-ink-border pt-6">
        <Link
          href="/last-minute"
          className="font-mono text-xs uppercase tracking-widest text-signal hover:underline"
        >
          🚨 Looking for something last-minute? See urgent slots →
        </Link>
      </div>
    </div>
  );
}
