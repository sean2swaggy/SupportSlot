import { distanceBetween } from "./geo";
import type { UKCity } from "./types";

// Rough average road speed assumed for a UK support-slot journey — good
// enough for a prototype "how long will this take" estimate, not real routing.
export const ASSUMED_AVG_SPEED_MPH = 40;

// Above this estimated travel time, a guaranteed minimum travel
// compensation fee kicks in for the artist.
export const LONG_TRAVEL_THRESHOLD_HOURS = 1;

// The minimum fee (in GBP) guaranteed to the artist when the journey to the
// venue is estimated to take over LONG_TRAVEL_THRESHOLD_HOURS.
export const MIN_LONG_TRAVEL_FEE = 10;

export function estimatedTravelHours(
  artistCity: UKCity | string,
  venueCity: UKCity | string
): number {
  const miles = distanceBetween(artistCity, venueCity);
  return miles / ASSUMED_AVG_SPEED_MPH;
}

export function isLongTravel(artistCity: UKCity | string, venueCity: UKCity | string): boolean {
  return estimatedTravelHours(artistCity, venueCity) > LONG_TRAVEL_THRESHOLD_HOURS;
}

// The travel contribution the artist actually receives: whatever the promoter
// offered, topped up to the guaranteed minimum when the journey is over an hour.
export function effectiveTravelContribution(
  baseContribution: number,
  artistCity: UKCity | string,
  venueCity: UKCity | string
): number {
  if (isLongTravel(artistCity, venueCity)) {
    return Math.max(baseContribution, MIN_LONG_TRAVEL_FEE);
  }
  return baseContribution;
}
