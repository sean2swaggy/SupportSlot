import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";
import { applicationFeePence, toPence } from "@/lib/stripe/fees";
import { effectiveTravelContribution } from "@/lib/travel";

// Creates the real PaymentIntent for booking an artist — a destination
// charge (per the Connect plan): the full amount is charged to the
// promoter, application_fee_amount stays with Support Slot, and the rest
// transfers automatically to the artist's connected account.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { applicationId } = await request.json();
  if (!applicationId) {
    return NextResponse.json({ error: "Missing applicationId." }, { status: 400 });
  }

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, status, slot_id, artist_id, slots(promoter_id, support_fee, travel_contribution, booking_fee, city), artists(stripe_account_id, stripe_transfers_active, location, name)"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const slot = application.slots as unknown as {
    promoter_id: string;
    support_fee: number;
    travel_contribution: number;
    booking_fee: number;
    city: string;
  } | null;
  const artist = application.artists as unknown as {
    stripe_account_id: string | null;
    stripe_transfers_active: boolean;
    location: string;
    name: string;
  } | null;

  if (!slot || slot.promoter_id !== user.id) {
    return NextResponse.json({ error: "Not authorized for this booking." }, { status: 403 });
  }
  if (application.status === "booked") {
    return NextResponse.json({ error: "This application is already booked." }, { status: 409 });
  }
  if (!artist?.stripe_account_id || !artist.stripe_transfers_active) {
    return NextResponse.json(
      { error: `${artist?.name ?? "This artist"} hasn't finished setting up payouts yet — they need to complete Stripe onboarding before you can book and pay them.` },
      { status: 400 }
    );
  }

  const travelFee = effectiveTravelContribution(slot.travel_contribution, artist.location, slot.city);
  const totalPence = toPence(slot.support_fee + travelFee + slot.booking_fee);
  const applicationFee = applicationFeePence(toPence(slot.booking_fee), totalPence);

  // Reuse (or create) a Stripe Customer for this promoter so the Payment
  // Element can offer "save this card" and show it back on their next
  // booking — no held balance, every booking is still its own full charge.
  const { data: promoterRow } = await supabase
    .from("promoters")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  let customerId = promoterRow?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await supabase.from("promoters").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalPence,
    currency: "gbp",
    customer: customerId,
    setup_future_usage: "off_session",
    automatic_payment_methods: { enabled: true },
    transfer_data: { destination: artist.stripe_account_id },
    application_fee_amount: applicationFee,
    metadata: { application_id: application.id, slot_id: application.slot_id },
  });

  await supabase
    .from("applications")
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq("id", applicationId);

  return NextResponse.json({ clientSecret: paymentIntent.client_secret, totalPence });
}
