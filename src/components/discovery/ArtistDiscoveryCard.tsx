"use client";

import Link from "next/link";
import type { Artist } from "@/lib/types";
import { GenreTag } from "@/components/ui/Tag";
import ArtistAvatarImage from "@/components/artists/ArtistAvatarImage";
import { ArtistListenButton } from "@/components/artists/ArtistLinksDisplay";
import SaveToRosterButton from "@/components/roster/SaveToRosterButton";

// The promoter-facing browsing card for Discover Artists. Deliberately
// shows only real, self-reported profile data — no ratings, availability
// status, monthly-listener counts or verification badge here, even though
// some of those exist elsewhere in the app, so nothing on this specific
// scanning/browsing surface reads as a credential or trust score. The full
// profile (reachable via "View profile") still shows everything it always
// has.
export default function ArtistDiscoveryCard({
  artist,
  onInvite,
}: {
  artist: Artist;
  onInvite: () => void;
}) {
  const bio = artist.bio?.trim();

  return (
    <div className="flex flex-col border border-ink-border bg-ink-raised">
      <Link href={`/artist/${artist.handle}`} className="block">
        <div className="aspect-[4/3] w-full overflow-hidden bg-ink">
          <ArtistAvatarImage
            artistId={artist.id}
            src={artist.bannerImage || artist.image}
            alt={artist.name}
            className="h-full w-full object-cover"
          />
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <Link href={`/artist/${artist.handle}`} className="min-w-0">
          <p className="font-display text-xl truncate">{artist.name}</p>
        </Link>
        <p className="mt-0.5 text-xs text-paper-dim">{artist.location}</p>

        {artist.genres.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
            {artist.genres.slice(0, 3).map((g) => (
              <GenreTag key={g} genre={g} />
            ))}
          </div>
        )}

        {bio ? (
          <p className="mt-3 text-sm text-paper-dim line-clamp-2 flex-1">{bio}</p>
        ) : (
          <p className="mt-3 text-sm text-paper-dim/50 italic flex-1">No bio yet.</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={`/artist/${artist.handle}`}
            className="font-mono text-[10px] uppercase tracking-widest border border-ink-border px-3 py-2 hover:border-paper transition-colors"
          >
            View profile
          </Link>
          <button
            type="button"
            onClick={onInvite}
            className="font-mono text-[10px] uppercase tracking-widest border border-acid text-acid px-3 py-2 hover:bg-acid hover:text-acid-ink transition-colors"
          >
            Invite to gig
          </button>
          <ArtistListenButton artist={artist} size="sm" />
          <SaveToRosterButton artistId={artist.id} size="sm" />
        </div>
      </div>
    </div>
  );
}
