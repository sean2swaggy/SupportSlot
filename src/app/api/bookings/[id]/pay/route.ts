import { stripe } from "@/lib/stripe/server";
import { fetchTransfersActive } from "@/lib/stripe/connect";
import { getOrCreatePromoterCustomer } from "@/lib/stripe/customers";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, limited, requireUser } from "@/lib/server/request";

// Starts (or resumes) payment for ONE confirmed booking. Everything that
// matters is decided here from the stored booking terms — the browser sends
// nothing but the booking id, so it can't change the amount, the recipient
// or the fees.
//
//   amount        = booking.total_pence        (fee + travel + booking fee + processing)
//   recipient     = the artist's connected account, looked up server-side
//   platform fee  = booking fee + processing   (so the artist receives fee + travel in full)
//
// The booking is only ever marked paid by the verified webhook (or the
// provider-verified sync route) — never because a page was opened.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const limit = await limited(`pay:${user.id}`, 12, 60);
  if (limit) return limit;

  // The caller's own client: RLS means they can only see a booking they're part of.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, application_id, slot_id, artist_id, promoter_id, status, payment_status, stripe_payment_intent_id, total_pence, booking_fee_pence, processing_fee_pence, headliner, artist_name")
    .eq("id", id)
    .maybeSingle();
  if (!booking) return json({ error: "Booking not found." }, 404);
  if (booking.promoter_id !== user.id) return json({ error: "Only the promoter who made the booking can pay for it." }, 403);
  if (booking.status !== "confirmed") {
    return json({ error: "The artist has to accept the offer before you can pay." }, 409);
  }
  if (["paid", "partially_refunded", "refunded", "disputed"].includes(booking.payment_status)) {
    return json({ error: "This booking has already been paid.", paymentStatus: booking.payment_status }, 409);
  }

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("artist_payment_accounts")
    .select("stripe_account_id")
    .eq("artist_id", booking.artist_id)
    .maybeSingle();
  if (!account?.stripe_account_id) {
    return json({ error: `${booking.artist_name} hasn't set up payouts yet — they need to finish Stripe onboarding before you can pay.` }, 400);
  }

  // Ask Stripe, not our cache, whether they can receive money right now.
  let active: boolean;
  try {
    active = await fetchTransfersActive(account.stripe_account_id);
  } catch (err) {
    console.error("Couldn't verify payout eligibility", err);
    return json({ error: "We couldn't verify the artist's payout setup with Stripe just now. Please try again in a minute." }, 502);
  }
  await admin
    .from("artist_payment_accounts")
    .update({ transfers_active: active, checked_at: new Date().toISOString() })
    .eq("artist_id", booking.artist_id);
  await admin.from("artists").update({ stripe_transfers_active: active }).eq("id", booking.artist_id);
  if (!active) {
    return json({ error: `${booking.artist_name}'s payout account isn't able to receive payments right now. Ask them to check their Stripe setup.` }, 400);
  }

  // Resume an existing, still-usable PaymentIntent rather than creating a second one.
  if (booking.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
    if (existing.status === "succeeded") {
      return json({ status: "paid_pending_sync", message: "This payment already went through — updating your booking." });
    }
    if (existing.status === "processing") {
      return json({ status: "processing", message: "Your payment is being processed." });
    }
    if (
      ["requires_payment_method", "requires_confirmation", "requires_action"].includes(existing.status) &&
      existing.amount === booking.total_pence &&
      existing.currency === "gbp"
    ) {
      return json({ clientSecret: existing.client_secret, totalPence: booking.total_pence, status: existing.status });
    }
  }

  const customerId = await getOrCreatePromoterCustomer(user.id, user.email);
  // Stable per (booking, attempt): two simultaneous requests compute the same
  // key, so Stripe hands both the SAME PaymentIntent — no double charge.
  const { count } = await admin
    .from("payment_events")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", booking.id)
    .eq("kind", "payment_started");

  const intent = await stripe.paymentIntents.create(
    {
      amount: booking.total_pence,
      currency: "gbp",
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      transfer_data: { destination: account.stripe_account_id },
      application_fee_amount: booking.booking_fee_pence + booking.processing_fee_pence,
      receipt_email: user.email ?? undefined,
      description: `Support Slot booking: ${booking.artist_name} — ${booking.headliner}`,
      transfer_group: `booking_${booking.id}`,
      metadata: { booking_id: booking.id, application_id: booking.application_id ?? "", slot_id: booking.slot_id ?? "" },
    },
    { idempotencyKey: `booking-pay:${booking.id}:${count ?? 0}` }
  );

  const { error: attachError } = await admin.rpc("attach_payment_intent", {
    p_booking_id: booking.id,
    p_payment_intent_id: intent.id,
  });
  if (attachError) {
    console.error("attach_payment_intent failed", attachError.message);
    return json({ error: "We couldn't start that payment. Please try again." }, 500);
  }

  return json({ clientSecret: intent.client_secret, totalPence: booking.total_pence, status: intent.status });
}
