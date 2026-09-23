"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { getAllArtists } from "@/lib/queries";
import { distanceBetween } from "@/lib/geo";
import Select from "@/components/ui/Select";
import SectionHeading from "@/components/ui/SectionHeading";
import ArtistDiscoveryCard from "@/components/discovery/ArtistDiscoveryCard";
import InviteToGigModal from "@/components/discovery/InviteToGigModal";
import type { Artist, Genre } from "@/lib/types";

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

const LOCATION_OPTIONS = [
  { value: "any", label: "Any location" },
  { value: "London", label: "London" },
  { value: "Manchester", label: "Manchester" },
  { value: "Birmingham", label: "Birmingham" },
  { value: "Bristol", label: "Bristol" },
  { value: "Leeds", label: "Leeds" },
  { value: "Brighton", label: "Brighton" },
];

const DISTANCE_OPTIONS = [
  { value: "any", label: "Any distance" },
  { value: "25", label: "Within 25 miles" },
  { value: "60", label: "Within 60 miles" },
  { value: "120", label: "Within 120 miles" },
  { value: "999", label: "Nationwide" },
];

export default function PromoterDiscoverArtists() {
  const { currentPromoter, currentPromoterId } = useStore();
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("any");
  const [location, setLocation] = useState("any");
  const [distance, setDistance] = useState("any");
  const [inviteTarget, setInviteTarget] = useState<Artist | null>(null);

  useEffect(() => {
    getAllArtists(createClient())
      .then(setArtists)
      .catch(() => setError(true));
  }, []);

  const filtered = useMemo(() => {
    if (!artists) return [];
    return artists.filter((a) => {
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (genre !== "any" && !a.genres.includes(genre as Genre)) return false;
      if (location !== "any" && a.location !== location) return false;
      if (distance !== "any" && currentPromoter?.location) {
        const d = distanceBetween(currentPromoter.location, a.location);
        if (d > Number(distance)) return false;
      }
      return true;
    });
  }, [artists, search, genre, location, distance, currentPromoter]);

  const anyActive = search !== "" || genre !== "any" || location !== "any" || distance !== "any";
  const resetFilters = () => {
    setSearch("");
    setGenre("any");
    setLocation("any");
    setDistance("any");
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
        Browse artists
      </p>
      <h1 className="font-display uppercase text-4xl sm:text-6xl leading-[0.95] tracking-tight">
        Discover artists
      </h1>
      <p className="mt-4 max-w-[58ch] text-paper-dim">
        Browse independent artists on Support Slot, save the ones you like to your roster, and
        invite them straight to one of your own gigs.
      </p>

      <div className="mt-9 flex flex-wrap gap-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by artist or band name..."
          className="border border-ink-border bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60 min-w-[220px]"
        />
        <Select label="Genre" value={genre} onChange={setGenre} options={GENRE_OPTIONS} />
        <Select label="Where" value={location} onChange={setLocation} options={LOCATION_OPTIONS} />
        {currentPromoter?.location && (
          <Select label="Distance" value={distance} onChange={setDistance} options={DISTANCE_OPTIONS} />
        )}
        {anyActive && (
          <button
            onClick={resetFilters}
            className="font-mono text-[10px] uppercase tracking-widest text-signal hover:underline px-3 py-2.5"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-10">
        <SectionHeading
          eyebrow="Artists"
          title={artists === null ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "result" : "results"}`}
        />

        {error ? (
          <div className="mt-10 border border-dashed border-signal/50 p-10 text-center">
            <p className="font-display text-xl">Couldn&rsquo;t load artists</p>
            <p className="mt-2 text-sm text-paper-dim">Try refreshing the page.</p>
          </div>
        ) : artists === null ? (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border border-ink-border bg-ink-raised animate-pulse">
                <div className="aspect-[4/3] bg-ink" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-2/3 bg-ink" />
                  <div className="h-3 w-1/3 bg-ink" />
                </div>
              </div>
            ))}
          </div>
        ) : artists.length === 0 ? (
          <div className="mt-10 border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">No artists on the platform yet</p>
            <p className="mt-2 text-sm text-paper-dim">
              Once artists sign up and complete their profile, they&rsquo;ll show up here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 border border-dashed border-ink-border p-10 text-center">
            <p className="font-display text-xl">No artists match those filters</p>
            <p className="mt-2 text-sm text-paper-dim">Try widening your search or clearing a filter.</p>
            <button
              onClick={resetFilters}
              className="mt-5 font-mono text-xs uppercase tracking-widest text-acid hover:underline"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map((artist) => (
              <ArtistDiscoveryCard key={artist.id} artist={artist} onInvite={() => setInviteTarget(artist)} />
            ))}
          </div>
        )}
      </div>

      {inviteTarget && (
        <InviteToGigModal
          open={!!inviteTarget}
          onClose={() => setInviteTarget(null)}
          artist={inviteTarget}
          promoterId={currentPromoterId}
        />
      )}
    </div>
  );
}
