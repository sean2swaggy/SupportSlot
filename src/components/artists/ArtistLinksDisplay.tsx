"use client";

import type { Artist } from "@/lib/types";
import { listPlatformLinks, primaryListenLink, type ArtistLinksOverride } from "@/lib/artist-links";
import Button from "@/components/ui/Button";

function linksOf(artist: Artist): ArtistLinksOverride {
  return {
    spotifyUrl: artist.spotifyUrl,
    instagramUrl: artist.instagramUrl,
    tiktokUrl: artist.tiktokUrl,
    soundcloudUrl: artist.soundcloudUrl,
    bandcampUrl: artist.bandcampUrl,
    youtubeUrl: artist.youtubeUrl,
    websiteUrl: artist.websiteUrl,
  };
}

/** The primary "Listen" CTA — Spotify first, then whichever other listening link is set. */
export function ArtistListenButton({
  artist,
  size = "md",
  className,
}: {
  artist: Artist;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const url = primaryListenLink(linksOf(artist));
  if (!url) return null;
  return (
    <Button href={url} target="_blank" rel="noopener noreferrer" size={size} className={className}>
      Listen
    </Button>
  );
}

/** The row of platform links (Spotify, Instagram, TikTok, and anything the artist added). */
export function ArtistSocialLinksRow({ artist, className }: { artist: Artist; className?: string }) {
  const list = listPlatformLinks(linksOf(artist));
  if (list.length === 0) return null;
  return (
    <div className={className}>
      {list.map((l) => (
        <a
          key={l.key}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] uppercase tracking-widest text-paper-dim hover:text-acid transition-colors"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}
