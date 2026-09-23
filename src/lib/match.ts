import type { Artist, SupportSlot } from "./types";

// A simple, transparent guidance score — never a guarantee, and never something
// an artist can pay to boost. Factors: genre overlap, location / travel radius,
// audience size compatibility, artist size fit, and general availability.
export function computeMatch(artist: Artist, slot: SupportSlot): number {
  let score = 0;

  // Genre overlap — up to 40 points
  const overlap = slot.genres.filter((g) => artist.genres.includes(g)).length;
  const genreScore = Math.min(40, overlap * 20);
  score += genreScore;

  // Location / distance — up to 25 points
  if (artist.location === slot.city) {
    score += 25;
  } else {
    score += 10; // touring artists still get partial credit
  }

  // Audience compatibility — up to 15 points, based on monthly listeners vs expected attendance
  const ratio = artist.monthlyListeners / Math.max(slot.expectedAttendance, 1);
  if (ratio >= 1 && ratio <= 15) score += 15;
  else if (ratio > 0.3) score += 9;
  else score += 4;

  // Artist size fit — up to 12 points
  if (slot.artistSizeFit.includes(artist.artistSize)) score += 12;
  else score += 3;

  // Availability — up to 8 points
  if (artist.availability === "available") score += 8;
  else if (artist.availability === "limited") score += 4;

  return Math.max(38, Math.min(99, Math.round(score)));
}

export function matchFactors() {
  return [
    "Genre",
    "Location",
    "Audience compatibility",
    "Artist size",
    "Availability",
  ];
}
