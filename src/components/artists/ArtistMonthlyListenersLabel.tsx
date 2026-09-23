import type { Artist } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

/**
 * Renders just the formatted number (callers supply their own "monthly
 * listeners" / "listeners" suffix text) so it drops into existing copy
 * unchanged. `artist.monthlyListeners` is the self-reported count stored
 * directly on the artist's row — see the "Monthly listeners" editor on the
 * artist dashboard for why it's self-reported rather than pulled from Spotify.
 */
export default function ArtistMonthlyListenersLabel({
  artist,
  className,
}: {
  artist: Artist;
  className?: string;
}) {
  return <span className={className}>{formatNumber(artist.monthlyListeners)}</span>;
}
