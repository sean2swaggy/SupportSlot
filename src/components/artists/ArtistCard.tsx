"use client";

import Link from "next/link";
import type { Artist } from "@/lib/types";
import { GenreTag } from "@/components/ui/Tag";
import MatchBadge from "@/components/ui/MatchBadge";
import VerifiedBadge from "@/components/ui/VerifiedBadge";
import ArtistAvatarImage from "@/components/artists/ArtistAvatarImage";
import ArtistMonthlyListenersLabel from "@/components/artists/ArtistMonthlyListenersLabel";

export default function ArtistCard({
  artist,
  matchPercent,
  children,
}: {
  artist: Artist;
  matchPercent?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="border border-ink-border bg-ink-raised p-4 flex gap-4">
      <Link href={`/artist/${artist.handle}`} className="shrink-0">
        <div className="h-20 w-20 overflow-hidden border border-ink-border">
          <ArtistAvatarImage
            artistId={artist.id}
            src={artist.image}
            alt={artist.name}
            className="h-full w-full object-cover"
          />
        </div>
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/artist/${artist.handle}`} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-display text-lg truncate">{artist.name}</p>
              {artist.verification === "verified" && <VerifiedBadge />}
            </div>
            <p className="text-xs text-paper-dim">
              {artist.location} · <ArtistMonthlyListenersLabel artist={artist} /> monthly listeners
            </p>
          </Link>
          {typeof matchPercent === "number" && <MatchBadge percent={matchPercent} size="sm" />}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
          {artist.genres.map((g) => (
            <GenreTag key={g} genre={g} />
          ))}
        </div>
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    </div>
  );
}
