import { distanceBetween } from "./geo";
import type { Artist, SupportSlot } from "./types";

// An honest "why this might suit you" explanation, built only from fields
// that really exist on the artist and the listing. It replaces the old
// percentage, which was a formula with a hard floor of 38 and a ceiling of
// 99 — a number with no real meaning. Nothing here can be paid for, and a
// missing field is reported as "unknown", never guessed.
//
// This is guidance for the artist and a convenience for the promoter. It is
// never a ranking that decides who gets booked: promoters choose.

export type FitState = "match" | "partial" | "mismatch" | "unknown";

export interface FitSignal {
  key: "genre" | "location" | "size";
  label: string;
  state: FitState;
  detail: string;
}

export interface Fit {
  signals: FitSignal[];
  /** How many of the signals are a clear match. */
  matched: number;
  /** How many signals could be assessed from real data (state !== "unknown"). */
  assessed: number;
  summary: string;
}

type ArtistFitFields = Pick<Artist, "genres" | "location" | "travelRadiusMiles" | "artistSize">;
type SlotFitFields = Pick<SupportSlot, "genres" | "city" | "artistSizeFit">;

export function explainFit(artist: ArtistFitFields, slot: SlotFitFields): Fit {
  const signals: FitSignal[] = [];

  // Genre
  if (artist.genres.length === 0) {
    signals.push({ key: "genre", label: "Genre", state: "unknown", detail: "Add your genres to your profile to see this." });
  } else {
    const shared = slot.genres.filter((g) => artist.genres.includes(g));
    signals.push(
      shared.length > 0
        ? { key: "genre", label: "Genre", state: "match", detail: `You both list ${shared.join(", ")}.` }
        : { key: "genre", label: "Genre", state: "mismatch", detail: `This show is ${slot.genres.join(" / ") || "unspecified"}; your profile lists ${artist.genres.join(", ")}.` }
    );
  }

  // Location / travel
  if (artist.location === slot.city) {
    signals.push({ key: "location", label: "Location", state: "match", detail: `You're based in ${slot.city}.` });
  } else {
    const miles = distanceBetween(artist.location, slot.city);
    const within = miles <= artist.travelRadiusMiles;
    signals.push({
      key: "location",
      label: "Location",
      state: within ? "partial" : "mismatch",
      detail: within
        ? `About ${miles} miles from ${artist.location}, within the ${artist.travelRadiusMiles}-mile travel radius you set.`
        : `About ${miles} miles from ${artist.location}, beyond the ${artist.travelRadiusMiles}-mile travel radius you set.`,
    });
  }

  // Artist size
  if (slot.artistSizeFit.length === 0) {
    signals.push({ key: "size", label: "Artist size", state: "unknown", detail: "The promoter hasn't said what size of act they want." });
  } else if (slot.artistSizeFit.includes(artist.artistSize)) {
    signals.push({ key: "size", label: "Artist size", state: "match", detail: `They want ${slot.artistSizeFit.join(" or ")} acts; you're ${artist.artistSize}.` });
  } else {
    signals.push({ key: "size", label: "Artist size", state: "mismatch", detail: `They want ${slot.artistSizeFit.join(" or ")} acts; you're ${artist.artistSize}.` });
  }

  const matched = signals.filter((s) => s.state === "match").length;
  const assessed = signals.filter((s) => s.state !== "unknown").length;
  const summary =
    assessed === 0
      ? "Not enough profile information to compare yet."
      : `${matched} of ${assessed} fit signals match.`;
  return { signals, matched, assessed, summary };
}

/**
 * A sort key for "recommended" ordering: more clear matches first, then more
 * partial ones. Only ever used to order a list a person can see the reasons
 * for — it's not displayed as a score.
 */
export function fitRank(fit: Fit): number {
  return fit.signals.reduce((n, s) => n + (s.state === "match" ? 10 : s.state === "partial" ? 4 : 0), 0);
}
