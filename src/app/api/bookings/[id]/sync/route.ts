import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, limited, requireUser } from "@/lib/server/request";

// Called when the customer comes back from paying (and by the booking page
// while it waits). It does NOT trust the browser: it asks Stripe directly for
// the PaymentIntent and applies the same SQL function the webhook uses, which
// checks the amount and PaymentIntent against the agreed booking and is a
// no-op if the webhook already recorded it. If Stripe says the payment hasn't
// succeeded, nothing changes.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const limit = await limited(`sync:${user.id}`, 30, 60);
  if (limit) return limit;

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, artist_id, promoter_id, stripe_payment_intent_id, payment_status")
    .eq("id", id)
    .maybeSingle();
  if (!booking || (booking.promoter_id !== user.id && booking.artist_id !== user.id)) {
    return json({ error: "Booking not found." }, 404);
  }
  if (!booking.stripe_payment_intent_id) return json({ paymentStatus: booking.payment_status });

  const intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id, { expand: ["latest_charge"] });
  const admin = createAdminClient();
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;

  if (intent.status === "succeeded") {
    const { error } = await admin.rpc("apply_payment_succeeded", {
      p_event_id: `sync:${intent.id}`,
      p_occurred: new Date((charge?.created ?? intent.created) * 1000).toISOString(),
      p_payment_intent_id: intent.id,
      p_booking_id: booking.id,
      p_amount_pence: intent.amount_received || intent.amount,
      p_charge_id: charge?.id ?? null,
      p_receipt_url: charge?.receipt_url ?? null,
    });
    if (error) {
      console.error("sync: apply_payment_succeeded failed", error.message);
      return json({ error: "We couldn't confirm that payment automatically. If you were charged, contact support." }, 409);
    }
  } else if (intent.status === "processing") {
    await admin.rpc("apply_payment_processing", {
      p_event_id: `sync:${intent.id}:processing`,
      p_occurred: new Date().toISOString(),
      p_payment_intent_id: intent.id,
      p_booking_id: booking.id,
    });
  }

  const { data: fresh } = await supabase.from("bookings").select("payment_status").eq("id", id).maybeSingle();
  return json({ paymentStatus: fresh?.payment_status ?? booking.payment_status, stripeStatus: intent.status });
}
