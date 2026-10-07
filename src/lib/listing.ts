// Client-side checks for the listing form. These mirror the rules the
// database enforces in slots_guard() (0020_marketplace_core.sql) so a person
// sees "the deadline must be before the show" next to the field instead of
// after a failed save. The database is still the authority — nothing here is
// trusted, and a rule added in SQL but missing here just surfaces as the
// server's own message.

import type { Genre } from "./types";

export interface ListingDraft {
  headliner: string;
  venueId: string;
  date: string; // YYYY-MM-DD
  doorsTime: string; // HH:MM
  setTime: string;
  performanceLengthMins: number;
  expectedAttendance: number;
  genres: Genre[];
  artistSizeFit: Array<"emerging" | "developing" | "established">;
  supportFee: number;
  travelContribution: number;
  applicationDeadline: string;
  requirementsText: string;
  description: string;
  isUrgent: boolean;
}

export type ListingErrors = Partial<Record<keyof ListingDraft, string>>;


export function parseRequirements(text: string): string[] {
  return text
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
}

const isWholeNumber = (n: number) => Number.isFinite(n) && Number.isInteger(n);

/**
 * @param today London calendar date (YYYY-MM-DD). `existing` lets an edit keep
 * a date that's already in the past without tripping the "in the past" rule
 * on fields the person didn't touch.
 */
export function validateListing(
  d: ListingDraft,
  today: string,
  existing?: { date: string; applicationDeadline: string }
): ListingErrors {
  const e: ListingErrors = {};

  const headliner = d.headliner.trim();
  if (headliner.length < 1) e.headliner = "Enter the headliner or show name.";
  else if (headliner.length > 120) e.headliner = "Keep the name to 120 characters or fewer.";

  if (!d.venueId) e.venueId = "Choose a venue.";

  if (!d.date) e.date = "Choose the show date.";
  else if (d.date < today && d.date !== existing?.date) e.date = "The show date can't be in the past.";

  if (!d.applicationDeadline) e.applicationDeadline = "Choose when applications close.";
  else if (d.applicationDeadline < today && d.applicationDeadline !== existing?.applicationDeadline)
    e.applicationDeadline = "The deadline can't be in the past.";
  else if (d.date && d.applicationDeadline > d.date) e.applicationDeadline = "Applications must close on or before the show date.";

  if (!d.doorsTime) e.doorsTime = "Enter the doors time.";
  if (!d.setTime) e.setTime = "Enter the set time.";
  else if (d.doorsTime && d.setTime < d.doorsTime) e.setTime = "The set can't start before doors.";

  if (!isWholeNumber(d.performanceLengthMins) || d.performanceLengthMins < 5 || d.performanceLengthMins > 240)
    e.performanceLengthMins = "Set length must be a whole number of minutes between 5 and 240.";

  if (!isWholeNumber(d.expectedAttendance) || d.expectedAttendance < 1 || d.expectedAttendance > 100000)
    e.expectedAttendance = "Enter the expected attendance (at least 1).";

  if (d.genres.length < 1) e.genres = "Choose at least one genre.";

  if (!isWholeNumber(d.supportFee) || d.supportFee < 0 || d.supportFee > 100000)
    e.supportFee = "The support fee must be a whole number of pounds between £0 and £100,000.";
  if (!isWholeNumber(d.travelContribution) || d.travelContribution < 0 || d.travelContribution > 5000)
    e.travelContribution = "Travel contribution must be a whole number of pounds between £0 and £5,000.";

  if (parseRequirements(d.requirementsText).length > 10) e.requirementsText = "At most 10 requirements.";
  if (d.description.length > 2000) e.description = "The description is too long (2,000 characters max).";

  return e;
}
