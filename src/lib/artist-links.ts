import type { Artist } from "./types";

/**
 * Extra links an artist can add themselves from their dashboard, layered on
 * top of the fixed spotify/instagram/tiktok fields every mock artist ships
 * with. Stored as a client-side override in lib/store.tsx — there's no real
 * account backend in this prototype, so this only ever applies to "the
 * current artist" (see CURRENT_ARTIST_ID).
 */
export interface ArtistLinksOverride {
  spotifyUrl?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
  soundcloudUrl?: string;
  bandcampUrl?: string;
  youtubeUrl?: string;
  websiteUrl?: string;
}

export type LinkPlatform = keyof ArtistLinksOverride;

export interface PlatformLink {
  key: LinkPlatform;
  label: string;
  url: string;
}

export const PLATFORM_LABELS: Record<LinkPlatform, string> = {
  spotifyUrl: "Spotify",
  soundcloudUrl: "SoundCloud",
  bandcampUrl: "Bandcamp",
  youtubeUrl: "YouTube",
  instagramUrl: "Instagram",
  tiktokUrl: "TikTok",
  websiteUrl: "Website",
};

// Controls display order everywhere links are listed.
const PLATFORM_ORDER: LinkPlatform[] = [
  "spotifyUrl",
  "soundcloudUrl",
  "bandcampUrl",
  "youtubeUrl",
  "instagramUrl",
  "tiktokUrl",
  "websiteUrl",
];

/**
 * Merges a saved override on top of the artist's baked-in mock links.
 * Spotify/Instagram/TikTok fall back to the mock value when the override is
 * blank; the newer platforms (SoundCloud, Bandcamp, YouTube, website) have
 * no mock fallback, so they only appear once the artist adds one.
 */
export function mergeArtistLinks(
  artist: Artist,
  override: ArtistLinksOverride | undefined
): ArtistLinksOverride {
  return {
    spotifyUrl: override?.spotifyUrl?.trim() || artist.spotifyUrl,
    instagramUrl: override?.instagramUrl?.trim() || artist.instagramUrl,
    tiktokUrl: override?.tiktokUrl?.trim() || artist.tiktokUrl,
    soundcloudUrl: override?.soundcloudUrl?.trim() || undefined,
    bandcampUrl: override?.bandcampUrl?.trim() || undefined,
    youtubeUrl: override?.youtubeUrl?.trim() || undefined,
    websiteUrl: override?.websiteUrl?.trim() || undefined,
  };
}

// These render straight into an <a href> on a public, unauthenticated
// profile page (ArtistLinksDisplay.tsx) — every field here is user-
// supplied text with no format enforced server-side, so without this check
// a `javascript:...` (or `data:`, `vbscript:`, etc.) value saved as e.g.
// spotifyUrl would execute in the browser of anyone who viewed the profile
// and clicked it. Only http(s) links are ever safe to render as a real
// navigable link; anything else is dropped rather than shown broken.
export function isSafeExternalUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function listPlatformLinks(links: ArtistLinksOverride): PlatformLink[] {
  return PLATFORM_ORDER.map((key) => ({ key, label: PLATFORM_LABELS[key], url: links[key] || "" })).filter(
    (l) => isSafeExternalUrl(l.url)
  );
}

/** The link used for the primary "Listen" call to action. */
export function primaryListenLink(links: ArtistLinksOverride): string | undefined {
  return [links.spotifyUrl, links.soundcloudUrl, links.bandcampUrl, links.youtubeUrl].find(
    isSafeExternalUrl
  );
}
