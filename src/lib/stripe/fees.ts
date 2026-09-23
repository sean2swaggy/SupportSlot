// Estimated Stripe processing fee for a UK domestic card charge, used only
// to size `application_fee_amount` so Support Slot's real margin doesn't
// get eaten by Stripe's own fee on every destination charge (see the
// Connect recommendation, Section H — "Option A: application_fee_amount =
// platform fee + estimated Stripe processing fee"). This is an estimate,
// not what Stripe actually charges — real rates vary by card type, region
// and negotiated pricing (see stripe.com/pricing). Revisit if actual
// margins (Dashboard → Connect → margin report) drift from this estimate.
const ESTIMATED_STRIPE_PERCENT = 0.015; // 1.5%
const ESTIMATED_STRIPE_FIXED_PENCE = 20; // £0.20

/** All amounts in whole pence. `totalPence` is what the promoter pays. */
export function applicationFeePence(bookingFeePence: number, totalPence: number): number {
  const estimatedStripeFee = Math.round(totalPence * ESTIMATED_STRIPE_PERCENT) + ESTIMATED_STRIPE_FIXED_PENCE;
  return bookingFeePence + estimatedStripeFee;
}

export function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}
