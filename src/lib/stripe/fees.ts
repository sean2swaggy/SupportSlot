// Booking money, in integer pence. These mirror the SQL in
// supabase/migrations/0020_marketplace_core.sql (processing_fee_pence /
// effective_travel_pence) — the database computes the terms that are
// actually charged; this copy only exists to PREVIEW a breakdown before an
// offer is made. tests/db/fees-parity.test.ts proves the two agree.
//
// Who pays what (the stated business model, and what the code now does):
//   - The artist receives the full agreed fee plus travel, always.
//   - The promoter pays: fee + travel + Support Slot's booking fee + the
//     estimated card-processing fee, itemised.
//   - Support Slot keeps the booking fee and the processing-fee estimate as
//     the Stripe `application_fee_amount`; Stripe's real fee is taken from
//     the platform. The estimate (UK card, 1.5% + 20p, grossed up) can differ
//     from the real fee on premium/international cards — the platform
//     absorbs that difference.

const ESTIMATED_STRIPE_PERCENT_X1000 = 15; // 1.5%
const ESTIMATED_STRIPE_FIXED_PENCE = 20;
const LONG_TRAVEL_MILES_PER_HOUR = 40;
export const MIN_LONG_TRAVEL_PENCE = 1000;

export function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}

/**
 * Card fee on the base amount, grossed up so charging it to the promoter
 * leaves the base amount intact: P = 0.015(T+P) + 20  =>  P = (0.015T+20)/0.985,
 * rounded up to the penny.
 */
export function processingFeePence(basePence: number): number {
  return Math.floor((ESTIMATED_STRIPE_PERCENT_X1000 * basePence + ESTIMATED_STRIPE_FIXED_PENCE * 1000 + 984) / 985);
}

export function effectiveTravelPence(basePence: number, distanceMiles: number): number {
  const long = distanceMiles / LONG_TRAVEL_MILES_PER_HOUR > 1;
  return long ? Math.max(basePence, MIN_LONG_TRAVEL_PENCE) : basePence;
}

export interface BookingBreakdown {
  feePence: number;
  travelPence: number;
  bookingFeePence: number;
  processingFeePence: number;
  totalPence: number;
  /** What the artist receives: the full agreed fee plus travel. */
  artistReceivesPence: number;
  /** What Support Slot keeps (also Stripe's application_fee_amount). */
  platformFeePence: number;
}

export function bookingBreakdown(input: {
  feePence: number;
  travelPence: number;
  bookingFeePence: number;
}): BookingBreakdown {
  const base = input.feePence + input.travelPence + input.bookingFeePence;
  const processing = processingFeePence(base);
  return {
    ...input,
    processingFeePence: processing,
    totalPence: base + processing,
    artistReceivesPence: input.feePence + input.travelPence,
    platformFeePence: input.bookingFeePence + processing,
  };
}
