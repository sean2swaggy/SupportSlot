import { isSafeExternalUrl, listPlatformLinks } from "./artist-links";
import type { Artist } from "./types";

// What makes an artist profile worth applying with. Every item is something a
// promoter can actually see on the profile, so "complete" means "a promoter
// has what they need" — not a made-up score.

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  hint: string;
}

type ProfileFields = Pick<
  Artist,
  "image" | "bio" | "genres" | "tracks" | "liveVideoUrl" | "spotifyUrl" | "soundcloudUrl" | "bandcampUrl" | "youtubeUrl" | "instagramUrl" | "tiktokUrl" | "websiteUrl"
>;

export function profileChecklist(a: ProfileFields): ChecklistItem[] {
  const links = listPlatformLinks({
    spotifyUrl: a.spotifyUrl,
    soundcloudUrl: a.soundcloudUrl,
    bandcampUrl: a.bandcampUrl,
    youtubeUrl: a.youtubeUrl,
    instagramUrl: a.instagramUrl,
    tiktokUrl: a.tiktokUrl,
    websiteUrl: a.websiteUrl,
  });
  const listenLink = links.some((l) => ["spotifyUrl", "soundcloudUrl", "bandcampUrl", "youtubeUrl"].includes(l.key));
  return [
    { key: "photo", label: "Profile photo", done: !!a.image, hint: "Promoters recognise a face or a logo." },
    { key: "bio", label: "A bio of at least 40 characters", done: a.bio.trim().length >= 40, hint: "Two or three sentences about your sound and live experience." },
    { key: "genres", label: "At least one genre", done: a.genres.length > 0, hint: "Used to show how well a listing fits you." },
    { key: "tracks", label: "At least one track", done: a.tracks.length > 0, hint: "You choose one to feature on each application." },
    { key: "listen", label: "A place to listen", done: listenLink, hint: "Add a Spotify, SoundCloud, Bandcamp or YouTube link." },
    { key: "video", label: "A live performance video", done: isSafeExternalUrl(a.liveVideoUrl), hint: "Promoters booking a support act want to see you play live." },
  ];
}

export function profileCompletion(items: ChecklistItem[]): { done: number; total: number; percent: number } {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, percent: Math.round((done / items.length) * 100) };
}

/** Returns an error message, or null if the track link is empty or a valid http(s) URL. */
export function trackUrlError(url: string): string | null {
  const v = url.trim();
  if (!v) return null;
  if (v.length > 500) return "That link is too long.";
  return isSafeExternalUrl(v) ? null : "Use a full link starting with https://";
}

/** "3:24" → true. Minutes 0–99, seconds 00–59. */
export function isValidDuration(d: string): boolean {
  return /^\d{1,2}:[0-5]\d$/.test(d.trim());
}
